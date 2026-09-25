/**
 * Snapshot-store bridge across the two public DSH client module layouts.
 *
 * Adapted from dsh-client-auto-continue (MIT, Copyright (c) 2025 HsiangNianian).
 *
 * DSH 0.1.2 moved the store engine from the dynamic
 * `@deepseek-ai/dsh-client-runtime/client` row into the shell-seeded
 * `@deepseek-ai/dsh-client-store` platform module. The probe is dynamic so the
 * bundler does not turn both candidates into eager top-level requires.
 */

/** Writable observable snapshot used by the settings card. */
export interface SnapshotStore<T> {
	getSnapshot(): T;
	subscribe(listener: () => void): () => void;
	update(mutator: (draft: T) => void): void;
	set(next: T): void;
}

/** Settings state consumed by the staged form. */
export interface SettingsScopeSnapshot<T> {
	status: "loading" | "ready" | "unavailable";
	value: T | undefined;
	base: unknown;
	user: unknown;
	revision: number | undefined;
	writable: boolean;
	mode: "host" | "memory";
}

/**
 * Stable subset shared by every settings surface this card has been built against: the legacy
 * settings scope, dsh 0.1.2's scope, and 0.1.7-alpha.1's `ConfigForm`. The write answers ("did the
 * Host accept it") are `unknown` because only some harnesses report them; the staged form re-reads
 * the snapshot after saving instead of consuming the answer.
 */
export interface SettingsScope<T> {
	getSnapshot(): SettingsScopeSnapshot<T>;
	subscribe(listener: () => void): () => void;
	set(field: string, value: unknown): Promise<unknown>;
	unset(field: string): Promise<unknown>;
}

interface SnapshotStoreModule {
	createSnapshotStore<T>(
		init: T,
		options?: { flush?: "raf" | "sync"; persist?: { name: string } },
	): SnapshotStore<T>;
}

/** A module can resolve and still be the wrong layout: only the factory export counts. */
function hasFactory(module: unknown): module is SnapshotStoreModule {
	return typeof (module as SnapshotStoreModule | null | undefined)?.createSnapshotStore === "function";
}

function resolveSnapshotStore(): SnapshotStoreModule {
	// String assembly preserves the lazy try/fallback in the emitted client bundle.
	const current = ["@deepseek-ai/dsh-client", "-store"].join("");
	const legacy = ["@deepseek-ai/dsh-client-runtime", "/client"].join("");
	for (const id of [current, legacy]) {
		try {
			const module: unknown = require(id);
			if (hasFactory(module)) return module;
		} catch {
			// Not the layout this shell ships; try the next candidate.
		}
	}
	// Failing here beats passing `undefined` into the card, where it would only
	// surface much later as "createStore is not a function". The tradeoff is that a
	// layout mismatch now fails the whole client half, not just the settings card;
	// a silent `undefined` would fail activation for the card anyway.
	throw new Error("dsh-project-context: neither client store module exposes createSnapshotStore");
}

export const { createSnapshotStore } = resolveSnapshotStore();
