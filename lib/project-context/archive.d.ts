/**
 * Session-archive reader.
 *
 * The canonical `session.jsonl` stores one full event per line, including
 * `assistant/message.stream` chunks that dwarf the visible conversation. When a
 * later pass backtracks into the archive it needs message-level text, not the
 * raw event payloads — this module replays the JSONL into the same compact
 * `## user / ## assistant / ## tool result` shape the live passes use.
 *
 * Two harnesses write that log into the same `.agents/` layout: dsh (named
 * events under `data`) and pi (a single `message` event whose body is the
 * message itself). Both are read here, because a project archive can hold both —
 * pi's older `session-log.ts` backfilled the same directory — and a log this
 * reader cannot parse is silently invisible to every pass that backtracks.
 */
/** A block of a pi message: same `text`/`tool-result` shapes under pi's own type names. */
export interface PiBlock {
    type?: unknown;
    text?: unknown;
    name?: unknown;
    content?: unknown;
}
/**
 * Text of a pi content list. Unlike dsh's `textOf` this joins without a separator (pi's own
 * renderer). Exported because the index title has to read a pi message exactly the way this
 * reader does: two joins over one message give different text (`"a b"` vs `"ab"`), and `clip`
 * cannot reconcile them — it collapses whitespace but never supplies a missing separator. Every
 * pi text extraction in the plugin therefore goes through this one function.
 */
export declare function piTextOf(blocks: readonly PiBlock[]): string;
/**
 * Render archived JSONL into a budgeted conversation transcript.
 *
 * Production reads go through {@link readArchivedConversation}, which streams the
 * file; this string form is the reference the streaming reader must stay
 * byte-identical to (and what the tests compare against).
 * @param jsonl - the whole canonical log.
 * @param limit - transcript character budget.
 * @returns the budgeted transcript.
 */
export declare function archivedConversationText(jsonl: string, limit: number): string;
/**
 * Read one archived session and render its conversation.
 *
 * The log is streamed rather than slurped: an archived session can be tens of
 * megabytes, and the caller only needs the rendered sections, which are a
 * fraction of that. A missing or unreadable file renders as empty, like
 * `readOptional` did.
 * @param file - absolute path of the archived `session.jsonl`.
 * @param limit - transcript character budget.
 * @returns the budgeted transcript.
 */
export declare function readArchivedConversation(file: string, limit: number): Promise<string>;
