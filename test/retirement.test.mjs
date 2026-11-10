/**
 * Batch Z2: the tombstone channel and the three mechanical retirement triggers.
 *
 * The pass is a whole-document regeneration, so this batch is the only place a fact ever leaves
 * `MEMORY.md` on purpose. Every test here therefore pins both halves: what left, and what did *not*
 * leave. A trigger that fires too eagerly deletes a true fact and no re-render can show it.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolvePluginConfig } from "../lib/shared/config.js";
import { consolidateProjectState } from "../lib/project-memory/consolidate.js";
import { recordMemoryDocument } from "../lib/project-memory/memory-store.js";
import { appendTombstones, MAX_DIGEST_ENTRIES, MAX_RETIRED_LINES, parseTombstones, readArchivedTombstones, readTombstones, renderTombstones, tombstoneDigest, tombstoneLine } from "../lib/project-memory/retired.js";
import { entryTid, mentionNeedle, recordEntryDates, retireReply, retireSections, retireWithinBudget, scanMentions, stampEntryIds, supersededIds } from "../lib/project-memory/retirement.js";
import { sectionsFromMarkdown } from "../lib/project-memory/sections.js";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-10T00:00:00Z");
const TODAY = "2026-11-10";

/** A four-section document from a `{section: entries}` map. */
function doc(sections) {
	const order = ["project", "invariants", "pitfalls", "index"];
	const headings = { project: "## Project", invariants: "## Invariants", pitfalls: "## Pitfalls", index: "## Index" };
	return `# Project Memory\n\n${order.map((key) => `${headings[key]}\n${(sections[key] ?? []).map((entry) => `- ${entry}`).join("\n")}`).join("\n\n")}\n`;
}

function sectionsOf(sections) {
	const parsed = sectionsFromMarkdown(doc(sections));
	assert.notEqual(parsed, undefined, "fixture: the document must parse");
	return parsed;
}

async function projectDir() {
	const root = await mkdtemp(path.join(tmpdir(), "dsh-retirement-"));
	await mkdir(path.join(root, ".agents", "memory", "session-logs"), { recursive: true });
	return root;
}

// ---------------------------------------------------------------------------------------------------
// The tombstone file
// ---------------------------------------------------------------------------------------------------

test("a tombstone line survives a render/parse round trip", () => {
	const entries = [
		{ date: "2026-11-10", title: "scripts/check.sh 已不存在", reason: "anchor-drift" },
		{ date: "2026-11-09", title: "批量不续写 pi、单文件 append 会崩", reason: "superseded-by:d8ee" },
		{ date: "2026-11-08", title: "an old fact nobody mentions", reason: "unconfirmed" },
		{ date: "2026-11-07", title: "replaced without a readable id", reason: "superseded" },
	];
	assert.deepEqual(parseTombstones(renderTombstones(entries)), entries);
	assert.equal(renderTombstones([]), "", "an empty list renders nothing at all");
	// Anything that is not a tombstone line is skipped, not rejected: the file is a log, and one bad
	// line must not cost the pass the good ones around it.
	const hand = `${renderTombstones(entries)}\n- not a tombstone\n# a trailing note\n`;
	assert.deepEqual(parseTombstones(hand), entries);
});

test("a tombstone title is clipped to one line so the file stays parseable", () => {
	const line = tombstoneLine({ date: "2026-11-10", title: `${"长".repeat(400)}\nsecond line`, reason: "anchor-drift" });
	assert.ok(!line.includes("\n"), "a multi-line title would break the one-line-per-fact format");
	assert.equal(parseTombstones(line).length, 1);
});

test("appending the same retirement twice records it once", async () => {
	const root = await projectDir();
	const entry = { date: TODAY, title: "a fact that was retired", reason: "anchor-drift" };
	await appendTombstones(root, [entry]);
	await appendTombstones(root, [entry]);
	assert.deepEqual(await readTombstones(root), [entry], "the same fact retired twice is one retirement");
});

test("the tombstone file moves its oldest half to the archive instead of dropping it", async () => {
	const root = await projectDir();
	const total = MAX_RETIRED_LINES + 20;
	const entries = Array.from({ length: total }, (_, index) => ({ date: "2026-11-10", title: `fact ${index}`, reason: "unconfirmed" }));
	await appendTombstones(root, entries);
	const live = await readTombstones(root);
	const archived = await readArchivedTombstones(root);
	assert.equal(live.length + archived.length, total, "no tombstone may be deleted by the compression");
	assert.ok(live.length <= MAX_RETIRED_LINES, `the live file stays inside its budget (${live.length})`);
	assert.deepEqual([...archived, ...live].map((entry) => entry.title), entries.map((entry) => entry.title), "the split preserves order");
});

test("the prompt digest shows titles and dates, counts the rest, and is empty when nothing retired", () => {
	assert.equal(tombstoneDigest([]), "", "a project with no tombstones sends a byte-identical prompt");
	const entries = Array.from({ length: MAX_DIGEST_ENTRIES + 5 }, (_, index) => ({ date: "2026-11-10", title: `fact ${index}`, reason: "anchor-drift" }));
	const digest = tombstoneDigest(entries);
	assert.ok(digest.includes("5 more retired fact(s)"), "entries past the cap are counted, not silently dropped");
	assert.ok(!digest.includes("fact 0"), "the digest shows the newest entries, which are the ones a conversation can revive");
	assert.ok(digest.includes(`fact ${MAX_DIGEST_ENTRIES + 4}`), "the newest entry is shown");
	assert.ok(!digest.includes("anchor-drift"), "the reason stays out of the prompt");
});

// ---------------------------------------------------------------------------------------------------
// Entry ids
// ---------------------------------------------------------------------------------------------------

test("an entry id is preserved, minted deterministically, and never collides", () => {
	const first = sectionsOf({ project: ["kept（aaaa）", "needs an id"] });
	const stamped = stampEntryIds(first, new Set());
	assert.equal(entryTid(stamped.sections.project[0]), "aaaa", "an existing id is kept");
	assert.equal(stamped.sections.project[1].endsWith(`（${entryTid(stamped.sections.project[1])}）`), true, "a missing id is appended");
	assert.equal(stamped.added.length, 1);

	const again = stampEntryIds(sectionsOf({ project: ["kept（aaaa）", "needs an id"] }), new Set());
	assert.deepEqual(again.added, stamped.added, "the same body earns the same id on a later pass");

	// Two identical bodies in one document cannot share an id, or a tombstone would name both.
	const twins = stampEntryIds(sectionsOf({ project: ["same body", "same body"] }), new Set());
	assert.notEqual(entryTid(twins.sections.project[0]), entryTid(twins.sections.project[1]));
});

test("a supersedes declaration names the entry it replaces", () => {
	const sections = sectionsOf({ invariants: ["old rule（1111）", "new rule（2222）supersedes:1111"] });
	assert.deepEqual([...supersededIds(sections)], [["1111", "2222"]]);
});

// ---------------------------------------------------------------------------------------------------
// Trigger 1: anchor drift
// ---------------------------------------------------------------------------------------------------

test("anchor drift fires only on a path this project can actually check", async () => {
	const root = await projectDir();
	await mkdir(path.join(root, "src", "project-memory"), { recursive: true });
	await writeFile(path.join(root, "src", "project-memory", "present.ts"), "line\n", "utf8");
	await mkdir(path.join(root, "docs"), { recursive: true });
	await writeFile(path.join(root, "docs", "README.md"), "one\ntwo\n", "utf8");

	const { anchorDriftReasons } = await import("../lib/project-memory/retirement.js");
	// The real path exists: no drift, and a slash-separated phrase is not a path at all.
	assert.deepEqual(anchorDriftReasons("A fact about src/project-memory/present.ts and its line 1", root), []);
	for (const prose of ["turn/start and origin/main", "provider/model is chosen by resolveTarget", "the knee is W/450000", "Project/Index are exclusion lists"]) {
		assert.deepEqual(anchorDriftReasons(prose, root), [], `prose must not be read as a path: ${prose}`);
	}
	// A missing file under an existing directory is drift.
	assert.equal(anchorDriftReasons("A fact about src/project-memory/gone.ts", root).length, 1);
	// A missing *parent* is not checkable: it could belong to another checkout.
	assert.deepEqual(anchorDriftReasons("A fact about packages/subagent/subagent/src/child-agent.ts", root), []);
	assert.deepEqual(anchorDriftReasons("A fact about scripts/dsh-plugin-patches/PINNING-RISK.md", root), []);
	assert.deepEqual(anchorDriftReasons("A fact about .agents/evidence/2026-10-06-x/roundtrip.mjs", root), []);
	// A line anchor past the end of an existing file is drift.
	assert.equal(anchorDriftReasons("A fact about docs/README.md:2", root).length, 0);
	assert.equal(anchorDriftReasons("A fact about docs/README.md:9", root).length, 1);
});

test("the plugin's own local artifacts are never drift", async () => {
	// `errors.log`, the journal and the locks exist only once the plugin writes them, and a fresh clone
	// has none. A fact that points at one describes this plugin's own output, so its absence proves
	// nothing — retiring it would delete a true fact on every clean checkout.
	const root = await projectDir();
	await mkdir(path.join(root, "src", "project-memory"), { recursive: true });
	const { anchorDriftReasons } = await import("../lib/project-memory/retirement.js");
	for (const entry of [
		"`.agents/memory/errors.log` records each pass's refusal lines",
		"the journal is `.agents/memory/memory.jsonl`",
		"the index write takes `.agents/memory/session-index.lock`",
		"a backup is `MEMORY.md.memory-backup-2026-11-07T12-09-40-054Z-f60070db`",
	]) {
		assert.deepEqual(anchorDriftReasons(entry, root), [], `a local artifact is not drift: ${entry}`);
	}
	// A source file under an existing directory is still drift when it is gone.
	assert.equal(anchorDriftReasons("the pass lives in src/project-memory/gone.ts", root).length, 1);
});

// ---------------------------------------------------------------------------------------------------
// Trigger 2: supersedes
// ---------------------------------------------------------------------------------------------------

test("a superseded entry is retired with the replacing id, and the marker leaves the document", async () => {
	const root = await projectDir();
	const result = await retireReply(
		sectionsOf({ invariants: ["old rule（1111）", "new rule（2222）supersedes:1111"], pitfalls: ["unrelated（3333）"] }),
		{ projectRoot: root, firstSeen: new Map(), today: TODAY, now: NOW },
		40_000,
	);
	assert.deepEqual(result.retired, [{ date: TODAY, title: "old rule", reason: "superseded-by:2222" }]);
	assert.deepEqual(result.sections.invariants, ["new rule（2222）"], "the declaration is consumed, not stored");
	assert.deepEqual(result.sections.pitfalls, ["unrelated（3333）"], "nothing else is touched");
});

test("an echoed retired entry is dropped without a second tombstone", async () => {
	// The retired entries leave the prompt, but the conversation that drives the regeneration usually
	// still holds the fact. A reply that re-derives it must not put it back, and must not claim a second
	// retirement for the same fact.
	const root = await projectDir();
	await mkdir(path.join(root, "scripts"), { recursive: true });
	const first = await retireSections(sectionsOf({ pitfalls: ["stale fact about scripts/gone-echo.mjs"] }), {
		projectRoot: root,
		firstSeen: new Map(),
		today: TODAY,
		now: NOW,
	});
	assert.equal(first.retired.length, 1, "fixture: the anchor drift retires it");
	assert.deepEqual(first.sections.pitfalls, [], "fixture: this document has nothing left");
	const [retiredId] = [...first.droppedIds];

	const echoed = await retireReply(
		sectionsOf({ pitfalls: [`stale fact about scripts/gone-echo.mjs（${retiredId}）`, "fresh fact（2222）"] }),
		{ projectRoot: root, firstSeen: new Map(), today: TODAY, now: NOW, retiredIds: first.droppedIds },
		40_000,
	);
	assert.deepEqual(echoed.sections.pitfalls, ["fresh fact（2222）"], "the echo is dropped");
	assert.deepEqual(echoed.retired, [], "the retirement was already recorded by the first call");
});

// ---------------------------------------------------------------------------------------------------
// Trigger 3: unconfirmed
// ---------------------------------------------------------------------------------------------------

/** A project holding one archived session, optionally mentioning `needle`. */
async function archiveFixture({ mention }) {
	const root = await projectDir();
	const dir = path.join(root, ".agents", "memory", "session-logs", "session-abc");
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, "meta.json"), JSON.stringify({ id: "session-abc", date: new Date(NOW - 10 * DAY).toISOString().slice(0, 10) }), "utf8");
	await writeFile(path.join(dir, "session.jsonl"), JSON.stringify({ text: mention ? "we still run check-dsh-plugin-patches.sh every release" : "unrelated chatter" }), "utf8");
	return root;
}

const UNCONFIRMED_ENTRY = "The release script check-dsh-plugin-patches.sh must run before tagging（aaaa）";
const OLD_DATE = new Date(NOW - 200 * DAY).toISOString().slice(0, 10);

test("an old entry nothing mentions any more is unconfirmed", async () => {
	const root = await archiveFixture({ mention: false });
	const result = await retireSections(sectionsOf({ pitfalls: [UNCONFIRMED_ENTRY] }), {
		projectRoot: root,
		firstSeen: new Map([["aaaa", OLD_DATE]]),
		today: TODAY,
		now: NOW,
	});
	assert.deepEqual(result.retired, [{ date: TODAY, title: "The release script check-dsh-plugin-patches.sh must run before tagging", reason: "unconfirmed" }]);
	assert.deepEqual(result.sections.pitfalls, []);
});

test("a mention keeps the entry, and so does an age below the horizon", async () => {
	// Positive control for the scan: the same fixture, one word different.
	const root = await archiveFixture({ mention: true });
	const kept = await retireSections(sectionsOf({ pitfalls: [UNCONFIRMED_ENTRY] }), {
		projectRoot: root,
		firstSeen: new Map([["aaaa", OLD_DATE]]),
		today: TODAY,
		now: NOW,
	});
	assert.deepEqual(kept.retired, [], "an entry the archive still talks about is not unconfirmed");
	assert.equal(kept.sections.pitfalls.length, 1);

	const young = await retireSections(sectionsOf({ pitfalls: [UNCONFIRMED_ENTRY] }), {
		projectRoot: root,
		firstSeen: new Map([["aaaa", new Date(NOW - 30 * DAY).toISOString().slice(0, 10)]]),
		today: TODAY,
		now: NOW,
	});
	assert.deepEqual(young.retired, [], "an entry below the horizon is never unconfirmed");
});

test("an incomplete scan retires nothing", async () => {
	// The byte cap stops the scan before the archive is read. Answering from a partial scan would delete
	// a fact that is still in play, so incompleteness must be inert — the difference between "not found"
	// and "not looked for" is the whole safety property here.
	const root = await archiveFixture({ mention: false });
	const capped = await retireSections(sectionsOf({ pitfalls: [UNCONFIRMED_ENTRY] }), {
		projectRoot: root,
		firstSeen: new Map([["aaaa", OLD_DATE]]),
		today: TODAY,
		now: NOW,
		mentionByteCap: 1,
	});
	assert.deepEqual(capped.retired, [], "a partial scan proves nothing");
	assert.equal(capped.sections.pitfalls.length, 1);

	// The same project with an unbounded scan answers: this is the positive control that keeps the
	// assertion above from passing because the trigger never fires at all.
	const whole = await retireSections(sectionsOf({ pitfalls: [UNCONFIRMED_ENTRY] }), {
		projectRoot: root,
		firstSeen: new Map([["aaaa", OLD_DATE]]),
		today: TODAY,
		now: NOW,
	});
	assert.equal(whole.retired.length, 1, "a complete scan of the same project does retire");

	// An entry with no distinctive token cannot be verified either way, so it stays.
	assert.equal(mentionNeedle("短句（aaaa）"), undefined, "prose yields no needle");
});

// ---------------------------------------------------------------------------------------------------
// The id budget
// ---------------------------------------------------------------------------------------------------

test("ids are skipped rather than costing a whole entry", async () => {
	const root = await projectDir();
	// Sized so the document fits without ids and does not fit with them: 300 entries of ~140 characters
	// at a 40 000-character cap leaves no room for six more characters each.
	const entries = Array.from({ length: 250 }, (_, index) => `${String(index).padStart(3, "0")} ${"记".repeat(150)}`);
	const sections = sectionsOf({ project: entries });
	const result = await retireWithinBudget(sections, { projectRoot: root, firstSeen: new Map(), today: TODAY, now: NOW }, 40_000);
	assert.equal(result.stamped, false, "fixture: the ids must not fit");
	assert.equal(result.sections.project.length, 250, "no entry may be lost to a metadata stamp");
	assert.equal(entryTid(result.sections.project[0]), undefined, "the document is left without ids");
	assert.deepEqual(result.added, [], "nothing is recorded when nothing was stamped");
});

// ---------------------------------------------------------------------------------------------------
// End to end through the consolidation pass
// ---------------------------------------------------------------------------------------------------

/** Run one consolidation pass over `root` with a scripted reply. */
async function pass(root, memoryMarkdown, config) {
	const calls = [];
	const ctx = {
		logger: { info() {}, warn() {} },
		llm: {
			resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
			stream(options) {
				calls.push(options);
				return (async function* generate() {
					yield { type: "text-delta", index: 0, text: JSON.stringify({ memory_markdown: memoryMarkdown, context: { title: "t", summary: "s", key_points: [], open_tasks: [] } }) };
					yield { type: "finish", reason: { kind: "stop" } };
				})();
			},
		},
	};
	const agent = {
		options: { provider: "test-provider", model: "test-model" },
		session: {
			id: "session-z2",
			header: { cwd: root, createdAt: Date.now() },
			snapshotEvents: () => [],
			deriveEventMessage: () => null,
			deriveMessages: () => [],
			requestHeader: () => undefined,
		},
	};
	const outcome = await consolidateProjectState(ctx, agent, config, { force: true });
	const prompt = calls[0].messages[0].content.map((block) => block.text ?? "").join("\n");
	return { outcome, prompt, config };
}

async function land(root, outcome, config) {
	await recordMemoryDocument(root, outcome.result.memory, config.maxMemoryChars, { basisKey: outcome.basisKey });
	await appendTombstones(root, outcome.retirement.tombstones);
	await recordEntryDates(root, new Map(outcome.retirement.added), outcome.retirement.ids === undefined ? undefined : new Set(outcome.retirement.ids));
}

test("a stale anchor is retired by the pass: the body goes, the tombstone arrives, the prompt stops showing it", async () => {
	const root = await projectDir();
	await mkdir(path.join(root, "scripts"), { recursive: true });
	await writeFile(path.join(root, ".agents/memory/MEMORY.md"), doc({
		project: ["A durable fact"],
		invariants: ["The retired fact points at scripts/gone-probe.mjs:12"],
		pitfalls: ["Another durable fact"],
		index: ["docs/README.md is the docs index"],
	}), "utf8");
	const config = resolvePluginConfig({ maxTokens: 8192, maxOutputTokens: 32_768, consolidateTurns: 1, maxMemoryChars: 40_000, forceDedupeMs: 0 });
	const { outcome, prompt } = await pass(root, doc({
		project: ["A durable fact"],
		pitfalls: ["Another durable fact"],
		index: ["docs/README.md is the docs index"],
	}), config);

	assert.equal(outcome.retirement.tombstones.length, 1, "the pass reports the retirement");
	assert.equal(outcome.retirement.tombstones[0].reason, "anchor-drift");
	assert.equal(prompt.includes("gone-probe.mjs"), false, "the model is never shown the entry it would copy forward");

	await land(root, outcome, config);
	const stored = await readFile(path.join(root, ".agents/memory/MEMORY.md"), "utf8");
	assert.equal(stored.includes("gone-probe.mjs"), false, "the body is gone");
	assert.equal(stored.includes("Another durable fact"), true, "its neighbours are untouched");
	const tombstones = await readTombstones(root);
	assert.equal(tombstones.length, 1);
	assert.match(tombstones[0].title, /gone-probe\.mjs/);

	// Every entry the landed document carries has a first-seen date, or it could never expire.
	const sidecar = JSON.parse(await readFile(path.join(root, ".agents/memory/entries.json"), "utf8"));
	for (const line of stored.split("\n").filter((line) => line.startsWith("- "))) {
		const tid = entryTid(line);
		assert.notEqual(tid, undefined, `stored entry carries an id: ${line}`);
		assert.match(sidecar.entries[tid] ?? "", /^\d{4}-\d{2}-\d{2}$/, `entry ${tid} has a first-seen date`);
	}
});

test("the next pass is told what was retired, so the fact is not learned again", async () => {
	// The negative control for the digest: the same reply that re-adds the retired fact is *shown* the
	// tombstone digest, which is the only thing standing between a deletion and the next regeneration.
	const root = await projectDir();
	await writeFile(path.join(root, ".agents/memory/MEMORY.md"), doc({ pitfalls: ["a fact that will be retired"] }), "utf8");
	await appendTombstones(root, [{ date: TODAY, title: "a fact that will be retired", reason: "anchor-drift" }]);
	const config = resolvePluginConfig({ maxTokens: 8192, maxOutputTokens: 32_768, consolidateTurns: 1, maxMemoryChars: 40_000, forceDedupeMs: 0 });
	const { prompt } = await pass(root, doc({ pitfalls: ["a fresh fact"] }), config);
	const digest = /<retired-facts>[\s\S]*?<\/retired-facts>/.exec(prompt);
	assert.notEqual(digest, null, "the prompt carries the retired-fact block");
	assert.match(digest[0], /a fact that will be retired/, "the retired fact is named");
	assert.match(digest[0], /Do not write them back/, "and the instruction is stated");
	assert.doesNotMatch(digest[0], /anchor-drift/, "the reason is not injected");
});

test("a pass that lands nothing records no tombstone", async () => {
	// A tombstone claims an entry left the document. A reply tier C refuses, or one the empty-skeleton
	// gate stops, deletes nothing — and a tombstone written anyway would say the fact is dead while it
	// is still stored, which is worse than not retiring it at all.
	const root = await projectDir();
	await mkdir(path.join(root, "scripts"), { recursive: true });
	await writeFile(path.join(root, ".agents/memory/MEMORY.md"), doc({ pitfalls: ["points at scripts/gone2.mjs:1"] }), "utf8");
	const config = resolvePluginConfig({ maxTokens: 8192, maxOutputTokens: 32_768, consolidateTurns: 1, maxMemoryChars: 40_000, forceDedupeMs: 0 });
	const { outcome } = await pass(root, doc({}), config);
	assert.equal(outcome.semanticEmpty, true, "fixture: the reply carries no entry");
	assert.equal(outcome.retirement, undefined, "nothing landed, so nothing is retired");
	assert.equal(existsSync(path.join(root, ".agents/memory/retired.md")), false);
});
