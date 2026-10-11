/**
 * The read path, which has no side effects. The journal wins once it exists; `MEMORY.md` and the
 * legacy `.omp`/`.pi` layouts stay readable for projects that never wrote one. Damage (a torn
 * journal tail, an unreadable source) is reported, never silently treated as "no memory".
 */
import { type Stats } from "node:fs";
import { type NormalizedMemory } from "./document.js";
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
/** One consistent read of the render: its bytes, the mtime that read saw, and whether it raced. */
export type RenderRead = {
    text: string;
    mtimeMs?: number;
    changed: boolean;
};
/** Whether the render's time is strictly ahead of the journal's: bytes the journal has not absorbed yet. */
export declare function renderIsNewerThanJournal(renderMtimeMs: number | undefined, journalMtimeMs: number | undefined): boolean;
/**
 * Whether the render read from disk beats the journal's fold. Our own writes append to the journal and
 * render afterwards, so a newer render proves nothing by itself: the render only wins when its content
 * differs from the fold *and* it is newer than the journal, which together mean an external edit.
 *
 * Pure, so every ordering a fixture cannot produce without a concurrent writer — a read that spanned a
 * replacement, a blank render, a tie between the two mtimes — is reachable from a test. Both readers
 * and the adopt path decide with this one rule; a second copy is how two vintages drift apart.
 * @param render - one consistent read (see `readRenderWithMtime`).
 * @param renderKey - **this render's own** normalization, e.g. `memoryComparisonKeyWithDrop(render.text, limit)`;
 * the key travels with the bytes it was taken from, so no caller can pair one version's key with another's time.
 * @param foldedKey - the journal fold's comparison key, in the same normalization.
 * @param journalMtimeMs - the journal's mtime, `undefined` when it cannot be read.
 */
export declare function externalRenderWins(render: RenderRead, renderKey: NormalizedMemory, foldedKey: string, journalMtimeMs: number | undefined): boolean;
/**
 * Whether a read spanned a replacement: the file's identity moved under it. The test is mtime +
 * size, so a replacement that keeps both (a same-size edit inside the filesystem's timestamp
 * granularity) stays invisible, which is the accepted residual. A file that appeared under the read
 * (no `before`) counts as changed, and a file that vanished is `undefined` and cannot be vouched for.
 */
export declare function renderChangedUnderRead(before: Stats | undefined, after: Stats | undefined): boolean;
/**
 * Read the render with the mtimes taken around the read, so its bytes and its time describe one
 * version of the file. A replacement landing inside the read would otherwise pair one version's
 * bytes with another version's time, and the caller would act on a version it cannot vouch for.
 * Exported for the race no ordinary fixture produces: a replacement landing inside the read.
 * @param file - the render's path.
 * @returns the bytes read, that read's mtime, and whether the file changed under it.
 */
export declare function readRenderWithMtime(file: string): Promise<RenderRead>;
/** The synchronous counterpart, for the prompt-assembly reader. Same contract as `readRenderWithMtime`. */
export declare function readRenderWithMtimeSync(file: string): RenderRead;
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
