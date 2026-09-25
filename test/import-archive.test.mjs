/**
 * Unit tests for archive backfill: JSONL parsing/validation, the minimal ZIP
 * reader (including dsh's own export shape: local header with zeroed sizes plus
 * a data descriptor, real sizes only in the central directory), and the
 * idempotent import that writes session.jsonl + session.md + INDEX.md.
 *
 * Run `pnpm test` (builds lib/ first).
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import {
	importSessionJsonl,
	importArchiveFile,
	parseSessionJsonl,
	readZipEntry,
} from "../lib/project-context/import-archive.js";

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
 *
 * @param {string | Array<{name: string, content: string}>} entries - one entry name, or a list.
 * @param {string} [content] - the single entry's content when `entries` is a name.
 */
function buildZip(entries, content) {
	const files = (typeof entries === "string" ? [{ name: entries, content }] : entries).map((file) => {
		const raw = Buffer.from(file.content, "utf8");
		return { nameBytes: Buffer.from(file.name, "utf8"), deflated: deflateRawSync(raw), usize: raw.length };
	});

	const bodies = [];
	const centrals = [];
	let offset = 0;
	for (const file of files) {
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
		local.writeUInt16LE(file.nameBytes.length, 26);
		local.writeUInt16LE(0, 28);
		const descriptor = Buffer.alloc(16);
		descriptor.writeUInt32LE(0x08074b50, 0);
		descriptor.writeUInt32LE(0, 4);
		descriptor.writeUInt32LE(file.deflated.length, 8);
		descriptor.writeUInt32LE(file.usize, 12);
		const body = Buffer.concat([local, file.nameBytes, file.deflated, descriptor]);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0x0008, 8);
		central.writeUInt16LE(8, 10);
		central.writeUInt32LE(0, 16);
		central.writeUInt32LE(file.deflated.length, 20); // real sizes here
		central.writeUInt32LE(file.usize, 24);
		central.writeUInt16LE(file.nameBytes.length, 28);
		central.writeUInt32LE(offset, 42); // local header offset
		centrals.push(Buffer.concat([central, file.nameBytes]));
		bodies.push(body);
		offset += body.length;
	}

	const directory = Buffer.concat(centrals);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(files.length, 8);
	eocd.writeUInt16LE(files.length, 10);
	eocd.writeUInt32LE(directory.length, 12);
	eocd.writeUInt32LE(offset, 16);
	return Buffer.concat([...bodies, directory, eocd]);
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
	assert.throws(() => parseSessionJsonl('{"type":"other"}'), /not a session header/);
	assert.throws(() => parseSessionJsonl("not json\n"), /header is not JSON/);
	assert.throws(() => parseSessionJsonl(`${JSON.stringify(HEADER)}\n{oops}`), /event line 2 is not JSON/);
});

test("readZipEntry reads the entry through the central directory", () => {
	const zip = buildZip("session.jsonl", JSONL);
	assert.equal(readZipEntry(zip, "session.jsonl").toString("utf8"), JSONL);
	assert.equal(readZipEntry(zip, "missing.jsonl"), undefined);
	assert.throws(() => readZipEntry(Buffer.from("not a zip"), "session.jsonl"), /not a zip archive/);
});

test("readArchiveFile reads a current dsh export, whose root entry is session.v3.jsonl", async () => {
	// dsh writes `sessionFormatLogFilename(SESSION_FORMAT_VERSION)` = session.v3.jsonl;
	// only generation 0 is named session.jsonl.
	const project = await mkdtemp(path.join(tmpdir(), "dsh-archives-v3-"));
	const file = path.join(project, "export.zip");
	await writeFile(file, buildZip([
		{ name: "media/image.png", content: "binary" },
		{ name: "subagents/child-1/session.v3.jsonl", content: '{"type":"session","id":"child-1"}' },
		{ name: "session.v3.jsonl", content: JSONL },
	]));

	const outcome = await importArchiveFile(file, { projectRoot: project });
	assert.equal(outcome.status, "created", outcome.error);
	assert.equal(outcome.id, HEADER.id);
	const raw = await readFile(path.join(project, ".agents", "memory", "session-logs", HEADER.id, "session.jsonl"), "utf8");
	assert.equal(raw, JSONL, "the root log wins over the subagent entry and media");
});

test("readArchiveFile prefers the highest session-log generation at the archive root", async () => {
	const project = await mkdtemp(path.join(tmpdir(), "dsh-archives-gen-"));
	const file = path.join(project, "export.zip");
	await writeFile(file, buildZip([
		{ name: "session.jsonl", content: '{"type":"session","id":"old"}' },
		{ name: "session.v3.jsonl", content: JSONL },
	]));

	const outcome = await importArchiveFile(file, { projectRoot: project });
	assert.equal(outcome.status, "created", outcome.error);
	assert.equal(outcome.id, HEADER.id);
});

test("readArchiveFile rejects a zip with no root session log", async () => {
	const project = await mkdtemp(path.join(tmpdir(), "dsh-archives-empty-"));
	const file = path.join(project, "export.zip");
	await writeFile(file, buildZip([{ name: "subagents/child-1/session.v3.jsonl", content: JSONL }]));

	const outcome = await importArchiveFile(file, { projectRoot: project });
	assert.equal(outcome.status, "failed");
	assert.match(outcome.error, /does not contain a session log/);
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
	assert.match(index, new RegExp(`^- \\[${HEADER.id}\\]\\(${HEADER.id}/session\\.jsonl\\) — 2026-09-09 — 整理 log 并适配 DSH 0\\.1\\.5$`, "m"));
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

test("a malformed event line is rejected before any artifact is written", async () => {
	// `null` parses as valid JSON but is not an event; it used to fail only after
	// the raw JSONL had been written, which then made the retry report "skipped".
	const project = await mkdtemp(path.join(tmpdir(), "dsh-archives-malformed-"));
	const file = path.join(project, "broken.jsonl");
	await writeFile(file, `${JSON.stringify(HEADER)}\nnull\n`);

	const outcome = await importArchiveFile(file, { projectRoot: project });
	assert.equal(outcome.status, "failed");
	assert.match(outcome.error, /event line 2 is not a JSON object/);
	assert.equal(existsSync(path.join(project, ".agents", "memory", "session-logs", HEADER.id)), false, "a failed import leaves nothing behind");
});

test("an unusable header createdAt falls back instead of failing after the raw write", async () => {
	const project = await mkdtemp(path.join(tmpdir(), "dsh-archives-date-"));
	const header = JSON.stringify({ ...HEADER, createdAt: 1e21 });
	const text = `${header}\n${JSON.stringify(EVENTS[0])}\n`;

	const outcome = await importSessionJsonl(text, { projectRoot: project });
	assert.equal(outcome.status, "created");
	assert.equal(outcome.entries, 1);
	// The canonical copy stays verbatim: only the rendering fell back to "now".
	const raw = await readFile(path.join(project, ".agents", "memory", "session-logs", HEADER.id, "session.jsonl"), "utf8");
	assert.match(raw, /1e\+21/);
});

test("a half-written import is retried instead of reported as already imported", async () => {
	const project = await mkdtemp(path.join(tmpdir(), "dsh-archives-heal-"));
	const logs = path.join(project, ".agents", "memory", "session-logs");
	// Simulate an interrupted import: the raw copy landed, the Markdown did not.
	await mkdir(path.join(logs, HEADER.id), { recursive: true });
	await writeFile(path.join(logs, HEADER.id, "session.jsonl"), JSONL);

	const outcome = await importSessionJsonl(JSONL, { projectRoot: project });
	assert.equal(outcome.status, "created", "a missing session.md means the import is incomplete");
	assert.match(await readFile(path.join(logs, HEADER.id, "session.md"), "utf8"), /# DSH Session/);
	assert.match(await readFile(path.join(logs, "INDEX.md"), "utf8"), new RegExp(HEADER.id));
});

test("markdown:false writes no session.md yet still imports once", async () => {
	const project = await mkdtemp(path.join(tmpdir(), "dsh-archives-nomd-"));
	const first = await importSessionJsonl(JSONL, { projectRoot: project, markdown: false });
	assert.equal(first.status, "created");
	const logs = path.join(project, ".agents", "memory", "session-logs");
	assert.equal(existsSync(path.join(logs, HEADER.id, "session.md")), false);
	assert.match(await readFile(path.join(logs, HEADER.id, "session.jsonl"), "utf8"), /user\/message/);

	const second = await importSessionJsonl(JSONL, { projectRoot: project, markdown: false });
	assert.equal(second.status, "skipped");
});
