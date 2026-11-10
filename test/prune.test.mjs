/**
 * Batch Z4 — the cleaning channel.
 *
 * Cleaning is the only path in this plugin that deletes, so every case here pins both halves: what
 * left the directory, and what did *not*. Three acceptance criteria from the spec drive the file:
 * the session archives survive every run (directory count unchanged), the removed bytes are in a
 * tarball first, and an applied run appends exactly one line to `purge.log`.
 *
 * The rules are also pinned at their boundaries, because every one of them is an age or a count:
 * 3 backups, 90 days, 1 MB, 60 days. A rule that fires one step too early deletes evidence a receipt
 * still names; one that fires too late just leaves a file behind.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, readdir, stat, utimes, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { resolvePluginConfig } from "../lib/shared/config.js";
import { consolidateProject, apply as applyMemory, memoryPruneReply } from "../lib/project-memory/index.js";
import { PRUNE_BACKUPS_KEPT, planPrune, pruneProjectMemory } from "../lib/project-memory/prune.js";
import { MAX_ERROR_LOG_BYTES } from "../lib/shared/error-log.js";

const DAY = 86_400_000;

/** A project root with `<root>/.agents/memory` in place. */
async function memoryRoot(prefix) {
	const root = await mkdtemp(path.join(tmpdir(), prefix));
	await mkdir(path.join(root, ".agents", "memory"), { recursive: true });
	return root;
}

/** A path inside the project's memory directory. */
function mem(root, ...parts) {
	return path.join(root, ".agents", "memory", ...parts);
}

/** Write a file with an explicit modification time, so an age rule has something to measure. */
async function writeAged(file, content, ageMs) {
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, content, "utf8");
	const when = new Date(Date.now() - ageMs);
	await utimes(file, when, when);
}

/** A backup name in the exact shape the writer generates. */
function backupName(index, ageMs = index * 1000) {
	const stamp = new Date(Date.now() - ageMs).toISOString().replace(/[:.]/g, "-");
	return `MEMORY.md.memory-backup-${stamp}-${String(index).padStart(8, "0")}`;
}

async function backupNames(root) {
	return (await readdir(mem(root))).filter((name) => name.includes(".memory-backup-")).sort();
}

/** A journal archive name in the exact shape `rotateMemoryJournalIfNeeded` generates. */
function archiveName(index) {
	const stamp = new Date(Date.now() - index * 1000).toISOString().replace(/[:.]/g, "-");
	return `memory-log-${stamp}-${String(index).padStart(8, "0")}.jsonl`;
}

/** The entries of a tarball, read back with the same tool that wrote it. */
function tarEntries(file) {
	return execFileSync("tar", ["-tf", file], { encoding: "utf8" }).split("\n").filter(Boolean);
}

async function purgeLines(root) {
	const file = mem(root, "purge.log");
	if (!existsSync(file)) return [];
	return (await readFile(file, "utf8")).split("\n").filter(Boolean);
}

// ---------------------------------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------------------------------

test("a preview names the plan and touches nothing, not even the log", async () => {
	const root = await memoryRoot("dsh-prune-preview-");
	for (const index of [1, 2, 3, 4, 5]) await writeFile(mem(root, backupName(index)), `backup ${index}`, "utf8");
	await writeAged(mem(root, archiveName(1)), "{}\n", 91 * DAY);
	await writeAged(mem(root, "skill-candidates", "old-note.md"), "note\n", 61 * DAY);

	const before = await readdir(mem(root));
	const outcome = await pruneProjectMemory(root, { apply: false, reason: "manual" });

	assert.equal(outcome.status, "preview", JSON.stringify(outcome));
	assert.deepEqual(outcome.plan.candidates.map((candidate) => candidate.reason).sort(), ["byte-backup", "byte-backup", "journal-archive", "skill-candidate"]);
	assert.equal(outcome.removed, 0);
	assert.equal(outcome.truncated, 0);
	assert.equal(outcome.trash, undefined, "a preview writes no archive");
	assert.equal(existsSync(mem(root, "trash")), false, "a look leaves no trace");
	assert.deepEqual(await purgeLines(root), [], "a preview is not a cleaning event");
	assert.deepEqual((await readdir(mem(root))).sort(), before.sort(), "no file left the directory");
});

test("an applied run keeps the newest three backups and archives the rest", async () => {
	const root = await memoryRoot("dsh-prune-backups-");
	// Five backups, aged so "newest" is unambiguous.
	for (const index of [1, 2, 3, 4, 5]) await writeAged(mem(root, backupName(index)), `backup ${index}`, index * 60_000);
	const all = await backupNames(root);
	const expectedKept = all.slice(-PRUNE_BACKUPS_KEPT);

	const outcome = await pruneProjectMemory(root, { apply: true, reason: "manual" });

	assert.equal(outcome.status, "applied", JSON.stringify(outcome));
	assert.equal(outcome.removed, 2);
	assert.deepEqual(await backupNames(root), expectedKept, "the newest three survive");
	const entries = tarEntries(outcome.trash);
	for (const removed of all.filter((name) => !expectedKept.includes(name))) {
		assert.ok(entries.includes(removed), `the tarball carries ${removed}`);
	}
});

test("the session archives are never candidates, and their count is the negative control", async () => {
	const root = await memoryRoot("dsh-prune-sessions-");
	const logs = mem(root, "session-logs");
	for (const id of ["session-a", "session-b", "session-c"]) {
		await mkdir(path.join(logs, id), { recursive: true });
		await writeFile(path.join(logs, id, "session.jsonl"), `${id}\n`, "utf8");
	}
	await writeFile(path.join(logs, "INDEX.md"), "- one row\n", "utf8");
	// A backup next to them, so the run really deletes something and the control is not vacuous.
	for (const index of [1, 2, 3, 4]) await writeFile(mem(root, backupName(index)), `backup ${index}`, "utf8");

	const before = (await readdir(logs, { withFileTypes: true })).filter((entry) => entry.isDirectory()).length;
	const outcome = await pruneProjectMemory(root, { apply: true, reason: "manual" });
	const after = (await readdir(logs, { withFileTypes: true })).filter((entry) => entry.isDirectory()).length;

	assert.equal(outcome.removed, 1, "the run really removed a file");
	assert.equal(before, 3);
	assert.equal(after, 3, "a session directory is never deleted by the cleaning channel");
	assert.equal(await readFile(path.join(logs, "session-b", "session.jsonl"), "utf8"), "session-b\n");
	assert.equal(await readFile(path.join(logs, "INDEX.md"), "utf8"), "- one row\n");
	assert.equal(outcome.plan.candidates.some((candidate) => candidate.name.startsWith("session-logs")), false);
});

test("archived journals are reclaimed at 90 days and kept one day short of it", async () => {
	const root = await memoryRoot("dsh-prune-journals-");
	const old = archiveName(1);
	const young = archiveName(2);
	// Literal ages, not the exported constants: a fixture that reads the horizon it is testing moves
	// with the mutant and stays green.
	await writeAged(mem(root, old), "{}\n", 91 * DAY);
	await writeAged(mem(root, young), "{}\n", 89 * DAY);

	const outcome = await pruneProjectMemory(root, { apply: true, reason: "auto" });

	assert.equal(outcome.status, "applied", JSON.stringify(outcome));
	assert.equal(existsSync(mem(root, old)), false, "an archive past the horizon is reclaimed");
	assert.equal(existsSync(mem(root, young)), true, "an archive inside the horizon survives");
});

test("the live journal is never a candidate, whatever its age", async () => {
	const root = await memoryRoot("dsh-prune-live-journal-");
	const journal = mem(root, "memory.jsonl");
	await writeAged(journal, '{"op":"replace","text":"# Project Memory\\n"}\n', 400 * DAY);
	await writeAged(mem(root, "memory-log-2026-01-01T00-00-00-000Z-aaaaaaaa.jsonl"), "{}\n", 400 * DAY);

	const outcome = await pruneProjectMemory(root, { apply: true, reason: "auto" });

	assert.equal(await readFile(journal, "utf8"), '{"op":"replace","text":"# Project Memory\\n"}\n', "the source of truth is untouched");
	assert.equal(outcome.removed, 1, "only the archive next to it was reclaimed");
});

test("orphaned journal temporaries are reclaimed, and a fresh one is not", async () => {
	const root = await memoryRoot("dsh-prune-tmp-");
	const orphan = "memory.jsonl.1712345678901.11111111-2222-3333-4444-555555555555.tmp";
	const fresh = "memory.jsonl.1712345678902.66666666-7777-8888-9999-000000000000.tmp";
	await writeAged(mem(root, orphan), "{}\n", 91 * DAY);
	await writeAged(mem(root, fresh), "{}\n", DAY);

	await pruneProjectMemory(root, { apply: true, reason: "auto" });

	assert.equal(existsSync(mem(root, orphan)), false);
	assert.equal(existsSync(mem(root, fresh)), true, "an in-flight atomic write is not touched");
});

test("an oversized errors.log is archived whole and truncated to its newest tail", async () => {
	const root = await memoryRoot("dsh-prune-errors-");
	const file = mem(root, "errors.log");
	const line = (index) => `${new Date(Date.now() - (index + 1) * 1000).toISOString()} [memory] record number ${index} ${"x".repeat(900)}\n`;
	// Appended oldest first, like the real log: index 0 is the newest and therefore the last line.
	const lines = Array.from({ length: Math.ceil((MAX_ERROR_LOG_BYTES + 50_000) / 950) }, (_, index) => line(index));
	await writeFile(file, lines.reverse().join(""), "utf8");
	const originalBytes = (await stat(file)).size;
	assert.ok(originalBytes > MAX_ERROR_LOG_BYTES);

	const outcome = await pruneProjectMemory(root, { apply: true, reason: "auto" });

	assert.equal(outcome.status, "applied", JSON.stringify(outcome));
	assert.equal(outcome.truncated, 1);
	assert.equal(outcome.removed, 0, "the log is truncated in place, not deleted");
	const archived = tarEntries(outcome.trash);
	assert.ok(archived.includes("errors.log"), "the whole log is in the tarball");
	assert.equal((await readFile(file, "utf8")).length < originalBytes, true);
	const after = await readFile(file, "utf8");
	assert.match(after, /^\[\.\.\.truncated; newest entries kept\.\.\.\]\n/, "the rotation marker leads the kept text");
	assert.match(after, /record number 0 /, "the newest record survives");
	assert.doesNotMatch(after, /record number 1000 /, "the oldest records are the ones that left");
});

test("an errors.log under the threshold is not touched", async () => {
	const root = await memoryRoot("dsh-prune-errors-small-");
	await writeFile(mem(root, "errors.log"), "a small log\n", "utf8");

	const outcome = await pruneProjectMemory(root, { apply: true, reason: "auto" });

	assert.equal(outcome.status, "nothing");
	assert.equal(await readFile(mem(root, "errors.log"), "utf8"), "a small log\n");
});

test("skill candidates age out at 60 days, and only generated `.md` files are candidates", async () => {
	const root = await memoryRoot("dsh-prune-candidates-");
	await writeAged(mem(root, "skill-candidates", "old.md"), "note\n", 61 * DAY);
	await writeAged(mem(root, "skill-candidates", "young.md"), "note\n", 59 * DAY);
	// Not a candidate the plugin generated: an editor backup and a stray note, both ancient.
	await writeAged(mem(root, "skill-candidates", "old.md~"), "note\n", 400 * DAY);
	await writeAged(mem(root, "skill-candidates", "notes.txt"), "note\n", 400 * DAY);

	await pruneProjectMemory(root, { apply: true, reason: "auto" });

	assert.equal(existsSync(mem(root, "skill-candidates", "old.md")), false);
	assert.equal(existsSync(mem(root, "skill-candidates", "young.md")), true);
	assert.equal(existsSync(mem(root, "skill-candidates", "old.md~")), true, "a non-generated name is never a candidate");
	assert.equal(existsSync(mem(root, "skill-candidates", "notes.txt")), true);
});

test("names the plugin did not generate are not candidates even when they are ancient", async () => {
	const root = await memoryRoot("dsh-prune-foreign-");
	// Four generated backups, so the count rule is genuinely exceeded: the run has work to do and a
	// widened name filter would take the foreign file too (only the generated eight-character suffix
	// separates them).
	const names = [1, 2, 3, 4].map((index) => backupName(index));
	for (const [index, name] of names.entries()) await writeAged(mem(root, name), `backup ${index + 1}`, (index + 1) * 60_000);
	await writeAged(mem(root, "MEMORY.md.user-backup"), "mine\n", 400 * DAY);
	await writeAged(mem(root, "CONTEXT.md"), "# Project Context\n", 400 * DAY);
	await writeAged(mem(root, "MEMORY.md"), "# Project Memory\n", 400 * DAY);
	await writeAged(mem(root, "entries.json"), "{}\n", 400 * DAY);

	const plan = await planPrune(root);

	assert.deepEqual(plan.candidates.map((candidate) => candidate.name), [names[3]], "only the oldest generated backup is a candidate");
	await pruneProjectMemory(root, { apply: true, reason: "manual" });
	for (const foreign of ["MEMORY.md.user-backup", "CONTEXT.md", "MEMORY.md", "entries.json"]) {
		assert.equal(existsSync(mem(root, foreign)), true, `${foreign} is never a candidate`);
	}
});

test("a second run on the same day appends to the same archive, so the morning's evidence survives", async () => {
	const root = await memoryRoot("dsh-prune-append-");
	for (const index of [1, 2, 3, 4]) await writeAged(mem(root, backupName(index)), `backup ${index}`, index * 60_000);

	const first = await pruneProjectMemory(root, { apply: true, reason: "manual" });
	assert.equal(first.removed, 1);
	const archive = first.trash;

	// Two more backups push the count over the floor again.
	for (const index of [5, 6]) await writeAged(mem(root, backupName(index)), `backup ${index}`, index * 60_000);
	const second = await pruneProjectMemory(root, { apply: true, reason: "manual" });
	assert.equal(second.removed, 2);
	assert.equal(second.trash, archive, "one tarball per day, extended in place");

	const entries = tarEntries(archive);
	assert.equal(entries.length, 3, "all three removals of the day are in it");
	assert.equal(new Set(entries).size, 3, "appending does not duplicate a member");
});

test("a member name longer than the ustar name field is split, not refused", async () => {
	const root = await memoryRoot("dsh-prune-longname-");
	const long = `skill-candidates/${"a".repeat(90)}.md`;
	assert.ok(Buffer.byteLength(long) > 100, "the fixture really exceeds the name field");
	await writeAged(mem(root, long), "note\n", 61 * DAY);

	const outcome = await pruneProjectMemory(root, { apply: true, reason: "manual" });

	assert.equal(outcome.status, "applied", JSON.stringify(outcome));
	assert.ok(tarEntries(outcome.trash).includes(long), "the real tar reads the split name back whole");
});

// ---------------------------------------------------------------------------------------------------
// The log
// ---------------------------------------------------------------------------------------------------

test("each applied run appends exactly one line, and an idle automatic run stays silent", async () => {
	const root = await memoryRoot("dsh-prune-log-");
	for (const index of [1, 2, 3, 4]) await writeFile(mem(root, backupName(index)), `backup ${index}`, "utf8");

	await pruneProjectMemory(root, { apply: true, reason: "auto" });
	const first = await purgeLines(root);
	assert.equal(first.length, 1, "one line per applied run");
	assert.match(first[0], /reason=auto removed=1 truncated=0 bytes=\d+/);
	assert.match(first[0], /trash=\.agents\/memory\/trash\/\d{4}-\d{2}-\d{2}\.tar/);
	assert.match(first[0], /targets=/);
	assert.match(first[0], /result=ok$/);

	// Nothing is left over the rules, so the automatic path adds nothing.
	await pruneProjectMemory(root, { apply: true, reason: "auto" });
	assert.equal((await purgeLines(root)).length, 1, "an idle automatic run is not a cleaning event");

	// An explicit run answers even when it has nothing to do: the user asked.
	const explicit = await pruneProjectMemory(root, { apply: true, reason: "manual" });
	assert.equal(explicit.status, "nothing");
	const lines = await purgeLines(root);
	assert.equal(lines.length, 2);
	assert.match(lines[1], /removed=0 truncated=0 bytes=0 result=nothing$/);
});

test("an archive that cannot be written deletes nothing and logs the failure", async () => {
	const root = await memoryRoot("dsh-prune-fail-");
	for (const index of [1, 2, 3, 4]) await writeFile(mem(root, backupName(index)), `backup ${index}`, "utf8");
	// A regular file where the trash directory belongs: `mkdir` fails, so nothing may be archived.
	await writeFile(mem(root, "trash"), "not a directory\n", "utf8");
	const before = await backupNames(root);

	const outcome = await pruneProjectMemory(root, { apply: true, reason: "manual" });

	assert.equal(outcome.status, "failed", JSON.stringify(outcome));
	assert.equal(outcome.removed, 0, "fail closed: no removal without an archive");
	assert.deepEqual(await backupNames(root), before, "every file is still there");
	const lines = await purgeLines(root);
	assert.equal(lines.length, 1, "the failure is recorded too");
	assert.match(lines[0], /result=failed: /);
});

// ---------------------------------------------------------------------------------------------------
// The wiring
// ---------------------------------------------------------------------------------------------------

/** One consolidation pass's harness. */
function consolidationFixture({ root, reply }) {
	const calls = [];
	const ctx = {
		get: () => undefined,
		logger: { info() {}, warn() {} },
		llm: {
			resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
			stream(options) {
				calls.push(options);
				return (async function* generate() {
					yield { type: "text-delta", index: 0, text: reply };
					yield { type: "finish", reason: { kind: "stop" } };
				})();
			},
		},
	};
	const agent = {
		options: { provider: "test-provider", model: "test-model" },
		session: {
			id: "session-prune-fixture",
			header: { cwd: root, createdAt: Date.now() },
			snapshotEvents: () => [],
			deriveEventMessage: () => null,
			deriveMessages: () => [],
			requestHeader: () => undefined,
		},
	};
	return { calls, ctx, agent };
}

/** A reply that survives every gate. */
function replyText() {
	return JSON.stringify({
		memory_markdown: "# Project Memory\n\n## Project\n- a project fact\n\n## Invariants\n- a rule\n\n## Pitfalls\n\n## Index\n",
		context: { title: "prune title", summary: "a summary", key_points: [], open_tasks: [] },
	});
}

test("the automatic path runs after a pass and still never touches the session archives", async () => {
	const root = await memoryRoot("dsh-prune-auto-");
	const logs = mem(root, "session-logs", "session-keep");
	await mkdir(logs, { recursive: true });
	await writeFile(path.join(logs, "session.jsonl"), "kept\n", "utf8");
	for (const index of [1, 2, 3, 4]) await writeFile(mem(root, backupName(index)), `backup ${index}`, "utf8");
	const { ctx, agent } = consolidationFixture({ root, reply: replyText() });

	const report = await consolidateProject(ctx, resolvePluginConfig({ consolidateTurns: 1, maxMemoryChars: 40_000, forceDedupeMs: 0 }), agent, { force: true, silent: true });

	assert.equal(report.status, "updated", JSON.stringify(report));
	// The pass writes its own backup first (5 total), then the cleaning channel trims to 3.
	assert.equal((await backupNames(root)).length, PRUNE_BACKUPS_KEPT, "the pass's own backup is kept, the oldest two left");
	const lines = await purgeLines(root);
	assert.equal(lines.length, 1, "the run is recorded once");
	assert.match(lines[0], /reason=auto/);
	assert.equal(await readFile(path.join(logs, "session.jsonl"), "utf8"), "kept\n", "the archive survives the automatic path too");
});

test("the receipt separates a preview from an applied run, and both name the archive or the absence of one", async () => {
	const root = await memoryRoot("dsh-prune-receipt-");
	for (const index of [1, 2, 3, 4]) await writeFile(mem(root, backupName(index)), `backup ${index}`, "utf8");

	const preview = memoryPruneReply(await pruneProjectMemory(root, { apply: false, reason: "manual" }), root);
	assert.equal(preview.kind, "success");
	assert.match(preview.text, /1 file\(s\)/, "the count is what a preview answers");
	assert.match(preview.text, /Nothing was deleted/);
	assert.match(preview.text, /\/memory prune --apply/);
	assert.match(preview.text, /byte-backup/, "the reason is named per candidate");

	const applied = memoryPruneReply(await pruneProjectMemory(root, { apply: true, reason: "manual" }), root);
	assert.equal(applied.kind, "success");
	assert.match(applied.text, /removed 1 file\(s\)/);
	assert.match(applied.text, /archived in \.agents\/memory\/trash\/\d{4}-\d{2}-\d{2}\.tar/);
	assert.match(applied.text, /purge\.log/);
	assert.doesNotMatch(applied.text, /Nothing was deleted/, "a landed run must not read like a preview");

	const empty = memoryPruneReply(await pruneProjectMemory(root, { apply: false, reason: "manual" }), root);
	assert.match(empty.text, /nothing to clean/);

	const failed = memoryPruneReply(
		{ status: "failed", plan: { candidates: [{ name: "x", bytes: 1, reason: "byte-backup", action: "remove" }], bytes: 1 }, removed: 0, truncated: 0, failed: 1, error: "tar exploded" },
		root,
	);
	assert.equal(failed.kind, "error");
	assert.match(failed.text, /nothing was deleted/);
	assert.match(failed.text, /tar exploded/);
});

test("the command surface answers prune and --apply, and the usage names both verbs", async () => {
	const root = await memoryRoot("dsh-prune-command-");
	for (const index of [1, 2, 3, 4]) await writeFile(mem(root, backupName(index)), `backup ${index}`, "utf8");
	const commands = new Map();
	const ctx = {
		on: () => () => undefined,
		effect: () => () => undefined,
		inject: () => () => undefined,
		systemPrompt: { context: () => undefined },
		commands: { register: (command) => { commands.set(command.name, command); return () => undefined; } },
		get: () => undefined,
		logger: { info: () => undefined, warn: () => undefined },
		llm: { resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }), stream: () => (async function* generate() {})() },
	};
	applyMemory(ctx, { provider: "test-provider", model: "test-model", maxMemoryChars: 40_000 });
	const command = commands.get("memory");
	const agent = { session: { id: "session-prune-command", header: { cwd: root, createdAt: Date.now() }, snapshotEvents: () => [], deriveMessages: () => [], requestHeader: () => undefined } };

	const preview = await command.handler({ agent, rawInput: "prune" });
	assert.equal(preview.kind, "success");
	assert.match(preview.text, /Nothing was deleted/);
	assert.equal(existsSync(mem(root, "purge.log")), false, "a preview writes no log line");

	const applied = await command.handler({ agent, rawInput: "prune --apply" });
	assert.equal(applied.kind, "success");
	assert.match(applied.text, /removed 1 file\(s\)/);
	assert.equal((await purgeLines(root)).length, 1);

	const unknown = await command.handler({ agent, rawInput: "frobnicate" });
	assert.equal(unknown.kind, "error");
	assert.match(unknown.text, /\/memory prune \[--apply\]/, "the usage names the new verb");
});
