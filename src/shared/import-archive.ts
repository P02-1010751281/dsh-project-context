/**
 * Archive backfill (pass ① for sessions that ended before this plugin existed).
 *
 * The live archive path mirrors a running dsh session (`session-log.ts`). This
 * module admits the same artifacts from a **static** source instead: a
 * `session.jsonl` file (first line header, one event per line) or a `.zip` that
 * contains one — the shape dsh's own session export produces.
 *
 * Mechanical by design: no model call, byte-identical canonical JSONL, the same
 * Markdown rendering and the same `INDEX.md` line the live path writes, so
 * later passes (consolidation, autolearn backtracking, handoff pointers) cannot
 * tell a backfilled session from a live one.
 *
 * Idempotent: an already-imported session is skipped unless `replace` is set,
 * so re-running over a growing archive directory is safe.
 */

import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import path from "node:path";
import {
	logsDir,
	pathExists,
	readOptional,
	safeSessionId,
	writeAtomic,
} from "./project-state.js";
import {
	ensureLogsIgnored,
	renderSessionMarkdown,
	type SessionFileHeader,
} from "./session-log.js";
import {
	queueIndexLine,
	sessionIndexLineFrom,
	sessionTitleFromEntries,
} from "./session-index.js";

export interface ParsedArchive {
	/** Header exactly as parsed — never rewritten: unknown fields (e.g. `delegationDepth`) are preserved. */
	header: Record<string, unknown>;
	/** Session id from the header (the only field required for archiving). */
	id: string;
	/** Header timestamp, or `Date.now()` when the archive predates the field (index display only). */
	createdAt: number;
	entries: unknown[];
}

export interface ImportOptions {
	/** Project root whose `.agents/memory/session-logs/` receives the archive. */
	projectRoot: string;
	/** Render `session.md` next to the canonical JSONL (default true). */
	markdown?: boolean;
	/** Overwrite an already-imported session instead of skipping it. */
	replace?: boolean;
}

export interface ImportOutcome {
	/** Session id taken from the archive header. */
	id: string;
	/** `created` wrote the artifacts, `skipped` found an existing copy, `failed` carried an error. */
	status: "created" | "skipped" | "failed";
	/** Absolute directory of the session artifacts (absent when parsing failed). */
	dir?: string;
	entries?: number;
	error?: string;
	/** Archive file this outcome came from. */
	source?: string;
}

/**
 * Parse a canonical `session.jsonl`: a `type: "session"` header line followed
 * by one event per line. Blank lines are ignored; a malformed header or a
 * malformed event line is a hard error so a bad archive cannot be archived as
 * if it were healthy.
 */
export function parseSessionJsonl(text: string): ParsedArchive {
	const lines = text.split("\n").filter((line) => line.trim());
	if (lines.length === 0) throw new Error("archive is empty");
	let header: unknown;
	try {
		header = JSON.parse(lines[0]!);
	} catch (error) {
		throw new Error(`header is not JSON: ${(error as Error).message}`);
	}
	const candidate = header as { type?: unknown; id?: unknown; createdAt?: unknown; version?: unknown; cwd?: unknown };
	if (candidate?.type !== "session" || typeof candidate.id !== "string" || candidate.id === "") {
		throw new Error('header is not a dsh session header (need {"type":"session","id":…})');
	}
	const entries: unknown[] = [];
	for (let index = 1; index < lines.length; index++) {
		try {
			entries.push(JSON.parse(lines[index]!));
		} catch (error) {
			throw new Error(`event line ${index + 1} is not JSON: ${(error as Error).message}`);
		}
	}
	return {
		header: header as Record<string, unknown>,
		id: candidate.id,
		createdAt: typeof candidate.createdAt === "number" ? candidate.createdAt : Date.now(),
		entries,
	};
}

/** Minimal header view for the Markdown rendering (display only — the canonical JSONL stays verbatim). */
function markdownHeaderView(archive: ParsedArchive): SessionFileHeader {
	const cwd = archive.header.cwd;
	return {
		type: "session",
		harness: "dsh",
		id: archive.id,
		version: typeof archive.header.version === "number" ? archive.header.version : 0,
		createdAt: archive.createdAt,
		cwd: typeof cwd === "string" ? cwd : null,
		isSeeded: archive.header.isSeeded === true,
	};
}

/**
 * Minimal ZIP reader: locate the entry through the central directory (sizes in
 * the local header are zero when the writer used a data descriptor, which dsh's
 * export does), then inflate the entry data. Deflate and stored entries are
 * supported; anything else is rejected with a clear message.
 */
export function readZipEntry(buffer: Buffer, entryName: string): Buffer | undefined {
	const EOCD = 0x06054b50;
	let eocd = -1;
	for (let index = buffer.length - 22; index >= 0 && index > buffer.length - 22 - 0xffff; index--) {
		if (buffer.readUInt32LE(index) === EOCD) { eocd = index; break; }
	}
	if (eocd < 0) throw new Error("not a zip archive (no end-of-central-directory record)");
	const count = buffer.readUInt16LE(eocd + 10);
	let offset = buffer.readUInt32LE(eocd + 16);
	for (let index = 0; index < count; index++) {
		if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("damaged zip central directory");
		const method = buffer.readUInt16LE(offset + 10);
		const compressedSize = buffer.readUInt32LE(offset + 20);
		const nameLength = buffer.readUInt16LE(offset + 28);
		const extraLength = buffer.readUInt16LE(offset + 30);
		const commentLength = buffer.readUInt16LE(offset + 32);
		const localOffset = buffer.readUInt32LE(offset + 42);
		const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
		if (name === entryName) {
			const localNameLength = buffer.readUInt16LE(localOffset + 26);
			const localExtraLength = buffer.readUInt16LE(localOffset + 28);
			const dataStart = localOffset + 30 + localNameLength + localExtraLength;
			const data = buffer.subarray(dataStart, dataStart + compressedSize);
			if (method === 0) return Buffer.from(data);
			if (method === 8) return inflateRawSync(data);
			throw new Error(`unsupported zip compression method ${method} for ${name}`);
		}
		offset += 46 + nameLength + extraLength + commentLength;
	}
	return undefined;
}

/** Read one archive file (`.zip` holding `session.jsonl`, or a bare `.jsonl`). */
export async function readArchiveFile(file: string): Promise<string> {
	const buffer = await readFile(file);
	if (file.toLowerCase().endsWith(".zip")) {
		const entry = readZipEntry(buffer, "session.jsonl");
		if (!entry) throw new Error("zip does not contain session.jsonl");
		return entry.toString("utf8");
	}
	return buffer.toString("utf8");
}

/** Write one parsed archive into the project's session-log layout and index it. */
export async function importSessionJsonl(text: string, options: ImportOptions): Promise<ImportOutcome> {
	const archive = parseSessionJsonl(text);
	const { id, entries } = archive;
	const dir = path.join(logsDir(options.projectRoot), safeSessionId(id));
	const rawPath = path.join(dir, "session.jsonl");
	await ensureLogsIgnored(options.projectRoot);

	const exists = await pathExists(rawPath);
	if (exists && !options.replace) return { id, status: "skipped", dir, entries: entries.length };

	// Verbatim copy: the archive is evidence, so the canonical JSONL keeps the
	// source bytes (headers of older exports carry fields later versions dropped,
	// e.g. `delegationDepth`); only the trailing newline is normalized to one.
	await writeAtomic(rawPath, text.endsWith("\n") ? text : `${text}\n`);
	if (options.markdown ?? true) {
		await writeAtomic(path.join(dir, "session.md"), renderSessionMarkdown(markdownHeaderView(archive), entries));
	}
	await queueIndexLine(
		options.projectRoot,
		safeSessionId(id),
		sessionIndexLineFrom(id, archive.createdAt, sessionTitleFromEntries(entries)),
	);
	return { id, status: "created", dir, entries: entries.length };
}

/** Import one archive file; parse/write failures come back as `failed`, never thrown. */
export async function importArchiveFile(file: string, options: ImportOptions): Promise<ImportOutcome> {
	try {
		const outcome = await importSessionJsonl(await readArchiveFile(file), options);
		return { ...outcome, source: file };
	} catch (error) {
		return { id: path.basename(file), status: "failed", source: file, error: (error as Error).message };
	}
}

/** Import a batch of archives (files passed in order; no ordering assumption inside). */
export async function importArchiveFiles(files: readonly string[], options: ImportOptions): Promise<ImportOutcome[]> {
	const outcomes: ImportOutcome[] = [];
	for (const file of files) outcomes.push(await importArchiveFile(file, options));
	return outcomes;
}

/** Existing archive ids for a project (the canonical JSONL is the marker). */
export async function archivedSessionIds(projectRoot: string): Promise<string[]> {
	const index = await readOptional(path.join(logsDir(projectRoot), "INDEX.md"));
	return index
		.split("\n")
		.map((line) => /^- \[([^\]]+)\]\(/.exec(line.trim())?.[1])
		.filter((id): id is string => typeof id === "string");
}
