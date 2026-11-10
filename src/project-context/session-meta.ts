/**
 * Per-session metadata: the truth source `session-logs/INDEX.md` is generated from.
 *
 * The index used to be the only record of a session (one appended line), which made two states
 * unwritable-but-possible: a directory with no line (a migration, an install that never ran the
 * archive path) and a line with no directory (a purged archive). Both disappear once the line is
 * a projection: what is on disk is what the index shows. `date` and `title` therefore live here
 * rather than only in the rendered line, because regenerating the line from `session.jsonl` would
 * mean opening every archive on every write.
 */

import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { readOptional, safeSessionId, writeAtomic } from "../shared/project-state.js";

/** `session` for an ordinary archive, `subagent` for a delegated child, `handoff` for a successor. */
export type SessionKind = "session" | "subagent" | "handoff";

export interface SessionMeta {
	/** Safe session id — the directory name. */
	id: string;
	/** `YYYY-MM-DD`; the index date column. */
	date: string;
	title: string;
	kind?: SessionKind;
	/** The session this one continued, written by the handoff that created it. */
	parentId?: string;
	/** Task slug this session is bound to; see the task dimension. */
	task?: string;
}

/** The metadata file for one session directory. */
export function sessionMetaFile(sessionDir: string): string {
	return path.join(sessionDir, "meta.json");
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * Read one session's metadata, or `undefined` when there is none.
 *
 * A malformed file reads as absent so the caller can rebuild it from the archive rather than
 * failing the whole index write: one corrupt `meta.json` must not freeze the navigation for every
 * other session. The rebuild is derived from the archive, which is the evidence.
 */
export async function readSessionMeta(sessionDir: string): Promise<SessionMeta | undefined> {
	const raw = await readOptional(sessionMetaFile(sessionDir));
	if (!raw.trim()) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (typeof parsed !== "object" || parsed === null) return undefined;
	const record = parsed as Record<string, unknown>;
	const id = text(record.id);
	const date = text(record.date);
	if (!id || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
	const kind = text(record.kind);
	return {
		id: safeSessionId(id),
		date,
		title: typeof record.title === "string" ? record.title : "",
		...(kind === "session" || kind === "subagent" || kind === "handoff" ? { kind } : {}),
		...(text(record.parentId) ? { parentId: safeSessionId(text(record.parentId)!) } : {}),
		...(text(record.task) ? { task: text(record.task)! } : {}),
	};
}

/**
 * Write one session's metadata, creating its directory when it does not exist yet.
 *
 * The mkdir is what lets the index be written before the archive bytes: the import path records the
 * line first and copies `session.jsonl` last (its presence is the completeness marker), so the
 * metadata has to be able to land in an as-yet-empty directory. Writing it after the copy instead
 * would mean a crash between the two leaves a session on disk with no row, which is the state this
 * batch exists to make impossible.
 */
export async function writeSessionMeta(sessionDir: string, meta: SessionMeta): Promise<void> {
	await mkdir(sessionDir, { recursive: true });
	await writeAtomic(sessionMetaFile(sessionDir), `${JSON.stringify(meta, undefined, "\t")}\n`);
}

/** Whether a path is a directory; a missing path and a file both read as `false`. */
export async function isDirectory(target: string): Promise<boolean> {
	try {
		return (await stat(target)).isDirectory();
	} catch {
		return false;
	}
}
