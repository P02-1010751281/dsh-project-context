/**
 * Mechanical session index: `<memory>/session-logs/INDEX.md`.
 *
 * One line per archived session, written without any model call — the archive
 * step (S0) owns it. The title comes from dsh's own `session/title` event,
 * falling back to the first user message. Later passes (autolearn backtracking,
 * handoff pointers) read the index to navigate the raw archive.
 */

import path from "node:path";
import type { Session } from "@deepseek-ai/dsh-session";
import { logsDir, readOptional, safeSessionId, sessionIndexFile, writeAtomic } from "./project-state.js";

export interface SessionIndexEntry {
	id: string;
	date: string;
	title: string;
	/** Absolute path of the session's Markdown rendering. */
	file: string;
}

const HEADING = "# Session Index";
const MAX_TITLE_CHARS = 160;
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

/** Title dsh itself assigned to the session, else the first user message, else a fallback. */
export function sessionTitle(session: Session): string {
	let title = "";
	let firstUser = "";
	for (const event of session.snapshotEvents()) {
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

/** One Markdown index line. Links are relative to `session-logs/`. */
export function sessionIndexLine(session: Session, title: string = sessionTitle(session)): string {
	const id = safeSessionId(String(session.id));
	const date = new Date(session.header.createdAt).toISOString().slice(0, 10);
	return `- [${id}](${id}/session.md) — ${date} — ${clip(title, MAX_TITLE_CHARS)}`;
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

/** Read the index with absolute paths so later passes can open the archives directly. */
export async function readSessionIndex(projectRoot: string): Promise<SessionIndexEntry[]> {
	const text = await readOptional(sessionIndexFile(projectRoot));
	return parseSessionIndex(text).map((entry) => ({
		...entry,
		file: path.join(logsDir(projectRoot), safeSessionId(entry.id), "session.md"),
	}));
}

/** One write chain per project so concurrent sessions cannot lose index lines. */
const queues = new Map<string, Promise<void>>();

/**
 * Insert or refresh this session's index line. Idempotent: a session keeps its
 * position, and the title is refreshed if dsh assigned a better one later.
 */
export function queueSessionIndexEntry(projectRoot: string, session: Session): Promise<void> {
	const key = projectRoot;
	const previous = queues.get(key) ?? Promise.resolve();
	const next = previous.catch(() => undefined).then(async () => {
		const file = sessionIndexFile(projectRoot);
		const id = safeSessionId(String(session.id));
		const line = sessionIndexLine(session);
		const existing = await readOptional(file);
		const lines = existing.trim() ? existing.trimEnd().split("\n") : [HEADING, ""];
		let replaced = false;
		const rendered = lines.map((current) => {
			if (!current.startsWith(`- [${id}](`)) return current;
			replaced = true;
			return line;
		});
		if (!replaced) rendered.push(line);
		const document = `${rendered.join("\n")}\n`;
		if (document !== existing) await writeAtomic(file, document);
	});
	queues.set(key, next);
	void next.catch(() => undefined).finally(() => {
		if (queues.get(key) === next) queues.delete(key);
	});
	return next;
}
