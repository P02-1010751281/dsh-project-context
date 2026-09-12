/**
 * Browser half of the handoff switch.
 *
 * The host half renames the fresh handoff session with a stable title prefix.
 * When such a session appears in the list after this plugin loaded, this
 * watcher opens it — the client mirror of pi's auto-handoff session switch.
 * Titles arrive through the session title projection, so the watcher rechecks
 * newly listed sessions on every list update until the projection lands.
 */

import type { Context as ClientContext } from "@deepseek-ai/cordis";

/** Title prefix written by the host half (see src/handoff.ts). */
const HANDOFF_TITLE_PREFIX = "↪ handoff · ";

interface SnapshotFace {
	getSnapshot(): unknown;
}

interface HandoffSessions {
	readonly list: {
		getSnapshot(): {
			readonly ids: readonly unknown[];
			readonly byId: Readonly<Record<string, { readonly cwd?: unknown; readonly origin?: unknown } | undefined>>;
			readonly current?: unknown;
		};
		subscribe(listener: () => void): () => void;
	};
	binding(id: unknown): { readonly session: { readonly projections: { faceOf(key: string): SnapshotFace } } } | undefined;
	open(id: unknown): void;
}

/**
 * Watch for freshly listed sessions carrying the handoff title and open them.
 * @param ctx - client context carrying the sessions service.
 * @returns disposer removing the list subscription.
 */
export function watchHandoffSwitch(ctx: ClientContext): () => void {
	const sessions = ctx.get("sessions") as HandoffSessions | undefined;
	if (sessions === undefined) return () => undefined;

	/** Sessions present before this plugin loaded never trigger a switch. */
	const seen = new Set<string>();
	for (const id of sessions.list.getSnapshot().ids) seen.add(String(id));

	const scan = (): void => {
		const state = sessions.list.getSnapshot();
		const current = state.current === undefined ? undefined : String(state.current);
		const currentCwd = current === undefined ? undefined : state.byId[current]?.cwd;
		for (const id of state.ids) {
			const key = String(id);
			if (seen.has(key)) continue;
			const summary = state.byId[key];
			if (summary?.origin === "subagent") {
				seen.add(key);
				continue;
			}
			if (summary?.cwd !== undefined && currentCwd !== undefined && summary.cwd !== currentCwd) {
				seen.add(key);
				continue;
			}
			let title: unknown;
			try {
				title = sessions.binding(id)?.session.projections.faceOf("title").getSnapshot();
			} catch {
				continue;
			}
			if (typeof title !== "string") continue;
			if (!title.startsWith(HANDOFF_TITLE_PREFIX)) {
				seen.add(key);
				continue;
			}
			try {
				sessions.open(id);
				seen.add(key);
			} catch {
				// Listed but not openable yet; a later list update retries.
			}
			return;
		}
	};

	const unsubscribe = sessions.list.subscribe(scan);
	scan();
	return unsubscribe;
}
