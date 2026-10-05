/**
 * The read path, which has no side effects. The journal wins once it exists; `MEMORY.md` and the
 * legacy `.omp`/`.pi` layouts stay readable for projects that never wrote one. Damage (a torn
 * journal tail, an unreadable source) is reported, never silently treated as "no memory".
 */
/** What one memory read produced, and how trustworthy it is. */
export type LoadedMemory = {
    text: string;
    source: string;
    poisoned: boolean;
    /** The source exists but could not be read: callers must not treat this as "no memory". */
    unreadable?: boolean;
    /** Unusable journal lines that were skipped (a torn tail from a crash, or a hand edit). */
    damaged?: number;
    /**
     * Characters this read's own cap kept back, 0 when the stored document reached the caller whole.
     *
     * A stored document can exceed the cap — a hand edit, or a `maxMemoryChars` lowered below what an
     * earlier pass wrote — and the cap is applied here, before the consolidation pass sees the text.
     * Without this count a pass re-emitting a nearly empty view of a large stored document reports a
     * clean read; the number is the normalizer's own cut, never a length difference against the raw
     * bytes, which would fold normalization's edits into the cap's count.
     */
    cappedDroppedChars: number;
};
/** Read one memory source, distinguishing "absent" from "exists but unreadable". */
export declare function readMemorySource(file: string): Promise<{
    text: string;
    unreadable: boolean;
}>;
/**
 * Read this project's memory. The journal is the source of truth once it exists; `MEMORY.md` is
 * the old layout and stays readable for projects that never wrote a journal.
 * @param projectRoot - the project root.
 * @param limit - the character cap; the project's `maxMemoryChars`. Every normalization on this
 * side uses it, so the fold and the render are compared under the same cap.
 * @returns the document, where it came from, and any damage worth reporting.
 */
export declare function loadMemory(projectRoot: string, limit?: number): Promise<LoadedMemory>;
/** Whether this path holds a record that no longer parses (used by callers that report damage). */
export declare function readMemoryDamage(projectRoot: string): Promise<{
    damaged: number;
    unreadable: boolean;
}>;
/**
 * Synchronous memory read for prompt assembly, which dsh calls synchronously and therefore cannot
 * await. Folds the journal when it exists — the render can lag behind a crash between the append
 * and the render — and otherwise reads the rendered document, decoding a stored reply if the
 * bytes are one. Returns an empty string when nothing readable exists, never throwing.
 * @param projectRoot - the project root.
 * @param limit - the character cap; the project's `maxMemoryChars`. Every normalization on this
 * side uses it, so this reader and the async one agree.
 * @returns the memory document, or `""`.
 */
export declare function loadMemorySync(projectRoot: string, limit?: number): string;
/** File mtime in milliseconds, 0 when it does not exist. */
export declare function mtimeMs(file: string): number;
