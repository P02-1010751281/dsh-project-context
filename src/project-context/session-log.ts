/**
 * Session artifact writer: raw event JSONL plus a full Markdown rendering, per
 * session, under `<project>/.agents/memory/session-logs/<session-id>/`.
 * Ported from pi's `session-log.ts`, adapted to dsh's event-sourced sessions.
 *
 * Both files are append-only within a process run: after the initial full
 * write, each flush appends only the new entries instead of rebuilding the
 * log, so a long session does not rewrite itself on every turn.
 */

import { randomUUID } from "node:crypto";
import { appendFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Session } from "@deepseek-ai/dsh-session";
import {
	cachedProjectRoot,
	getProjectRoot,
	getProjectRootSync,
	logError,
	logsDir,
	pathExists,
	readOptional,
	safeSessionId,
	writeAtomic,
} from "../shared/project-state.js";
import { queueSessionIndexEntry } from "./session-index.js";

export interface SessionFileHeader {
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

/**
 * Render a stored timestamp for display. The value is cosmetic, so an unusable
 * one (absent, zero, or outside the `Date` range — e.g. a corrupt archive line)
 * must degrade to a label instead of aborting the whole render with
 * `RangeError: Invalid time value`.
 *
 * Both the per-entry sections and the header's `Started` line go through this:
 * the header used to call `new Date(header.createdAt).toISOString()` directly, so
 * the one value that can legitimately be missing (an archive whose header
 * predates the field) aborted the render of the whole session.
 * @param time - the timestamp as stored.
 * @returns an ISO string, or `unknown time`.
 */
function displayTime(time: number | undefined): string {
	if (time === undefined || time === 0) return "unknown time";
	const renderable = Number.isFinite(time) && Math.abs(time) <= 8.64e15;
	return renderable ? new Date(time).toISOString() : "unknown time";
}

function markdownSection(entry: SessionEntry, index: number): string {
	const timestamp = displayTime(entry.time);
	return `### ${index + 1}. ${entry.type} — ${timestamp}\n\n~~~~json\n${JSON.stringify(entry, null, 2)}\n~~~~\n`;
}

function markdownSections(entries: readonly unknown[], offset: number): string {
	return entries.map((entry, index) => markdownSection(entry as SessionEntry, offset + index)).join("\n");
}

/**
 * Full Markdown rendering of one session. Shared by the live writer and the
 * archive backfill (`import-archive.ts`) so both produce byte-identical output.
 */
export function renderSessionMarkdown(header: SessionFileHeader, entries: readonly unknown[]): string {
	return `${markdownHeader(header)}
${markdownSections(entries, 0)}`.replace(/\n+$/, "") + "\n";
}

function markdownHeader(header: SessionFileHeader): string {
	return [
		`# DSH Session ${header.id}`,
		"",
		`- Started: ${displayTime(header.createdAt)}`,
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
/** Identity of an artifact right after this process wrote it. */
interface ArtifactStamp {
	/** Byte length. */
	readonly size: number;
	/** Inode, which changes when the file is replaced rather than rewritten. */
	readonly ino: number;
	/** Modification time, which changes on any external write. */
	readonly mtimeMs: number;
}

/**
 * Stamp each artifact had after this process wrote it. An append is only safe
 * while the file on disk is still exactly what this process left there:
 * `scripts/import-archives.mjs --replace` (or any external rewrite) of a live
 * session's JSONL would otherwise make the next append concatenate onto a file
 * that no longer holds the prefix the cursor assumes.
 */
const persistedStamps = new Map<string, ArtifactStamp>();
const renderedStamps = new Map<string, ArtifactStamp>();
const logsIgnored = new Set<string>();

/**
 * Stamp one artifact as this process just wrote it.
 * @param file - artifact path.
 * @returns the stamp, or `undefined` when the file cannot be stat'ed.
 */
async function stampOf(file: string): Promise<ArtifactStamp | undefined> {
	try {
		const info = await stat(file);
		return { size: info.size, ino: info.ino, mtimeMs: info.mtimeMs };
	} catch {
		return undefined;
	}
}

/**
 * Whether this file is still the artifact the cursor was recorded against.
 * Size alone would accept a same-length external rewrite, so inode and mtime
 * are part of the identity too.
 * @param file - artifact path.
 * @param expected - stamp recorded after the last write, if any.
 * @returns true when an append may extend the existing file.
 */
async function appendableAt(file: string, expected: ArtifactStamp | undefined): Promise<boolean> {
	if (expected === undefined) return false;
	const current = await stampOf(file);
	return current !== undefined && current.size === expected.size && current.ino === expected.ino && current.mtimeMs === expected.mtimeMs;
}

/** Keep local transcripts out of version control without touching project ignore files. */
export async function ensureLogsIgnored(projectRoot: string): Promise<void> {
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
	const key = sessionKey(session);
	const rawPath = path.join(dir, "session.jsonl");

	const persisted = persistedEvents.get(key);
	if (persisted !== undefined && persisted > 0 && persisted <= events.length && await appendableAt(rawPath, persistedStamps.get(key))) {
		const fresh = events.slice(persisted).map((entry) => JSON.stringify(entry));
		// A flush that adds no event must write nothing: an empty payload would
		// append a bare newline on every call and grow the canonical log forever.
		if (fresh.length > 0) {
			await appendFile(rawPath, `${fresh.join("\n")}\n`, "utf8");
			const stamp = await stampOf(rawPath);
			if (stamp !== undefined) persistedStamps.set(key, stamp);
		}
	} else {
		// No cursor, a shorter event list, or a file this process no longer owns
		// (deleted, truncated, or rewritten by an external tool): rebuild it.
		//
		// A file holding **more** records than this session is about to write means somebody else's
		// events are in there — a backfill with `--replace`, another host, a hand edit — and rebuilding
		// would drop them with no trace. Keep a byte-for-byte recovery copy first (a `.broken-*`
		// sibling, which the session-logs ignore file already covers) and say so in the project log.
		// `persisted > events.length` excludes the one case that is not a foreign writer: this
		// process's own cursor holding more events than the session does now. dsh cannot produce that
		// by compaction — `Session`'s log is append-only (`packages/core/session/src/index.ts`:
		// `snapshotEvents()` returns that log and `append` only pushes onto it), and a disposed
		// session's cursor is dropped by `releaseSessionQueue` — so the exclusion is defensive, not a
		// live path.
		const onDisk = await readOptional(rawPath);
		const onDiskLines = onDisk.trim() ? onDisk.trimEnd().split("\n").length : 0;
		const ownLines = events.length + 1;
		if (onDiskLines > ownLines && !(persisted !== undefined && persisted > events.length)) {
			const recovery = `${rawPath}.broken-${randomUUID().slice(0, 8)}`;
			await writeAtomic(recovery, onDisk).catch(() => undefined);
			await logError(projectRoot, "session-log", `rebuilt ${rawPath} over a longer file: ${onDiskLines - ownLines} line(s) this session does not have were kept at ${recovery}`);
		}
		const text = `${[JSON.stringify(header), ...events.map((entry) => JSON.stringify(entry))].join("\n")}\n`;
		await writeAtomic(rawPath, text);
		const stamp = await stampOf(rawPath);
		if (stamp !== undefined) persistedStamps.set(key, stamp);
	}
	persistedEvents.set(key, events.length);

	if (options.markdown ?? true) {
		const markdownPath = path.join(dir, "session.md");
		const rendered = renderedEvents.get(key);
		if (rendered !== undefined && rendered > 0 && rendered <= events.length && await appendableAt(markdownPath, renderedStamps.get(key))) {
			// Same rule as the JSONL: no new sections means no write at all.
			const sections = markdownSections(events.slice(rendered), rendered);
			if (sections.length > 0) {
				await appendFile(markdownPath, `\n${sections}`, "utf8");
				const stamp = await stampOf(markdownPath);
				if (stamp !== undefined) renderedStamps.set(key, stamp);
			}
		} else {
			// Sections already end with a newline; keep exactly one at EOF so the
			// append path leaves a single blank line between flushes.
			const text = renderSessionMarkdown(header, events);
			await writeAtomic(markdownPath, text);
			const stamp = await stampOf(markdownPath);
			if (stamp !== undefined) renderedStamps.set(key, stamp);
		}
		renderedEvents.set(key, events.length);
		// The index is mechanical: one line per session, refreshed when the title changes.
		await queueSessionIndexEntry(projectRoot, session);
	}

	return { dir };
}

/**
 * Cursor/queue key for one session's artifacts. The project root is part of the key because a
 * session id is unique only inside its own harness store: two projects could otherwise share a
 * cursor and have one project's stamps judged against the other project's file.
 * Synchronous by design (the writer's queue cannot await git): the root cache is warm whenever a
 * session has actually written, and `getProjectRootSync` fills it otherwise.
 */
function sessionKey(session: Session): string {
	const cwd = session.header.cwd ?? process.cwd();
	const root = cachedProjectRoot(cwd) ?? getProjectRootSync(cwd);
	return `${root}\u0000${safeSessionId(String(session.id))}`;
}

/** One write chain per session so concurrent turn ends cannot interleave files. */
const writeQueues = new Map<string, Promise<void>>();

export function queueSessionArtifacts(session: Session, options: { markdown?: boolean } = {}): Promise<void> {
	const key = sessionKey(session);
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
export function releaseSessionQueue(session: Session): void {
	const key = sessionKey(session);
	persistedEvents.delete(key);
	renderedEvents.delete(key);
	persistedStamps.delete(key);
	renderedStamps.delete(key);
	const current = writeQueues.get(key);
	if (!current) return;
	void current.finally(() => {
		if (writeQueues.get(key) === current) writeQueues.delete(key);
	});
}
