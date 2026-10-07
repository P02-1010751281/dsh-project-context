/**
 * One handoff transaction, in order: persist `HANDOFF.md`, seed the child, publish the switch
 * marker. Nothing is generated: the child gets the carried tail, the file index and a pointer to
 * the session log the dropped prefix stays in. The seed happens before the marker, and the document
 * is written last, so an abandoned attempt leaves nothing behind in the project.
 */
import { type Context } from "@deepseek-ai/cordis";
import { type Session } from "@deepseek-ai/dsh-session";
import { type PluginConfig } from "../shared/config.js";
import { type HandoffLanguage } from "./language.js";
import { type HandoffSplit } from "./conversation.js";
/**
 * The two language-dependent artifacts of one handoff: the `HANDOFF.md` document and the child's
 * first message. Both carry mechanical parts only — the archive pointers, the file index and the
 * carried state; the dropped prefix is reachable through the log the payload names. Exported so a
 * test can pin the wiring (the resolved language, the pending-question carry and the carried user
 * decision) rather than only the pure helpers.
 * @param args - session, resolved language, file index, archive pointers and the tail.
 * @returns the document to persist and the prompt to admit to the child.
 */
export declare function handoffArtifacts(args: {
    session: Session;
    config: PluginConfig;
    language: HandoffLanguage;
    fileOperations: string;
    archive: {
        log: string;
        index: string;
    };
    pointers: {
        log: string;
        index: string;
    };
    tail: string;
}): {
    document: string;
    prompt: string;
};
/**
 * The span a handoff drops, or an error when there is none. Two cases reach this: a session with no
 * messages at all, and — with the default `handoffBudgetRecentTokens` — a short conversation that
 * fits entirely inside the carried-over window. Both would otherwise seed the child with a
 * continuation that drops nothing; the error names the `budget recent 0` escape for the second case.
 * The automatic path cannot reach it (it refuses a span below `MIN_DROP_TOKENS` first).
 * Exported so a test can pin the guard instead of only the happy path.
 * @param older - the rendered conversation before the kept tail.
 */
export declare function assertHandoffDroppable(older: string): void;
/**
 * The title to write when the service's accepted value lost the switch prefix, else `undefined`.
 *
 * The service stores what it normalizes, not what it was asked for: `cleanTitleText` drops control
 * and invisible characters and then trims the end, so a label consisting only of characters it strips
 * would leave `↪ handoff ·` — one space short of the literal the browser watcher matches with
 * `startsWith`, which means the user is never switched to the continuation while the plugin logs a
 * successful handoff. `sessionController.rename` reports the accepted title (`{title, seq}`), so this
 * is read from the same call and costs no round trip; the parent's short id is ASCII and cannot lose
 * the prefix. `undefined` (a runtime that reports nothing recognizable, or a label that already is the
 * id) leaves the stored title alone: treating an unknown reply as a failure would write a second title
 * for no reason.
 *
 * This is the backstop, not the whole guarantee. {@link handoffLabel} already withholds a label with
 * nothing visible, so the realistic class never reaches the service; and no correction can undo a scan
 * the browser already made — `planHandoffWatch` adds the rows it walks past, whose title is a string
 * without the prefix, to `markSeen` (it stops at the first row that does carry the prefix), and that set
 * is never revisited, so a client that read the intermediate title before this second write has already
 * given up on the switch. What the correction restores is the stored title (what the sidebar and every
 * later reader see), not a guaranteed switch.
 * @param accepted - the value `sessionController.rename` resolved with.
 * @param label - the label that was asked for, without the prefix.
 * @param fallback - the parent's short id, already the label when the session had no human input.
 * @returns the title to write, or `undefined` to keep what the service stored.
 */
export declare function retitleAfterRename(accepted: unknown, label: string, fallback: string): string | undefined;
/**
 * Drop the older context, persist the document, and start the seeded child session.
 * @param reason - the path that decided this handoff.
 * @param signal - the caller's cancellation signal, when the profile supplies one.
 * @param split - the span decided by the caller, when it already computed one.
 * @param triggerSeq - the automatic path's triggering `turn/end` offset; the handoff is deferred
 *   (never performed) once this session has started a turn after it. Absent on the manual path:
 *   `/handoff now` runs *inside* a turn, so "a turn is open" cannot mean the user moved on.
 */
export declare function performHandoff(ctx: Context, session: Session, config: PluginConfig, reason: "auto" | "manual", signal: AbortSignal | undefined, split?: HandoffSplit, triggerSeq?: number): Promise<{
    childId: string;
    file: string;
}>;
