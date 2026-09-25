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

/** Structural view of the optional `subagents` host service: this session's direct children. */
interface SubagentsLike {
	/**
	 * Direct-child read from the parent-owned `subagent/catalog` projection. Every row carries `id`
	 * and `mode` (dsh 0.1.6's classified `{kind, id, mode, activity, hasChildren}` row and
	 * 0.1.7-alpha.1's bare `{id, createdAt, mode, label}` catalog row both do), so one read covers
	 * both versions; a `kind: "diagnostic"` row means the host could not classify that child at all.
	 */
	listChildren?(parentSessionId: string, signal?: AbortSignal): Promise<readonly unknown[]>;
}

/** Structural view of the host's live Agent registry, the only place turn activity is readable. */
interface AgentsLike {
	get(sessionId: string): { readonly status?: unknown } | undefined;
}

/**
 * This session's direct continuable children that are executing a turn *right now*, or `undefined`
 * when that cannot be read — the caller then falls back to the event log.
 *
 * Activity comes from the live Agent registry (`agents.get(id)?.status === "running"`), never from
 * the listing's own `activity` field. That field means "the Session store still holds this child":
 * `list-children.ts` answers `running` for every candidate with a live Session and `inactive` only
 * for the ones it had to read cold, so a teammate that finished its turn but stays resident — which
 * is what makes `send_message` able to resume it — reads as running there. dsh's own `list_agents`
 * re-derives status the same way and documents why ("Report turn activity without exposing whether
 * the child is loaded"); the Team roster (`availability`) and `archive-admission` read `agent.status`
 * too, and `AgentStatus` is `'idle' | 'running'`, flipped at every turn boundary. Residency would
 * instead hold every handoff until the child is evicted, and a handoff that never runs is worse than
 * the deferral it exists to express.
 *
 * Enumeration is still the listing, and its shape is checked rather than trusted: a `diagnostic`
 * row, or a row without a `mode`, means the host could not classify that child, and `[]` would then
 * be an answer this plugin cannot support — so control returns to the log. (dsh 0.1.7-alpha.1
 * replaced `listChildren`'s classified row with the bare catalog row; the bare row keeps `mode`, but
 * a guard that insisted on `kind` answered `[]` — an answer the caller's `??` accepts — and the
 * live-registry half of this guard went silent for two releases.)
 * @param ctx - plugin context, for the optional `subagents` and `agents` lookups.
 * @param session - the session about to be handed off.
 * @returns the running continuable child ids, or `undefined` when the log must be consulted.
 */
export async function runningContinuableChildren(ctx: Context, session: Session): Promise<string[] | undefined> {
	const service = ctx.get("subagents") as SubagentsLike | undefined;
	const agents = ctx.get("agents") as AgentsLike | undefined;
	// Without the live registry there is no way to tell a working child from a resident one, and the
	// residency proxy must not stand in for it: read the log instead.
	if (service === undefined || typeof service.listChildren !== "function") return undefined;
	if (agents === undefined || typeof agents.get !== "function") return undefined;
	try {
		const entries = await service.listChildren(String(session.id), AbortSignal.timeout(SUBAGENT_LIST_TIMEOUT_MS));
		const ids: string[] = [];
		for (const raw of entries) {
			const entry = raw as { kind?: unknown; id?: unknown; mode?: unknown };
			if (entry.kind === "diagnostic") return undefined;
			if (typeof entry.mode !== "string") return undefined;
			if (entry.mode !== "continuable" || typeof entry.id !== "string") continue;
			if (agents.get(entry.id)?.status === "running") ids.push(entry.id);
		}
		return ids;
	} catch {
		// Projections unavailable, the listing timed out, or a shape from another version: the
		// caller reads the event log instead of letting the guard fail.
		return undefined;
	}
}

/**
 * The running continuable children that must hold a handoff: the live registry when it can be read,
 * the event log otherwise. One function owns that fallback because two callers act on it — the
 * automatic path defers, the manual path refuses — and a private copy in either would let one of
 * them read a different answer than the other.
 * @param ctx - plugin context, for the optional `subagents` lookup.
 * @param session - the session about to be handed off.
 * @returns the outstanding child session ids.
 */
export async function pendingSubagentWork(ctx: Context, session: Session): Promise<string[]> {
	return await runningContinuableChildren(ctx, session) ?? outstandingSubagents(ownEventsOf(session), Date.now());
}
