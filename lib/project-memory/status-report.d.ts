/**
 * The `/memory` status **core**: one report DTO in, one receipt string out.
 *
 * Nothing here touches the harness or the disk. How many lines the journal has, how many backups sit
 * next to the render, how many sessions are archived — those arrive already measured from the sibling
 * `status-source.ts`, the one file that knows the `.agents/memory` layout. A receipt is therefore a pure
 * function of what was measured, and a wording change can never disagree with a count.
 *
 * Two rules the wording enforces:
 *
 * - A value we could not measure is a *named* absence (`unknown`, `none yet`, `unparseable`), never a
 *   `0`: "no backups" and "could not list the directory" are different facts, and this repository
 *   treats a wrong cause as worse than a named gap.
 * - Nothing claims what the last consolidation did. That outcome is not persisted anywhere — not in a
 *   state file, not in a journal record — so the receipt says so instead of inferring it from an mtime
 *   or a size. A receipt that guessed would be wrong the first time two passes ran close together.
 *
 * Section counts come from `sectionsFromMarkdown`, the same conservative parser the write path uses:
 * a document it cannot read with certainty is reported as *unparseable*, not as four empty sections,
 * because "0 entries" would read as "this memory is empty" when the truth is "this is not our shape".
 */
/**
 * The journal as the adapter measured it.
 *
 * `unreadable` is separate from `absent` on purpose: a journal that exists but cannot be opened is a
 * failure the user has to see, and folding it into "no journal yet" would hide a broken store.
 */
export type JournalFacts = {
    readonly kind: "absent";
} | {
    readonly kind: "present";
    readonly lines: number;
    readonly bytes: number;
} | {
    readonly kind: "unreadable";
};
/**
 * The raw facts the adapter measured around one memory document.
 *
 * `undefined` on a count means "the directory could not be listed" — unknown, never zero.
 */
export interface MemoryFileFacts {
    readonly journal: JournalFacts;
    /** Backup files this plugin wrote next to the render. */
    readonly backups: number | undefined;
    /** Directories under `session-logs/` that carry a `meta.json` (an archived session). */
    readonly archivedSessions: number | undefined;
    /** Line count only: the log's content is deliberately not read here. */
    readonly errorLogLines: number | undefined;
}
/** Everything one status receipt renders. Measured values only. */
export interface MemoryStatusReport {
    /** The loaded document — what a consolidation pass would see, cap and fold included. */
    readonly document: string;
    readonly source: string;
    /** Where a memory would live, for the "none yet" wording. */
    readonly expectedPath: string;
    /** The journal's path, named once whether the file is present or not. */
    readonly journalPath: string;
    readonly maxChars: number;
    /** Unusable journal lines this read skipped. */
    readonly damaged: number;
    readonly unreadable: boolean;
    readonly poisoned: boolean;
    /** Characters this read's cap kept back (the loader's own count, not a length difference). */
    readonly cappedDroppedChars: number;
    readonly files: MemoryFileFacts;
}
/**
 * The `/memory` status receipt.
 *
 * The reply distinguishes the states a silent fold would otherwise hide: a torn journal line, a source
 * that exists but cannot be read, and a stored reply from the old bug. It also reports the character
 * cap, which is the one degraded state the document itself cannot surface to the user: a marker records
 * that the document was capped *at some point* (it is carried forward), while `cappedDroppedChars`
 * describes what **this** read's cap kept back — including on the no-journal read, which clips without
 * writing a marker at all. Either one is enough to warn; a memory that lost a third of itself must not
 * read as perfectly healthy, or every later append lands past the cap and is dropped on write.
 * @param report - the loaded document, its flags, and the file facts the adapter measured.
 * @returns the command result.
 */
export declare function formatMemoryStatus(report: MemoryStatusReport): {
    kind: "success" | "error";
    text: string;
};
