/**
 * Decoding a "stored reply": a memory document that is really the JSON object a model returned
 * (a whole API response pasted into `MEMORY.md` by an older build or a hand edit). Recovers the
 * largest useful string field instead of injecting tens of thousands of JSON characters.
 *
 * `memoryComparisonKey` lives here because it is this decoder plus the document normalizer, and
 * both the read path and the write path need it — putting it in either one would make them import
 * each other.
 */
import { type NormalizedMemory } from "./document.js";
/**
 * Older builds stored an unparseable reply verbatim, which left raw JSON in MEMORY.md. Decode it
 * back into markdown for readers (injection, consolidation, autolearn); the stored file is only
 * replaced by the normal consolidation write path, so a mis-detection can never destroy it.
 * @param current - the document as stored.
 * @param limit - the character cap; the project's `maxMemoryChars`.
 * @returns the decoded document, or `undefined` when the bytes are not a stored reply.
 */
export declare function decodePoisonedMemory(current: string, limit?: number): string | undefined;
/**
 * `decodePoisonedMemory`, plus what this decode's own cap cut.
 *
 * For a stored reply the cap is applied here and not at the caller: the decoded field is normalized
 * (and capped) before it is returned, so a caller that only saw the string could not tell a fitting
 * reply from a cut one. The read path needs that number to report the characters the model was not
 * shown, so it comes back from the normalizer that did the cutting.
 * @param current - the bytes read from a memory source.
 * @param limit - the character cap; the project's `maxMemoryChars`.
 * @returns the document plus this call's own cut, or `undefined` when the bytes are not a stored reply.
 */
export declare function decodePoisonedMemoryWithDrop(current: string, limit?: number): NormalizedMemory | undefined;
/** Comparison key for "does this render still equal what the journal folds to?" — both normalized. */
export declare function memoryComparisonKey(render: string, limit?: number): string;
/**
 * `memoryComparisonKey`, plus what this key's own normalizations cut.
 *
 * The read path's external-render branch returns this key as the memory it will show the model, so
 * the cap that applies to it is the one to report. Both normalizations the key already performs are
 * kept: `normalizeMemoryDocument` is **not** idempotent on a capped document — a cut that leaves only
 * the header re-renders two characters longer the second time — so skipping the second one would
 * change the key's bytes, and that key is the write path's baseline.
 * @param render - the rendered document as it sits on disk.
 * @param limit - the character cap; the project's `maxMemoryChars`.
 * @returns the normalized key plus the characters the cap dropped (0 when it fit).
 */
export declare function memoryComparisonKeyWithDrop(render: string, limit?: number): NormalizedMemory;
