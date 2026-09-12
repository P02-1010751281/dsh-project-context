/**
 * Handoff session marker shared by the host and browser halves.
 *
 * The host renames a fresh handoff session with this stable title prefix; the
 * client watcher switches to it when such a session appears. Keeping the
 * literal in one module prevents a silent host/client drift.
 */

/** Title prefix written by `src/handoff.ts` and matched by `client/handoff-nav.ts`. */
export const HANDOFF_TITLE_PREFIX = "↪ handoff · ";
