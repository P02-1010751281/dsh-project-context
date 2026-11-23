/**
 * Batch AA2: content drift gets an explicit channel.
 *
 * The state machine already labels an entry whose cited file changed, and `summariseStaleness` already
 * prints that label in a receipt. What it cannot do is name more than three entries or let one be
 * re-verified, so this batch adds the per-entry view (`staleEntriesOf`), the re-baseline
 * (`acceptStaleness`), and the two receipts `/memory reconcile` renders.
 *
 * The load-bearing case is the merge: an acceptance must survive a consolidation pass that read the
 * sidecar before it. Without that, `--accept` reports success and the entry is stale again on the next
 * receipt — a wrong cause, which this repository treats as worse than a silent one.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { acceptEntryState, apply as applyMemory, memoryAcceptReply, memoryReconcileReply } from "../lib/project-memory/index.js";
import { memoryEntryStates } from "../lib/project-memory/entry-states.js";
import { sectionsFromMarkdown } from "../lib/project-memory/sections.js";
import { memoryExpiryRule } from "../lib/project-memory/consolidate.js";
import { mergeBaselines, acceptStaleness, measureStalenessDetail } from "../lib/project-memory/staleness-source.js";
import { staleEntriesOf, summariseStaleness } from "../lib/project-memory/staleness.js";

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

/** The fingerprint the plugin writes: a lower-case SHA-256 prefix. */
function fingerprint(text) {
	return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

const SHA_A = "a".repeat(16);
const SHA_B = "b".repeat(16);

async function projectDir() {
	const root = await mkdtemp(path.join(tmpdir(), "dsh-reconcile-"));
	await mkdir(path.join(root, ".agents", "memory"), { recursive: true });
	return root;
}

/** Write the sidecar the plugin's reader expects, with the real v2 shape. */
async function writeSidecar(root, sources, entries = {}) {
	const raw = { version: 2, entries, sources };
	await writeFile(path.join(root, ".agents", "memory", "entries.json"), `${JSON.stringify(raw, null, "\t")}\n`, "utf8");
}

async function writeMemory(root, sections) {
	await writeFile(path.join(root, ".agents", "memory", "MEMORY.md"), doc(sections), "utf8");
}

// ---------------------------------------------------------------------------------------------------
// The per-entry view
// ---------------------------------------------------------------------------------------------------

test("the per-entry view names every changed file, and only entries that have a binding", () => {
	const sections = sectionsOf({
		project: ["one file（aaa）", "two files（bbb）", "no binding（ccc）"],
		invariants: ["clean（ddd）"],
	});
	const bindings = {
		aaa: { "src/a.ts": SHA_A },
		bbb: { "src/a.ts": SHA_A, "docs/b.md": SHA_B },
		ddd: { "src/a.ts": SHA_A },
	};
	const files = new Map([
		["src/a.ts", { kind: "sha", value: SHA_A }],
		["docs/b.md", { kind: "sha", value: "c".repeat(16) }],
	]);
	// Only `bbb` has a changed file: `aaa` and `ddd` still match, and `ccc` has no binding at all.
	assert.deepEqual(staleEntriesOf(sections, bindings, files), [{ tid: "bbb", paths: ["docs/b.md"] }]);

	files.set("src/a.ts", { kind: "sha", value: "d".repeat(16) });
	// Now the shared file changed too, so every entry bound to it is stale — `ddd` included, which is the
	// point: the view follows the bindings, not a hand-kept list.
	assert.deepEqual(staleEntriesOf(sections, bindings, files), [
		{ tid: "aaa", paths: ["src/a.ts"] },
		{ tid: "bbb", paths: ["src/a.ts", "docs/b.md"] },
		{ tid: "ddd", paths: ["src/a.ts"] },
	]);
});

test("the receipt counts are unchanged: three ids at most, and the same four numbers", () => {
	const sections = sectionsOf({
		project: ["first（aaa）", "second（bbb）", "third（ccc）", "fourth（ddd）"],
		invariants: ["gone（eee）", "unreadable（fff）"],
	});
	const bindings = {
		aaa: { "src/a.ts": SHA_A },
		bbb: { "src/a.ts": SHA_A },
		ccc: { "src/a.ts": SHA_A },
		ddd: { "src/a.ts": SHA_A },
		eee: { "src/gone.ts": SHA_A },
		fff: { "src/fifo.ts": SHA_A },
	};
	const files = new Map([
		["src/a.ts", { kind: "sha", value: SHA_B }],
		["src/gone.ts", { kind: "missing" }],
		["src/fifo.ts", { kind: "unreadable" }],
	]);
	// Four entries are stale, but a receipt names three; the per-entry view still carries all four.
	assert.deepEqual(summariseStaleness(sections, bindings, files), {
		bound: 6,
		stale: 4,
		staleIds: ["aaa", "bbb", "ccc"],
		missing: 1,
		unverifiable: 1,
		checked: true,
	});
	assert.equal(staleEntriesOf(sections, bindings, files).length, 4);
});

// ---------------------------------------------------------------------------------------------------
// The merge: an acceptance must not be undone by a pass that read the sidecar first
// ---------------------------------------------------------------------------------------------------

test("a baseline written after the pass read the sidecar wins, and a new binding is still recorded", () => {
	// `aaa` was accepted while the pass was hashing: the accepted value is the one on disk now, while the
	// pass still holds the pre-accept value it read. `bbb` is newly bound by this pass.
	const current = new Map([["aaa", new Map([["src/a.ts", SHA_B]])]]);
	const next = new Map([
		["aaa", new Map([["src/a.ts", SHA_A]])],
		["bbb", new Map([["src/b.ts", SHA_A]])],
	]);
	const merged = mergeBaselines(current, next);
	assert.deepEqual(merged.get("aaa"), new Map([["src/a.ts", SHA_B]]), "the concurrent acceptance must survive");
	assert.deepEqual(merged.get("bbb"), new Map([["src/b.ts", SHA_A]]), "a first binding is still written");
	// The control: nothing else moved.
	assert.equal(merged.size, 2);
});

// ---------------------------------------------------------------------------------------------------
// The acceptance, through the real store
// ---------------------------------------------------------------------------------------------------

test("accepting a stale entry re-baselines it, through the sidecar, and the drift disappears", async () => {
	const root = await projectDir();
	const cited = path.join(root, "src", "a.ts");
	await mkdir(path.join(root, "src"), { recursive: true });
	await writeFile(cited, "line one\n", "utf8");
	const authored = fingerprint("line one\n");
	await writeMemory(root, { project: ["a fact about `src/a.ts`（aaa）"] });
	await writeSidecar(root, { aaa: { "src/a.ts": authored } }, { aaa: "2026-11-01" });
	const text = doc({ project: ["a fact about `src/a.ts`（aaa）"] });

	// The file moves after the baseline was recorded, which is exactly the state V reports.
	await writeFile(cited, "line one\nline two\n", "utf8");
	const before = await measureStalenessDetail(root, text);
	assert.equal(before.facts.stale, 1);
	assert.deepEqual(before.stale, [{ tid: "aaa", paths: ["src/a.ts"] }]);

	const outcome = await acceptStaleness(root, text, "aaa");
	assert.deepEqual(outcome, { status: "accepted", paths: ["src/a.ts"] });

	const after = await measureStalenessDetail(root, text);
	assert.equal(after.facts.stale, 0, "the entry stops being reported as stale");
	assert.equal(after.facts.bound, 1, "accepting does not unbound the entry");

	// The sidecar on disk carries the new fingerprint and keeps the age clock untouched.
	const raw = JSON.parse(await readFile(path.join(root, ".agents", "memory", "entries.json"), "utf8"));
	assert.equal(raw.sources.aaa["src/a.ts"], fingerprint("line one\nline two\n"));
	assert.equal(raw.entries.aaa, "2026-11-01", "the age clock is not the baseline and must not move");

	// A second acceptance is a no-op it names, rather than a silent success.
	assert.deepEqual(await acceptStaleness(root, text, "aaa"), { status: "not-stale" });
});

test("a non-existent file is anchor drift, and accepting it writes nothing", async () => {
	const root = await projectDir();
	await writeMemory(root, { project: ["a fact about `src/gone.ts`（aaa）"] });
	await writeSidecar(root, { aaa: { "src/gone.ts": SHA_A } });
	const text = doc({ project: ["a fact about `src/gone.ts`（aaa）"] });

	assert.deepEqual(await acceptStaleness(root, text, "aaa"), { status: "anchor-missing", paths: ["src/gone.ts"] });
	const raw = JSON.parse(await readFile(path.join(root, ".agents", "memory", "entries.json"), "utf8"));
	assert.equal(raw.sources.aaa["src/gone.ts"], SHA_A, "a refusal leaves the baseline byte-identical");
});

test("an id this document does not carry, an entry with no binding, and an unreadable store each refuse by name", async () => {
	const root = await projectDir();
	await writeMemory(root, { project: ["no binding（ccc）"] });
	await writeSidecar(root, { aaa: { "src/a.ts": SHA_A } });
	const text = doc({ project: ["no binding（ccc）"] });

	assert.deepEqual(await acceptStaleness(root, text, "fff"), { status: "unknown-entry" });
	assert.deepEqual(await acceptStaleness(root, text, "ccc"), { status: "no-binding" });

	// A sidecar that cannot be parsed is a named absence, never a clean memory.
	await writeFile(path.join(root, ".agents", "memory", "entries.json"), "{ not json\n", "utf8");
	assert.deepEqual(await acceptStaleness(root, text, "aaa"), { status: "unreadable-store" });
	assert.equal((await measureStalenessDetail(root, text)).facts.checked, false);
});

test("a document that is not a four-section memory is refused, not guessed at", async () => {
	const root = await projectDir();
	await writeSidecar(root, { aaa: { "src/a.ts": SHA_A } });
	assert.deepEqual(await acceptStaleness(root, "# Notes\n\n- something else\n", "aaa"), { status: "unreadable-store" });
	assert.equal((await measureStalenessDetail(root, "# Notes\n\n- something else\n")).facts.checked, false);
});

// ---------------------------------------------------------------------------------------------------
// The receipts
// ---------------------------------------------------------------------------------------------------

/** The arbiter's verdict for a document, as the receipts consume it. */
function statesOf(entries, total = entries.length) {
	return { checked: true, total, entries };
}

test("the reconcile receipt puts the verdict on the first line and names the entry, its state and the file", () => {
	const states = statesOf([
		{ tid: "ef8", state: "content-stale", detail: "src/project-memory/retirement.ts" },
		{ tid: "dc5", state: "content-stale", detail: "src/shared/model-call.ts" },
	]);
	const reply = memoryReconcileReply(states, { cappedDroppedChars: 0 });
	assert.equal(reply.kind, "success");
	const [first] = reply.text.split("\n");
	assert.match(first, /^Memory reconcile: 2 of 2 entries have a reason to re-verify/, `the payload must survive the collapsed card, got ${first}`);
	assert.match(reply.text, /ef8 — content-stale — src\/project-memory\/retirement\.ts/);
	assert.match(reply.text, /--accept <id>/, "the receipt names the lever");
	assert.doesNotMatch(reply.text, /hid \d+ character/, "nothing was hidden, so nothing is claimed");
});

test("a healthy, unchecked and read-capped document each read differently", () => {
	const healthy = memoryReconcileReply(statesOf([], 12), { cappedDroppedChars: 0 });
	assert.match(healthy.text, /no entry has a reason to re-verify — all 12 entries are healthy/);

	const unchecked = memoryReconcileReply({ checked: false, total: 0, entries: [] }, { cappedDroppedChars: 0 });
	assert.equal(unchecked.kind, "error");
	assert.match(unchecked.text, /unknown/);

	const capped = memoryReconcileReply(statesOf([{ tid: "ef8", state: "content-stale", detail: "src/a.ts" }], 25), { cappedDroppedChars: 900 });
	assert.match(capped.text, /hid 900 character\(s\), so entries past that point were not judged/, "a truncated view must not read as a complete scan");
});

test("every acceptance outcome says its own cause, so the reader's next move differs", () => {
	const accepted = memoryAcceptReply({ kind: "content-stale", outcome: { status: "accepted", paths: ["src/a.ts"] } }, "aaa");
	assert.match(accepted.text, /accepted aaa/);
	assert.match(accepted.text, /src\/a\.ts/);

	const confirmed = memoryAcceptReply({ kind: "confirmed", reason: "task-closed" }, "aaa");
	assert.equal(confirmed.kind, "success");
	assert.match(confirmed.text, /recorded that you confirmed it/);
	assert.match(confirmed.text, /"task-closed" stops being reported/);
	assert.match(confirmed.text, /any other reason for the same entry still is/, "accepting one claim must not imply the others");

	const missing = memoryAcceptReply({ kind: "content-stale", outcome: { status: "anchor-missing", paths: ["src/gone.ts"] } }, "aaa");
	assert.equal(missing.kind, "error");
	assert.match(missing.text, /anchor drift/, "a missing anchor is the retirement pass's business, not a re-baseline");

	const retirable = memoryAcceptReply({ kind: "retirable", state: "age-unconfirmed" }, "aaa");
	assert.equal(retirable.kind, "error");
	assert.match(retirable.text, /the retirement engine owns that state/);

	assert.match(memoryAcceptReply({ kind: "healthy" }, "aaa").text, /no reason to re-verify/);
	assert.match(memoryAcceptReply({ kind: "unknown-entry" }, "fff").text, /no entry fff/);
	assert.match(memoryAcceptReply({ kind: "unreadable-store" }, "aaa").text, /nothing was changed/);
	assert.match(memoryAcceptReply({ kind: "content-stale", outcome: { status: "raced" } }, "aaa").text, /run the command again/i);
});

// ---------------------------------------------------------------------------------------------------
// The two states a fingerprint cannot see, and their exit
// ---------------------------------------------------------------------------------------------------

/** A task document the way `/context task` writes one. */
function taskDoc(status, lastSeen = "2026-11-20") {
	return `> created 2026-11-01 · status ${status} · lastSeen ${lastSeen} · title t\n\n## Summary\n- a task\n`;
}

test("entry state: a closed task, a released claim, and their exit by confirmation", async () => {
	const root = await projectDir();
	await mkdir(path.join(root, ".agents", "memory", "tasks"), { recursive: true });
	await writeFile(path.join(root, ".agents", "memory", "tasks", "old-work.md"), taskDoc("archived"), "utf8");
	// An open task the entry also cites: the reason must fire for the closed one only.
	await writeFile(path.join(root, ".agents", "memory", "tasks", "active-work.md"), taskDoc("active"), "utf8");
	await mkdir(path.join(root, "docs", "changelog"), { recursive: true });
	await writeFile(path.join(root, "docs", "changelog", "v0.9.0.md"), "# 0.9.0\n\n**project-memory（批次 Z9q：shipped thing）**\n", "utf8");
	const sections = {
		project: [
			"a fact that depends on `tasks/old-work.md`（aaa）",
			"Z9q 只在 未发布 里（bbb）",
			"the release procedure moves `未发布` into a changelog（ccc）",
			"nothing to see（ddd）",
			// Names a released marker but claims no unreleased state: the marker alone must not fire.
			"batch Z9q landed the three-hex entry ids（eee）",
			// The task is open, so this entry is healthy even though it cites a task document.
			// The id must be hex: `entryTid` only recognises `（[0-9a-f]{3,4}）`, and a non-hex id makes
			// the entry silently invisible to every state — a control that proves nothing.
			"a fact about `tasks/active-work.md`（f01）",
		],
	};
	await writeMemory(root, sections);
	await writeSidecar(root, {});
	const text = doc(sections);

	const states = await memoryEntryStates(root, text, { taskMode: "manual" });
	assert.equal(states.checked, true);
	assert.deepEqual(
		states.entries.map((entry) => [entry.tid, entry.state]),
		[["aaa", "task-closed"], ["bbb", "version-shipped"]],
		"`ccc` only mentions 未发布 as a procedure and names no marker; `eee` names a shipped marker but claims nothing unreleased — neither may fire",
	);
	assert.match(states.entries[0].detail, /tasks\/old-work\.md \(archived\)/);
	assert.match(states.entries[1].detail, /docs\/changelog\/v0\.9\.0\.md \(Z9q\)/);

	// Accepting one reason clears it and nothing else: `bbb` keeps its own state.
	assert.equal((await acceptEntryState(root, text, states, "aaa")).kind, "confirmed");
	const after = await memoryEntryStates(root, text, { taskMode: "manual" });
	assert.deepEqual(after.entries.map((entry) => entry.tid), ["bbb"]);
	const raw = JSON.parse(await readFile(path.join(root, ".agents", "memory", "entries.json"), "utf8"));
	assert.deepEqual(raw.confirmed.aaa, ["task-closed"]);

	// Accepting a healthy entry says so instead of writing a marker.
	assert.equal((await acceptEntryState(root, text, after, "ddd")).kind, "healthy");
	// An id the document does not carry is a different answer from a healthy one.
	assert.equal((await acceptEntryState(root, text, after, "fff")).kind, "unknown-entry");
});

test("a retirable state is refused by the acceptance, because the retirement engine owns it", async () => {
	const root = await projectDir();
	const sections = { project: ["kept（aaa）", "needs an id（bbb）"] };
	await writeMemory(root, sections);
	await writeSidecar(root, {});
	const states = await memoryEntryStates(root, doc(sections), { taskMode: "manual" });
	// `bbb` is healthy here; force the verdict the retirement engine would give and check the refusal path.
	const retirable = await acceptEntryState(root, doc(sections), { checked: true, total: 2, entries: [{ tid: "bbb", state: "anchor-drift", detail: "src/gone.ts does not exist" }] }, "bbb");
	assert.equal(retirable.kind, "retirable");
	assert.equal(states.checked, true);
});

// ---------------------------------------------------------------------------------------------------
// Wiring: the command the host registers really routes to it
// ---------------------------------------------------------------------------------------------------

test("the registered /memory command routes 'reconcile' to the state report", async () => {
	const root = await projectDir();
	const cited = path.join(root, "src", "a.ts");
	await mkdir(path.join(root, "src"), { recursive: true });
	await writeFile(cited, "after\n", "utf8");
	await writeMemory(root, { project: ["a fact about `src/a.ts`（aaa）"] });
	await writeSidecar(root, { aaa: { "src/a.ts": fingerprint("before\n") } });

	let handler;
	applyMemory(
		{
			logger: { info() {}, warn() {} },
			systemPrompt: { context: () => undefined },
			on: () => () => undefined,
			commands: { register: (registration) => { handler = registration.handler; } },
		},
		{ memoryEnabled: true },
	);
	assert.equal(typeof handler, "function", "control: the plugin registered a command handler");

	const agent = { session: { header: { cwd: root }, deriveMessages: () => [], snapshotEvents: () => [] } };
	const receipt = await handler({ agent, rawInput: "reconcile", signal: undefined });
	assert.equal(receipt.kind, "success", receipt.text);
	assert.match(receipt.text, /1 of 1 entry has a reason to re-verify/);
	assert.match(receipt.text, /aaa — content-stale — src\/a\.ts/);

	// The usage line still answers an unknown verb, and now names the new one.
	const unknown = await handler({ agent, rawInput: "nonsense", signal: undefined });
	assert.equal(unknown.kind, "error");
	assert.match(unknown.text, /\/memory reconcile/, "the usage line must not hide a verb the command accepts");
});

test("the expiry rule names the reason, the evidence and the prohibition, and stops being a list", () => {
	assert.equal(memoryExpiryRule([]), "", "nothing to report means no prompt tokens");
	const one = memoryExpiryRule([{ tid: "aaa", state: "task-closed", detail: "tasks/old-work.md (archived)" }]);
	assert.match(one, /aaa \(task-closed: tasks\/old-work\.md \(archived\)\)/);
	assert.match(one, /Never invent a path/);
	assert.match(one, /never delete an entry that is still true/);
	assert.doesNotMatch(one, /and \d+ more/, "one entry needs no tail");

	const many = memoryExpiryRule(Array.from({ length: 13 }, (_, index) => ({ tid: `a0${index}`, state: "content-stale", detail: "src/a.ts" })));
	assert.match(many, /and 3 more of the same kind/, "the rule names ten and counts the rest");
});
