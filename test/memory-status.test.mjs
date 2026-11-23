/**
 * The bare `/memory` status receipt (W1-B): the store as it is right now, not just its path.
 *
 * What this pins:
 *  - every number is a fact of the filesystem: the character count is the loaded document's own
 *    length (never a trimmed or normalized one), the four section counts come from parsing the stored
 *    document, and the journal/backup/archive/log counts come from the files themselves;
 *  - a value the store cannot produce is a *named* absence — `unparseable`, `none yet`, `unreadable`,
 *    `unknown` — never a `0`, because "no backups" and "could not list the directory" are different
 *    facts;
 *  - the degraded states (capped / damaged / poisoned / unreadable) keep their own wording and their
 *    own kind, and the cap warning survives the new lines;
 *  - the receipt never claims what the last consolidation did: that outcome is not persisted, and the
 *    line says so instead of guessing it from an mtime.
 *
 * The pure core is exercised directly with a DTO as well, because the `unknown` branches (an
 * unlistable directory, an unreadable journal) are not all reachable from a temporary project.
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { apply as applyMemory, memoryStatusReply } from "../lib/project-memory/index.js";
import { resolvePluginConfig } from "../lib/shared/config.js";
import { loadMemory } from "../lib/project-memory/load.js";
import { memoryJournalFile } from "../lib/project-memory/journal.js";
import { formatMemoryStatus } from "../lib/project-memory/status-report.js";
import { renderMemoryDocument, sectionsFromMarkdown } from "../lib/project-memory/sections.js";
import { errorLogFile, logsDir, memoryDir, memoryFile } from "../lib/shared/paths.js";

const CAP = 45_000;

/** Four sections with 2 / 3 / 1 / 4 entries = 10, small enough to stay clear of every budget. */
const FIXTURE = {
	project: ["uses dsh", "single package"],
	invariants: ["the journal is the authority", "tier C refuses loss", "one name per fact"],
	pitfalls: ["tsc tagged templates"],
	index: ["docs/README.md", "src/shared/config.ts", "pnpm test", "lib/"],
};

async function freshProject(prefix = "memory-status-") {
	return mkdtemp(path.join(tmpdir(), prefix));
}

/** Run the real command composition (loader + adapter + core) against one project. */
async function status(root, cap = CAP) {
	const memory = await loadMemory(root, cap);
	const reply = await memoryStatusReply(memory, { projectRoot: root, journal: memoryJournalFile(root), maxMemoryChars: cap });
	return { memory, reply };
}

test("an empty project says none yet, and every count is a measured zero rather than a guess", async () => {
	const root = await freshProject();
	const { reply } = await status(root);

	assert.equal(reply.kind, "success");
	assert.ok(reply.text.startsWith(`Memory: none yet — ${memoryFile(root)}\n`), reply.text);
	assert.match(reply.text, /journal .*memory\.jsonl none yet/, "the absent journal is named, not reported as 0 lines");
	assert.match(reply.text, /0 backups/);
	assert.match(reply.text, /0 archived sessions/);
	assert.match(reply.text, /errors\.log 0 lines/);
	assert.doesNotMatch(reply.text, /entry|entries/, "an empty store has no section counts to claim");
	assert.match(reply.text, /no last-pass result/, "the receipt says the outcome is not persisted instead of guessing it");
	assert.ok(Buffer.byteLength(reply.text) < 3072, "the whole receipt stays under 3 KB");
});

test("the receipt is reachable as a bare command and as the word `status`", async () => {
	const root = await freshProject();
	await mkdir(memoryDir(root), { recursive: true });
	await writeFile(memoryFile(root), renderMemoryDocument(FIXTURE, CAP).text);

	// The real registration surface: `apply()` wires the command, and this is the handler the host
	// would call with the user's raw input.
	const registered = [];
	const ctx = {
		get: () => undefined,
		logger: { info() {}, warn() {} },
		systemPrompt: { context: () => undefined },
		on: () => () => undefined,
		commands: { register: (command) => { registered.push(command); return () => undefined; } },
		llm: { resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }) },
	};
	applyMemory(ctx, resolvePluginConfig({ provider: "test-provider", model: "test-model", maxMemoryChars: CAP }));
	const command = registered.find((entry) => entry.name === "memory");
	assert.ok(command !== undefined, "the /memory command is registered");

	const agent = {
		options: { provider: "test-provider", model: "test-model" },
		session: { id: "session-memory-status-forms", header: { cwd: root }, deriveMessages: () => [], snapshotEvents: () => [] },
	};
	const call = (rawInput) => command.handler({ agent, rawInput, signal: new AbortController().signal });

	const bare = await call("");
	const spelled = await call("status");
	assert.equal(bare.kind, "success");
	assert.equal(spelled.kind, "success");
	assert.equal(spelled.text, bare.text, "both spellings render the same receipt");
	assert.match(bare.text, /^Memory: \d+\/\d+ chars \(\d+%\)$/m, "the status receipt, not a refusal");

	// Every sibling spells the word out (`/handoff status`, `/session-log status`, `/autolearn
	// status`), so the usage has to name it as one rather than only as an omitted argument.
	const unknown = await call("stat");
	assert.equal(unknown.kind, "error");
	assert.match(unknown.text, /Unknown option "stat"/);
	assert.match(unknown.text, /Usage: \/memory \[status\]/);
});

test("a stored four-section document reports its length and its section counts, which the file confirms", async () => {
	const root = await freshProject();
	const document = renderMemoryDocument(FIXTURE, CAP).text;
	await mkdir(memoryDir(root), { recursive: true });
	await writeFile(memoryFile(root), document);

	const { memory, reply } = await status(root);
	// The first line is the only one a collapsed command row shows, so it carries the measurements;
	// the source path is named on the journal line instead of leading and being clipped.
	assert.match(reply.text, /^Memory: \d+\/\d+ chars \(\d+%\)$/m, reply.text);
	assert.match(reply.text, new RegExp(`^source ${memoryFile(root).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"), reply.text);
	// The receipt sizes the *loaded* document — what a consolidation pass would see — so a loader
	// normalization (a trailing newline) is already reflected in both numbers.
	assert.match(reply.text, new RegExp(`${memory.text.length}/${CAP} chars \\(${Math.round((memory.text.length / CAP) * 100)}%\\)`), reply.text);
	// The breakdown is its own line: on the size line it pushed the folded summary past the clip.
	assert.match(reply.text, /^sections: 10 entries \(Project 2, Invariants 3, Pitfalls 1, Index 4\)$/m);
	assert.doesNotMatch(reply.text, /cap|dropped|truncat/i, "a memory inside the cap is not warned about");

	// Independent recomputation from the file the user would open.
	const stored = sectionsFromMarkdown(await readFile(memoryFile(root), "utf8"));
	assert.deepEqual(
		[stored.project.length, stored.invariants.length, stored.pitfalls.length, stored.index.length],
		[2, 3, 1, 4],
		"the receipt's counts are the stored document's counts",
	);
});

test("a journal reports its own line and byte counts, measured from the file", async () => {
	const root = await freshProject();
	const document = renderMemoryDocument(FIXTURE, CAP).text;
	const journalText = `${JSON.stringify({ ts: "2026-11-18T00:00:00.000Z", op: "replace", text: document })}\n`
		+ `${JSON.stringify({ ts: "2026-11-18T00:01:00.000Z", op: "append", text: "- an appended fact" })}\n`;
	await mkdir(memoryDir(root), { recursive: true });
	await writeFile(memoryJournalFile(root), journalText);

	const { reply } = await status(root);
	const lines = journalText.split("\n").length - 1;
	assert.match(reply.text, new RegExp(`journal ${memoryJournalFile(root).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} ${lines} lines / ${Buffer.byteLength(journalText)} bytes`), reply.text);
	assert.equal(lines, 2, "the fixture really has two records");
	// The journal wins the read, so the document the receipt sizes is the folded one.
	assert.match(reply.text, /entries \(Project 2, Invariants 3, Pitfalls 1, Index 5\)/, "the appended fact lands in the last section");
});

test("backups and errors.log are counted, and a look-alike file is not a backup", async () => {
	const root = await freshProject();
	await mkdir(memoryDir(root), { recursive: true });
	await writeFile(memoryFile(root), renderMemoryDocument(FIXTURE, CAP).text);
	for (const stamp of ["2026-11-18T00-00-00-000Z-deadbeef", "2026-11-18T00-01-00-000Z-feedface"]) {
		await writeFile(path.join(memoryDir(root), `MEMORY.md.memory-backup-${stamp}`), "old bytes");
	}
	// A user file that merely ends with the generator's name is not one of its backups.
	await writeFile(path.join(memoryDir(root), "notes-MEMORY.md.memory-backup-x"), "not a backup");
	await writeFile(errorLogFile(root), "first failure\nsecond failure\nthird failure");

	const { reply } = await status(root);
	assert.match(reply.text, /2 backups/);
	assert.match(reply.text, /errors\.log 3 lines/);
});

test("archived sessions are the directories that carry a meta.json, never a bare directory count", async () => {
	const root = await freshProject();
	for (const session of ["session-aaaaaaaa", "session-bbbbbbbb"]) {
		await mkdir(path.join(logsDir(root), session), { recursive: true });
		await writeFile(path.join(logsDir(root), session, "meta.json"), "{}");
	}
	await mkdir(path.join(logsDir(root), "not-a-session"), { recursive: true });

	const { reply } = await status(root);
	assert.match(reply.text, /2 archived sessions/, reply.text);
});

test("a capped document keeps its warning and still reports the store", async () => {
	const root = await freshProject();
	await mkdir(memoryDir(root), { recursive: true });
	// One long line: the loader's cap cuts inside it and reports the characters it kept back.
	await writeFile(memoryFile(root), `# Project Memory\n\n- ${"x".repeat(40_000)}\n`);

	const { reply } = await status(root, 32_000);
	assert.equal(reply.kind, "success");
	assert.match(reply.text, /32000-character cap/, "the warning still names the configured cap");
	assert.match(reply.text, /dropped on write/, "and still says what the consequence is");
	assert.match(reply.text, /journal .*none yet/, "the store facts follow the warning");
	assert.match(reply.text, /no last-pass result/);
});

test("an opaque document is reported as unparseable, not as four empty sections", async () => {
	const root = await freshProject();
	await mkdir(memoryDir(root), { recursive: true });
	await writeFile(memoryFile(root), "# Project Memory\n\nfree prose that is not our four sections\n");

	const { reply } = await status(root, 40_000);
	assert.match(reply.text, /sections unparseable/, reply.text);
	assert.match(reply.text, /withheld, not reported as 0/, "the refusal says why it is not a zero");
	assert.doesNotMatch(reply.text, /\b0 entries\b/, "an unreadable shape must never read as an empty memory");
});

test("a damaged journal keeps its own wording and gains the measured facts", async () => {
	const root = await freshProject();
	const document = renderMemoryDocument(FIXTURE, CAP).text;
	await mkdir(memoryDir(root), { recursive: true });
	await writeFile(memoryJournalFile(root), `${JSON.stringify({ ts: "2026-11-18T00:00:00.000Z", op: "replace", text: document })}\n{broken`);

	const { reply } = await status(root);
	assert.equal(reply.kind, "success");
	assert.match(reply.text, /1 unusable line\(s\) skipped/);
	assert.match(reply.text, /journal .*2 lines/, "the torn tail is still a line in the file");
	assert.match(reply.text, /10 entries \(Project 2, Invariants 3, Pitfalls 1, Index 4\)/, "the folded document is still counted");
});

test("an unreadable source stays an error and claims no size", async () => {
	const root = await freshProject();
	// A directory where the journal should be: it exists, so this is "unreadable", not "none yet".
	await mkdir(path.join(memoryDir(root), "memory.jsonl"), { recursive: true });

	const { reply } = await status(root);
	assert.equal(reply.kind, "error");
	assert.match(reply.text, /exists but cannot be read/, reply.text);
	assert.match(reply.text, /journal .*unreadable/);
	assert.doesNotMatch(reply.text, /chars \(/, "nothing is sized for a document that never loaded");
});

test("the core renders named absences for what the adapter could not measure", () => {
	const reply = formatMemoryStatus({
		document: renderMemoryDocument(FIXTURE, 4_000).text,
		source: "MEMORY.md",
		expectedPath: "/p/.agents/memory/MEMORY.md",
		journalPath: "/p/.agents/memory/memory.jsonl",
		maxChars: 4_000,
		damaged: 0,
		unreadable: false,
		poisoned: false,
		cappedDroppedChars: 0,
		files: { journal: { kind: "unreadable" }, backups: undefined, archivedSessions: undefined, errorLogLines: undefined },
	});
	assert.equal(reply.kind, "success");
	assert.match(reply.text, /journal \/p\/\.agents\/memory\/memory\.jsonl unreadable/);
	assert.match(reply.text, /backups unknown/);
	assert.match(reply.text, /archived sessions unknown/);
	assert.match(reply.text, /errors\.log unknown/);
	assert.match(reply.text, /10 entries \(Project 2, Invariants 3, Pitfalls 1, Index 4\)/);
});

test("the receipt marks the document as a derived view and names the journal as the authority", async () => {
	// AOCI's `derived=true / authoritative=false` marker, in the one-line form a receipt can carry.
	// Without it a reader treats MEMORY.md as the record, when the append-only journal is.
	const root = await freshProject();
	await mkdir(memoryDir(root), { recursive: true });
	const document = renderMemoryDocument(FIXTURE, CAP).text;
	await writeFile(memoryFile(root), document);
	// A real journal record: without one MEMORY.md *is* the only store, and the marker would be a lie.
	await writeFile(memoryJournalFile(root), `${JSON.stringify({ ts: new Date().toISOString(), op: "replace", text: document })}\n`);

	const { reply } = await status(root);
	assert.match(reply.text, /derived view: MEMORY\.md is a projection, the authority is the journal/, reply.text);
	assert.ok(
		reply.text.indexOf("journal ") < reply.text.indexOf("derived view:"),
		"the marker follows the journal line it qualifies, so the reader sees the authority first",
	);
});

test("an absent journal is not called an authority", async () => {
	// The negative control: with no journal there is nothing to defer to, so the receipt must not claim
	// an authority the store does not have.
	const root = await freshProject();
	// A real document, so journal absence is the only thing this case varies.
	await mkdir(memoryDir(root), { recursive: true });
	await writeFile(memoryFile(root), renderMemoryDocument(FIXTURE, CAP).text);
	const { reply } = await status(root);

	assert.match(reply.text, /^Memory: \d+\/\d+ chars/m, "the document is loaded, not empty");
	assert.match(reply.text, /journal .*memory\.jsonl none yet/);
	assert.doesNotMatch(reply.text, /derived view/, "no journal, no authority to name");
});

test("an empty journal file does not make the journal the authority", async () => {
	// A journal path that exists but holds no records is not a source: `loadMemory` falls back to
	// MEMORY.md, so calling the journal the authority would contradict the `source` line above it.
	const root = await freshProject();
	await mkdir(memoryDir(root), { recursive: true });
	await writeFile(memoryFile(root), renderMemoryDocument(FIXTURE, CAP).text);
	await writeFile(memoryJournalFile(root), "", "utf8");

	const { reply } = await status(root);
	assert.match(reply.text, /journal .*memory\.jsonl 0 lines/, "the empty journal is still reported");
	assert.doesNotMatch(reply.text, /derived view/, "an empty journal is not the authority; MEMORY.md is the source");
});

test("a newer MEMORY.md after an outside edit is the source, so the journal is not called the authority", async () => {
	const root = await freshProject();
	await mkdir(memoryDir(root), { recursive: true });
	const journalText = renderMemoryDocument(FIXTURE, CAP).text;
	await writeFile(
		memoryJournalFile(root),
		`${JSON.stringify({ ts: new Date(Date.now() - 60_000).toISOString(), op: "replace", text: journalText })}\n`,
	);
	// Written after the journal with an explicitly newer mtime, so `loadMemory` adopts it as the source
	// (a same-millisecond write can fall inside the comparison's granularity).
	await writeFile(memoryFile(root), `${journalText}- an outside edit added this entry\n`);
	const ahead = new Date(Date.now() + 5_000);
	await utimes(memoryFile(root), ahead, ahead);

	const { reply } = await status(root);
	assert.match(reply.text, /^source .*MEMORY\.md$/m, "the receipt names MEMORY.md as the source");
	assert.doesNotMatch(reply.text, /derived view/, "the source line and the marker must not contradict each other");
});
