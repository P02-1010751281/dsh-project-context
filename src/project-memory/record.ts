/**
 * One write: adopt an external edit of `MEMORY.md` into the journal history, append this pass's
 * render, rotate if needed, then rebuild the render. The append always lands before the render.
 * The one-time legacy `.omp` import lives here too — it is a write, and putting it in the read
 * path would make the two modules import each other.
 */

import { stat } from "node:fs/promises";
import path from "node:path";
import { MAX_MEMORY_CHARS, ensureMemoryGitignore, legacyOmpDir, logError, memoryDir, memoryFile, pathExists, readOptional, writeAtomic } from "../shared/project-state.js";
import { normalizeMemoryDocument } from "./document.js";
import { appendMemoryOp, foldMemoryJournal, memoryJournalFile, readMemoryJournal, rotateMemoryJournalIfNeeded } from "./journal.js";
import { loadMemory, readMemorySource } from "./load.js";
import { decodePoisonedMemory, memoryComparisonKey } from "./poison.js";
import { withMemoryLock } from "../shared/lock.js";

/**
 * Record one consolidated document: keep a pre-journal project's current memory as the journal's
 * base, append the new replacement, collapse the journal when it grew too large and render
 * `MEMORY.md`. Callers hold the memory lock and have already backed up the current render.
 * @param projectRoot - the project root.
 * @param text - the new memory document.
 * @param limit - the character cap; the project's `maxMemoryChars`.
 */
export async function recordMemoryDocument(projectRoot: string, text: string, limit: number = MAX_MEMORY_CHARS): Promise<void> {
	const file = memoryJournalFile(projectRoot);
	const base = await readMemoryJournal(file);
	if (base.unreadable) throw new Error(`memory journal exists but cannot be read: ${file}`);
	if (base.entries.length === 0) {
		// First journal write for this project: start history from the memory it has today. The
		// legacy read path also decodes a stored reply, so the journal never stores raw JSON.
		const existing = await loadMemory(projectRoot, limit);
		if (existing.unreadable) throw new Error(`memory exists but cannot be read: ${existing.source}`);
		if (existing.text.trim()) await appendMemoryOp(file, "replace", normalizeMemoryDocument(existing.text, limit));
	} else {
		// Adopt an external edit (hand edit or an older build) before appending this pass: its bytes
		// enter the journal's history instead of being silently overwritten. A render that merely
		// equals the fold is our own output, and one that is older and differs is a torn write
		// window (journal already ahead), so neither is adopted.
		const foldedView = foldMemoryJournal(base.entries, limit);
		const renderRaw = await readOptional(memoryFile(projectRoot));
		if (renderRaw.trim()) {
			const external = memoryComparisonKey(renderRaw, limit);
			const renderInfo = await stat(memoryFile(projectRoot)).catch(() => undefined);
			const journalInfo = await stat(file).catch(() => undefined);
			if (external && external !== foldedView && renderInfo && journalInfo && renderInfo.mtimeMs > journalInfo.mtimeMs) {
				await appendMemoryOp(file, "replace", external);
				// Keep a trace of which pass folded in an edit that was made outside the plugin.
				await logError(projectRoot, "memory", "adopted an externally edited MEMORY.md into the memory journal");
			}
		}
	}
	await appendMemoryOp(file, "replace", normalizeMemoryDocument(text, limit));
	await rotateMemoryJournalIfNeeded(projectRoot, limit);
	await ensureMemoryGitignore(memoryDir(projectRoot));
	await writeAtomic(memoryFile(projectRoot), normalizeMemoryDocument(text, limit));
}

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
export async function importLegacyMemory(projectRoot: string, limit: number = MAX_MEMORY_CHARS): Promise<boolean> {
	if (await pathExists(memoryFile(projectRoot))) return false;
	for (const name of ["MEMORY.md", "memory_summary.md", "learned.md"]) {
		const source = path.join(legacyOmpDir(projectRoot), name);
		const loaded = await readMemorySource(source);
		if (loaded.unreadable) {
			// Skipping silently would hide a legacy memory that exists but cannot be imported.
			await logError(projectRoot, "migration", `legacy OMP memory at ${source} exists but cannot be read`);
			continue;
		}
		const raw = loaded.text.trim();
		if (!raw) continue;
		return await withMemoryLock(memoryFile(projectRoot), async () => {
			// Re-check under the lock: another writer may have created memory or a journal meanwhile,
			// and the legacy file must never win over either.
			if (await pathExists(memoryFile(projectRoot))) return false;
			const journal = await readMemoryJournal(memoryJournalFile(projectRoot));
			// A journal that exists in any form owns the memory: records, a torn tail, or bytes that
			// no longer parse. Importing beside it would either throw or be adopted as an edit.
			if (journal.entries.length > 0 || journal.damaged > 0 || journal.unreadable) return false;
			const decoded = decodePoisonedMemory(raw, limit);
			await recordMemoryDocument(projectRoot, decoded ? decoded.trim() : raw, limit);
			return true;
		});
	}
	return false;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------
