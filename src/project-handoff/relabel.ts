/**
 * The deferred half of the handoff title policy: a continuation names itself once it has been talked to.
 *
 * A handoff writes the child's title before anyone has typed into the child, so `handoffLabel` can
 * only use the parent's own last input — and when the parent has none (every link of an automatic
 * continuation chain) the label is the parent's short id, which is what the sidebar shows for the
 * rest of that session's life. The child's own log is the one place a better label appears later, and
 * reading it costs nothing: no model call, no new dependency, no new event type.
 *
 * Why one write needs no bookkeeping: the label comes from the child's **first** naming input
 * (`deferredHandoffLabel`), which never changes, and a write is skipped when the stored title already
 * reads that way. So the rewrite happens at most once per continuation, it survives a plugin restart
 * (nothing is remembered in the process), and a user's own rename wins forever because it does not
 * carry our prefix. Naming the continuation after the *first* input rather than tracking the newest
 * is deliberate: a sidebar entry that changes with every message would be worse than a stale id.
 *
 * The prefix stays, because `marker.ts`'s watcher matches it; the write is the same `session/title`
 * with the `user` source dsh itself writes on a rename, which is also why the service leaves the
 * title alone afterwards (a rename pins it). This module holds no state at all.
 */

import { type Context } from "@deepseek-ai/cordis";
import { type Session } from "@deepseek-ai/dsh-session";
import { deferredHandoffLabel } from "./conversation.js";
import { HANDOFF_TITLE_PREFIX } from "./marker.js";
import { retitleAfterRename } from "./perform.js";
import { type SessionTitleLike } from "./runtime.js";

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
export function storedHandoffLabel(title: unknown): string | undefined {
	if (typeof title !== "string" || !title.startsWith(HANDOFF_TITLE_PREFIX)) return undefined;
	return title.slice(HANDOFF_TITLE_PREFIX.length);
}

/**
 * Rename a continuation after its own first input, once, keeping the switch prefix.
 *
 * Best-effort by construction: a title is a display nicety, so a service that refuses the write (a
 * session that is no longer live, a store that rejects it) is logged and dropped rather than allowed
 * to fail the turn that carried the input. The reads before the write are not wrapped because neither
 * can raise a failure this path introduces: `ctx.get` never throws for an absent service, and folding
 * the title is what the host itself does on the very same event.
 * @param ctx - plugin context; the title service is read undeclared and may be absent.
 * @param session - the session whose `user/message` just landed.
 */
export function relabelHandoffChild(ctx: Context, session: Session): void {
	const titles = ctx.get("sessionTitle") as SessionTitleLike | undefined;
	if (titles?.get === undefined || titles.rename === undefined) return;
	// Anything but a prefix-carrying title means this is not ours: an ordinary session, or a
	// continuation the user renamed themselves.
	const stored = storedHandoffLabel(titles.get(session)?.title);
	if (stored === undefined) return;
	const label = deferredHandoffLabel(session);
	// Nothing names it yet, or the stored title already reads that way — the second case is what makes
	// a repeated event free, and it is the whole of the "write once" rule.
	if (label === undefined || label === stored) return;
	try {
		const accepted = titles.rename(session, `${HANDOFF_TITLE_PREFIX}${label}`);
		// The same backstop the handoff's own write carries: the service stores what it normalized, and
		// a label it strips entirely (an escape sequence with a printable body is the reachable class)
		// would leave the prefix one space short of the literal the watcher matches with `startsWith`.
		// The previous title was accepted by that same service, so restoring it cannot lose the prefix.
		const restore = retitleAfterRename(accepted, label, stored);
		if (restore !== undefined) titles.rename(session, restore);
	} catch (error: unknown) {
		ctx.logger.warn("dsh-project-context: handoff continuation title not updated: %s", error instanceof Error ? error.message : String(error));
	}
}
