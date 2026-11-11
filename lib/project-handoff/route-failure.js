/**
 * The one failure the automatic trigger can hit that repeats forever without saying anything.
 *
 * `resolveHandoffGate` reads the routed window through `ctx.llm.resolveModelInfo`, and that read
 * throws when the session's provider/model pair is not resolvable in this profile — the state a
 * mid-session model switch leaves behind, because `resolveTarget` falls back to the session's *stored*
 * request header and nothing rewrites it. Until this module existed the whole consequence was one
 * `warn` in the server log, one `errors.log` line and a five-minute backoff: the user saw a session
 * that had silently stopped handing off, and the one surface that would have told them (`/handoff
 * status`) threw the same exception instead of answering.
 *
 * So the failure is named here as its own type, and the display layer renders it on the same
 * `systemPrompt.context` line the crossing uses. Two constraints come from that channel:
 *
 *   - the text carries only the *stable* facts (route and harness code), never the adapter's message:
 *     a `systemPrompt.context` is materialized as a durable runtime-context snapshot that the harness
 *     **appends** whenever the text changes, so a message that varies per attempt would cost a
 *     snapshot per attempt. The adapter's own wording lives in the `/handoff status` receipt, which
 *     is rendered on demand;
 *   - a repeated identical failure re-renders nothing, so the backoff retries do not each append.
 *
 * The language is frozen with the record, like a crossing's: it comes from the conversation, so
 * re-deriving it per assembly could flip zh/en and append a snapshot for a language change only.
 */
import {} from "./language.js";
/**
 * A route `resolveHandoffGate` could not resolve.
 *
 * It is a wrapper rather than a replacement: the adapter's own error is kept as `cause` and its
 * message as `detail`, because the receipt must be able to quote it — "this pair is not configured"
 * is what tells the user which pair to fix.
 */
export class HandoffRouteError extends Error {
    /** The route that failed, for the record and the receipt. */
    failure;
    /** The adapter's message, clipped; read by the receipt only (never by the injected line). */
    detail;
    constructor(route, cause) {
        const failure = { provider: route.provider, model: route.model, code: errorCode(cause) };
        super(`handoff route ${failure.provider}/${failure.model} cannot be resolved${failure.code === undefined ? "" : ` (${failure.code})`}`, { cause });
        this.name = "HandoffRouteError";
        this.failure = failure;
        this.detail = clipDetail(cause);
    }
}
/**
 * The harness's stable failure class, when the thrown value carries one.
 *
 * Read structurally rather than by `instanceof HarnessError`: the adapter's error crosses the plugin's
 * type-only boundary, and the class is deliberately not a runtime dependency. `code` is the supported
 * discriminant — dsh documents "route on this, never by parsing `message`" — so a value without one
 * records no code instead of guessing from its text.
 */
function errorCode(cause) {
    if (typeof cause !== "object" || cause === null)
        return undefined;
    const code = cause.code;
    return typeof code === "string" && code !== "" ? code : undefined;
}
/** Longest adapter message the receipt quotes; a stack-length message would bury the line. */
const DETAIL_CHARS = 240;
function clipDetail(cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const flat = message.replace(/\s+/g, " ").trim();
    return flat.length <= DETAIL_CHARS ? flat : `${flat.slice(0, DETAIL_CHARS - 1)}…`;
}
/** Whether a thrown value is this module's route failure (not a bare harness error). */
export function isHandoffRouteError(value) {
    return value instanceof HandoffRouteError;
}
/**
 * Run one route read and name its failure.
 *
 * The single wrap site: the trigger's gate and the `/handoff status` receipt both read the routed
 * window, and a second copy of "which throws are a route failure" is how the two would end up
 * disagreeing. A caller-cancelled read is rethrown as it was — the pair may be perfectly resolvable and
 * the caller merely stopped, so that is not this failure.
 * @param route - the pair being read.
 * @param read - performs the read.
 * @param signal - the caller's cancellation, when it has one.
 * @returns whatever `read` resolves.
 */
export async function withRouteFailure(route, read, signal) {
    try {
        return await read();
    }
    catch (error) {
        if (signal?.aborted === true)
            throw error;
        throw new HandoffRouteError(route, error);
    }
}
/** Sessions whose route is known-dead, with the frozen rendering inputs. */
const failures = new Map();
/**
 * Record a route failure for one session.
 *
 * A repeat of the same route and code is a no-op, not a re-render: this runs on every retry the
 * five-minute backoff allows, and each text change appends a runtime-context snapshot.
 * @param sessionId - the session id as a string.
 * @param failure - the route facts, from {@link HandoffRouteError.failure}.
 * @param language - the session's conversation language, frozen with the record.
 */
export function recordRouteFailure(sessionId, failure, language) {
    const previous = failures.get(sessionId);
    if (previous !== undefined && sameFailure(previous.failure, failure))
        return;
    failures.set(sessionId, { failure, language });
}
function sameFailure(left, right) {
    return left.provider === right.provider && left.model === right.model && left.code === right.code;
}
/**
 * Forget one session's failure: either the route resolved again (`recordHandoffGate` runs on every
 * successful resolution) or the session is gone. Clearing is what makes the recovery visible — the
 * line stops claiming a failure that no longer holds.
 * @param sessionId - the session id as a string.
 */
export function clearRouteFailure(sessionId) {
    failures.delete(sessionId);
}
/** The recorded failure for one session, if its route is still known-dead. */
export function routeFailureOf(sessionId) {
    return failures.get(sessionId)?.failure;
}
/**
 * The model-facing sentence for one session, or `''` when its route is fine.
 *
 * `''` is the documented way to contribute nothing, so a healthy session's assembly is unchanged.
 * @param sessionId - the session id as a string.
 * @returns the frozen line, or the empty string.
 */
export function routeFailureText(sessionId) {
    const recorded = failures.get(sessionId);
    if (recorded === undefined)
        return "";
    return renderRouteFailure(recorded.failure, recorded.language);
}
/**
 * The same failure as the `/handoff status` receipt states it.
 *
 * A receipt is read by the user, so it must not carry the prompt's "tell the user" instruction, and it
 * may quote the adapter's own message: the receipt is rendered on demand, so its length costs nothing
 * and that message is what names the pair to fix. Both renderers exist so no caller paraphrases the
 * facts on its own — the route and the code come from the same failure object either way.
 * @param failure - the route facts.
 * @param detail - the adapter's message (clipped by {@link HandoffRouteError}).
 * @param language - the receipt's language.
 * @returns one receipt line.
 */
export function routeFailureReceipt(failure, detail, language) {
    const route = `\`${failure.provider}/${failure.model}\``;
    const codeText = failure.code ?? (language === "zh" ? "未给出错误码" : "no error code");
    const cause = detail === "" ? "" : `: ${detail}`;
    if (language === "zh") {
        return `路由 ${route} 无法解析（${codeText}）${cause}；自动交接因此无法运行，切到可用模型即可恢复`;
    }
    return `route ${route} cannot be resolved (${codeText})${cause}; automatic handoff cannot run until an available model is selected`;
}
/**
 * The model-facing rendering of one failure, without a recorded session.
 *
 * {@link routeFailureText} is the payload the injected line uses; this is the same sentence for a
 * caller that holds the failure itself (a test, or a future surface) — one renderer, so the prompt
 * cannot start describing the same failure two ways.
 * @param failure - the route facts.
 * @param language - the session's language.
 * @returns the rendered sentence.
 */
export function renderRouteFailure(failure, language) {
    const { provider, model, code } = failure;
    const route = `\`${provider}/${model}\``;
    const codeText = code ?? (language === "zh" ? "未给出错误码" : "no error code");
    if (language === "zh") {
        return `**自动交接无法运行**：本会话的路由 ${route} 在本机无法解析（${codeText}）。自动交接会按失败退避重试；若这是切换模型后留下的旧配对，切到可用模型即可恢复。请在回复中把这一状态告知用户。`;
    }
    return `**Automatic handoff cannot run**: this session's route ${route} cannot be resolved in this profile (${codeText}). Automatic handoff retries after its failure backoff; if this is a stale pair left by a model switch, selecting an available model restores it. Tell the user this status.`;
}
