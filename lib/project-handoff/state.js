/**
 * The per-session process memory: which sessions were handed off or are in flight, the failure
 * backoff and the skip/deferral log throttles.
 */
/** Per-session backoff after a failed automatic handoff. */
export const FAILURE_BACKOFF_MS = 5 * 60_000;
/** How often one session may log "nothing older to drop": the skip repeats on every idle. */
export const SKIP_LOG_INTERVAL_MS = 10 * 60_000;
/** Sessions this process already handed off, and sessions with a handoff in flight. */
export const handedOff = new Set();
export const inFlight = new Set();
/**
 * The newest `turn/end` that arrived while an attempt was in flight. The listener drops it (the
 * running attempt owns the session), but a turn/end that closed a *settled* turn is the one chance
 * to hand off, so the attempt re-runs against it when it finishes instead of waiting for a turn
 * that may never come.
 */
export const pendingTriggerSeq = new Map();
/** Sessions whose last automatic handoff failed; no retry before this timestamp. */
export const failedUntil = new Map();
/** Last logged "nothing older to drop" per session; the skip repeats on every idle. */
export const skippedLoggedAt = new Map();
/**
 * When this session's automatic handoff first found nothing older to drop, cleared as soon as
 * an idle finds the conversation droppable again. The skip repeats on every idle and dsh has no
 * notification channel, so `/handoff status` is where the user actually sees it; keeping the first
 * occurrence stops the timestamp from looking like "just now" on every read.
 */
export const skippedSince = new Map();
/** Last logged deferral per session. Separate from the skip above: one must not mute the other. */
export const deferredLoggedAt = new Map();
/**
 * Sessions whose handoff succeeded while their own turn was still open.
 *
 * A handoff *forks*, so the session it replaced has to be retired (stopped and archived) or it stays
 * live above its own continuation. Archiving with `stopActivity` would stop a turn that is still
 * rendering the reply, so that case waits for its `turn/end` instead, and `turnOpenNow` decides it
 * from the session's own log. Which path asked is *not* that question: a standalone `/handoff now`
 * runs as a command with no turn open at all, and reading "manual" as "turn open" left the
 * retirement waiting for an event that never came, silently (2026-11-07).
 */
export const pendingRetire = new Set();
