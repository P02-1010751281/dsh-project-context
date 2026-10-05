/**
 * Shared plugin lifecycle helpers: session identity, serialized background
 * work, and per-session durability tracking. Both context plugins and the
 * handoff plugin keep the same lifecycle shape, so it lives here once.
 */
import type { Session } from "@deepseek-ai/dsh-session";
/** Longest a durability flush waits for in-flight work before letting shutdown proceed. */
export declare const FLUSH_WAIT_MS = 90000;
export declare function isTopLevel(session: Session): boolean;
export declare function projectCwd(session: Session): string;
/** Wait for a promise, but never longer than the flush budget. */
export declare function waitBounded(promise: Promise<void>): Promise<void>;
/**
 * Serialize background writes. A failed task reaches its caller through the
 * returned promise, but never poisons later tasks on the same queue.
 */
export declare class SerialQueue {
    private tail;
    /**
     * Run one task after the previous one settles.
     * @param work - the task; its value or rejection reaches this caller only.
     * @returns the task's own promise, so callers can read what it produced.
     */
    run<T>(work: () => Promise<T>): Promise<T>;
}
/** Per-session in-flight work, awaited by the `session/flush` durability handler. */
export declare class SessionWorkTracker {
    private readonly pending;
    /** @param work - in-flight work; its value is ignored, only its settlement matters. */
    track(session: Session, work: Promise<unknown>): void;
    flush(session: Session): Promise<void> | undefined;
}
