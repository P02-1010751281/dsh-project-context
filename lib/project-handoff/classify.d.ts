/**
 * Failure classification: a deferral (the session moved on — not a failure), a transient
 * failure (safe to retry), or a terminal one. The wording heuristic is deliberately
 * conservative; its accepted residual misclassifications are listed next to the patterns.
 */
/**
 * Raised by the automatic path when the session started a new turn while the handoff was being
 * prepared. Not a failure: `turn/end` is the trigger, but the harness pumps a queued user message
 * into the very next turn as soon as the current one closes, so the parent can be back at work
 * seconds later — before the summary call returns. Creating the child then would leave the parent
 * and the continuation editing the same project (the 2026-09-17 incident: the auto handoff fired at
 * `turn/end` of turn 9, the queued message opened turn 10 in the same second, and the child was
 * created 8 seconds later while the parent went on to do the same fix). The next `turn/end`
 * re-evaluates, so the handoff only waits for the session to actually settle.
 */
export declare class HandoffDeferred extends Error {
    constructor(message: string);
}
/**
 * Raised when a handoff failed for a reason that a plain retry can clear — the session controller
 * refused the seed because a turn was already open, the summary route dropped the connection, the
 * provider rate-limited the call. Distinct from an ordinary `Error`, which is terminal: a handoff
 * document that cannot be built, a model that does not exist, a project root that cannot be read.
 *
 * The manual path needs the distinction because `/handoff now` renders its `catch` verbatim: a
 * retryable cause reported as "Handoff failed" tells the user the operation is over when the fix
 * is to run the same command again. The automatic path does not need it (it retries on its own
 * schedule), so this class exists for the receipt.
 */
export declare class HandoffTransient extends Error {
    constructor(message: string, options?: {
        cause?: unknown;
    });
}
/**
 * Whether a handoff failure is worth retrying. Only the shapes recognized below qualify; anything
 * else is terminal. The pattern is a heuristic over wording the runtime controls, so it is biased
 * toward "terminal" — an unrecognized transient is reported as a plain failure rather than promised
 * a retry — but it cannot be exact: an unrecognized *terminal* wording that happens to match still
 * prints the retry advice.
 * @param error - the error a handoff attempt threw.
 * @returns `true` for a cause a plain retry can clear.
 */
export declare function handoffFailureIsTransient(error: unknown): boolean;
/**
 * Wrap a handoff failure with the retryable/terminal verdict, preserving the original cause.
 * Used where the failure is caught and re-thrown so the verdict survives to the receipt.
 *
 * A {@link HandoffDeferred} is passed through **unchanged**: the automatic path tests
 * `instanceof HandoffDeferred` to keep a deferral out of the failure backoff and to title and retire
 * the abandoned child as deferred rather than failed, and re-wrapping it would silently turn the
 * 2026-09-17 double-write guard into an ordinary error.
 */
export declare function transientIfRetryable(error: unknown): Error;
