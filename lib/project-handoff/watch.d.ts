/**
 * Browser half of the handoff switch.
 *
 * The host half renames the fresh handoff session with a stable title prefix.
 * When such a session appears in the list after this plugin loaded, this
 * watcher opens it — the client mirror of pi's auto-handoff session switch.
 * Titles arrive through the session title projection, so the watcher rechecks
 * newly listed sessions on every list update until the projection lands.
 *
 * The switch is deferred while the active session's composer holds input the
 * user has not surrendered yet (a non-empty draft or a submission in flight),
 * because opening a session moves where the next send lands. The watcher then
 * subscribes to that composer, so it retries as soon as the user settles
 * instead of waiting for unrelated session-list traffic.
 *
 * The module carries no browser or Cordis import so it compiles into the host
 * half's `lib/` too: the decision lives in `planHandoffWatch` and this adapter is
 * exercised by `node --test` against a fake context, which is what the
 * 2026-09-13 misdirected-command incident lacked.
 */
/** The slice of the client context this watcher reads: `sessions` and `conversation`, when present. */
export interface HandoffWatchContext {
    get(name: string): unknown;
}
/**
 * Watch for freshly listed sessions carrying the handoff title and open them.
 * @param ctx - client context carrying the sessions service.
 * @returns disposer removing the list subscription.
 */
export declare function watchHandoffSwitch(ctx: HandoffWatchContext): () => void;
