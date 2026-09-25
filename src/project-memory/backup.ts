/**
 * The byte-level backup taken before the render is replaced, and the prune that keeps a burst of
 * writes from growing the directory without bound.
 */

import { randomUUID } from "node:crypto";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { ensureMemoryGitignore, writeAtomic } from "../shared/project-state.js";
import { decodePoisonedMemory } from "./poison.js";

const MEMORY_BACKUPS_KEPT = 5;

/** Backups younger than this are never pruned, so a backup named in a notice stays reviewable
 * until roughly MEMORY_BACKUPS_MAX further writes have pushed it past the hard ceiling. */
export const MEMORY_BACKUP_MIN_AGE_MS = 60 * 60 * 1000;

/** Hard ceiling on backups, so a sustained burst cannot grow the directory without bound. */
const MEMORY_BACKUPS_MAX = Math.max(MEMORY_BACKUPS_KEPT, 20);

/** Escape a literal string for use inside a RegExp. */
function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Keep the current bytes of a memory file next to it before the writer replaces it, and report
 * whether the bytes on disk are a stored reply. Reads the disk at write time, so a concurrent
 * writer's file is what gets backed up. Older backups beyond the newest few are pruned.
 * @param target - the rendered document about to be replaced.
 * @returns the backup path (absent when there was nothing to keep) and whether it was poisoned.
 */
export async function backupMemoryBeforeWrite(target: string): Promise<{ path?: string; poisoned: boolean }> {
	// Fail closed: a missing file has nothing to keep, but an unreadable one must stop the write.
	let raw: Buffer;
	try {
		raw = await readFile(target);
	} catch (error) {
		if ((error as { code?: string }).code === "ENOENT") return { poisoned: false };
		throw error;
	}
	if (raw.length === 0) return { poisoned: false };
	await ensureMemoryGitignore(path.dirname(target));
	const poisoned = Boolean(decodePoisonedMemory(raw.toString("utf8").trim()));
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const directory = path.dirname(target);
	const prefix = `${path.basename(target)}.memory-backup-`;
	const keep = `${prefix}${stamp}-${randomUUID().slice(0, 8)}`;
	const backup = path.join(directory, keep);
	await writeAtomic(backup, raw);
	// Match only names this generator writes, from the start of the name. A user file that merely
	// carries a similar suffix must survive the prune.
	const generated = new RegExp(`^${escapeRegExp(prefix)}\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z-[0-9a-f]{8}$`);
	try {
		// Prune only files this plugin generated, by mtime, never the backup just written.
		const candidates: Array<{ name: string; mtime: number }> = [];
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			if (entry.name === keep || !entry.isFile()) continue;
			if (!generated.test(entry.name)) continue;
			try {
				candidates.push({ name: entry.name, mtime: (await stat(path.join(directory, entry.name))).mtimeMs });
			} catch {
				// A backup whose time cannot be read must never be deleted on a guess.
			}
		}
		candidates.sort((left, right) => (right.mtime - left.mtime) || right.name.localeCompare(left.name));
		const pruneBefore = Date.now() - MEMORY_BACKUP_MIN_AGE_MS;
		for (const [index, stale] of candidates.slice(MEMORY_BACKUPS_KEPT - 1).entries()) {
			// Recent backups survive the count limit, up to the hard ceiling; beyond that even the
			// recent excess is rotated, so a burst cannot grow the directory without bound.
			if (stale.mtime > pruneBefore && index < MEMORY_BACKUPS_MAX - MEMORY_BACKUPS_KEPT) continue;
			try {
				await rm(path.join(directory, stale.name), { force: true });
			} catch {
				// One unremovable backup must not stop the others.
			}
		}
	} catch {
		// Pruning is best-effort; a stale backup is harmless.
	}
	return { path: backup, poisoned };
}

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------
