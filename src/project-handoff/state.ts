/**
 * The per-session process memory: which sessions were handed off or are in flight, the failure
 * backoff and the skip/deferral log throttles.
 */

/** Per-session backoff after a failed automatic handoff. */
export const FAILURE_BACKOFF_MS = 5 * 60_000;

/** How often one session may log "nothing to summarize": the skip repeats on every idle. */
export const SKIP_LOG_INTERVAL_MS = 10 * 60_000;

/** Sessions this process already handed off, and sessions with a handoff in flight. */
export const handedOff = new Set<string>();

export const inFlight = new Set<string>();

/**
 * The newest `turn/end` that arrived while an attempt was in flight. The listener drops it (the
 * running attempt owns the session), but a turn/end that closed a *settled* turn is the one chance
 * to hand off, so the attempt re-runs against it when it finishes instead of waiting for a turn
 * that may never come.
 */
export const pendingTriggerSeq = new Map<string, number>();

/** Sessions whose last automatic handoff failed; no retry before this timestamp. */
export const failedUntil = new Map<string, number>();

/** Last logged "nothing older to summarize" per session; the skip repeats on every idle. */
export const skippedLoggedAt = new Map<string, number>();

/**
 * When this session's automatic handoff first found nothing older to summarize, cleared as soon as
 * an idle finds the conversation summarizable again. The skip repeats on every idle and dsh has no
 * notification channel, so `/handoff status` is where the user actually sees it; keeping the first
 * occurrence stops the timestamp from looking like "just now" on every read.
 */
export const skippedSince = new Map<string, number>();

/** Last logged deferral per session. Separate from the skip above: one must not mute the other. */
export const deferredLoggedAt = new Map<string, number>();
