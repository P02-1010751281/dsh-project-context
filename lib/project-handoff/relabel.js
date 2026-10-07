/**
 * The deferred half of the handoff title policy: a continuation names itself once it has been talked to.
 *
 * A handoff writes the child's title before anyone has typed into the child, so `handoffLabel` can
 * only use the parent's own last input — and when the parent has none (every link of an automatic
 * continuation chain) the label is the parent's short id, which is what the sidebar shows for the
 * rest of that session's life. The child's own log is the one place a better label appears later, and
 * reading it costs nothing: no model call, no new dependency, no new event type.
 *
 * Why one write needs no bookkeeping: the label comes from the child's **first** naming input, read
 * from the durable log (`firstHandoffInput`), and the write is attempted only while the event being
 * handled is the one that carried that input. The seq is fixed for the session's life and the log
 * keeps the message, so an event can trigger the write exactly once even though the service stores its
 * own normalized title — a comparison against the stored text would never settle for a label the
 * service rewrites, and would rewrite again on every later input. A plugin restart loses nothing
 * (nothing is remembered in the process), and a user's own rename wins because it does not carry our
 * prefix. Naming the continuation after the *first* input rather than tracking the newest is
 * deliberate: a sidebar entry that changes with every message would be worse than a stale id.
 *
 * The prefix stays, because `marker.ts`'s watcher matches it; the write is the same `session/title`
 * with the `user` source dsh itself writes on a rename, which is also why the service leaves the
 * title alone afterwards (a rename pins it). This module holds no state at all.
 *
 * Why the write has to leave the dispatch envelope: this module is reached from a `session/event`
 * observer, i.e. from *inside* `Session.append`, and an append nested there is refused outright
 * ("session append cannot reenter while another append is being published"). `rename` appends the
 * `session/title` event itself, so a synchronous write can only ever be refused; the host's own title
 * service `defer`s its fallback write for the same reason. The decision below is still made, and made
 * only, on the event that carried the first naming input — deferring moves *when* the write lands,
 * never how often.
 */
import {} from "@deepseek-ai/cordis";
import {} from "@deepseek-ai/dsh-session";
import { firstHandoffInput } from "./conversation.js";
import { HANDOFF_TITLE_PREFIX } from "./marker.js";
import { retitleAfterRename } from "./perform.js";
import {} from "./runtime.js";
/**
 * The label inside a stored title this plugin wrote, else `undefined`.
 *
 * The prefix is the durable marker of a continuation — it is written before the child has any input
 * and survives restarts — so it is also what tells this reader that the title is ours to correct
 * rather than something the user chose, which must never be overwritten. The criterion is the exact
 * literal the watcher matches with `startsWith`: a title the service already broke down to the
 * prefix-less form is not re-adopted here (the handoff's own write is where that is repaired).
 * @param title - the latest stored title, as the title service folded it.
 * @returns the label after the prefix, or `undefined` when the title is not a continuation's.
 */
export function storedHandoffLabel(title) {
    if (typeof title !== "string" || !title.startsWith(HANDOFF_TITLE_PREFIX))
        return undefined;
    return title.slice(HANDOFF_TITLE_PREFIX.length);
}
/**
 * Rename a continuation after its own first input, once, keeping the switch prefix.
 *
 * The write happens only while the event being handled is the one that carried the first naming input
 * (`firstHandoffInput`'s `seq`): the service stores its *normalized* form of the title, so comparing
 * the stored title against the label we would ask for can never be a fixed point for a label it
 * rewrites — it would rewrite again on every later input — while the log's seq is fixed for the
 * session's life. The label also has to differ from the stored one, which keeps a continuation whose
 * parent's own input happened to be the child's too from being rewritten with the same text.
 *
 * Best-effort by construction: a title is a display nicety, so a service that refuses the write (a
 * session that is no longer live, a store that rejects it) is logged and dropped rather than allowed
 * to fail the turn that carried the input. The reads before the write are not wrapped because neither
 * can raise a failure this path introduces: `ctx.get` never throws for an absent service, and folding
 * the title is what the host itself does on the very same event.
 *
 * The write itself is deferred past the dispatch envelope (see the module comment). The methods are
 * read once and invoked with their own receiver, because the service resolves `this` when it appends.
 * @param ctx - plugin context; the title service is read undeclared and may be absent.
 * @param session - the session whose `user/message` just landed.
 * @param triggerSeq - that event's seq, which must be the first naming input's own.
 */
export function relabelHandoffChild(ctx, session, triggerSeq) {
    const titles = ctx.get("sessionTitle");
    if (titles === undefined)
        return;
    const { get, rename } = titles;
    if (get === undefined || rename === undefined)
        return;
    // Anything but a prefix-carrying title means this is not ours: an ordinary session, or a
    // continuation the user renamed themselves.
    const stored = storedHandoffLabel(get.call(titles, session)?.title);
    if (stored === undefined)
        return;
    const first = firstHandoffInput(session);
    if (first === undefined || first.seq !== triggerSeq)
        return;
    const label = first.label;
    if (label === stored)
        return;
    void Promise.resolve().then(() => {
        try {
            const accepted = rename.call(titles, session, `${HANDOFF_TITLE_PREFIX}${label}`);
            // The same backstop the handoff's own write carries: the service stores what it normalized,
            // and a label it strips entirely (an escape sequence with a printable body is the reachable
            // class) would leave the prefix one space short of the literal the watcher matches with
            // `startsWith`. The previous title was accepted by that same service, so restoring it
            // cannot lose the prefix.
            const restore = retitleAfterRename(accepted, label, stored);
            if (restore !== undefined)
                rename.call(titles, session, restore);
        }
        catch (error) {
            ctx.logger.warn("dsh-project-context: handoff continuation title not updated: %s", error instanceof Error ? error.message : String(error));
        }
    });
}
