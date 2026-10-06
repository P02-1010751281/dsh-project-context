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
import {} from "@deepseek-ai/dsh-session";
import {} from "./gate.js";
import {} from "./language.js";
/** Sessions whose line is currently over, plus the frozen crossing that describes it. */
const crossings = new Map();
/**
 * Record the gate the trigger resolved (or the one a `step/start` tick resolved on its behalf).
 *
 * Called on every tick, so the common paths must do nothing observable: a session below its
 * threshold clears the line without producing text, and a session already over returns with the
 * frozen bytes untouched.
 * @param session - the session the gate belongs to.
 * @param gate - the resolved gate, from `resolveHandoffGate`.
 */
export function recordHandoffGate(session, gate) {
    const key = String(session.id);
    const { threshold, measurement, contextWindow } = gate;
    if (threshold === undefined || measurement.totalTokens < threshold.tokens) {
        // Below the threshold (or refused outright): the line must not keep claiming a crossing that
        // no longer holds. Deleting is what lets a later crossing speak again.
        crossings.delete(key);
        return;
    }
    const previous = crossings.get(key);
    // Already over: keep the frozen bytes. This early return *is* the cost bound.
    if (previous !== undefined)
        return;
    crossings.set(key, { tokens: measurement.totalTokens, threshold: threshold.tokens, contextWindow, reason: undefined });
}
/**
 * Name the guard the trigger stopped on, so the line says *why* nothing happened.
 *
 * A no-op for a session with no visible crossing (the trigger ran before the tick saw one, or the
 * session is below the threshold) and for a repeat of the same reason, which is what keeps the
 * text byte-identical across turns and therefore appends nothing.
 * @param sessionId - the session id as a string.
 * @param reason - the guard that deferred this attempt.
 */
export function recordHandoffDeferral(sessionId, reason) {
    const crossing = crossings.get(sessionId);
    if (crossing === undefined || crossing.reason === reason)
        return;
    crossings.set(sessionId, { ...crossing, reason });
}
/**
 * Whether this session already has a frozen crossing.
 *
 * The `step/start` tick reads this to stop measuring a session that has nothing left to report:
 * once the line is frozen the tick cannot change it, and re-resolving the route and the surface
 * every step would be pure cost.
 * @param sessionId - the session id as a string.
 * @returns whether a crossing is currently recorded.
 */
export function handoffPressureIsOver(sessionId) {
    return crossings.has(sessionId);
}
/** Forget one session's line (disposal must not leak markers for the process lifetime). */
export function clearHandoffPressure(sessionId) {
    crossings.delete(sessionId);
}
/**
 * The model-facing text for this session, or `''` when nothing is crossed.
 *
 * `''` is the documented way to contribute nothing ("Empty text contributes nothing"), so a session
 * below its threshold adds no context at all.
 * @param session - the session being assembled.
 * @param language - the language the session's conversation resolves to.
 * @returns the frozen line, or the empty string.
 */
export function handoffPressureText(session, language) {
    const crossing = crossings.get(String(session.id));
    if (crossing === undefined)
        return "";
    const percent = Math.round((crossing.tokens / crossing.contextWindow) * 100);
    const reason = crossing.reason === undefined ? "" : ` ${deferralText(crossing.reason, language)}`;
    if (language === "zh") {
        return `**自动交接状态（宿主注入，非用户发言）**：本会话上下文 ${crossing.tokens} / 窗口 ${crossing.contextWindow}（${percent}%），已越过阈值 ${crossing.threshold}。自动交接只在轮次结束时评估，所以轮次内的越线不会立刻触发。${reason}请在回复中把这一状态与原因告知用户。`;
    }
    return `**Automatic-handoff status (host-injected, not a user message)**: this session's context is ${crossing.tokens} / window ${crossing.contextWindow} (${percent}%), past its threshold of ${crossing.threshold}. Automatic handoff is evaluated only at turn end, so a crossing inside a turn does not trigger it yet.${reason} Tell the user this status and its reason.`;
}
/** One deferral sentence, in the session's language. */
function deferralText(reason, language) {
    if (language === "zh") {
        return reason === "question"
            ? "上一轮以未回答的问题结束，按当前设置会延后交接。"
            : reason === "subagents"
                ? "仍有后台子代理在运行，会延后交接。"
                : "当前没有足够旧的内容可丢弃，会跳过交接。";
    }
    return reason === "question"
        ? "The last turn ended on an unanswered question, which defers the handoff under the current setting."
        : reason === "subagents"
            ? "Background subagents are still running, which defers the handoff."
            : "There is not enough older content to drop, which skips the handoff.";
}
