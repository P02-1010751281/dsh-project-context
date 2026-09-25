/**
 * May this session hand off *now*? A running continuable subagent and a turn that opened
 * while the summary was being prepared both mean two sessions would work the same project
 * at once (the 2026-09-17 incident); both are read here.
 */

import { type Context } from "@deepseek-ai/cordis";
import { type Session } from "@deepseek-ai/dsh-session";
import { HandoffDeferred } from "./classify.js";

/** Bound on the live subagent listing, so a slow registry cannot stall the turn end. */
const SUBAGENT_LIST_TIMEOUT_MS = 5_000;

/**
 * A *continuable* background subagent that has not reported a settlement yet keeps the parent
 * session alive: when it settles, dsh wakes the parent with a notice and the parent starts a new
 * turn. Firing the automatic handoff inside that window hands the task off and *then* wakes the
 * parent, so parent and child work the same project at once. An unsettled child only counts for one
 * horizon, so a child that died without a notice cannot block handoffs forever.
 *
 * One-shot children are deliberately ignored: dsh catalogues them the same way, but only the
 * continuable activation reports a settlement, so counting them would defer every handoff for an
 * hour after a one-shot delegation (the default `subagent` mode, and all of `workflow`) had already
 * returned its result. A continuable child that is later *resumed* by a parent-side message is also
 * invisible here (resuming appends no new catalogue entry), which is the one known gap of this guard.
 */
const SUBAGENT_WORK_HORIZON_MS = 60 * 60_000;

/**
 * The event-log **fallback** for {@link runningContinuableChildren}: this session's continuable
 * subagent children that were spawned within the horizon and have not reported a settlement since.
 * Used only when the `subagents` service is unavailable. Read structurally: `subagent/catalog` and
 * the `subagent-settled` source kind are dsh-internal shapes, so a log from another version simply
 * yields no pending work — the guard fails open instead of blocking every handoff.
 * @param events - the session's *own* event log (a fork's inherited prefix is not this session's work).
 * @param now - current time in milliseconds.
 * @param horizonMs - how long an unsettled child keeps counting as running.
 * @returns the outstanding child session ids.
 */
export function outstandingSubagents(events: readonly unknown[], now: number, horizonMs: number = SUBAGENT_WORK_HORIZON_MS): string[] {
	const spawned = new Map<string, number>();
	const settled = new Map<string, number>();
	for (const raw of events) {
		const event = raw as {
			type?: unknown;
			time?: unknown;
			data?: { childId?: unknown; mode?: unknown; source?: { kind?: unknown; senderSessionId?: unknown } };
		};
		if (event.type === "subagent/catalog") {
			const id = event.data?.childId;
			// Only a continuable child reports a settlement; a one-shot child is done when its call
			// returns, so treating it as running would defer the handoff for the whole horizon.
			if (event.data?.mode !== "continuable") continue;
			if (typeof id === "string" && typeof event.time === "number") spawned.set(id, event.time);
			continue;
		}
		if (event.type === "user/message" && event.data?.source?.kind === "subagent-settled") {
			const id = event.data.source.senderSessionId;
			if (typeof id === "string" && typeof event.time === "number") settled.set(id, event.time);
		}
	}
	// The latest event per child wins, so a child that settled and was catalogued again counts again.
	return [...spawned]
		.filter(([id, at]) => at > (settled.get(id) ?? 0) && now - at <= horizonMs)
		.map(([id]) => id);
}

/**
 * This session's *own* events. A fork inherits its parent's log and an inherited child's notice
 * goes to the original parent, so the inherited prefix must not read as this session's work.
 */
export function ownEventsOf(session: Session): readonly unknown[] {
	const withOwn = session as { ownEvents?: () => readonly unknown[] };
	return withOwn.ownEvents?.() ?? session.snapshotEvents();
}

/**
 * Whether this session has started a new turn after `seq`, the offset of the `turn/end` that
 * triggered the automatic handoff. The check is deliberately log-based rather than
 * `agent.status`-based: at the trigger instant the driver's phase is still `running` (it settles
 * only after the turn returns), so a status read there cannot distinguish "this turn just closed"
 * from "another turn already started", while a `turn/start` after the trigger offset can. A
 * mid-flight status read *would* work, but one log predicate covers both the trigger-time and the
 * mid-flight checks.
 * @param session - the session being handed off.
 * @param seq - the triggering `turn/end` offset.
 * @returns `true` when a later `turn/start` exists.
 */
export function turnStartedAfter(session: Session, seq: number): boolean {
	for (const raw of ownEventsOf(session)) {
		const event = raw as { type?: unknown; seq?: unknown };
		if (event.type === "turn/start" && typeof event.seq === "number" && event.seq > seq) return true;
	}
	return false;
}

/** Defer the automatic handoff once its trigger's session has started another turn. */
export function assertSessionSettled(session: Session, triggerSeq: number | undefined): void {
	if (triggerSeq === undefined) return;
	if (turnStartedAfter(session, triggerSeq)) {
		throw new HandoffDeferred("the session started a new turn while the handoff was being prepared");
	}
}

/** Structural view of the optional `subagents` host service. */
interface SubagentsLike {
	/**
	 * The classified listing: one row per subagent in the root's tree, each carrying `kind`
	 * (`child`/`diagnostic`), `mode` and `activity`. It is the only listing that reports `activity`:
	 * dsh 0.1.6's `listChildren` returned this row, and 0.1.7-alpha.1 moved it here and left
	 * `listChildren` with the bare catalog row.
	 */
	listDescendants?(rootSessionId: string, signal?: AbortSignal): Promise<readonly unknown[]>;
	/** Direct-child catalog read: `{id, createdAt, mode, label}` — no `kind`, so no `activity`. */
	listChildren?(parentSessionId: string, signal?: AbortSignal): Promise<readonly unknown[]>;
}

/**
 * Continuable children the live registry still reports as running, or `undefined` when the service
 * is absent, failed, or answered in a shape this plugin cannot classify — the caller then falls back
 * to the event log. The registry is authoritative where it can be read: it knows `mode` (a one-shot
 * child never reports a settlement), reports `activity` directly instead of inferring it from a
 * one-hour horizon, and lists what the session store holds rather than what a fork inherited.
 *
 * The shape check is not defensive padding. dsh 0.1.7-alpha.1 changed `listChildren` from the
 * classified row to the bare catalog row, and a guard that filtered on `kind`/`activity` then
 * matched nothing and answered `[]` — an answer, so the caller's `??` never consulted the log
 * either, and the whole live-registry branch went silent for two releases. An empty listing is a
 * real answer ("no subagent below this session"); a listing this plugin cannot read is not.
 * @param ctx - plugin context, for the optional `subagents` lookup.
 * @param session - the session about to be handed off.
 * @returns the running continuable child ids, or `undefined` when the log must be consulted.
 */
export async function runningContinuableChildren(ctx: Context, session: Session): Promise<string[] | undefined> {
	const service = ctx.get("subagents") as SubagentsLike | undefined;
	if (service === undefined) return undefined;
	// Prefer the classified listing; a harness that only classifies in `listChildren` (0.1.6) still works.
	const listing = service.listDescendants?.bind(service) ?? service.listChildren?.bind(service);
	if (listing === undefined) return undefined;
	try {
		const entries = await listing(String(session.id), AbortSignal.timeout(SUBAGENT_LIST_TIMEOUT_MS));
		const ids: string[] = [];
		let classified = false;
		for (const raw of entries) {
			const entry = raw as { kind?: unknown; id?: unknown; mode?: unknown; activity?: unknown };
			if (entry.kind !== "child") continue;
			classified = true;
			if (entry.mode === "continuable" && entry.activity === "running" && typeof entry.id === "string") ids.push(entry.id);
		}
		if (!classified && entries.length > 0) return undefined;
		return ids;
	} catch {
		// Projections unavailable, the listing timed out, or a shape from another version: the
		// caller reads the event log instead of letting the guard fail.
		return undefined;
	}
}
