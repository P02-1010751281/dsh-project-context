/**
 * A cross-process write lock for one target path: `<target>.lock`, stolen after a staleness
 * horizon with a `<target>.lock.steal` claim so two waiters cannot both take it over.
 *
 * Generic over the target — `project-memory` locks `MEMORY.md`, `project-context` locks the
 * session index — so it lives with the other shared facilities, not with either caller.
 */
/** A lock older than this was left behind by a crashed writer and may be stolen. */
export declare const MEMORY_LOCK_STALE_MS = 30000;
/**
 * How long a writer waits for the lock before failing the pass. It must exceed the staleness
 * horizon: a lock orphaned by a crash is not stealable until then, so a shorter wait would fail
 * every pass for the rest of that window instead of taking the abandoned lock over.
 *
 * The sibling pi port pins a flat 5 s wait under the same 30 s horizon, so there an orphaned lock
 * does fail every pass until it expires. The divergence is deliberate and must not be "unified":
 * the invariant above is exactly what this value encodes, and a 5 s wait here would break it.
 */
export declare const MEMORY_LOCK_WAIT_MS: number;
/**
 * Whether a lock is old enough to steal. `lockMtimeMs` reports **0** for a lock file that is gone,
 * and 0 is not an age: reading it as one makes the test true for any horizon, so a waiter whose
 * `tryLock` failed a moment ago enters the steal branch for a lock that no longer exists. The
 * `.steal` claim it then creates makes the writer that is just finishing bail out of `releaseLock`
 * (documented safe branch: only the claim holder may delete) **without deleting its own lock**, and
 * every later writer then waits out the whole staleness horizon. Exported so that invariant can be
 * pinned by a test without racing the filesystem.
 */
export declare function staleLockAge(lockAgeMs: number, nowMs: number, staleMs: number): boolean;
/**
 * Serialize one memory-file write across processes with an exclusive lock file, so the bytes a
 * writer backs up cannot be replaced between the backup read and the atomic rename that publishes
 * the new file. A lock left behind by a crashed writer is stolen once it is older than any live
 * write; the thief writes its own token and the original holder only deletes a lock it still owns.
 *
 * A lock orphaned by a crash is not stealable until `staleMs` has passed, and the waiter outlives
 * that horizon by design: it would rather pause the idle/flush path for up to `waitMs` (35 s by
 * default) than fail the pass and leave the orphan in place. The limits are injectable so a test can
 * exercise both outcomes in milliseconds.
 * @param target - the file the lock protects (its path plus `.lock` is the lock).
 * @param action - the write to run while holding the lock.
 * @param limits - staleness horizon and waiter budget; defaults to the production constants.
 * @returns whatever `action` produced.
 */
export declare function withMemoryLock<T>(target: string, action: () => Promise<T>, limits?: {
    staleMs?: number;
    waitMs?: number;
}): Promise<T>;
