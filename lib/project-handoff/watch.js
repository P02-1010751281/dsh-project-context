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
import { planHandoffWatch } from "./marker.js";
/** Read the active session's input snapshot; an absent or unexpected facade never blocks a switch. */
function inputSnapshot(conversation, id) {
    if (conversation === undefined || id === undefined)
        return undefined;
    try {
        const state = conversation.input.shell(id).state.getSnapshot();
        if (typeof state !== "object" || state === null)
            return undefined;
        // The snapshot crosses a service boundary, so read the two fields instead of
        // trusting a cast: a missing `draft` would throw inside the list listener.
        const { draft, phase } = state;
        if (typeof draft !== "string" || typeof phase !== "string")
            return undefined;
        return { draft, phase };
    }
    catch {
        return undefined;
    }
}
/**
 * Watch for freshly listed sessions carrying the handoff title and open them.
 * @param ctx - client context carrying the sessions service.
 * @returns disposer removing the list subscription.
 */
export function watchHandoffSwitch(ctx) {
    const sessions = ctx.get("sessions");
    if (sessions === undefined)
        return () => undefined;
    const conversation = ctx.get("conversation");
    /** Sessions present before this plugin loaded never trigger a switch. */
    const seen = new Set();
    /** Whether "already present" has been captured from a landed list. */
    let seeded = false;
    /** Composer subscription that retries a deferred switch once the user settles. */
    let composerOff;
    /** Session that subscription belongs to, so a move to another session re-binds it. */
    let composerFor;
    const stopComposerWatch = () => {
        composerOff?.();
        composerOff = undefined;
        composerFor = undefined;
    };
    /**
     * Re-scan when the active session's composer settles.
     *
     * The scan is otherwise only driven by session-list updates, and the composer
     * does not touch the list: a user who clears the draft without sending would
     * leave a deferred handoff unopened forever. The subscription follows the
     * active session, because a deferral can outlive a move to another one.
     */
    const watchComposer = (current) => {
        if (composerFor === current && composerOff !== undefined)
            return;
        stopComposerWatch();
        if (conversation === undefined || current === undefined)
            return;
        try {
            const state = conversation.input.shell(current).state;
            if (typeof state.subscribe !== "function")
                return;
            composerFor = current;
            composerOff = state.subscribe(() => {
                stopComposerWatch();
                scan();
            });
        }
        catch {
            // No composer facade for this session; the next list update retries.
        }
    };
    /** Read one session's title projection; a thrown projection means "not landed yet". */
    const titleOf = (id) => {
        try {
            return sessions.binding(id)?.session.projections.faceOf("title").getSnapshot();
        }
        catch {
            return undefined;
        }
    };
    const scan = () => {
        const state = sessions.list.getSnapshot();
        const current = state.current === undefined ? undefined : String(state.current);
        const rows = [];
        for (const id of state.ids) {
            const key = String(id);
            if (seeded && seen.has(key))
                continue;
            const summary = state.byId[key];
            rows.push({ id: key, origin: summary?.origin, cwd: summary?.cwd, title: titleOf(id) });
        }
        const plan = planHandoffWatch({
            phase: state.phase,
            seeded,
            current,
            currentCwd: current === undefined ? undefined : state.byId[current]?.cwd,
            composer: inputSnapshot(conversation, current),
            rows,
        });
        if (plan.seed) {
            seeded = true;
            for (const row of rows)
                seen.add(row.id);
            stopComposerWatch();
            return;
        }
        for (const id of plan.markSeen)
            seen.add(id);
        if (plan.open !== undefined) {
            try {
                sessions.open(plan.open);
                seen.add(plan.open);
                stopComposerWatch();
            }
            catch {
                // Listed but not openable yet; a later list update retries.
            }
            return;
        }
        if (plan.deferred)
            watchComposer(current);
        else
            stopComposerWatch();
    };
    const unsubscribe = sessions.list.subscribe(scan);
    scan();
    return () => {
        unsubscribe();
        stopComposerWatch();
    };
}
