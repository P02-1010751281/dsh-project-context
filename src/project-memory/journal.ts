/**
 * The append-only journal — the source of truth: one JSON record per write, folded into a render
 * on read, rotated (archived, never deleted) once it grows past the size limit.
 */

import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { MAX_MEMORY_CHARS, memoryDir, writeAtomic } from "../shared/project-state.js";
import { MEMORY_BACKUP_MIN_AGE_MS } from "./backup.js";
import { normalizeMemoryDocument } from "./document.js";

/** The append-only memory journal for one project. */
export function memoryJournalFile(projectRoot: string): string {
	return path.join(memoryDir(projectRoot), "memory.jsonl");
}

// ---------------------------------------------------------------------------
// Cross-process write lock
// ---------------------------------------------------------------------------

/** Collapse the journal once it grows past this; the previous file is archived, never deleted. */
const MEMORY_JOURNAL_ROTATE_BYTES = 512 * 1024;

/** Archived journals kept as evidence; the same age floor as backups protects the newest. */
const MEMORY_JOURNAL_ARCHIVES_KEPT = 5;

/** One journal record: a whole-document replacement or an appended fragment. */
export type MemoryJournalEntry = { op: "replace" | "append"; text: string };

/** Append one record with a single `write` call; the file is append-only by construction. */
export async function appendMemoryOp(file: string, op: MemoryJournalEntry["op"], text: string): Promise<void> {
	await mkdir(path.dirname(file), { recursive: true });
	const entry = `${JSON.stringify({ ts: new Date().toISOString(), op, text })}\n`;
	// A crash or a full disk can leave a torn last line; terminate it first, or the new record
	// would be glued onto it and parsed as damage instead of being recorded.
	let torn = false;
	try {
		const info = await stat(file);
		if (info.size > 0) {
			const reader = await open(file, "r");
			try {
				const tail = Buffer.alloc(1);
				await reader.read(tail, 0, 1, info.size - 1);
				torn = tail[0] !== 0x0a;
			} finally {
				await reader.close();
			}
		}
	} catch {
		// No file yet (or it vanished): there is no torn tail to repair.
	}
	const handle = await open(file, "a", 0o600);
	try {
		await handle.write(torn ? `\n${entry}` : entry);
	} finally {
		await handle.close();
	}
}

/** Parse journal text in file order, tolerating a torn or hand-edited line without losing the rest. */
export function parseJournalEntries(raw: string): { entries: MemoryJournalEntry[]; damaged: number } {
	const entries: MemoryJournalEntry[] = [];
	let damaged = 0;
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const parsed = JSON.parse(trimmed) as { op?: unknown; text?: unknown };
			if ((parsed.op === "replace" || parsed.op === "append") && typeof parsed.text === "string") {
				entries.push({ op: parsed.op, text: parsed.text });
			} else {
				damaged += 1;
			}
		} catch {
			damaged += 1; // A partially written last line from a crash is skipped, not fatal.
		}
	}
	return { entries, damaged };
}

/**
 * Read the journal in file order, tolerating a torn or hand-edited line without losing the rest.
 * @param file - the journal path.
 * @returns the usable records, how many lines were unusable, and whether the file was unreadable.
 */
export async function readMemoryJournal(file: string): Promise<{ entries: MemoryJournalEntry[]; damaged: number; unreadable: boolean }> {
	let raw: string;
	try {
		raw = await readFile(file, "utf8");
	} catch (error) {
		if ((error as { code?: string }).code === "ENOENT") return { entries: [], damaged: 0, unreadable: false };
		return { entries: [], damaged: 0, unreadable: true };
	}
	return { ...parseJournalEntries(raw), unreadable: false };
}

/** Apply journal records in order: a replacement supersedes the document, an append extends it. */
export function foldMemoryJournal(entries: readonly MemoryJournalEntry[], limit: number = MAX_MEMORY_CHARS): string {
	let document = "";
	for (const entry of entries) {
		const text = entry.text.trim();
		if (!text) continue;
		document = entry.op === "replace" ? text : document ? `${document}\n\n${text}` : text;
	}
	return document ? normalizeMemoryDocument(document, limit) : "";
}

/** Collapse an oversized journal into one replacement, archiving the previous bytes first. */
export async function rotateMemoryJournalIfNeeded(projectRoot: string, limit: number = MAX_MEMORY_CHARS): Promise<void> {
	const file = memoryJournalFile(projectRoot);
	let size: number;
	try {
		size = (await stat(file)).size;
	} catch {
		return;
	}
	if (size <= MEMORY_JOURNAL_ROTATE_BYTES) return;
	const state = await readMemoryJournal(file);
	if (state.unreadable || state.entries.length === 0) return;
	const folded = foldMemoryJournal(state.entries, limit);
	if (!folded) return;
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const archive = path.join(memoryDir(projectRoot), `memory-log-${stamp}-${randomUUID().slice(0, 8)}.jsonl`);
	// The `.tmp` suffix keeps an orphaned rotation file inside the reclamation rules.
	const collapsed = path.join(memoryDir(projectRoot), `memory.jsonl.${Date.now()}.${randomUUID()}.tmp`);
	const record = `${JSON.stringify({ ts: new Date().toISOString(), op: "replace", text: folded })}\n`;
	try {
		// Prepare the replacement first: a failure here leaves the journal exactly as it was.
		await writeAtomic(collapsed, record);
	} catch {
		return;
	}
	try {
		await rename(file, archive);
	} catch {
		await rm(collapsed, { force: true }).catch(() => undefined);
		return;
	}
	try {
		await rename(collapsed, file);
	} catch {
		// Put the original back rather than leaving the journal path empty.
		await rename(archive, file).catch(() => undefined);
		await rm(collapsed, { force: true }).catch(() => undefined);
		return;
	}
	await pruneMemoryJournalArchives(projectRoot);
}

/** Keep the newest archived journals; anything younger than an hour is never pruned. */
async function pruneMemoryJournalArchives(projectRoot: string): Promise<void> {
	const generated = /^memory-log-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{8}\.jsonl$/;
	try {
		const directory = memoryDir(projectRoot);
		const candidates: Array<{ name: string; mtime: number }> = [];
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			if (!entry.isFile() || !generated.test(entry.name)) continue;
			try {
				candidates.push({ name: entry.name, mtime: (await stat(path.join(directory, entry.name))).mtimeMs });
			} catch {
				// An unreadable archive must never be deleted on a guess.
			}
		}
		candidates.sort((left, right) => (right.mtime - left.mtime) || right.name.localeCompare(left.name));
		const pruneBefore = Date.now() - MEMORY_BACKUP_MIN_AGE_MS;
		for (const stale of candidates.slice(MEMORY_JOURNAL_ARCHIVES_KEPT)) {
			if (stale.mtime > pruneBefore) continue;
			try {
				await rm(path.join(directory, stale.name), { force: true });
			} catch {
				// One unremovable archive must not stop the others.
			}
		}
	} catch {
		// Pruning is best effort; an extra archive is harmless.
	}
}
