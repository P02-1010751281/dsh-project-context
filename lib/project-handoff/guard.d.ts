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
/**
 * Whether this session's own turn is still open, read from its event log.
 *
 * Retiring a handed-off session has to wait for `turn/end` when the archive would otherwise stop the
 * very turn that is rendering the command's reply — but *which path asked* is not that condition. A
 * standalone `/handoff now` runs as `command/run` → `command/done` with no turn at all: the
 * 2026-11-07 session that was never archived ended exactly there, so treating "manual" as "turn
 * open" left its retirement waiting for a `turn/end` that could never arrive, and nothing recorded
 * the loss. This reads the last turn boundary in the log instead of the caller's identity.
 *
 * Deliberately log-based rather than `ctx.agents.turnBoundaryOf()`, whose `openTurnStartSeq` answers
 * the same question off the same events. Two reasons, both about this predicate being the one that
 * runs: the projection would make the *fallback* the path every retirement fixture exercises — the
 * green-suite-covers-the-wrong-branch trap this repo has already been bitten by — and a host-side
 * branch that is only reachable in production is exactly what a fallback-shaped predicate must not
 * have. Reading `ownEventsOf` also adds no new deprecated call site: `session.ownEvents()` is called
 * once, inside that helper, and this batch adds a consumer, not a call. `turnStartedAfter` reads the
 * same two event types for the same reason.
 * @param session - the session whose turn state is in question.
 * @returns `true` when the newest turn boundary in its own log is a `turn/start`.
 */
export declare function turnOpenNow(session: Session): boolean;
/** Defer the automatic handoff once its trigger's session has started another turn. */
export declare function assertSessionSettled(session: Session, triggerSeq: number | undefined): void;
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
