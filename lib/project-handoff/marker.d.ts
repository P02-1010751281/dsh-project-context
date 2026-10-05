/**
 * Handoff session marker shared by the host and browser halves.
 *
 * The host renames a fresh handoff session with this stable title prefix; the
 * client watcher switches to it when such a session appears. Keeping the
 * literal in one module prevents a silent host/client drift.
 */
/** Title prefix written by `src/project-handoff/index.ts` and matched by `src/project-handoff/watch.ts`. */
export declare const HANDOFF_TITLE_PREFIX = "\u21AA handoff \u00B7 ";
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
export declare function handoffSwitchDeferred(state: {
    readonly draft: string;
    readonly phase: string;
} | undefined): boolean;
/** One listed session as the browser watcher sees it. */
export interface HandoffWatchRow {
    /** Session id. */
    readonly id: string;
    /** `subagent` marks a delegated child, never a handoff target. */
    readonly origin?: unknown;
    /** Session cwd, compared against the active session's cwd. */
    readonly cwd?: unknown;
    /** Title projection; `undefined` while it has not landed yet. */
    readonly title?: unknown;
}
/** Everything one watcher scan observes. */
export interface HandoffWatchInput {
    /** Session-list arrival lifecycle: `pending` means no pull has landed yet. */
    readonly phase?: unknown;
    /** Whether the pre-existing id set has already been captured. */
    readonly seeded: boolean;
    /** Active session id, when one is selected. */
    readonly current?: string | undefined;
    /** Active session cwd, when the list knows it. */
    readonly currentCwd?: unknown;
    /** Listed sessions that are not known yet (all of them before the first seed). */
    readonly rows: readonly HandoffWatchRow[];
    /** Active session's composer snapshot, when its facade exists. */
    readonly composer?: {
        readonly draft: string;
        readonly phase: string;
    } | undefined;
}
/** What the caller should do about one scan. */
export interface HandoffWatchPlan {
    /** Adopt every listed row as pre-existing instead of switching. */
    readonly seed: boolean;
    /** Rows settled as "not this watcher's business". */
    readonly markSeen: readonly string[];
    /** Session to open; the caller marks it seen after a successful `open`. */
    readonly open?: string | undefined;
    /** A handoff was found but the composer owns the session; retry when it settles. */
    readonly deferred: boolean;
}
/**
 * Decide what the browser watcher does with one session-list snapshot.
 *
 * Kept pure and host-side so the switch logic — the code behind the 2026-09-13
 * misdirected-command incident — is unit-testable without a browser. The caller
 * owns the `seen` set, the list subscription, and `sessions.open`.
 *
 * @param input - the snapshot, the ids already known, and the composer state.
 * @returns the rows to settle, at most one session to open, and whether to retry.
 */
export declare function planHandoffWatch(input: HandoffWatchInput): HandoffWatchPlan;
