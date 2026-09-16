/**
 * Mechanical session index: `<memory>/session-logs/INDEX.md`.
 *
 * One line per archived session, written without any model call — the archive
 * step (S0) owns it. The title comes from dsh's own `session/title` event,
 * falling back to the first user message. Later passes (autolearn backtracking,
 * handoff pointers) read the index to navigate the raw archive.
 */

import { rm } from "node:fs/promises";
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
 * Newest line per session id, oldest first, capped. The incoming line replaces any
 * line with the same id, and duplicates left behind by an import collapse to one.
 */
function dedupeIndexLines(lines: readonly string[], line: string, limit: number, replaceId: string): string[] {
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
	return result.slice(-limit);
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
 * Insert or refresh this session's index line. Idempotent: a session keeps its
 * position, and the title is refreshed if dsh assigned a better one later.
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
		// Adopt a pre-move `<memory>/session-index.md` once, converting its links, so an existing
		// index survives the layout change into `session-logs/`.
		let existing = await readOptional(file);
		let legacyFile: string | undefined;
		if (!existing.trim()) {
			const candidate = legacySessionIndexFile(projectRoot);
			const legacy = normalizeLegacyIndex(await readOptional(candidate));
			if (legacy.trim()) {
				existing = legacy.endsWith("\n") ? legacy : `${legacy}\n`;
				legacyFile = candidate;
			}
		}
		const entries = existing.trim()
			? existing.split("\n").map((current) => current.trim()).filter((current) => current.startsWith("- ["))
			: [];
		const document = [HEADING, "", ...dedupeIndexLines(entries, line, MAX_INDEX_LINES, safeSessionId(id)), ""].join("\n");
		// Write before removing the adopted source, and write even when the legacy bytes were
		// already canonical: otherwise an adoption whose content needs no change deletes the only
		// copy of the index. A crash between the two now leaves both files, never neither.
		if (document !== existing || legacyFile !== undefined) await writeAtomic(file, document);
		if (legacyFile !== undefined) await rm(legacyFile, { force: true }).catch(() => undefined);
	});
	queues.set(key, next);
	void next.catch(() => undefined).finally(() => {
		if (queues.get(key) === next) queues.delete(key);
	});
	return next;
}
