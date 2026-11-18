/**
 * The per-session process memory: which sessions were handed off or are in flight, the failure
 * backoff and the skip/deferral log throttles.
 */
import { type SeedReceipt } from "./receipt.js";
/** Per-session backoff after a failed automatic handoff. */
export declare const FAILURE_BACKOFF_MS: number;
/** How often one session may log "nothing older to drop": the skip repeats on every idle. */
export declare const SKIP_LOG_INTERVAL_MS: number;
/** Sessions this process already handed off, and sessions with a handoff in flight. */
export declare const handedOff: Set<string>;
export declare const inFlight: Set<string>;
/**
 * What each continuation was seeded with, keyed by the **child** session id.
 *
 * Keyed by the child on purpose. A handoff retires the session it replaced, so the receipt is read in
 * the continuation — the only session still talking to the user. Nothing reads across the parent link:
 * a session this process did not seed has no entry and prints no seed line, which is how "the parent
 * keeps `already handed off`" and "the child reports its own seed" stay two different statements.
 *
 * Process memory, exactly like {@link handedOff}: a restart forgets it and the next `/handoff status`
 * simply omits the line. The durable copy of the same facts is `HANDOFF.md` plus the seed itself, so
 * the loss is a receipt's worth of convenience, never evidence.
 */
export declare const handoffReceipts: Map<string, SeedReceipt>;
/**
 * The newest `turn/end` that arrived while an attempt was in flight. The listener drops it (the
 * running attempt owns the session), but a turn/end that closed a *settled* turn is the one chance
 * to hand off, so the attempt re-runs against it when it finishes instead of waiting for a turn
 * that may never come.
 */
export declare const pendingTriggerSeq: Map<string, number>;
/** Sessions whose last automatic handoff failed; no retry before this timestamp. */
export declare const failedUntil: Map<string, number>;
/** Last logged "nothing older to drop" per session; the skip repeats on every idle. */
export declare const skippedLoggedAt: Map<string, number>;
/**
 * When this session's automatic handoff first found nothing older to drop, cleared as soon as
 * an idle finds the conversation droppable again. The skip repeats on every idle and dsh has no
 * notification channel, so `/handoff status` is where the user actually sees it; keeping the first
 * occurrence stops the timestamp from looking like "just now" on every read.
 */
export declare const skippedSince: Map<string, number>;
/** Last logged deferral per session. Separate from the skip above: one must not mute the other. */
export declare const deferredLoggedAt: Map<string, number>;
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
export declare const pendingRetire: Set<string>;
