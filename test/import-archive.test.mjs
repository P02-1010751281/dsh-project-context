/**
 * Unit tests for archive backfill: JSONL parsing/validation, the minimal ZIP
 * reader (including dsh's own export shape: local header with zeroed sizes plus
 * a data descriptor, real sizes only in the central directory), and the
 * idempotent import that writes session.jsonl + session.md + INDEX.md.
 *
 * Run `pnpm test` (builds lib/ first).
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import {
	importSessionJsonl,
	importArchiveFile,
	parseSessionJsonl,
	readZipEntry,
} from "../lib/shared/import-archive.js";

const HEADER = {
	type: "session",
	harness: "dsh",
	id: "11111111-2222-3333-4444-555555555555",
	version: 3,
	createdAt: Date.UTC(2026, 8, 9, 21, 9),
	cwd: "/tmp/project",
	isSeeded: false,
};

const EVENTS = [
	{ type: "user/message", time: Date.UTC(2026, 8, 9, 21, 10), data: { source: { kind: "user" }, content: [{ type: "text", text: "整理 log 并适配 DSH 0.1.5" }] } },
	{ type: "assistant/message", time: Date.UTC(2026, 8, 9, 21, 11), data: { message: { content: [{ type: "text", text: "好" }] } } },
];

const JSONL = `${[JSON.stringify(HEADER), ...EVENTS.map((event) => JSON.stringify(event))].join("\n")}\n`;

/**
 * Build a ZIP the way dsh exports sessions do: flag bit 3 set, sizes zero in
 * the local header, real sizes in the central directory, deflate compression.
 */
function buildZip(name, content) {
	const raw = Buffer.from(content, "utf8");
	const deflated = deflateRawSync(raw);
	const nameBytes = Buffer.from(name, "utf8");
	const local = Buffer.alloc(30);
	local.writeUInt32LE(0x04034b50, 0);
	local.writeUInt16LE(20, 4);
	local.writeUInt16LE(0x0008, 6); // data descriptor
	local.writeUInt16LE(8, 8); // deflate
	local.writeUInt16LE(0, 10);
	local.writeUInt16LE(0, 12);
	local.writeUInt32LE(0, 14); // crc32 unknown at this point
	local.writeUInt32LE(0, 18); // csize = 0 (descriptor carries the real value)
	local.writeUInt32LE(0, 22); // usize = 0
	local.writeUInt16LE(nameBytes.length, 26);
	local.writeUInt16LE(0, 28);
	const descriptor = Buffer.alloc(16);
	descriptor.writeUInt32LE(0x08074b50, 0);
	descriptor.writeUInt32LE(0, 4);
	descriptor.writeUInt32LE(deflated.length, 8);
	descriptor.writeUInt32LE(raw.length, 12);
	const body = Buffer.concat([local, nameBytes, deflated, descriptor]);

	const central = Buffer.alloc(46);
	central.writeUInt32LE(0x02014b50, 0);
	central.writeUInt16LE(20, 4);
	central.writeUInt16LE(20, 6);
	central.writeUInt16LE(0x0008, 8);
	central.writeUInt16LE(8, 10);
	central.writeUInt32LE(0, 16);
	central.writeUInt32LE(deflated.length, 20); // real sizes here
	central.writeUInt32LE(raw.length, 24);
	central.writeUInt16LE(nameBytes.length, 28);
	central.writeUInt32LE(0, 42); // local header offset
	const directory = Buffer.concat([central, nameBytes]);

	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(1, 8);
	eocd.writeUInt16LE(1, 10);
	eocd.writeUInt32LE(directory.length, 12);
	eocd.writeUInt32LE(body.length, 16);
	return Buffer.concat([body, directory, eocd]);
}

test("parseSessionJsonl accepts a canonical archive", () => {
	const parsed = parseSessionJsonl(JSONL);
	assert.equal(parsed.id, HEADER.id);
	assert.equal(parsed.createdAt, HEADER.createdAt);
	assert.equal(parsed.entries.length, 2);
});

test("the canonical JSONL is copied verbatim, unknown header fields included", async () => {
	// Older exports carry fields later versions dropped, and non-ASCII arrives
	// escaped; a parse/stringify round-trip would silently rewrite both.
	const legacyHeader = '{"type":"session","version":0,"id":"22222222-3333-4444-5555-666666666666","createdAt":1787076315465,"cwd":"D:\\\\Projects\\\\DSH-AV","delegationDepth":0,"agentPreset":"anchored-standard"}';
	const legacy = `${legacyHeader}\n{"type":"user/message","data":{"source":{"kind":"user"},"content":[{"type":"text","text":"\\u4e2d\\u6587测试"}]}}`;
	const project = await mkdtemp(path.join(tmpdir(), "dsh-archives-verbatim-"));
	const outcome = await importSessionJsonl(legacy, { projectRoot: project });
	assert.equal(outcome.status, "created");
	const raw = await readFile(path.join(project, ".agents", "memory", "session-logs", outcome.id, "session.jsonl"), "utf8");
	assert.equal(raw, `${legacy}\n`); // only the missing trailing newline was added
	assert.match(raw, /"delegationDepth":0/);
	assert.match(raw, /\\u4e2d\\u6587/); // still escaped, not decoded
});

test("parseSessionJsonl rejects non-session and malformed archives", () => {
	assert.throws(() => parseSessionJsonl(""), /empty/);
	assert.throws(() => parseSessionJsonl('{"type":"other"}'), /not a dsh session header/);
	assert.throws(() => parseSessionJsonl("not json\n"), /header is not JSON/);
	assert.throws(() => parseSessionJsonl(`${JSON.stringify(HEADER)}\n{oops}`), /event line 2 is not JSON/);
});

test("readZipEntry reads the entry through the central directory", () => {
	const zip = buildZip("session.jsonl", JSONL);
	assert.equal(readZipEntry(zip, "session.jsonl").toString("utf8"), JSONL);
	assert.equal(readZipEntry(zip, "missing.jsonl"), undefined);
	assert.throws(() => readZipEntry(Buffer.from("not a zip"), "session.jsonl"), /not a zip archive/);
});

test("importSessionJsonl writes JSONL, Markdown and one index line, then skips a repeat", async () => {
	const project = await mkdtemp(path.join(tmpdir(), "dsh-archives-"));
	const first = await importSessionJsonl(JSONL, { projectRoot: project });
	assert.equal(first.status, "created");
	assert.equal(first.entries, 2);

	const logs = path.join(project, ".agents", "memory", "session-logs");
	const raw = await readFile(path.join(logs, HEADER.id, "session.jsonl"), "utf8");
	assert.equal(raw, JSONL); // canonical copy preserved byte-for-byte
	const markdown = await readFile(path.join(logs, HEADER.id, "session.md"), "utf8");
	assert.match(markdown, /# DSH Session 11111111-2222-3333-4444-555555555555/);
	assert.match(markdown, /整理 log 并适配 DSH 0\.1\.5/);
	const index = await readFile(path.join(logs, "INDEX.md"), "utf8");
	assert.match(index, new RegExp(`^- \\[${HEADER.id}\\]\\(${HEADER.id}/session\\.md\\) — 2026-09-09 — 整理 log 并适配 DSH 0\\.1\\.5$`, "m"));
	// The archive directory stays out of version control (plugin-owned ignore file).
	assert.equal((await readdir(logs)).includes(".gitignore"), true);

	const second = await importSessionJsonl(JSONL, { projectRoot: project });
	assert.equal(second.status, "skipped");
	const replaced = await importSessionJsonl(JSONL, { projectRoot: project, replace: true, markdown: false });
	assert.equal(replaced.status, "created");
});

test("importArchiveFile reports a bad archive as failed instead of throwing", async () => {
	const project = await mkdtemp(path.join(tmpdir(), "dsh-archives-bad-"));
	const file = path.join(project, "broken.zip");
	await writeFile(file, Buffer.from("definitely not a zip"));
	const outcome = await importArchiveFile(file, { projectRoot: project });
	assert.equal(outcome.status, "failed");
	assert.match(outcome.error, /not a zip archive/);
});
