/**
 * The memory document's shape: line-boundary clipping, normalization, and the truncation marker
 * `_ [memory truncated at <limit> characters: <dropped> dropped] _` that makes a capped document
 * self-describing instead of silently short.
 */

import { MAX_MEMORY_CHARS } from "../shared/project-state.js";

/** Leading text of the marker line a capped memory carries; the full shape is matched below. */
const MEMORY_TRUNCATION_PREFIX = "_[memory truncated";

/** The marker line in full: `_[memory truncated at <limit> characters: <dropped> dropped]_`. */
const MEMORY_TRUNCATION_LINE = /^_\[memory truncated at \d+ characters: \d+ dropped\]_$/;

/** The line a capped document ends with: a cut memory must never look like a complete one. */
export function memoryTruncationMarker(dropped: number, limit: number): string {
	return `${MEMORY_TRUNCATION_PREFIX} at ${limit} characters: ${dropped} dropped]_`;
}

/** True when a memory document reports that the cap dropped part of it. */
export function isMemoryTruncated(text: string): boolean {
	return text.split("\n").some((line) => MEMORY_TRUNCATION_LINE.test(line.trim()));
}

/** Largest whole-line prefix of `text` within `limit`; only a single over-long line is cut inside. */
export function clipToLineBoundary(text: string, limit: number): string {
	if (text.length <= limit) return text;
	const head = text.slice(0, Math.max(0, limit));
	const cut = head.lastIndexOf("\n");
	return cut > 0 ? head.slice(0, cut) : head;
}

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
export function normalizeMemoryDocument(value: string, limit: number = MAX_MEMORY_CHARS): string {
	const cleaned = value
		.replace(/^```(?:markdown)?\s*/i, "")
		.replace(/\s*```$/, "")
		.trim()
		.replace(/^#\s*Project Memory\s*/i, "")
		.trim();
	const lines = cleaned.split("\n");
	// Only the exact marker shape is stripped; a regular memory line that merely starts with the
	// same words must not be moved to the end (and reported as a cap that never happened).
	const previous = lines.find((line) => MEMORY_TRUNCATION_LINE.test(line.trim()))?.trim();
	const body = lines.filter((line) => !MEMORY_TRUNCATION_LINE.test(line.trim())).join("\n").trim();
	const document = `# Project Memory\n\n${body}`;
	if (document.length <= limit) return `${document}${previous ? `\n\n${previous}` : ""}`.trimEnd() + "\n";
	// Reserve the marker's room, then re-cut with the count that cut produced: one correction is
	// enough, because a larger dropped count can only make the marker longer and the budget is
	// recomputed from the marker actually emitted.
	let kept = clipToLineBoundary(document, Math.max(0, limit - markerRoom(document.length, limit))).trimEnd();
	kept = clipToLineBoundary(document, Math.max(0, limit - memoMarkerLength(document.length, kept.length, limit))).trimEnd();
	return `${kept}\n\n${memoryTruncationMarker(document.length - kept.length, limit)}\n`;
}

/** Worst-case marker length for a still-unknown count: every digit of the document's own length. */
function markerRoom(documentLength: number, limit: number): number {
	return memoryTruncationMarker(documentLength, limit).length + 2;
}

/** Exact marker length once the kept prefix is known. */
function memoMarkerLength(documentLength: number, keptLength: number, limit: number): number {
	return memoryTruncationMarker(documentLength - keptLength, limit).length + 2;
}
