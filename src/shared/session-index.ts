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
import { legacySessionIndexFile, logsDir, readOptional, safeSessionId, sessionIndexFile, writeAtomic } from "./project-state.js";

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

/** Title from a bare event list: `session/title`, else the first user message, else a fallback. */
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

/** Whether an adopted file still has the size and mtime it had when it was read. */
async function untouchedSince(file: string, adopted: { size: number; mtimeMs: number }): Promise<boolean> {
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
	queues.set(key, next);
	void next.catch(() => undefined).finally(() => {
		if (queues.get(key) === next) queues.delete(key);
	});
	return next;
}
