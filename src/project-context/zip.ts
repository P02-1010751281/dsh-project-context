/**
 * Reading a dsh session export (`.zip`): the central directory, the raw-deflate entries, and
 * the one entry that carries `session.jsonl`.
 */

import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";

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
