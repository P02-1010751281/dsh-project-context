/**
 * The injected pressure line: what the user learns about a crossed threshold without typing
 * `/handoff status`.
 *
 * Why this is not "one line per turn". The harness materializes a registered `systemPrompt.context`
 * as a durable user-role runtime-context snapshot, and it **appends** that snapshot whenever its
 * text changes (`surface-fold.ts`'s `planSurfaceTokens` appends for `surfaceOp: "append"`; only a
 * ranged op replaces). Measured on this repo's own archived sessions: one such snapshot is ~37 KB,
 * and session-3a19d454's log carries five of them (len 37274/37274/37761/37513/37875) with zero
 * ranged replaces anywhere in the session. So the cost of this line is per *text change*, three
 * orders of magnitude above per turn, and the whole design here is to make the text change once per
 * crossing:
 *
 *   - the line appears when the session crosses the threshold and is then **frozen** — later
 *     ticks keep the same bytes even as occupancy grows, so they append nothing;
 *   - it changes only when the recorded deferral reason changes (a second append), which is a fact
 *     the reader needs;
 *   - falling back below the threshold empties it, so a later crossing speaks again.
 *
 * The numbers come from `ResolvedHandoffGate` — the very object the decision consumed — never from
 * a second resolution of the same terms.
 */
import { type Session } from "@deepseek-ai/dsh-session";
import { type ResolvedHandoffGate } from "./gate.js";
import { type HandoffLanguage } from "./language.js";
/** Why an over-threshold session has not handed off yet, as the trigger itself determined it. */
export type HandoffDeferral = "question" | "subagents" | "nothing-to-drop";
/**
 * Record the gate the trigger resolved (or the one a `step/start` tick resolved on its behalf).
 *
 * Called on every tick, so the common paths must do nothing observable: a session below its
 * threshold clears the line without producing text, and a session already over returns with the
 * frozen bytes untouched.
 * @param session - the session the gate belongs to.
 * @param gate - the resolved gate, from `resolveHandoffGate`.
 */
export declare function recordHandoffGate(session: Session, gate: ResolvedHandoffGate): void;
/**
 * Name the guard the trigger stopped on, so the line says *why* nothing happened.
 *
 * A no-op for a session with no visible crossing (the trigger ran before the tick saw one, or the
 * session is below the threshold) and for a repeat of the same reason, which is what keeps the
 * text byte-identical across turns and therefore appends nothing.
 * @param sessionId - the session id as a string.
 * @param reason - the guard that deferred this attempt.
 */
export declare function recordHandoffDeferral(sessionId: string, reason: HandoffDeferral): void;
/**
 * Whether this session already has a frozen crossing.
 *
 * The `step/start` tick reads this to stop measuring a session that has nothing left to report:
 * once the line is frozen the tick cannot change it, and re-resolving the route and the surface
 * every step would be pure cost.
 * @param sessionId - the session id as a string.
 * @returns whether a crossing is currently recorded.
 */
export declare function handoffPressureIsOver(sessionId: string): boolean;
/** Forget one session's line (disposal must not leak markers for the process lifetime). */
export declare function clearHandoffPressure(sessionId: string): void;
/**
 * The model-facing text for this session, or `''` when nothing is crossed.
 *
 * `''` is the documented way to contribute nothing ("Empty text contributes nothing"), so a session
 * below its threshold adds no context at all.
 * @param session - the session being assembled.
 * @param language - the language the session's conversation resolves to.
 * @returns the frozen line, or the empty string.
 */
export declare function handoffPressureText(session: Session, language: HandoffLanguage): string;
