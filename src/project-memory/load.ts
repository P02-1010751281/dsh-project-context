/**
 * The read path, which has no side effects. The journal wins once it exists; `MEMORY.md` and the
 * legacy `.omp`/`.pi` layouts stay readable for projects that never wrote one. Damage (a torn
 * journal tail, an unreadable source) is reported, never silently treated as "no memory".
 */

import { readFile, stat } from "node:fs/promises";
import { readFileSync, statSync, type Stats } from "node:fs";
import path from "node:path";
import { MAX_MEMORY_CHARS, legacyOmpDir, legacyPiDir, memoryFile, readOptional } from "../shared/project-state.js";
import { clipToLineBoundary, type NormalizedMemory } from "./document.js";
import { foldMemoryJournal, foldMemoryJournalWithDrop, memoryJournalFile, newestMemoryArchive, newestMemoryArchiveSync, parseJournalEntries, readMemoryJournal } from "./journal.js";
import { decodePoisonedMemory, decodePoisonedMemoryWithDrop, memoryComparisonKeyWithDrop } from "./poison.js";

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

/** A clipped document plus the characters the clip kept back; the clip is the cap site on this path. */
function clipWithDrop(text: string, limit: number): { text: string; dropped: number } {
	const clipped = clipToLineBoundary(text, limit);
	return { text: clipped, dropped: text.length - clipped.length };
}

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
	const decoded = decodePoisonedMemoryWithDrop(text, limit);
	if (decoded) {
		// The decoder capped its own field, so its cut is the one that hid content; the clip below runs
		// on the already-normalized text and can only trim whitespace at the cut, never content.
		const clipped = clipWithDrop(decoded.text.trim(), limit);
		return { text: clipped.text, source, poisoned: true, cappedDroppedChars: decoded.dropped + clipped.dropped };
	}
	const clipped = clipWithDrop(text, limit);
	return { text: clipped.text, source, poisoned: false, cappedDroppedChars: clipped.dropped };
}

/** One consistent read of the render: its bytes, the mtime that read saw, and whether it raced. */
export type RenderRead = { text: string; mtimeMs?: number; changed: boolean };

/** Whether the render's time is strictly ahead of the journal's: bytes the journal has not absorbed yet. */
export function renderIsNewerThanJournal(renderMtimeMs: number | undefined, journalMtimeMs: number | undefined): boolean {
	return renderMtimeMs !== undefined && journalMtimeMs !== undefined && renderMtimeMs > journalMtimeMs;
}

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
export function externalRenderWins(render: RenderRead, renderKey: NormalizedMemory, foldedKey: string, journalMtimeMs: number | undefined): boolean {
	// A read that spanned a replacement must not pick a version it cannot vouch for; the fold stands
	// and the next write re-reads and adopts then.
	if (render.changed) return false;
	// A blank render means the file was cleared by hand; the journal stays authoritative. The test is on
	// the text, not on the key: the canonical document of an empty render is the bare header, not "".
	if (!render.text.trim()) return false;
	// Nothing to compare against the fold: an empty key is not a document.
	if (!renderKey.text) return false;
	if (renderKey.text === foldedKey) return false;
	return renderIsNewerThanJournal(render.mtimeMs, journalMtimeMs);
}

/**
 * Whether a read spanned a replacement: the file's identity moved under it. `mtime` + `size` are what
 * a replacement normally moves; `ctime` catches the one that does not — a writer that preserves mtime
 * (`cp -p`, `rsync -t`) and lands the same byte count leaves both untouched, and userspace cannot set
 * ctime, so that copy is still seen. What remains is a replacement inside the filesystem's ctime
 * granularity, which no stat can see. A file that appeared under the read (no `before`) counts as
 * changed, and a file that vanished is `undefined` and cannot be vouched for.
 */
export function renderChangedUnderRead(before: Stats | undefined, after: Stats | undefined): boolean {
	return after !== undefined && (before?.mtimeMs !== after.mtimeMs || before?.size !== after.size || before?.ctimeMs !== after.ctimeMs);
}

/**
 * Read the render with the mtimes taken around the read, so its bytes and its time describe one
 * version of the file. A replacement landing inside the read would otherwise pair one version's
 * bytes with another version's time, and the caller would act on a version it cannot vouch for.
 * Exported for the race no ordinary fixture produces: a replacement landing inside the read.
 * @param file - the render's path.
 * @returns the bytes read, that read's mtime, and whether the file changed under it.
 */
export async function readRenderWithMtime(file: string): Promise<RenderRead> {
	const before = await stat(file).catch(() => undefined);
	const text = await readOptional(file);
	const after = await stat(file).catch(() => undefined);
	return { text, mtimeMs: after?.mtimeMs, changed: renderChangedUnderRead(before, after) };
}

/** The synchronous counterpart, for the prompt-assembly reader. Same contract as `readRenderWithMtime`. */
export function readRenderWithMtimeSync(file: string): RenderRead {
	const before = statSafe(file);
	const text = readMemorySync(file).text;
	const after = statSafe(file);
	return { text, mtimeMs: after?.mtimeMs, changed: renderChangedUnderRead(before, after) };
}

/** File stats, or `undefined` when the path does not exist. */
function statSafe(file: string): Stats | undefined {
	try {
		return statSync(file);
	} catch {
		return undefined;
	}
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
	if (journalState.unreadable) return { text: "", source: journal, poisoned: false, unreadable: true, cappedDroppedChars: 0 };
	// Content that yields no usable record means the journal cannot be reconstructed; report it
	// instead of silently showing a render that the journal has already superseded.
	if (journalState.entries.length === 0 && journalState.damaged > 0) return { text: "", source: journal, poisoned: false, unreadable: true, cappedDroppedChars: 0 };
	if (journalState.entries.length > 0) {
		const folded = foldMemoryJournalWithDrop(journalState.entries, limit);
		if (!folded.text) return { text: "", source: journal, poisoned: false, unreadable: true, cappedDroppedChars: 0 };
		// One consistent read: the render's bytes and its time describe one version, so a replacement
		// landing under the read cannot hand this path the older bytes wearing the newer file's mtime.
		const render = await readRenderWithMtime(target);
		// Both sides are compared in normalized form: the fold returns a normalized document, so a raw
		// trimmed render would never compare equal and the mtime would silently become the only rule
		// (adopting our own output as if it were an edit).
		const external = memoryComparisonKeyWithDrop(render.text, limit);
		const journalInfo = await stat(journal).catch(() => undefined);
		if (externalRenderWins(render, external, folded.text, journalInfo?.mtimeMs)) {
			return { text: external.text, source: target, poisoned: Boolean(decodePoisonedMemory(render.text.trim(), limit)), damaged: journalState.damaged, cappedDroppedChars: external.dropped };
		}
		return { text: folded.text, source: journal, poisoned: false, damaged: journalState.damaged, cappedDroppedChars: folded.dropped };
	}
	let raw = "";
	try {
		raw = await readFile(target, "utf8");
	} catch (error) {
		if ((error as { code?: string }).code !== "ENOENT") {
			// The file exists but cannot be read: report it instead of claiming there is no memory.
			return { text: "", source: target, poisoned: false, unreadable: true, cappedDroppedChars: 0 };
		}
	}
	// No journal at all. A rotation archive is still evidence of what the document was — the previous
	// bytes are copied there — so prefer it over a render the journal had already superseded. This is
	// the recovery path for a journal deleted by hand, and the second net under the rotation window.
	const archive = await newestMemoryArchive(projectRoot);
	if (archive) {
		const archived = await readMemoryJournal(archive);
		const recovered = foldMemoryJournalWithDrop(archived.entries, limit);
		if (recovered.text) return { text: recovered.text, source: archive, poisoned: false, damaged: archived.damaged, cappedDroppedChars: recovered.dropped };
	}
	const current = raw.trim();
	if (current) {
		const decoded = decodePoisonedMemoryWithDrop(current, limit);
		if (decoded) {
			const clipped = clipWithDrop(decoded.text.trim(), limit);
			return { text: clipped.text, source: target, poisoned: true, cappedDroppedChars: decoded.dropped + clipped.dropped };
		}
		const clipped = clipWithDrop(current, limit);
		return { text: clipped.text, source: target, poisoned: false, cappedDroppedChars: clipped.dropped };
	}

	const legacyPi = path.join(legacyPiDir(projectRoot), "MEMORY.md");
	const fromPi = await readMemorySource(legacyPi);
	if (fromPi.unreadable) return { text: "", source: legacyPi, poisoned: false, unreadable: true, cappedDroppedChars: 0 };
	const piText = fromPi.text.trim();
	if (piText) return legacyMemory(piText, legacyPi, limit);

	for (const name of ["MEMORY.md", "memory_summary.md", "learned.md"]) {
		const fallback = path.join(legacyOmpDir(projectRoot), name);
		const source = await readMemorySource(fallback);
		if (source.unreadable) return { text: "", source: fallback, poisoned: false, unreadable: true, cappedDroppedChars: 0 };
		const text = source.text.trim();
		if (text) return legacyMemory(text, fallback, limit);
	}

	return { text: "", source: target, poisoned: false, cappedDroppedChars: 0 };
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
			// The decision is shared with the async reader, so the two cannot drift apart again: the key
			// is the render's own normalization (its `.text` is what `memoryComparisonKey` returns).
			const render = readRenderWithMtimeSync(target);
			const external = memoryComparisonKeyWithDrop(render.text.trim(), limit);
			if (externalRenderWins(render, external, folded, mtimeMs(journal))) return external.text;
			return folded;
		}
		// The journal exists but holds no usable record: fail closed exactly like `loadMemory`
		// instead of injecting a render the journal has already superseded.
		if (damaged > 0) return "";
	} catch (error) {
		// An existing but unreadable journal is not "no journal": fail closed like the async reader.
		if ((error as { code?: string }).code !== "ENOENT") return "";
	}
	// Same recovery as the async reader, and it matters more here: with no journal, a rotation archive
	// is the surviving copy of the pass's document, while the render may predate the pass entirely.
	const archive = newestMemoryArchiveSync(projectRoot);
	if (archive) {
		const archived = readMemorySync(archive);
		if (archived.unreadable) return "";
		const recovered = foldMemoryJournal(parseJournalEntries(archived.text).entries, limit);
		if (recovered) return recovered;
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
