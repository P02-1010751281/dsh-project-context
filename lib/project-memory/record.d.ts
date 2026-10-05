/**
 * One write: adopt an external edit of `MEMORY.md` into the journal history, append this pass's
 * render, rotate if needed, then rebuild the render. The append always lands before the render.
 * The one-time legacy `.omp` import lives here too — it is a write, and putting it in the read
 * path would make the two modules import each other.
 */
/**
 * True when what is on disk now is a different, non-empty document than the one this pass read, so
 * publishing the reply would overwrite a newer edit. Exported because the pre-publish check is
 * otherwise only reachable through a race.
 */
export declare function nextRenderSupersedes(renderKey: string, nowKey: string, publishKey: string): boolean;
/** What one write of the memory document did: published the reply, or kept newer stored bytes. */
export type MemoryWriteResult = {
    written: true;
} | {
    written: false;
    kept: string;
};
/**
 * Record one consolidated document: keep a pre-journal project's current memory as the journal's
 * base, append the new replacement, collapse the journal when it grew too large and render
 * `MEMORY.md`. Callers hold the memory lock and have already backed up the current render.
 *
 * `options.basisKey` is the memory this pass's reply was built from. When the stored document no
 * longer matches it, the reply is not published: whatever landed meanwhile is the newer
 * information, and the next pass consolidates from it. Omitting the option keeps the previous
 * behaviour byte for byte — which is what the legacy import and the existing suites rely on.
 * @param projectRoot - the project root.
 * @param text - the new memory document.
 * @param limit - the character cap; the project's `maxMemoryChars`.
 * @param options - `basisKey` opts into the stale-reply refusal.
 * @returns whether the reply was published, and the bytes that stayed effective when it was not.
 */
export declare function recordMemoryDocument(projectRoot: string, text: string, limit?: number, options?: {
    basisKey?: string;
}): Promise<MemoryWriteResult>;
/**
 * Import a legacy `.omp` memory document into the journal, once, on first use.
 *
 * pi does this inside its migration; here it lives with the memory store because it must hold the
 * same lock and re-check the same facts: without them a stale legacy file would land next to an
 * existing journal, be read as an "external edit" (the render is missing or older) and then be
 * adopted over the consolidated memory. Poison is decoded before it is stored, like the read path.
 * @param projectRoot - the project root.
 * @param limit - the character cap; the project's `maxMemoryChars`.
 * @returns true when a legacy document was imported.
 */
export declare function importLegacyMemory(projectRoot: string, limit?: number): Promise<boolean>;
