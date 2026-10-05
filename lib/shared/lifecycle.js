/**
 * Shared plugin lifecycle helpers: session identity, serialized background
 * work, and per-session durability tracking. Both context plugins and the
 * handoff plugin keep the same lifecycle shape, so it lives here once.
 */
/** Longest a durability flush waits for in-flight work before letting shutdown proceed. */
export const FLUSH_WAIT_MS = 90_000;
export function isTopLevel(session) {
    return session.header.origin !== "subagent";
}
export function projectCwd(session) {
    return session.header.cwd ?? process.cwd();
}
/** Wait for a promise, but never longer than the flush budget. */
export function waitBounded(promise) {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, FLUSH_WAIT_MS);
        timer.unref?.();
        void promise.finally(() => {
            clearTimeout(timer);
            resolve();
        });
    });
}
/**
 * Serialize background writes. A failed task reaches its caller through the
 * returned promise, but never poisons later tasks on the same queue.
 */
export class SerialQueue {
    tail = Promise.resolve();
    /**
     * Run one task after the previous one settles.
     * @param work - the task; its value or rejection reaches this caller only.
     * @returns the task's own promise, so callers can read what it produced.
     */
    run(work) {
        const next = this.tail.then(work);
        this.tail = next.then(() => undefined, () => undefined);
        return next;
    }
}
/** Per-session in-flight work, awaited by the `session/flush` durability handler. */
export class SessionWorkTracker {
    pending = new Map();
    /** @param work - in-flight work; its value is ignored, only its settlement matters. */
    track(session, work) {
        const key = String(session.id);
        const tracked = work.then(() => undefined, () => undefined);
        this.pending.set(key, tracked);
        void tracked.finally(() => {
            if (this.pending.get(key) === tracked)
                this.pending.delete(key);
        });
    }
    flush(session) {
        const work = this.pending.get(String(session.id));
        return work ? waitBounded(work) : undefined;
    }
}
