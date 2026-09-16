/**
 * Durable project memory: an append-only journal plus a rendered `MEMORY.md`.
 *
 * Ported from the pi sibling (`extensions/project-context/project-state.ts`), which
 * unified the memory write path with the session archive: `session.jsonl` is
 * append-only truth and `session.md` is its rendering, so `memory.jsonl` is the
 * append-only truth and `MEMORY.md` is the rendering a human reads, the prompts
 * inject, and external editors touch.
 *
 * Layout (`<project>/.agents/memory/`):
 *   memory.jsonl                     one record per write: {"ts","op":"replace"|"append","text"}
 *   MEMORY.md                        rendered document, always rebuildable from the journal
 *   MEMORY.md.memory-backup-<stamp>  byte-level copy of the render before it is replaced
 *   MEMORY.md.lock / .steal          cross-process write serialization
 *   memory-log-<stamp>-<hex>.jsonl   archived journals from a rotation
 *
 * Invariants (a port keeps every one of them):
 *   1. The read path has no side effects: no writes, no backups, no log entries.
 *   2. The journal is append-only; only a rotation replaces the file, and it archives
 *      the previous bytes instead of deleting them.
 *   3. A byte-level backup is taken before the render is replaced, inside the same lock.
 *   4. A failed write never leaves "render newer than journal": the append lands first.
 */

import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
	MAX_MEMORY_CHARS,
	ensureMemoryGitignore,
	pathExists,
	legacyOmpDir,
	legacyPiDir,
	logError,
	memoryDir,
	memoryFile,
	readOptional,
	writeAtomic,
} from "./project-state.js";

/** The append-only memory journal for one project. */
export function memoryJournalFile(projectRoot: string): string {
	return path.join(memoryDir(projectRoot), "memory.jsonl");
}

// ---------------------------------------------------------------------------
// Cross-process write lock
// ---------------------------------------------------------------------------

/** A lock older than this was left behind by a crashed writer and may be stolen. */
const MEMORY_LOCK_STALE_MS = 30_000;
/** How long a writer waits for the lock before failing the pass. */
const MEMORY_LOCK_WAIT_MS = 5_000;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Take the lock with `wx`; returns the token that proves ownership, or undefined when held. */
async function tryLock(lockPath: string): Promise<string | undefined> {
	const token = `${process.pid}-${randomUUID()}`;
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			const handle = await open(lockPath, "wx", 0o600);
			// The open handle identifies the exact file this attempt created; a write failure may
			// only remove that file, never a successor's lock created after a long suspension.
			const created = await handle.stat().catch(() => undefined);
			let writeFailure: unknown;
			try {
				await handle.writeFile(`${token}\n`);
			} catch (error) {
				writeFailure = error;
			} finally {
				await handle.close().catch(() => undefined);
			}
			if (writeFailure) {
				const current = await lstat(lockPath).catch(() => undefined);
				if (current && created && current.ino === created.ino && current.dev === created.dev) {
					await rm(lockPath, { force: true }).catch(() => undefined);
				}
				throw writeFailure;
			}
			return token;
		} catch (error) {
			if ((error as { code?: string }).code !== "EEXIST") throw error;
			let info: Awaited<ReturnType<typeof lstat>>;
			try {
				info = await lstat(lockPath);
			} catch {
				return undefined; // Vanished; the next attempt can win it.
			}
			if (!info.isFile()) {
				// A directory, FIFO or symlink (even a dangling one) can never age into a lock: move
				// it aside. `lstat` is essential here: `stat` follows the link and reports ENOENT.
				await rename(lockPath, `${lockPath}.broken-${randomUUID().slice(0, 8)}`).catch(() => undefined);
				continue;
			}
			return undefined;
		}
	}
	return undefined;
}

/** Lock mtime where a missing file counts as 0 and an unreadable one as fresh (never stolen). */
async function lockMtimeMs(file: string): Promise<number> {
	try {
		return (await stat(file)).mtimeMs;
	} catch (error) {
		return (error as { code?: string }).code === "ENOENT" ? 0 : Number.POSITIVE_INFINITY;
	}
}

/** Take the short-lived steal claim with `wx`; only one writer wins it. */
async function acquireClaim(claimPath: string): Promise<string | undefined> {
	const token = `${process.pid}-${randomUUID()}`;
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			const handle = await open(claimPath, "wx", 0o600);
			const created = await handle.stat().catch(() => undefined);
			try {
				await handle.writeFile(`${token}\n`);
			} catch {
				// A claim we cannot fill is not ours to hold; remove only the exact file we created.
				const current = await lstat(claimPath).catch(() => undefined);
				if (current && created && current.ino === created.ino && current.dev === created.dev) {
					await rm(claimPath, { force: true }).catch(() => undefined);
				}
				return undefined;
			} finally {
				await handle.close().catch(() => undefined);
			}
			return token;
		} catch (error) {
			if ((error as { code?: string }).code !== "EEXIST") throw error;
			let info: Awaited<ReturnType<typeof lstat>>;
			try {
				info = await lstat(claimPath);
			} catch {
				return undefined; // Vanished between open and stat; the next attempt can win it.
			}
			if (!info.isFile()) {
				// A directory, FIFO or symlink (even a dangling one) can never age into staleness.
				await rename(claimPath, `${claimPath}.broken-${randomUUID().slice(0, 8)}`).catch(() => undefined);
				continue;
			}
			// A claim left by a crashed stealer must not block stealing forever, but only the exact
			// inode and bytes inspected may be removed; a claim that replaced them belongs to someone else.
			if (Date.now() - info.mtimeMs > MEMORY_LOCK_STALE_MS) {
				const observed = await readFile(claimPath, "utf8").catch(() => undefined);
				if (observed === undefined) continue;
				const after = await lstat(claimPath).catch(() => undefined);
				if (!after || !after.isFile() || after.ino !== info.ino || after.dev !== info.dev) continue;
				const current = await readFile(claimPath, "utf8").catch(() => undefined);
				if (current === observed) await rm(claimPath, { force: true }).catch(() => undefined);
				continue;
			}
			return undefined;
		}
	}
	return undefined;
}

/** True while the claim file still carries this writer's token. */
async function claimStillOurs(claimPath: string, token: string): Promise<boolean> {
	return (await readFile(claimPath, "utf8").catch(() => "")).trim() === token;
}

/** Release a claim only while it is still ours; a reclaimed claim belongs to its new holder. */
async function releaseClaim(claimPath: string, token: string): Promise<void> {
	if (await claimStillOurs(claimPath, token)) await rm(claimPath, { force: true }).catch(() => undefined);
}

/**
 * Remove a stale lock with a single winner: every stealer first takes `<lock>.steal` with its own
 * token, so two writers cannot both pass the age check and then delete each other's lock. Every
 * destructive step re-checks that we still own the claim, which closes the race for cooperating
 * writers except for a suspension between that final check and the unlink; no kernel-atomic
 * alternative is available through node:fs.
 */
async function stealStaleLock(lockPath: string, claimPath: string, claimToken: string): Promise<void> {
	const before = await lstat(lockPath).catch(() => undefined);
	if (!before || !before.isFile()) return; // Non-regular paths heal in tryLock.
	if (Date.now() - before.mtimeMs <= MEMORY_LOCK_STALE_MS) return;
	// Only the exact inode and bytes inspected may be removed; a lock replaced meanwhile is not ours.
	const observed = await readFile(lockPath, "utf8").catch(() => undefined);
	if (observed === undefined) return;
	const after = await lstat(lockPath).catch(() => undefined);
	if (!after || !after.isFile() || after.ino !== before.ino || after.dev !== before.dev) return;
	const current = await readFile(lockPath, "utf8").catch(() => undefined);
	if (current !== observed) return;
	if (!(await claimStillOurs(claimPath, claimToken))) return;
	await rm(lockPath, { force: true }).catch(() => undefined);
}

/** Remove the lock only while it still carries this writer's token; a stolen lock belongs to its thief. */
async function releaseLock(lockPath: string, token: string): Promise<void> {
	const claimPath = `${lockPath}.steal`;
	// Only the claim holder may delete: without it a stealer owns the lock's fate, and a delete
	// could unlink the thief's freshly created lock. Leaving our own lock is the safe branch.
	const claimToken = await acquireClaim(claimPath);
	if (!claimToken) return;
	try {
		const current = (await readFile(lockPath, "utf8").catch(() => "")).trim();
		if (current === token && await claimStillOurs(claimPath, claimToken)) {
			await rm(lockPath, { force: true }).catch(() => undefined);
		}
	} finally {
		await releaseClaim(claimPath, claimToken);
	}
}

/**
 * Serialize one memory-file write across processes with an exclusive lock file, so the bytes a
 * writer backs up cannot be replaced between the backup read and the atomic rename that publishes
 * the new file. A lock left behind by a crashed writer is stolen once it is older than any live
 * write; the thief writes its own token and the original holder only deletes a lock it still owns.
 * @param target - the file the lock protects (its path plus `.lock` is the lock).
 * @param action - the write to run while holding the lock.
 * @returns whatever `action` produced.
 */
export async function withMemoryLock<T>(target: string, action: () => Promise<T>): Promise<T> {
	const lockPath = `${target}.lock`;
	// The memory directory may not exist yet on a first write; the lock lives next to the file.
	await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
	await ensureMemoryGitignore(path.dirname(lockPath));
	const deadline = Date.now() + MEMORY_LOCK_WAIT_MS;
	let token: string | undefined;
	while (!token) {
		token = await tryLock(lockPath);
		if (token) break;
		if (Date.now() >= deadline) throw new Error(`timed out waiting for the memory write lock at ${lockPath}`);
		if (Date.now() - (await lockMtimeMs(lockPath)) > MEMORY_LOCK_STALE_MS) {
			const claimPath = `${lockPath}.steal`;
			const claimToken = await acquireClaim(claimPath);
			if (claimToken) {
				try {
					await stealStaleLock(lockPath, claimPath, claimToken);
				} finally {
					await releaseClaim(claimPath, claimToken);
				}
			}
		}
		// Always back off: a stale lock whose claim is held must not spin a core to the deadline.
		await sleep(40 + Math.floor(Math.random() * 60));
	}
	try {
		return await action();
	} finally {
		await releaseLock(lockPath, token);
	}
}

// ---------------------------------------------------------------------------
// Stored-reply decoding ("JSON poison")
// ---------------------------------------------------------------------------

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
 * @returns the decoded document, or `undefined` when the bytes are not a stored reply.
 */
function decodePoisonedMemory(current: string): string | undefined {
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
	return normalizeMemoryDocument(field.value);
}

// ---------------------------------------------------------------------------
// Rendered document + backups
// ---------------------------------------------------------------------------

/** Rebuild the `# Project Memory` document from a model or recovered value, keeping every line. */
export function normalizeMemoryDocument(value: string): string {
	const body = value
		.replace(/^```(?:markdown)?\s*/i, "")
		.replace(/\s*```$/, "")
		.trim()
		.replace(/^#\s*Project Memory\s*/i, "")
		.trim();
	return `# Project Memory\n\n${body}`.slice(0, MAX_MEMORY_CHARS).trimEnd() + "\n";
}

const MEMORY_BACKUPS_KEPT = 5;
/** Backups younger than this are never pruned, so a backup named in a notice stays reviewable
 * until roughly MEMORY_BACKUPS_MAX further writes have pushed it past the hard ceiling. */
const MEMORY_BACKUP_MIN_AGE_MS = 60 * 60 * 1000;
/** Hard ceiling on backups, so a sustained burst cannot grow the directory without bound. */
const MEMORY_BACKUPS_MAX = Math.max(MEMORY_BACKUPS_KEPT, 20);

/** Collapse the journal once it grows past this; the previous file is archived, never deleted. */
const MEMORY_JOURNAL_ROTATE_BYTES = 512 * 1024;
/** Archived journals kept as evidence; the same age floor as backups protects the newest. */
const MEMORY_JOURNAL_ARCHIVES_KEPT = 5;

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

/** One journal record: a whole-document replacement or an appended fragment. */
export type MemoryJournalEntry = { op: "replace" | "append"; text: string };

/** Comparison key for "does this render still equal what the journal folds to?" — both normalized. */
function memoryComparisonKey(render: string): string {
	return normalizeMemoryDocument(decodePoisonedMemory(render.trim()) ?? render);
}

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
function parseJournalEntries(raw: string): { entries: MemoryJournalEntry[]; damaged: number } {
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
export function foldMemoryJournal(entries: readonly MemoryJournalEntry[]): string {
	let document = "";
	for (const entry of entries) {
		const text = entry.text.trim();
		if (!text) continue;
		document = entry.op === "replace" ? text : document ? `${document}\n\n${text}` : text;
	}
	return document ? normalizeMemoryDocument(document) : "";
}

/** Collapse an oversized journal into one replacement, archiving the previous bytes first. */
async function rotateMemoryJournalIfNeeded(projectRoot: string): Promise<void> {
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
	const folded = foldMemoryJournal(state.entries);
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

/**
 * Record one consolidated document: keep a pre-journal project's current memory as the journal's
 * base, append the new replacement, collapse the journal when it grew too large and render
 * `MEMORY.md`. Callers hold the memory lock and have already backed up the current render.
 * @param projectRoot - the project root.
 * @param text - the new memory document.
 */
export async function recordMemoryDocument(projectRoot: string, text: string): Promise<void> {
	const file = memoryJournalFile(projectRoot);
	const base = await readMemoryJournal(file);
	if (base.unreadable) throw new Error(`memory journal exists but cannot be read: ${file}`);
	if (base.entries.length === 0) {
		// First journal write for this project: start history from the memory it has today. The
		// legacy read path also decodes a stored reply, so the journal never stores raw JSON.
		const existing = await loadMemory(projectRoot);
		if (existing.unreadable) throw new Error(`memory exists but cannot be read: ${existing.source}`);
		if (existing.text.trim()) await appendMemoryOp(file, "replace", normalizeMemoryDocument(existing.text));
	} else {
		// Adopt an external edit (hand edit or an older build) before appending this pass: its bytes
		// enter the journal's history instead of being silently overwritten. A render that merely
		// equals the fold is our own output, and one that is older and differs is a torn write
		// window (journal already ahead), so neither is adopted.
		const foldedView = foldMemoryJournal(base.entries);
		const renderRaw = await readOptional(memoryFile(projectRoot));
		if (renderRaw.trim()) {
			const external = memoryComparisonKey(renderRaw);
			const renderInfo = await stat(memoryFile(projectRoot)).catch(() => undefined);
			const journalInfo = await stat(file).catch(() => undefined);
			if (external && external !== foldedView && renderInfo && journalInfo && renderInfo.mtimeMs > journalInfo.mtimeMs) {
				await appendMemoryOp(file, "replace", external);
				// Keep a trace of which pass folded in an edit that was made outside the plugin.
				await logError(projectRoot, "memory", "adopted an externally edited MEMORY.md into the memory journal");
			}
		}
	}
	await appendMemoryOp(file, "replace", normalizeMemoryDocument(text));
	await rotateMemoryJournalIfNeeded(projectRoot);
	await ensureMemoryGitignore(memoryDir(projectRoot));
	await writeAtomic(memoryFile(projectRoot), normalizeMemoryDocument(text));
}

/**
 * Import a legacy `.omp` memory document into the journal, once, on first use.
 *
 * pi does this inside its migration; here it lives with the memory store because it must hold the
 * same lock and re-check the same facts: without them a stale legacy file would land next to an
 * existing journal, be read as an "external edit" (the render is missing or older) and then be
 * adopted over the consolidated memory. Poison is decoded before it is stored, like the read path.
 * @param projectRoot - the project root.
 * @returns true when a legacy document was imported.
 */
export async function importLegacyMemory(projectRoot: string): Promise<boolean> {
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
			const decoded = decodePoisonedMemory(raw);
			await recordMemoryDocument(projectRoot, decoded ? decoded.trim() : raw);
			return true;
		});
	}
	return false;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

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
async function readMemorySource(file: string): Promise<{ text: string; unreadable: boolean }> {
	try {
		return { text: await readFile(file, "utf8"), unreadable: false };
	} catch (error) {
		return { text: "", unreadable: (error as { code?: string }).code !== "ENOENT" };
	}
}

/** Decode a stored reply found outside the `.agents/` layout (legacy `.pi`, OMP import). */
function legacyMemory(text: string, source: string): LoadedMemory {
	const decoded = decodePoisonedMemory(text);
	if (decoded) return { text: decoded.trim().slice(0, MAX_MEMORY_CHARS), source, poisoned: true };
	return { text: text.slice(0, MAX_MEMORY_CHARS), source, poisoned: false };
}

/**
 * Read this project's memory. The journal is the source of truth once it exists; `MEMORY.md` is
 * the old layout and stays readable for projects that never wrote a journal.
 * @param projectRoot - the project root.
 * @returns the document, where it came from, and any damage worth reporting.
 */
export async function loadMemory(projectRoot: string): Promise<LoadedMemory> {
	const target = memoryFile(projectRoot);
	const journal = memoryJournalFile(projectRoot);
	const journalState = await readMemoryJournal(journal);
	if (journalState.unreadable) return { text: "", source: journal, poisoned: false, unreadable: true };
	// Content that yields no usable record means the journal cannot be reconstructed; report it
	// instead of silently showing a render that the journal has already superseded.
	if (journalState.entries.length === 0 && journalState.damaged > 0) return { text: "", source: journal, poisoned: false, unreadable: true };
	if (journalState.entries.length > 0) {
		const folded = foldMemoryJournal(journalState.entries);
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
			const external = memoryComparisonKey(renderRaw);
			const renderInfo = await stat(target).catch(() => undefined);
			const journalInfo = await stat(journal).catch(() => undefined);
			// An empty key means the render was cleared by hand; the journal stays authoritative.
			if (external && external !== folded && renderInfo && journalInfo && renderInfo.mtimeMs > journalInfo.mtimeMs) {
				return { text: external, source: target, poisoned: Boolean(decodePoisonedMemory(renderRaw.trim())), damaged: journalState.damaged };
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
		const decoded = decodePoisonedMemory(current);
		if (decoded) return { text: decoded.trim().slice(0, MAX_MEMORY_CHARS), source: target, poisoned: true };
		return { text: current.slice(0, MAX_MEMORY_CHARS), source: target, poisoned: false };
	}

	const legacyPi = path.join(legacyPiDir(projectRoot), "MEMORY.md");
	const fromPi = await readMemorySource(legacyPi);
	if (fromPi.unreadable) return { text: "", source: legacyPi, poisoned: false, unreadable: true };
	const piText = fromPi.text.trim();
	if (piText) return legacyMemory(piText, legacyPi);

	for (const name of ["MEMORY.md", "memory_summary.md", "learned.md"]) {
		const fallback = path.join(legacyOmpDir(projectRoot), name);
		const source = await readMemorySource(fallback);
		if (source.unreadable) return { text: "", source: fallback, poisoned: false, unreadable: true };
		const text = source.text.trim();
		if (text) return legacyMemory(text, fallback);
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
 * @returns the memory document, or `""`.
 */
export function loadMemorySync(projectRoot: string): string {
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
			const folded = foldMemoryJournal(entries);
			if (!folded) return "";
			// The render wins only when it differs from the fold *and* is newer: that is an
			// external edit, exactly as in the async reader.
			const renderRaw = readMemorySync(target).text.trim();
			if (renderRaw) {
				const external = memoryComparisonKey(renderRaw);
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
	if (current.text.trim()) return (decodePoisonedMemory(current.text.trim()) ?? current.text.trim()).trim().slice(0, MAX_MEMORY_CHARS);
	// The same legacy fallbacks the async reader has, so a project that never had a `.agents`
	// memory document still injects what `.pi` or `.omp` holds.
	const fromPi = readMemorySync(path.join(legacyPiDir(projectRoot), "MEMORY.md"));
	if (fromPi.unreadable) return "";
	if (fromPi.text.trim()) return (decodePoisonedMemory(fromPi.text.trim()) ?? fromPi.text.trim()).trim().slice(0, MAX_MEMORY_CHARS);
	for (const name of ["MEMORY.md", "memory_summary.md", "learned.md"]) {
		const legacy = readMemorySync(path.join(legacyOmpDir(projectRoot), name));
		if (legacy.unreadable) return "";
		if (legacy.text.trim()) return (decodePoisonedMemory(legacy.text.trim()) ?? legacy.text.trim()).trim().slice(0, MAX_MEMORY_CHARS);
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
function mtimeMs(file: string): number {
	try {
		return statSync(file).mtimeMs;
	} catch {
		return 0;
	}
}
