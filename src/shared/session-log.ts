/**
 * Session artifact writer: raw event JSONL plus a full Markdown rendering, per
 * session, under `<project>/.agents/memory/session-logs/<session-id>/`.
 * Ported from pi's `session-log.ts`, adapted to dsh's event-sourced sessions.
 */

import path from "node:path";
import type { Session } from "@deepseek-ai/dsh-session";
import {
	getProjectRoot,
	logError,
	logsDir,
	safeSessionId,
	writeAtomic,
} from "./project-state.js";

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

function sessionMarkdown(session: Session, header: SessionFileHeader, raw: string): string {
	const entries = session.snapshotEvents();
	const sections = entries.map((entry, index) => {
		const timestamp = entry.time ? new Date(entry.time).toISOString() : "unknown time";
		return `### ${index + 1}. ${entry.type} — ${timestamp}\n\n~~~~json\n${JSON.stringify(entry, null, 2)}\n~~~~`;
	});

	return [
		`# DSH Session ${String(session.id)}`,
		"",
		`- Started: ${new Date(header.createdAt).toISOString()}`,
		`- Project: ${header.cwd ?? "unknown"}`,
		"- Raw log: [session.jsonl](./session.jsonl)",
		`- Entries: ${entries.length}`,
		"",
		"The JSONL file is canonical. This Markdown rendering intentionally preserves every session entry, including tool calls, tool results, thinking blocks, compaction records, model changes, and extension entries.",
		"",
		...sections,
		"",
		"<!-- raw-log-bytes: " + Buffer.byteLength(raw, "utf8") + " -->",
		"",
	].join("\n");
}

export async function writeSessionArtifacts(session: Session, options: { markdown?: boolean } = {}): Promise<{ dir: string }> {
	const cwd = session.header.cwd ?? process.cwd();
	const projectRoot = await getProjectRoot(cwd);
	const id = safeSessionId(String(session.id));
	const dir = path.join(logsDir(projectRoot), id);

	const header = fileHeader(session);
	const events = session.snapshotEvents();
	const raw = [JSON.stringify(header), ...events.map((entry) => JSON.stringify(entry))].join("\n") + "\n";

	await writeAtomic(path.join(dir, "session.jsonl"), raw);
	if (options.markdown ?? true) await writeAtomic(path.join(dir, "session.md"), sessionMarkdown(session, header, raw));
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

/** Release a disposed session's queue entry after its writes settle. */
export function releaseSessionQueue(sessionId: string): void {
	const key = sessionId;
	const current = writeQueues.get(key);
	if (!current) return;
	void current.finally(() => {
		if (writeQueues.get(key) === current) writeQueues.delete(key);
	});
}
