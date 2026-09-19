/**
 * Mechanical session index: `<memory>/session-logs/INDEX.md`.
 *
 * One line per archived session, written without any model call — the archive
 * step (S0) owns it. The title comes from dsh's own `session/title` event,
 * falling back to the first user message. Later passes (autolearn backtracking,
 * handoff pointers) read the index to navigate the raw archive.
 */

import { rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Session } from "@deepseek-ai/dsh-session";
import { legacySessionIndexFile, logsDir, memoryDir, readOptional, safeSessionId, sessionIndexFile, writeAtomic } from "./project-state.js";
import { withMemoryLock } from "./memory-store.js";
import { piTextOf } from "./archive.js";
import type { PiBlock } from "./archive.js";

export interface SessionIndexEntry {
	id: string;
	date: string;
	title: string;
	/** Absolute path of the session's Markdown rendering. */
	file: string;
	/** Absolute path of the canonical JSONL archive (the source for backtracking). */
	raw: string;
}

type SessionEntry = ReturnType<Session["snapshotEvents"]>[number];

const HEADING = "# Session Index";
const MAX_TITLE_CHARS = 160;
/** Newest sessions kept when the index is rewritten; older lines drop off the top. */
const MAX_INDEX_LINES = 200;
/** `- [id](<id>/session.md) — YYYY-MM-DD — title` (the link target is ignored on parse). */
const LINE_PATTERN = /^- \[([^\]]+)\]\(([^)]+)\) — (\d{4}-\d{2}-\d{2}) — (.*)$/;

function clip(value: string, limit: number): string {
	const text = value.replace(/\s+/g, " ").trim();
	return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function textOf(content: readonly { type: string; text?: string }[]): string {
	return content
		.filter((block) => block.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join(" ")
		.trim();
}

/**
 * Title from a bare event list: `session/title`, else the first user message, else a fallback.
 * Both harnesses that write into `.agents/` are read — dsh's named events and pi's bare
 * `message` event — so a pi archive imported by dsh gets the same title the live path would.
 */
export function sessionTitleFromEntries(events: readonly unknown[]): string {
	let title = "";
	let firstUser = "";
	for (const raw of events) {
		const event = raw as SessionEntry;
		// `session/title` is emitted by dsh at runtime; its type is not part of the
		// base SessionEventMap, so read it structurally instead of narrowing.
		const type = event.type as string;
		if (type === "session/title") {
			const data = event.data as { title?: unknown };
			if (typeof data.title === "string" && data.title.trim()) title = data.title;
			continue;
		}
		if (!firstUser && event.type === "user/message" && event.data.source.kind === "user") {
			firstUser = textOf(event.data.content);
			continue;
		}
		// pi writes `{"type":"message","message":{role,content:[…]}}` where dsh writes one named
		// event per message under `data`; the event name `message` is disjoint from every dsh event
		// name, so this branch cannot change what a dsh log resolves to. A pi archive imported by
		// dsh would otherwise index as "Untitled session" — the one label autolearn navigates by.
		// The body is read as unknown (not `SessionEntry`) because a pi line is not a dsh event.
		// `piTextOf` (archive.ts) is reused rather than this file's `textOf`: the two join the text
		// blocks differently, so a multi-block message would title as `"a b"` while the archive
		// reader renders `"ab"` — the same message, two different strings. One extraction, one text.
		if (!firstUser && type === "message") {
			const message = (raw as { message?: unknown }).message;
			const pi = typeof message === "object" && message !== null ? (message as { role?: unknown; content?: unknown }) : undefined;
			if (pi?.role === "user" && Array.isArray(pi.content)) firstUser = piTextOf(pi.content as PiBlock[]);
		}
	}
	return clip(title || firstUser || "Untitled session", MAX_TITLE_CHARS);
}

/** Title dsh itself assigned to the session, else the first user message, else a fallback. */
export function sessionTitle(session: Session): string {
	return sessionTitleFromEntries(session.snapshotEvents());
}

/** One Markdown index line from its parts. Links are relative to `session-logs/`. */
export function sessionIndexLineFrom(id: string, createdAt: number, title: string): string {
	const safe = safeSessionId(id);
	const date = new Date(createdAt).toISOString().slice(0, 10);
	return `- [${safe}](${safe}/session.md) — ${date} — ${clip(title, MAX_TITLE_CHARS)}`;
}

/** One Markdown index line. Links are relative to `session-logs/`. */
export function sessionIndexLine(session: Session, title: string = sessionTitle(session)): string {
	return sessionIndexLineFrom(String(session.id), session.header.createdAt, title);
}

/**
 * Convert pre-move index links (`session-logs/<id>/session.md`) to the current relative form.
 * @param document - the legacy index body.
 * @returns the body with every link made relative to `session-logs/`.
 */
export function normalizeLegacyIndex(document: string): string {
	return document
		.split("\n")
		.map((line) => line.replace(/\]\(session-logs\//, "]("))
		.join("\n");
}

/** Parse an INDEX.md body; unrecognized lines are ignored. */
export function parseSessionIndex(text: string): Array<{ id: string; date: string; title: string }> {
	const entries: Array<{ id: string; date: string; title: string }> = [];
	for (const raw of text.split("\n")) {
		const match = LINE_PATTERN.exec(raw.trim());
		if (match) entries.push({ id: match[1]!, date: match[3]!, title: match[4]!.trim() });
	}
	return entries;
}

function indexLineId(line: string): string {
	return /^- \[([^\]]+)\]/.exec(line)?.[1] ?? line;
}

/**
 * One line per session id: the incoming line replaces any line with the same id, and duplicates
 * left behind by an import collapse to one. The cap is applied by the caller after
 * `orderIndexLines`, so what drops off is the oldest session and not the first line written.
 */
function dedupeIndexLines(lines: readonly string[], line: string, replaceId: string): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const current = lines[index]!;
		const id = indexLineId(current);
		if (id === replaceId || seen.has(id)) continue;
		seen.add(id);
		result.unshift(current);
	}
	result.push(line);
	return result;
}

/** The `- [id](…)` lines of an index body; a heading, prose or a blank line is not an entry. */
function entryLines(document: string): string[] {
	return document.split("\n").map((current) => current.trim()).filter((current) => current.startsWith("- ["));
}

/**
 * Oldest first, by the date in each line. The index is a date-ordered list whose cap drops its
 * head, so this order decides which sessions survive the cap — and which ones a reader taking the
 * newest lines, as autolearn does, ever sees. Stable for equal dates; a line without a parsable
 * date is kept at the newest end rather than dropped first.
 */
function orderIndexLines(lines: readonly string[]): string[] {
	return lines
		.map((current, position) => ({ current, position, date: LINE_PATTERN.exec(current)?.[3] ?? "" }))
		.sort((left, right) => {
			if (left.date !== right.date) {
				if (left.date === "") return 1;
				if (right.date === "") return -1;
				return left.date < right.date ? -1 : 1;
			}
			return left.position - right.position;
		})
		.map((entry) => entry.current);
}

/**
 * The pre-move index at `<memory>/session-index.md`, ready for adoption, or `undefined` when there
 * is nothing to adopt: no regular file there (`stat` also keeps a directory or a FIFO from making
 * every later write fail or block), or a file holding no index line at all — a hand-written note is
 * not an index and must not be deleted.
 */
async function readLegacyIndexForAdoption(file: string): Promise<{ body: string; ids: string[]; size: number; mtimeMs: number } | undefined> {
	try {
		const info = await stat(file);
		if (!info.isFile()) return undefined;
		const body = normalizeLegacyIndex(await readOptional(file));
		const ids = entryLines(body).map((current) => indexLineId(current));
		return ids.length === 0 ? undefined : { body, ids, size: info.size, mtimeMs: info.mtimeMs };
	} catch {
		return undefined;
	}
}

/**
 * Whether an adopted file still has the size and mtime it had when it was read. Exported for its
 * own unit test: the check has to notice an *append* (same inode, new size/mtime), and the
 * end-to-end adoption test cannot reach that case — there the write replaces the path and so
 * changes the inode too, which an identity-based (and append-blind) check would also catch.
 */
export async function untouchedSince(file: string, adopted: { size: number; mtimeMs: number }): Promise<boolean> {
	try {
		const info = await stat(file);
		return info.size === adopted.size && info.mtimeMs === adopted.mtimeMs;
	} catch {
		return false;
	}
}

/** Read the index with absolute paths so later passes can open the archives directly. */
export async function readSessionIndex(projectRoot: string): Promise<SessionIndexEntry[]> {
	const text = await readOptional(sessionIndexFile(projectRoot));
	return parseSessionIndex(text).map((entry) => ({
		...entry,
		file: path.join(logsDir(projectRoot), safeSessionId(entry.id), "session.md"),
		raw: path.join(logsDir(projectRoot), safeSessionId(entry.id), "session.jsonl"),
	}));
}

/** One write chain per project so concurrent sessions cannot lose index lines. */
const queues = new Map<string, Promise<void>>();

/**
 * Cross-process lock target for one project's index, so the lock file is
 * `<memory>/session-index.lock`. It lives in the memory directory because that
 * directory's `.gitignore` already covers `*.lock`, while `session-logs/` owns a
 * different ignore file (a bare `*`) that the lock helper must not append to.
 */
function sessionIndexLockTarget(projectRoot: string): string {
	return path.join(memoryDir(projectRoot), "session-index");
}

/**
 * Insert or refresh this session's index line. Idempotent: a session keeps its place in the date
 * order, and the title is refreshed if dsh assigned a better one later.
 */
export function queueSessionIndexEntry(projectRoot: string, session: Session): Promise<void> {
	return queueIndexLine(projectRoot, safeSessionId(String(session.id)), sessionIndexLine(session));
}

/** Insert or refresh one index line (used by the live writer and the archive backfill). */
export function queueIndexLine(projectRoot: string, id: string, line: string): Promise<void> {
	const key = projectRoot;
	const previous = queues.get(key) ?? Promise.resolve();
	const next = previous.catch(() => undefined).then(async () => {
		// `queues` orders writers inside this process only, and the index write is a read-modify-write:
		// two hosts doing it at once lose most lines (measured: 58-59 of 120). The same cross-process
		// lock the memory journal uses (30 s stale / 35 s wait) therefore guards the whole
		// read → merge → write → remove sequence, not just the final write.
		await withMemoryLock(sessionIndexLockTarget(projectRoot), async () => {
			const file = sessionIndexFile(projectRoot);
			const existing = await readOptional(file);
			const candidate = legacySessionIndexFile(projectRoot);
			const adopted = await readLegacyIndexForAdoption(candidate);
			// Adopt a pre-move `<memory>/session-index.md`, converting its links, so an existing index
			// survives the layout change into `session-logs/`. It is merged with the current index rather
			// than adopted only while that index is still empty: two hosts can straddle the move, and a
			// legacy file written after the new index appeared would otherwise strand its entries —
			// archived on disk, missing from the list autolearn navigates by, forever. Legacy lines come
			// first only so that a shared id keeps the current index's line; the document is ordered by
			// date, because a straddling legacy file can hold the newest sessions, not the oldest.
			const entries = [...entryLines(adopted?.body ?? ""), ...entryLines(existing)];
			const document = [HEADING, "", ...orderIndexLines(dedupeIndexLines(entries, line, safeSessionId(id))).slice(-MAX_INDEX_LINES), ""].join("\n");
			// Write before removing the adopted source, and write even when the bytes are unchanged: an
			// adoption whose content was already canonical must still create the new file. A crash
			// between the two leaves both files, never neither.
			if (document !== existing || adopted !== undefined) await writeAtomic(file, document);
			// Remove the source only once every line it held is in the document. The cap drops the oldest
			// lines, so a legacy entry too old to survive it would otherwise have its only copy deleted;
			// the file is left in place instead and adopted again on the next write. Re-stat first: an
			// older host can still append to that path, and a line appended into the read→remove window
			// must not be deleted with the file, unadopted.
			if (adopted !== undefined && adopted.ids.every((entryId) => document.includes(`[${entryId}](`)) && (await untouchedSince(candidate, adopted))) {
				await rm(candidate, { force: true }).catch(() => undefined);
			}
		});
	});
	queues.set(key, next);
	void next.catch(() => undefined).finally(() => {
		if (queues.get(key) === next) queues.delete(key);
	});
	return next;
}
