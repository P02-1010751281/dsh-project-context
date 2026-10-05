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
 * True when what is on disk now is a different, non-empty document than the one this pass read, so
 * publishing the reply would overwrite a newer edit. Exported because the pre-publish check is
 * otherwise only reachable through a race.
 */
export function nextRenderSupersedes(renderKey, nowKey, publishKey) {
    return nowKey !== "" && nowKey !== renderKey && nowKey !== publishKey;
}
/** The comparison key of a render; an empty or missing document collapses to no key at all. */
function renderKeyOf(raw, limit) {
    return raw.trim() ? memoryComparisonKey(raw, limit) : "";
}
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
export async function recordMemoryDocument(projectRoot, text, limit = MAX_MEMORY_CHARS, options = {}) {
    const file = memoryJournalFile(projectRoot);
    const base = await readMemoryJournal(file);
    if (base.unreadable)
        throw new Error(`memory journal exists but cannot be read: ${file}`);
    // Read the render once, up front: the adoption below and the pre-publish check must compare the
    // same bytes, and an empty document is not a key at all.
    const renderRaw = await readOptional(memoryFile(projectRoot));
    const renderKey = renderKeyOf(renderRaw, limit);
    if (base.entries.length > 0) {
        // Adopt an external edit (hand edit or an older build) before appending this pass: its bytes
        // enter the journal's history instead of being silently overwritten. A render that merely
        // equals the fold is our own output, and one that is older and differs is a torn write
        // window (journal already ahead), so neither is adopted.
        const foldedView = foldMemoryJournal(base.entries, limit);
        if (renderKey) {
            const renderInfo = await stat(memoryFile(projectRoot)).catch(() => undefined);
            const journalInfo = await stat(file).catch(() => undefined);
            if (renderKey !== foldedView && renderInfo && journalInfo && renderInfo.mtimeMs > journalInfo.mtimeMs) {
                await appendMemoryOp(file, "replace", renderKey);
                // Keep a trace of which pass folded in an edit that was made outside the plugin.
                await logError(projectRoot, "memory", "adopted an externally edited MEMORY.md into the memory journal");
            }
        }
    }
    // The reply was built from this baseline: if the stored memory moved on while the model was
    // writing, publishing would overwrite that newer content, so keep it instead. Both sides are
    // compared as keys — a journal-backed read folds, a bare render does not, so the same bytes can
    // wear two shapes.
    const current = await loadMemory(projectRoot, limit);
    if (options.basisKey !== undefined && current.text.trim() && memoryComparisonKey(current.text, limit) !== memoryComparisonKey(options.basisKey, limit)) {
        await logError(projectRoot, "memory", "the memory changed while this pass's reply was being built; the reply was not published and the newer content stays effective");
        return { written: false, kept: current.text };
    }
    if (base.entries.length === 0) {
        // First journal write for this project: start history from the memory it has today. The
        // legacy read path also decodes a stored reply, so the journal never stores raw JSON.
        const existing = await loadMemory(projectRoot, limit);
        if (existing.unreadable)
            throw new Error(`memory exists but cannot be read: ${existing.source}`);
        if (existing.text.trim())
            await appendMemoryOp(file, "replace", normalizeMemoryDocument(existing.text, limit));
    }
    const rendered = normalizeMemoryDocument(text, limit);
    // The window between that check and this append: an edit landing here is newer than the reply
    // too, so keep it in the history and let the next pass consolidate from it.
    const nowKey = renderKeyOf(await readOptional(memoryFile(projectRoot)), limit);
    if (options.basisKey !== undefined && nextRenderSupersedes(renderKey, nowKey, memoryComparisonKey(rendered, limit))) {
        await appendMemoryOp(file, "replace", nowKey);
        await logError(projectRoot, "memory", "an external edit landed while this pass's memory write was being prepared; the reply was not published");
        return { written: false, kept: (await loadMemory(projectRoot, limit)).text };
    }
    await appendMemoryOp(file, "replace", rendered);
    await rotateMemoryJournalIfNeeded(projectRoot, limit);
    await ensureMemoryGitignore(memoryDir(projectRoot));
    await writeAtomic(memoryFile(projectRoot), rendered);
    return { written: true };
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
export async function importLegacyMemory(projectRoot, limit = MAX_MEMORY_CHARS) {
    if (await pathExists(memoryFile(projectRoot)))
        return false;
    for (const name of ["MEMORY.md", "memory_summary.md", "learned.md"]) {
        const source = path.join(legacyOmpDir(projectRoot), name);
        const loaded = await readMemorySource(source);
        if (loaded.unreadable) {
            // Skipping silently would hide a legacy memory that exists but cannot be imported.
            await logError(projectRoot, "migration", `legacy OMP memory at ${source} exists but cannot be read`);
            continue;
        }
        const raw = loaded.text.trim();
        if (!raw)
            continue;
        return await withMemoryLock(memoryFile(projectRoot), async () => {
            // Re-check under the lock: another writer may have created memory or a journal meanwhile,
            // and the legacy file must never win over either.
            if (await pathExists(memoryFile(projectRoot)))
                return false;
            const journal = await readMemoryJournal(memoryJournalFile(projectRoot));
            // A journal that exists in any form owns the memory: records, a torn tail, or bytes that
            // no longer parse. Importing beside it would either throw or be adopted as an edit.
            if (journal.entries.length > 0 || journal.damaged > 0 || journal.unreadable)
                return false;
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
