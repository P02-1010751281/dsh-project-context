/**
 * The append-only journal — the source of truth: one JSON record per write, folded into a render
 * on read, rotated (archived, never deleted) once it grows past the size limit.
 */
import { type NormalizedMemory } from "./document.js";
/** The append-only memory journal for one project. */
export declare function memoryJournalFile(projectRoot: string): string;
/** One journal record: a whole-document replacement or an appended fragment. */
export type MemoryJournalEntry = {
    op: "replace" | "append";
    text: string;
};
/** Append one record with a single `write` call; the file is append-only by construction. */
export declare function appendMemoryOp(file: string, op: MemoryJournalEntry["op"], text: string): Promise<void>;
/** Parse journal text in file order, tolerating a torn or hand-edited line without losing the rest. */
export declare function parseJournalEntries(raw: string): {
    entries: MemoryJournalEntry[];
    damaged: number;
};
/**
 * Read the journal in file order, tolerating a torn or hand-edited line without losing the rest.
 * @param file - the journal path.
 * @returns the usable records, how many lines were unusable, and whether the file was unreadable.
 */
export declare function readMemoryJournal(file: string): Promise<{
    entries: MemoryJournalEntry[];
    damaged: number;
    unreadable: boolean;
}>;
/** Apply journal records in order: a replacement supersedes the document, an append extends it. */
export declare function foldMemoryJournal(entries: readonly MemoryJournalEntry[], limit?: number): string;
/**
 * `foldMemoryJournal`, plus what this fold's own cap cut.
 *
 * The fold is where the read cap is applied to a journal-backed document, and a stored document can
 * exceed it (a hand edit, or a `maxMemoryChars` lowered below what an earlier pass wrote). The read
 * path has to report the characters the model was not shown, and only this normalizer knows how much
 * of the *normalized* document the cap removed — a length difference taken against the raw records
 * would fold normalization's own edits into the cap's count.
 * @param entries - the journal records, in file order.
 * @param limit - the character cap; the project's `maxMemoryChars`.
 * @returns the rendered document plus the characters this call's cap dropped (0 when it fit).
 */
export declare function foldMemoryJournalWithDrop(entries: readonly MemoryJournalEntry[], limit?: number): NormalizedMemory;
/** Collapse an oversized journal into one replacement, archiving the previous bytes first. */
export declare function rotateMemoryJournalIfNeeded(projectRoot: string, limit?: number): Promise<void>;
/**
 * The newest archived journal, or `undefined` when the project never rotated.
 *
 * Rotation archives the previous bytes, so when `memory.jsonl` is gone this is the only surviving
 * copy of the document the pass wrote — better evidence than the render the journal had already
 * superseded. Used by the read path as a recovery source.
 */
export declare function newestMemoryArchive(projectRoot: string): Promise<string | undefined>;
/**
 * Synchronous counterpart of {@link newestMemoryArchive}, for prompt assembly (`loadMemorySync`),
 * which dsh calls synchronously and therefore cannot await. Same name rule, same "newest first".
 */
export declare function newestMemoryArchiveSync(projectRoot: string): string | undefined;
