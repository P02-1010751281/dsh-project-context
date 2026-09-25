/**
 * Reading one `session.jsonl` (or pi's JSONL): the header, the events, and the index metadata
 * derived from them. Both the file and the zip path parse through here.
 */

import { type SessionFileHeader } from "./session-log.js";

export interface ParsedArchive {
	/** Header exactly as parsed — never rewritten: unknown fields (e.g. `delegationDepth`) are preserved. */
	header: Record<string, unknown>;
	/** Session id from the header (the only field required for archiving). */
	id: string;
	/** Harness that wrote the header, when it says: dsh writes `harness`, pi writes none. */
	harness: "dsh" | "pi" | "unknown";
	/** Header timestamp, or `Date.now()` when the archive predates the field (index display only). */
	createdAt: number;
	entries: unknown[];
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
	const candidate = header as {
		type?: unknown;
		id?: unknown;
		createdAt?: unknown;
		timestamp?: unknown;
		version?: unknown;
		cwd?: unknown;
		harness?: unknown;
	};
	if (candidate?.type !== "session" || typeof candidate.id !== "string" || candidate.id === "") {
		throw new Error('header is not a session header (need {"type":"session","id":…})');
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
		harness: harnessOf(candidate),
		createdAt: indexTimestamp(candidate.createdAt) ?? indexTimestamp(candidate.timestamp) ?? Date.now(),
		entries,
	};
}

/**
 * Which harness wrote the archive. dsh stamps `harness`; pi's header has no such
 * field, so its epoch-ms `createdAt` is the only other positive signal. Used for
 * display and to keep the Markdown header honest — never to gate the import.
 * @param header - the parsed header.
 * @returns the harness name, or `unknown` for a header that predates the field.
 */
function harnessOf(header: { harness?: unknown; createdAt?: unknown }): "dsh" | "pi" | "unknown" {
	if (header.harness === "dsh" || header.harness === "pi") return header.harness;
	return typeof header.createdAt === "number" && Number.isFinite(header.createdAt) ? "dsh" : "unknown";
}

/** Largest `Date` argument that still renders (`±8.64e15` ms, the ECMAScript limit). */
const MAX_DATE_MS = 8.64e15;

/**
 * Normalize one header start-time field to epoch ms.
 *
 * dsh writes `createdAt` as a number, pi writes `timestamp` as an ISO string.
 * Only accepting the number made every pi archive fall back to the import time,
 * so a session from 2026-09-12 was indexed (and rendered) as if it had started on
 * the day of the import — a wrong fact in the project's own history, which the
 * index date is the only record of.
 *
 * `createdAt` feeds the index date and the Markdown header only, so a missing or
 * malformed value must not abort the import: `new Date(1e21).toISOString()`
 * throws `RangeError: Invalid time value` after the raw JSONL was already written.
 * @param value - one start-time field as parsed.
 * @returns epoch ms, or `undefined` when the value is absent or unusable.
 */
function indexTimestamp(value: unknown): number | undefined {
	if (typeof value === "number") {
		return Number.isFinite(value) && Math.abs(value) <= MAX_DATE_MS ? value : undefined;
	}
	if (typeof value === "string" && value.trim()) {
		const parsed = Date.parse(value);
		if (Number.isFinite(parsed) && Math.abs(parsed) <= MAX_DATE_MS) return parsed;
	}
	return undefined;
}

/**
 * Build the Markdown header for a parsed archive.
 *
 * The `harness` field is typed as dsh's literal, but this function is the one
 * place the two formats meet, and writing `"dsh"` into a pi session's header
 * would be a false statement about where the log came from. The value is
 * display-only (nothing reads it back) and dsh archives are unaffected.
 */
export function markdownHeaderView(archive: ParsedArchive): SessionFileHeader {
	const cwd = archive.header.cwd;
	return {
		type: "session",
		harness: archive.harness,
		id: archive.id,
		version: typeof archive.header.version === "number" ? archive.header.version : 0,
		createdAt: archive.createdAt,
		cwd: typeof cwd === "string" ? cwd : null,
		isSeeded: archive.header.isSeeded === true,
	} as SessionFileHeader;
}
