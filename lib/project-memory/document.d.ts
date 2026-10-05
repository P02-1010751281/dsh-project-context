/**
 * The memory document's shape: line-boundary clipping, normalization, and the truncation marker
 * `_ [memory truncated at <limit> characters: <dropped> dropped] _` that makes a capped document
 * self-describing instead of silently short.
 */
/**
 * True when a single line is the cap marker, not merely prefixed like it.
 *
 * Exported because the section parser has to strip a trailing marker before it can read a stored
 * memory: a memory that was ever over the cap ends with this line, and treating it as section content
 * would reject the whole document.
 */
export declare function isMemoryTruncationLine(line: string): boolean;
/** The canonical heading every stored memory document carries; the schema budget reserves it. */
export declare const MEMORY_HEADER = "# Project Memory\n\n";
/** The line a capped document ends with: a cut memory must never look like a complete one. */
export declare function memoryTruncationMarker(dropped: number, limit: number): string;
/** True when a memory document reports that the cap dropped part of it. */
export declare function isMemoryTruncated(text: string): boolean;
/** Largest whole-line prefix of `text` within `limit`; only a single over-long line is cut inside. */
export declare function clipToLineBoundary(text: string, limit: number): string;
/**
 * Rebuild the `# Project Memory` document from a model or recovered value.
 *
 * Over the cap the document is cut on a line boundary and gets an explicit marker: a plain
 * `.slice()` cut the last line in half, so a fact lost its tail with nothing to show for it, and
 * — because new memory is always appended at the end — every later pass re-emitted a document
 * whose tail past the cap was discarded on write, so new learning was silently lost.
 * The marker's own length is reserved before cutting, so the result honours `limit`; its
 * dropped-count digits are fit by re-cutting with the count the cut actually produced, which
 * settles after one extra pass because the count only grows. A marker an earlier cap left behind
 * is stripped and recomputed, so normalizing twice is idempotent.
 * @param value - the document as a model or a legacy source produced it.
 * @param limit - the character cap; the project's `maxMemoryChars`.
 * @returns one canonical `# Project Memory` document, at most `limit` characters.
 */
export declare function normalizeMemoryDocument(value: string, limit?: number): string;
/** A normalized document plus what this normalization itself cut. */
export type NormalizedMemory = {
    text: string;
    /**
     * Characters this call's cut dropped, 0 when the document fit. Never read from the marker line:
     * a marker the input already carried records an **earlier** cap (it is deliberately carried
     * forward, so a stored document keeps saying it was once capped), and reporting it as this call's
     * loss is how a fitting reply gets refused for a cut that never happened.
     */
    dropped: number;
};
/**
 * `normalizeMemoryDocument`, with the count of what the cap actually dropped.
 *
 * The tier-C refusal and the received-loss receipt both need that number, and both used to get it by
 * parsing the output's marker line — which is a record of the *first* cap a document suffered, not of
 * this one. Two callers need the number, so it is returned here rather than re-derived.
 * @param value - the document as a model or a legacy source produced it.
 * @param limit - the character cap; the project's `maxMemoryChars`.
 */
export declare function normalizeMemoryWithDrop(value: string, limit?: number): NormalizedMemory;
