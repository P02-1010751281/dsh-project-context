/**
 * Handoff session marker shared by the host and browser halves.
 *
 * The host renames a fresh handoff session with this stable title prefix; the
 * client watcher switches to it when such a session appears. Keeping the
 * literal in one module prevents a silent host/client drift.
 */
/** Title prefix written by `src/project-handoff/index.ts` and matched by `src/project-handoff/watch.ts`. */
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
export function handoffSwitchDeferred(state) {
    return state !== undefined && (state.phase !== "plain" || state.draft.trim().length > 0);
}
/** A fresh idle plan; never a shared constant, so a caller cannot alias another scan's result. */
function noPlan() {
    return { seed: false, markSeen: [], deferred: false };
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
export function planHandoffWatch(input) {
    // While the list is `pending` its snapshot is empty because nothing arrived,
    // not because no session exists: seeding there would make the whole first pull
    // look newly created and auto-open a stale handoff session.
    if (typeof input.phase === "string" && input.phase !== "ready")
        return noPlan();
    if (!input.seeded)
        return { seed: true, markSeen: [], deferred: false };
    const markSeen = [];
    for (const row of input.rows) {
        if (row.origin === "subagent") {
            markSeen.push(row.id);
            continue;
        }
        if (row.cwd !== undefined && input.currentCwd !== undefined && row.cwd !== input.currentCwd) {
            markSeen.push(row.id);
            continue;
        }
        // A missing title means the projection has not landed; retry on a later update.
        if (typeof row.title !== "string")
            continue;
        if (!row.title.startsWith(HANDOFF_TITLE_PREFIX)) {
            markSeen.push(row.id);
            continue;
        }
        // The composer owns the active session: switching now would send whatever the
        // user is typing (or submitting) into the fresh session instead.
        if (input.current !== undefined && handoffSwitchDeferred(input.composer)) {
            return { seed: false, markSeen, deferred: true };
        }
        return { seed: false, markSeen, open: row.id, deferred: false };
    }
    return { seed: false, markSeen, deferred: false };
}
