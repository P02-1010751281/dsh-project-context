/**
 * Session artifact writer: raw event JSONL plus a full Markdown rendering, per
 * session, under `<project>/.agents/memory/session-logs/<session-id>/`.
 * Ported from pi's `session-log.ts`, adapted to dsh's event-sourced sessions.
 *
 * Both files are append-only within a process run: after the initial full
 * write, each flush appends only the new entries instead of rebuilding the
 * log, so a long session does not rewrite itself on every turn.
 */

import { appendFile } from "node:fs/promises";
import path from "node:path";
import type { Session } from "@deepseek-ai/dsh-session";
import {
	getProjectRoot,
	logError,
	logsDir,
	pathExists,
	safeSessionId,
	writeAtomic,
} from "./project-state.js";
import { queueSessionIndexEntry } from "./session-index.js";

interface SessionFileHeader {
	type: "session";
	harness: "dsh";
	id: string;
	version: number;
	createdAt: number;
	cwd: string | null;
	parentSession?: string;
	origin?: string;
	agentPreset?: string;
	isSeeded: boolean;
}

function fileHeader(session: Session): SessionFileHeader {
	const header = session.header;
	const result: SessionFileHeader = {
		type: "session",
		harness: "dsh",
		id: String(session.id),
		version: header.version,
		createdAt: header.createdAt,
		cwd: header.cwd ?? null,
		isSeeded: header.isSeeded,
	};
	if (header.parentSession !== undefined) result.parentSession = String(header.parentSession);
	if (header.origin !== undefined) result.origin = header.origin;
	if (header.agentPreset !== undefined) result.agentPreset = header.agentPreset;
	return result;
}

type SessionEntry = ReturnType<Session["snapshotEvents"]>[number];

function markdownSection(entry: SessionEntry, index: number): string {
	const timestamp = entry.time ? new Date(entry.time).toISOString() : "unknown time";
	return `### ${index + 1}. ${entry.type} — ${timestamp}\n\n~~~~json\n${JSON.stringify(entry, null, 2)}\n~~~~\n`;
}

function markdownSections(entries: readonly SessionEntry[], offset: number): string {
	return entries.map((entry, index) => markdownSection(entry, offset + index)).join("\n");
}

function markdownHeader(session: Session, header: SessionFileHeader): string {
	return [
		`# DSH Session ${String(session.id)}`,
		"",
		`- Started: ${new Date(header.createdAt).toISOString()}`,
		`- Project: ${header.cwd ?? "unknown"}`,
		"- Raw log: [session.jsonl](./session.jsonl)",
		"",
		"The JSONL file is canonical. This Markdown rendering intentionally preserves every session entry, including tool calls, tool results, thinking blocks, compaction records, model changes, and extension entries.",
		"",
	].join("\n");
}

/** JSONL lines and Markdown sections already persisted per session. */
const persistedEvents = new Map<string, number>();
const renderedEvents = new Map<string, number>();
const logsIgnored = new Set<string>();

/** Keep local transcripts out of version control without touching project ignore files. */
async function ensureLogsIgnored(projectRoot: string): Promise<void> {
	if (logsIgnored.has(projectRoot)) return;
	logsIgnored.add(projectRoot);
	try {
		const file = path.join(logsDir(projectRoot), ".gitignore");
		if (!await pathExists(file)) {
			await writeAtomic(file, "# Local session transcripts; not meant for version control.\n*\n");
		}
	} catch {
		// Best effort: a failed ignore file must not break the log write.
	}
}

export async function writeSessionArtifacts(session: Session, options: { markdown?: boolean } = {}): Promise<{ dir: string }> {
	const cwd = session.header.cwd ?? process.cwd();
	const projectRoot = await getProjectRoot(cwd);
	await ensureLogsIgnored(projectRoot);
	const id = safeSessionId(String(session.id));
	const dir = path.join(logsDir(projectRoot), id);

	const header = fileHeader(session);
	const events = session.snapshotEvents();
	const key = String(session.id);
	const rawPath = path.join(dir, "session.jsonl");

	const persisted = persistedEvents.get(key);
	if (persisted !== undefined && persisted > 0 && persisted <= events.length && await pathExists(rawPath)) {
		const lines = events.slice(persisted).map((entry) => JSON.stringify(entry));
		if (lines.length > 0) await appendFile(rawPath, `${lines.join("\n")}\n`, "utf8");
	} else {
		const lines = [JSON.stringify(header), ...events.map((entry) => JSON.stringify(entry))];
		await writeAtomic(rawPath, `${lines.join("\n")}\n`);
	}
	persistedEvents.set(key, events.length);

	if (options.markdown ?? true) {
		const markdownPath = path.join(dir, "session.md");
		const rendered = renderedEvents.get(key);
		if (rendered !== undefined && rendered > 0 && rendered <= events.length && await pathExists(markdownPath)) {
			const sections = markdownSections(events.slice(rendered), rendered);
			if (sections.length > 0) await appendFile(markdownPath, `\n${sections}`, "utf8");
		} else {
			const body = `${markdownHeader(session, header)}\n${markdownSections(events, 0)}`;
			// Sections already end with a newline; keep exactly one at EOF so the
			// append path leaves a single blank line between flushes.
			await writeAtomic(markdownPath, `${body.replace(/\n+$/, "")}\n`);
		}
		renderedEvents.set(key, events.length);
		// The index is mechanical: one line per session, refreshed when the title changes.
		await queueSessionIndexEntry(projectRoot, session);
	}

	return { dir };
}

/** One write chain per session so concurrent turn ends cannot interleave files. */
const writeQueues = new Map<string, Promise<void>>();

export function queueSessionArtifacts(session: Session, options: { markdown?: boolean } = {}): Promise<void> {
	const key = String(session.id);
	const previous = writeQueues.get(key) ?? Promise.resolve();
	const next = previous
		.then(() => writeSessionArtifacts(session, options).then(() => undefined))
		.catch(async (error: unknown) => {
			try {
				const projectRoot = await getProjectRoot(session.header.cwd ?? process.cwd());
				await logError(projectRoot, "session-log", error);
			} catch {
				// Diagnostics must never throw.
			}
		});
	writeQueues.set(key, next);
	return next;
}

/** Release a disposed session's queue entry and append bookkeeping after its writes settle. */
export function releaseSessionQueue(sessionId: string): void {
	const key = sessionId;
	persistedEvents.delete(key);
	renderedEvents.delete(key);
	const current = writeQueues.get(key);
	if (!current) return;
	void current.finally(() => {
		if (writeQueues.get(key) === current) writeQueues.delete(key);
	});
}
