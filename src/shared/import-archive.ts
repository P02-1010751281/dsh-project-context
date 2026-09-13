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
 *
 * A session counts as imported only once **every** artifact it should have is on
 * disk (`session.jsonl`, plus `session.md` when Markdown is enabled). The
 * canonical JSONL is written last, so an interrupted import is retried instead
 * of being reported as an existing archive that no later pass can repair.
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
		let parsed: unknown;
		try {
			parsed = JSON.parse(lines[index]!);
		} catch (error) {
			throw new Error(`event line ${index + 1} is not JSON: ${(error as Error).message}`);
		}
		// Every later pass treats an entry as an event object; `null` or an array
		// line would only fail much deeper, after the archive was half-written.
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			throw new Error(`event line ${index + 1} is not a JSON object`);
		}
		entries.push(parsed);
	}
	return {
		header: header as Record<string, unknown>,
		id: candidate.id,
		createdAt: indexTimestamp(candidate.createdAt),
		entries,
	};
}

/** Largest `Date` argument that still renders (`±8.64e15` ms, the ECMAScript limit). */
const MAX_DATE_MS = 8.64e15;

/**
 * `createdAt` feeds the index date and the Markdown header only, so a missing or
 * malformed value must not abort the import: `new Date(1e21).toISOString()`
 * throws `RangeError: Invalid time value` after the raw JSONL was already written.
 * @param value - the header's `createdAt` field as parsed.
 * @returns the timestamp, or the current time when the value is unusable.
 */
function indexTimestamp(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_DATE_MS ? value : Date.now();
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

/** One central-directory row: where the entry's data lives and how it is packed. */
interface ZipRow {
	name: string;
	method: number;
	compressedSize: number;
	localOffset: number;
}

/**
 * Walk a ZIP's central directory into rows. Sizes in the local header are zero
 * when the writer used a data descriptor (dsh's export does), so only the
 * central directory holds the real compressed size.
 * @param buffer - the whole zip file.
 * @returns one row per central-directory entry, in archive order.
 */
function listZipRows(buffer: Buffer): ZipRow[] {
	const EOCD = 0x06054b50;
	let eocd = -1;
	for (let index = buffer.length - 22; index >= 0 && index > buffer.length - 22 - 0xffff; index--) {
		if (buffer.readUInt32LE(index) === EOCD) { eocd = index; break; }
	}
	if (eocd < 0) throw new Error("not a zip archive (no end-of-central-directory record)");
	const count = buffer.readUInt16LE(eocd + 10);
	let offset = buffer.readUInt32LE(eocd + 16);
	const rows: ZipRow[] = [];
	for (let index = 0; index < count; index++) {
		if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("damaged zip central directory");
		const nameLength = buffer.readUInt16LE(offset + 28);
		const extraLength = buffer.readUInt16LE(offset + 30);
		const commentLength = buffer.readUInt16LE(offset + 32);
		rows.push({
			name: buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"),
			method: buffer.readUInt16LE(offset + 10),
			compressedSize: buffer.readUInt32LE(offset + 20),
			localOffset: buffer.readUInt32LE(offset + 42),
		});
		offset += 46 + nameLength + extraLength + commentLength;
	}
	return rows;
}

/** Inflate one row's data. Deflate and stored entries are supported; anything else is rejected. */
function inflateRow(buffer: Buffer, row: ZipRow): Buffer {
	const localNameLength = buffer.readUInt16LE(row.localOffset + 26);
	const localExtraLength = buffer.readUInt16LE(row.localOffset + 28);
	const dataStart = row.localOffset + 30 + localNameLength + localExtraLength;
	const data = buffer.subarray(dataStart, dataStart + row.compressedSize);
	if (row.method === 0) return Buffer.from(data);
	if (row.method === 8) return inflateRawSync(data);
	throw new Error(`unsupported zip compression method ${row.method} for ${row.name}`);
}

/**
 * Minimal ZIP reader: locate the entry through the central directory, then
 * inflate the entry data.
 * @param buffer - the whole zip file.
 * @param entryName - exact central-directory name to read.
 * @returns the entry's bytes, or `undefined` when no entry has that name.
 */
export function readZipEntry(buffer: Buffer, entryName: string): Buffer | undefined {
	const row = listZipRows(buffer).find((candidate) => candidate.name === entryName);
	return row === undefined ? undefined : inflateRow(buffer, row);
}

/**
 * Root-level session-log entry names dsh exports use: `session.jsonl` is
 * generation 0, later format generations are `session.v<N>.jsonl`
 * (`sessionFormatLogFilename(SESSION_FORMAT_VERSION)`, currently `session.v3.jsonl`).
 */
const SESSION_LOG_ENTRY = /^session(?:\.v(\d+))?\.jsonl$/;

/**
 * Pick the newest session log in a dsh export zip. Only the archive root counts:
 * `subagents/<id>/session.vN.jsonl` entries belong to delegated children, not to
 * the exported session itself.
 * @param buffer - the whole zip file.
 * @returns the canonical JSONL bytes, or `undefined` when no root session log exists.
 */
export function readZipSessionLog(buffer: Buffer): Buffer | undefined {
	let best: ZipRow | undefined;
	let bestGeneration = -1;
	for (const row of listZipRows(buffer)) {
		if (row.name.includes("/")) continue;
		const match = SESSION_LOG_ENTRY.exec(row.name);
		if (match === null) continue;
		// `session.jsonl` is generation 0; prefer the highest generation present.
		const generation = match[1] === undefined ? 0 : Number(match[1]);
		if (generation > bestGeneration) {
			bestGeneration = generation;
			best = row;
		}
	}
	return best === undefined ? undefined : inflateRow(buffer, best);
}

/** Read one archive file (`.zip` holding the exported session log, or a bare `.jsonl`). */
export async function readArchiveFile(file: string): Promise<string> {
	const buffer = await readFile(file);
	if (file.toLowerCase().endsWith(".zip")) {
		const entry = readZipSessionLog(buffer);
		if (!entry) throw new Error("zip does not contain a session log at its root (session.jsonl / session.vN.jsonl)");
		return entry.toString("utf8");
	}
	return buffer.toString("utf8");
}

/** Write one parsed archive into the project's session-log layout and index it. */
export async function importSessionJsonl(text: string, options: ImportOptions): Promise<ImportOutcome> {
	const archive = parseSessionJsonl(text);
	const { id, entries } = archive;
	const safe = safeSessionId(id);
	const dir = path.join(logsDir(options.projectRoot), safe);
	const rawPath = path.join(dir, "session.jsonl");
	const markdownPath = path.join(dir, "session.md");
	const withMarkdown = options.markdown ?? true;
	await ensureLogsIgnored(options.projectRoot);

	// Render before writing anything: a rendering failure must not leave a raw
	// JSONL behind that later runs then report as an already-imported session.
	const markdown = withMarkdown ? renderSessionMarkdown(markdownHeaderView(archive), entries) : undefined;

	// "Imported" means every artifact is present. Testing the JSONL alone would
	// treat a half-written import (raw copy present, Markdown/INDEX missing) as
	// done, and no later pass could ever repair it.
	const exists = await pathExists(rawPath) && (!withMarkdown || await pathExists(markdownPath));
	if (exists && !options.replace) return { id, status: "skipped", dir, entries: entries.length };

	if (markdown !== undefined) await writeAtomic(markdownPath, markdown);
	await queueIndexLine(
		options.projectRoot,
		safe,
		sessionIndexLineFrom(id, archive.createdAt, sessionTitleFromEntries(entries)),
	);
	// Verbatim copy, written last so its presence marks a complete import: the
	// archive is evidence, so the canonical JSONL keeps the source bytes (headers
	// of older exports carry fields later versions dropped, e.g. `delegationDepth`);
	// only the trailing newline is normalized to one.
	await writeAtomic(rawPath, text.endsWith("\n") ? text : `${text}\n`);
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
