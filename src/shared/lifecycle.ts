/**
 * Shared plugin lifecycle helpers: session identity, serialized background
 * work, and per-session durability tracking. Both context plugins and the
 * handoff plugin keep the same lifecycle shape, so it lives here once.
 */

import type { Session } from "@deepseek-ai/dsh-session";

/** Longest a durability flush waits for in-flight work before letting shutdown proceed. */
export const FLUSH_WAIT_MS = 90_000;

export function isTopLevel(session: Session): boolean {
	return session.header.origin !== "subagent";
}

export function projectCwd(session: Session): string {
	return session.header.cwd ?? process.cwd();
}

/** Wait for a promise, but never longer than the flush budget. */
export function waitBounded(promise: Promise<void>): Promise<void> {
	return new Promise<void>((resolve) => {
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
	private tail: Promise<void> = Promise.resolve();

	run(work: () => Promise<void>): Promise<void> {
		const next = this.tail.then(work);
		this.tail = next.then(
			() => undefined,
			() => undefined,
		);
		return next;
	}
}

/** Per-session in-flight work, awaited by the `session/flush` durability handler. */
export class SessionWorkTracker {
	private readonly pending = new Map<string, Promise<void>>();

	track(session: Session, work: Promise<void>): void {
		const key = String(session.id);
		const tracked = work.catch(() => undefined);
		this.pending.set(key, tracked);
		void tracked.finally(() => {
			if (this.pending.get(key) === tracked) this.pending.delete(key);
		});
	}

	flush(session: Session): Promise<void> | undefined {
		const work = this.pending.get(String(session.id));
		return work ? waitBounded(work) : undefined;
	}
}
