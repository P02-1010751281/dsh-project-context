/**
 * Decoding a "stored reply": a memory document that is really the JSON object a model returned
 * (a whole API response pasted into `MEMORY.md` by an older build or a hand edit). Recovers the
 * largest useful string field instead of injecting tens of thousands of JSON characters.
 *
 * `memoryComparisonKey` lives here because it is this decoder plus the document normalizer, and
 * both the read path and the write path need it — putting it in either one would make them import
 * each other.
 */

import { MAX_MEMORY_CHARS } from "../shared/project-state.js";
import { normalizeMemoryDocument } from "./document.js";

type JsonStringField = { value: string; complete: boolean; end: number };

/** Read a quoted string starting at `at` (skipping whitespace); tolerates an unterminated value. */
function readJsonStringAt(text: string, at: number): JsonStringField | undefined {
	let index = at;
	while (index < text.length && /\s/.test(text[index]!)) index += 1;
	if (text[index] !== '"') return undefined;
	index += 1;
	let out = "";
	while (index < text.length) {
		const char = text[index]!;
		if (char === "\\") {
			const escaped = text[index + 1];
			if (escaped === undefined) return { value: out, complete: false, end: text.length };
			if (escaped === "u") {
				const hex = text.slice(index + 2, index + 6);
				if (!/^[0-9a-f]{4}$/i.test(hex)) return { value: out, complete: false, end: text.length };
				out += String.fromCharCode(Number.parseInt(hex, 16));
				index += 6;
				continue;
			}
			out += escaped === "n" ? "\n" : escaped === "t" ? "\t" : escaped === "r" ? "\r" : escaped === "b" ? "\b" : escaped === "f" ? "\f" : escaped;
			index += 2;
			continue;
		}
		if (char === '"') return { value: out, complete: true, end: index };
		out += char;
		index += 1;
	}
	return { value: out, complete: false, end: text.length };
}

type TopLevelField = { key: string; valueAt: number };

/** Top-level `"key": value` fields of an object text, in order, with the value's start index. */
function topLevelFields(object: string): TopLevelField[] {
	const fields: TopLevelField[] = [];
	let depth = 0;
	let index = 0;
	while (index < object.length) {
		const char = object[index]!;
		if (char === '"') {
			const field = readJsonStringAt(object, index);
			if (!field) break;
			let look = field.end + 1;
			while (look < object.length && /\s/.test(object[look]!)) look += 1;
			if (depth === 1 && object[look] === ":") fields.push({ key: field.value, valueAt: look + 1 });
			index = field.end + 1;
			continue;
		}
		if (char === "{") depth += 1;
		else if (char === "}") depth -= 1;
		index += 1;
	}
	return fields;
}

/** How long a single non-JSON wrapper line may be before it stops looking like a stored reply. */
const POISON_PREFIX_LIMIT = 40;

/** Minimum decoded length before a header-less value counts as a memory document. */
const MIN_DECODED_MEMORY_CHARS = 120;

/** Wrapper text a stored reply may carry before its object: nothing, `json`/`[`, a fence, or one short introducer line. */
function isPoisonPrefix(prefix: string): boolean {
	const trimmed = prefix.trim();
	if (!trimmed) return true;
	if (/^(?:json|JSON|\[|```(?:json|JSON|markdown)?)$/.test(trimmed)) return true;
	// Exactly one short plain line ending in a colon, e.g. "Consolidation reply:". Markdown
	// structure (list, heading, code, quote, emphasis) or a multi-line preamble is never a reply
	// wrapper; the caller additionally requires the object to be the whole remainder, to lead
	// with a reply field, and the decoded value to be a full memory document.
	if (trimmed.includes("\n") || trimmed.length > POISON_PREFIX_LIMIT) return false;
	if (!/[:：]$/.test(trimmed)) return false;
	return !/[*_#`>|\-[\]]/.test(trimmed.replace(/[:：]\s*$/, ""));
}

/** Index just after the object opened at `start`, or -1 when the braces never close. */
function jsonObjectEnd(text: string, start: number): number {
	let depth = 0;
	let inString = false;
	for (let index = start; index < text.length; index += 1) {
		const char = text[index]!;
		if (inString) {
			if (char === "\\") index += 1;
			else if (char === '"') inString = false;
			continue;
		}
		if (char === '"') inString = true;
		else if (char === "{") depth += 1;
		else if (char === "}") {
			depth -= 1;
			if (depth === 0) return index + 1;
		}
	}
	return -1;
}

/**
 * Older builds stored an unparseable reply verbatim, which left raw JSON in MEMORY.md. Decode it
 * back into markdown for readers (injection, consolidation, autolearn); the stored file is only
 * replaced by the normal consolidation write path, so a mis-detection can never destroy it.
 * @param current - the document as stored.
 * @param limit - the character cap; the project's `maxMemoryChars`.
 * @returns the decoded document, or `undefined` when the bytes are not a stored reply.
 */
export function decodePoisonedMemory(current: string, limit: number = MAX_MEMORY_CHARS): string | undefined {
	const body = current.replace(/^#\s*Project Memory\s*/i, "").trim();
	const objectAt = body.indexOf("{");
	if (objectAt < 0) return undefined;
	// Both sides of the object are part of the shape: a stored reply has nothing but wrapper text
	// before it, and nothing but a closing fence after it.
	const prefix = body.slice(0, objectAt);
	if (!isPoisonPrefix(prefix)) return undefined;
	const prosePrefix = Boolean(prefix.trim());
	const objectEnd = jsonObjectEnd(body, objectAt);
	if (objectEnd >= 0) {
		const after = body.slice(objectEnd).trim();
		if (after && after !== "```" && after !== "]") return undefined;
	}
	const scope = objectEnd >= 0 ? body.slice(objectAt, objectEnd) : body.slice(objectAt);
	// A stored reply leads with one of its two fields, in either order; a nested or later
	// occurrence is a documented example, not the reply itself.
	const fields = topLevelFields(scope);
	if (fields[0]?.key !== "memory_markdown" && fields[0]?.key !== "context") return undefined;
	const memoryField = fields.find((field) => field.key === "memory_markdown");
	if (!memoryField) return undefined;
	const field = readJsonStringAt(scope, memoryField.valueAt);
	if (!field || !field.value.trim()) return undefined;
	// The value must be the memory document itself, not a documented reply sample.
	const decoded = field.value.trim().replace(/^```(?:markdown)?\s*/i, "").trim();
	const hasHeader = /^#\s*Project Memory/i.test(decoded);
	// A header-less value is accepted only for the canonical wrappers and only when it clearly is
	// a document; an introducer line carries more false-positive risk, so it needs the header.
	if (!hasHeader && (prosePrefix || decoded.length < MIN_DECODED_MEMORY_CHARS || !decoded.includes("\n"))) return undefined;
	return normalizeMemoryDocument(field.value, limit);
}

// ---------------------------------------------------------------------------
// Rendered document + backups
// ---------------------------------------------------------------------------

/** Comparison key for "does this render still equal what the journal folds to?" — both normalized. */
export function memoryComparisonKey(render: string, limit: number = MAX_MEMORY_CHARS): string {
	return normalizeMemoryDocument(decodePoisonedMemory(render.trim(), limit) ?? render, limit);
}
