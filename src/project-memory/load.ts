/**
 * The read path, which has no side effects. The journal wins once it exists; `MEMORY.md` and the
 * legacy `.omp`/`.pi` layouts stay readable for projects that never wrote one. Damage (a torn
 * journal tail, an unreadable source) is reported, never silently treated as "no memory".
 */

import { readFile, stat } from "node:fs/promises";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { MAX_MEMORY_CHARS, legacyOmpDir, legacyPiDir, memoryFile, readOptional } from "../shared/project-state.js";
import { clipToLineBoundary } from "./document.js";
import { foldMemoryJournal, memoryJournalFile, parseJournalEntries, readMemoryJournal } from "./journal.js";
import { decodePoisonedMemory, memoryComparisonKey } from "./poison.js";

/** What one memory read produced, and how trustworthy it is. */
export type LoadedMemory = {
	text: string;
	source: string;
	poisoned: boolean;
	/** The source exists but could not be read: callers must not treat this as "no memory". */
	unreadable?: boolean;
	/** Unusable journal lines that were skipped (a torn tail from a crash, or a hand edit). */
	damaged?: number;
};

/** Read one memory source, distinguishing "absent" from "exists but unreadable". */
export async function readMemorySource(file: string): Promise<{ text: string; unreadable: boolean }> {
	try {
		return { text: await readFile(file, "utf8"), unreadable: false };
	} catch (error) {
		return { text: "", unreadable: (error as { code?: string }).code !== "ENOENT" };
	}
}

/** Decode a stored reply found outside the `.agents/` layout (legacy `.pi`, OMP import). */
function legacyMemory(text: string, source: string, limit: number): LoadedMemory {
	const decoded = decodePoisonedMemory(text, limit);
	if (decoded) return { text: clipToLineBoundary(decoded.trim(), limit), source, poisoned: true };
	return { text: clipToLineBoundary(text, limit), source, poisoned: false };
}

/**
 * Read this project's memory. The journal is the source of truth once it exists; `MEMORY.md` is
 * the old layout and stays readable for projects that never wrote a journal.
 * @param projectRoot - the project root.
 * @param limit - the character cap; the project's `maxMemoryChars`. Every normalization on this
 * side uses it, so the fold and the render are compared under the same cap.
 * @returns the document, where it came from, and any damage worth reporting.
 */
export async function loadMemory(projectRoot: string, limit: number = MAX_MEMORY_CHARS): Promise<LoadedMemory> {
	const target = memoryFile(projectRoot);
	const journal = memoryJournalFile(projectRoot);
	const journalState = await readMemoryJournal(journal);
	if (journalState.unreadable) return { text: "", source: journal, poisoned: false, unreadable: true };
	// Content that yields no usable record means the journal cannot be reconstructed; report it
	// instead of silently showing a render that the journal has already superseded.
	if (journalState.entries.length === 0 && journalState.damaged > 0) return { text: "", source: journal, poisoned: false, unreadable: true };
	if (journalState.entries.length > 0) {
		const folded = foldMemoryJournal(journalState.entries, limit);
		if (!folded) return { text: "", source: journal, poisoned: false, unreadable: true };
		// Our own writes append to the journal and render afterwards, so a newer render proves
		// nothing by itself. The render only wins when its content differs from the fold *and* it is
		// newer than the journal: that is an external edit, and `recordMemoryDocument` adopts those
		// bytes into the journal on the next write.
		const renderRaw = await readOptional(target);
		if (renderRaw.trim()) {
			// Both sides are compared in normalized form: `foldMemoryJournal` returns a normalized
			// document, so a raw trimmed render would never compare equal and the mtime would
			// silently become the only rule (adopting our own output as if it were an edit).
			const external = memoryComparisonKey(renderRaw, limit);
			const renderInfo = await stat(target).catch(() => undefined);
			const journalInfo = await stat(journal).catch(() => undefined);
			// An empty key means the render was cleared by hand; the journal stays authoritative.
			if (external && external !== folded && renderInfo && journalInfo && renderInfo.mtimeMs > journalInfo.mtimeMs) {
				return { text: external, source: target, poisoned: Boolean(decodePoisonedMemory(renderRaw.trim(), limit)), damaged: journalState.damaged };
			}
		}
		return { text: folded, source: journal, poisoned: false, damaged: journalState.damaged };
	}
	let raw = "";
	try {
		raw = await readFile(target, "utf8");
	} catch (error) {
		if ((error as { code?: string }).code !== "ENOENT") {
			// The file exists but cannot be read: report it instead of claiming there is no memory.
			return { text: "", source: target, poisoned: false, unreadable: true };
		}
	}
	const current = raw.trim();
	if (current) {
		const decoded = decodePoisonedMemory(current, limit);
		if (decoded) return { text: clipToLineBoundary(decoded.trim(), limit), source: target, poisoned: true };
		return { text: clipToLineBoundary(current, limit), source: target, poisoned: false };
	}

	const legacyPi = path.join(legacyPiDir(projectRoot), "MEMORY.md");
	const fromPi = await readMemorySource(legacyPi);
	if (fromPi.unreadable) return { text: "", source: legacyPi, poisoned: false, unreadable: true };
	const piText = fromPi.text.trim();
	if (piText) return legacyMemory(piText, legacyPi, limit);

	for (const name of ["MEMORY.md", "memory_summary.md", "learned.md"]) {
		const fallback = path.join(legacyOmpDir(projectRoot), name);
		const source = await readMemorySource(fallback);
		if (source.unreadable) return { text: "", source: fallback, poisoned: false, unreadable: true };
		const text = source.text.trim();
		if (text) return legacyMemory(text, fallback, limit);
	}

	return { text: "", source: target, poisoned: false };
}

/** Whether this path holds a record that no longer parses (used by callers that report damage). */
export async function readMemoryDamage(projectRoot: string): Promise<{ damaged: number; unreadable: boolean }> {
	const state = await readMemoryJournal(memoryJournalFile(projectRoot));
	return { damaged: state.damaged, unreadable: state.unreadable };
}

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
export function loadMemorySync(projectRoot: string, limit: number = MAX_MEMORY_CHARS): string {
	const journal = memoryJournalFile(projectRoot);
	const target = memoryFile(projectRoot);
	try {
		const raw = readFileSync(journal, "utf8");
		const { entries, damaged } = parseJournalEntries(raw);
		if (entries.length > 0) {
			// A damaged line never invalidates the records around it, and the render is an optional
			// input: a crash between the journal append and the render leaves it missing or stale,
			// and dropping the fold for that would lose memory the journal already holds. Mirrors
			// the async reader, which folds whenever there is at least one record.
			const folded = foldMemoryJournal(entries, limit);
			if (!folded) return "";
			// The render wins only when it differs from the fold *and* is newer: that is an
			// external edit, exactly as in the async reader.
			const renderRaw = readMemorySync(target).text.trim();
			if (renderRaw) {
				const external = memoryComparisonKey(renderRaw, limit);
				if (external && external !== folded && mtimeMs(target) > mtimeMs(journal)) return external;
			}
			return folded;
		}
		// The journal exists but holds no usable record: fail closed exactly like `loadMemory`
		// instead of injecting a render the journal has already superseded.
		if (damaged > 0) return "";
	} catch (error) {
		// An existing but unreadable journal is not "no journal": fail closed like the async reader.
		if ((error as { code?: string }).code !== "ENOENT") return "";
	}
	// An existing but unreadable source fails closed, exactly like the async reader: falling
	// through to a legacy file would silently serve a memory the project already superseded.
	const current = readMemorySync(target);
	if (current.unreadable) return "";
	if (current.text.trim()) return clipToLineBoundary((decodePoisonedMemory(current.text.trim(), limit) ?? current.text.trim()).trim(), limit);
	// The same legacy fallbacks the async reader has, so a project that never had a `.agents`
	// memory document still injects what `.pi` or `.omp` holds.
	const fromPi = readMemorySync(path.join(legacyPiDir(projectRoot), "MEMORY.md"));
	if (fromPi.unreadable) return "";
	if (fromPi.text.trim()) return clipToLineBoundary((decodePoisonedMemory(fromPi.text.trim(), limit) ?? fromPi.text.trim()).trim(), limit);
	for (const name of ["MEMORY.md", "memory_summary.md", "learned.md"]) {
		const legacy = readMemorySync(path.join(legacyOmpDir(projectRoot), name));
		if (legacy.unreadable) return "";
		if (legacy.text.trim()) return clipToLineBoundary((decodePoisonedMemory(legacy.text.trim(), limit) ?? legacy.text.trim()).trim(), limit);
	}
	return "";
}

/** Synchronous read that distinguishes "absent" from "exists but unreadable". */
function readMemorySync(file: string): { text: string; unreadable: boolean } {
	try {
		return { text: readFileSync(file, "utf8"), unreadable: false };
	} catch (error) {
		return { text: "", unreadable: (error as { code?: string }).code !== "ENOENT" };
	}
}

/** File mtime in milliseconds, 0 when it does not exist. */
export function mtimeMs(file: string): number {
	try {
		return statSync(file).mtimeMs;
	} catch {
		return 0;
	}
}
