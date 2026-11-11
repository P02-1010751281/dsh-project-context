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
import { type HandoffLanguage } from "./language.js";
/** The route facts a failure is identified by. */
export interface HandoffRouteFailure {
    /** The provider `resolveTarget` resolved (config first, then the session's request header). */
    readonly provider: string;
    /** The model of that same pair. */
    readonly model: string;
    /** The harness's stable failure class (`UNKNOWN_MODEL`, `NO_ADAPTER`, …), when it has one. */
    readonly code: string | undefined;
}
/**
 * A route `resolveHandoffGate` could not resolve.
 *
 * It is a wrapper rather than a replacement: the adapter's own error is kept as `cause` and its
 * message as `detail`, because the receipt must be able to quote it — "this pair is not configured"
 * is what tells the user which pair to fix.
 */
export declare class HandoffRouteError extends Error {
    /** The route that failed, for the record and the receipt. */
    readonly failure: HandoffRouteFailure;
    /** The adapter's message, clipped; read by the receipt only (never by the injected line). */
    readonly detail: string;
    constructor(route: {
        readonly provider: string;
        readonly model: string;
    }, cause: unknown);
}
/** Whether a thrown value is this module's route failure (not a bare harness error). */
export declare function isHandoffRouteError(value: unknown): value is HandoffRouteError;
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
export declare function withRouteFailure<T>(route: {
    readonly provider: string;
    readonly model: string;
}, read: () => Promise<T>, signal?: AbortSignal): Promise<T>;
/**
 * Record a route failure for one session.
 *
 * A repeat of the same route and code is a no-op, not a re-render: this runs on every retry the
 * five-minute backoff allows, and each text change appends a runtime-context snapshot.
 * @param sessionId - the session id as a string.
 * @param failure - the route facts, from {@link HandoffRouteError.failure}.
 * @param language - the session's conversation language, frozen with the record.
 */
export declare function recordRouteFailure(sessionId: string, failure: HandoffRouteFailure, language: HandoffLanguage): void;
/**
 * Forget one session's failure: either the route resolved again (`recordHandoffGate` runs on every
 * successful resolution) or the session is gone. Clearing is what makes the recovery visible — the
 * line stops claiming a failure that no longer holds.
 * @param sessionId - the session id as a string.
 */
export declare function clearRouteFailure(sessionId: string): void;
/** The recorded failure for one session, if its route is still known-dead. */
export declare function routeFailureOf(sessionId: string): HandoffRouteFailure | undefined;
/**
 * The model-facing sentence for one session, or `''` when its route is fine.
 *
 * `''` is the documented way to contribute nothing, so a healthy session's assembly is unchanged.
 * @param sessionId - the session id as a string.
 * @returns the frozen line, or the empty string.
 */
export declare function routeFailureText(sessionId: string): string;
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
export declare function routeFailureReceipt(failure: HandoffRouteFailure, detail: string, language: HandoffLanguage): string;
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
export declare function renderRouteFailure(failure: HandoffRouteFailure, language: HandoffLanguage): string;
