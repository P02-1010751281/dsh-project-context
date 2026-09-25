/**
 * The per-session process memory: which sessions were handed off or are in flight, the
 * failure backoff and the pressure/skip/deferral log throttles. `setPressureCheckIntervalMs`
 * lets a test drive the time-based gates without sleeping.
 */

/** Per-session backoff after a failed automatic handoff. */
export const FAILURE_BACKOFF_MS = 5 * 60_000;

/** Automatic handoffs re-measure context pressure at most this often per session. */
const PRESSURE_CHECK_INTERVAL_MS = 15_000;

/**
 * The live pressure interval. Exported through {@link setPressureCheckIntervalMs} so a test can
 * drive the time-based gates (a deferral releasing the throttle, a successful attempt that outlives
 * it and still must not hand off twice) without sleeping for the production interval.
 */
let pressureCheckIntervalMs = PRESSURE_CHECK_INTERVAL_MS;

/**
 * Override the pressure re-check interval. Exported so a test can exercise the gates that only
 * differ after the interval has elapsed, without sleeping for it in production.
 * @param ms - the interval every later pressure check compares against.
 */
export function setPressureCheckIntervalMs(ms: number): void {
	pressureCheckIntervalMs = ms;
}

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

/** Last automatic pressure check per session, so measurement is not run every turn. */
export const pressureCheckedAt = new Map<string, number>();

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

/**
 * The live pressure interval, read by the automatic path. Exported as a function so the
 * value cannot be captured at import time (a test changes it after the module loads).
 * @returns the interval in milliseconds.
 */
export function getPressureCheckIntervalMs(): number {
	return pressureCheckIntervalMs;
}
