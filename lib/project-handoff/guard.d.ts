/**
 * May this session hand off *now*? A running continuable subagent and a turn that opened
 * while the handoff was being prepared both mean two sessions would work the same project
 * at once (the 2026-09-17 incident); both are read here.
 */
import { type Context } from "@deepseek-ai/cordis";
import { type Session } from "@deepseek-ai/dsh-session";
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
export declare function outstandingSubagents(events: readonly unknown[], now: number, horizonMs?: number): string[];
/**
 * This session's *own* events. A fork inherits its parent's log and an inherited child's notice
 * goes to the original parent, so the inherited prefix must not read as this session's work.
 */
export declare function ownEventsOf(session: Session): readonly unknown[];
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
export declare function turnStartedAfter(session: Session, seq: number): boolean;
/** Defer the automatic handoff once its trigger's session has started another turn. */
export declare function assertSessionSettled(session: Session, triggerSeq: number | undefined): void;
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
export declare function runningContinuableChildren(ctx: Context, session: Session): Promise<string[] | undefined>;
/**
 * The running continuable children that must hold a handoff: the live registry when it can be read,
 * the event log otherwise. One function owns that fallback because two callers act on it — the
 * automatic path defers, the manual path refuses — and a private copy in either would let one of
 * them read a different answer than the other.
 * @param ctx - plugin context, for the optional `subagents` lookup.
 * @param session - the session about to be handed off.
 * @returns the outstanding child session ids.
 */
export declare function pendingSubagentWork(ctx: Context, session: Session): Promise<string[]>;
