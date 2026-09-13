/**
 * Handoff session marker shared by the host and browser halves.
 *
 * The host renames a fresh handoff session with this stable title prefix; the
 * client watcher switches to it when such a session appears. Keeping the
 * literal in one module prevents a silent host/client drift.
 */

/** Title prefix written by `src/handoff.ts` and matched by `client/handoff-nav.ts`. */
export const HANDOFF_TITLE_PREFIX = "↪ handoff · ";

/**
 * Whether a session's composer holds input the user has not surrendered yet.
 *
 * The client watcher must not steal the active session while the user is typing
 * or while a submission is in flight: opening a session moves where the next
 * send lands, so the draft and the submit-plane phase are the client-side
 * signals that a switch would lose the user's input target.
 *
 * @param state - the session's input-machine snapshot, when its facade exists.
 * @returns true when the draft is non-empty or the submit plane is mid-flight.
 */
export function handoffSwitchDeferred(state: { readonly draft: string; readonly phase: string } | undefined): boolean {
	return state !== undefined && (state.phase !== "plain" || state.draft.trim().length > 0);
}
