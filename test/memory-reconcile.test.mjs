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

import { apply as applyMemory, memoryAcceptReply, memoryReconcileReply } from "../lib/project-memory/index.js";
import { sectionsFromMarkdown } from "../lib/project-memory/sections.js";
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

test("the reconcile receipt puts the verdict on the first line and names the entry and its file", () => {
	const reading = {
		facts: { bound: 25, stale: 2, staleIds: ["ef8", "dc5"], missing: 0, unverifiable: 0, checked: true },
		stale: [
			{ tid: "ef8", paths: ["src/project-memory/retirement.ts"] },
			{ tid: "dc5", paths: ["src/shared/model-call.ts"] },
		],
	};
	const reply = memoryReconcileReply(reading, { cappedDroppedChars: 0 });
	assert.equal(reply.kind, "success");
	const [first] = reply.text.split("\n");
	assert.match(first, /^Memory reconcile: 2 of 25 bound entries/, `the payload must survive the collapsed card, got ${first}`);
	assert.match(reply.text, /ef8 → src\/project-memory\/retirement\.ts/);
	assert.match(reply.text, /--accept <id>/, "the receipt names the lever");
	assert.doesNotMatch(reply.text, /hid \d+ character/, "nothing was hidden, so nothing is claimed");
});

test("a clean, empty, unchecked and read-capped memory each read differently", () => {
	const clean = memoryReconcileReply({ facts: { bound: 25, stale: 0, staleIds: [], missing: 0, unverifiable: 0, checked: true }, stale: [] }, { cappedDroppedChars: 0 });
	assert.match(clean.text, /no drift — all 25 bound entries/);

	const unbounded = memoryReconcileReply({ facts: { bound: 0, stale: 0, staleIds: [], missing: 0, unverifiable: 0, checked: true }, stale: [] }, { cappedDroppedChars: 0 });
	assert.match(unbounded.text, /nothing to check/, "an unbound memory is not a clean one");

	const unchecked = memoryReconcileReply({ facts: { bound: 0, stale: 0, staleIds: [], missing: 0, unverifiable: 0, checked: false }, stale: [] }, { cappedDroppedChars: 0 });
	assert.equal(unchecked.kind, "error");
	assert.match(unchecked.text, /unknown/);

	const capped = memoryReconcileReply({ facts: { bound: 25, stale: 1, staleIds: ["ef8"], missing: 0, unverifiable: 0, checked: true }, stale: [{ tid: "ef8", paths: ["src/a.ts"] }] }, { cappedDroppedChars: 900 });
	assert.match(capped.text, /hid 900 character\(s\), so entries past that point were not judged/, "a truncated view must not read as a complete scan");
});

test("every acceptance refusal says its own cause, so the reader's next move differs", () => {
	const accepted = memoryAcceptReply({ status: "accepted", paths: ["src/a.ts"] }, "aaa");
	assert.match(accepted.text, /accepted aaa/);
	assert.match(accepted.text, /src\/a\.ts/);

	const missing = memoryAcceptReply({ status: "anchor-missing", paths: ["src/gone.ts"] }, "aaa");
	assert.equal(missing.kind, "error");
	assert.match(missing.text, /anchor drift/, "a missing anchor is the retirement pass's business, not a re-baseline");
	assert.match(missing.text, /\/memory update/);

	assert.match(memoryAcceptReply({ status: "unknown-entry" }, "fff").text, /no entry fff/);
	assert.match(memoryAcceptReply({ status: "no-binding" }, "ccc").text, /cites no checkable file/);
	assert.match(memoryAcceptReply({ status: "not-stale" }, "aaa").text, /not stale/);
	assert.match(memoryAcceptReply({ status: "unreadable", paths: ["src/x.ts"] }, "aaa").text, /could not be read/);
	assert.match(memoryAcceptReply({ status: "unreadable-store" }, "aaa").text, /nothing was changed/);
	assert.match(memoryAcceptReply({ status: "raced" }, "aaa").text, /run the command again/i);
});

// ---------------------------------------------------------------------------------------------------
// Wiring: the command the host registers really routes to it
// ---------------------------------------------------------------------------------------------------

test("the registered /memory command routes 'reconcile' to the drift report", async () => {
	const root = await projectDir();
	const cited = path.join(root, "src", "a.ts");
	await mkdir(path.join(root, "src"), { recursive: true });
	await writeFile(cited, "before\n", "utf8");
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

	const agent = { session: { header: { cwd: root } } };
	const receipt = await handler({ agent, rawInput: "reconcile", signal: undefined });
	assert.equal(receipt.kind, "success", receipt.text);
	assert.match(receipt.text, /1 of 1 bound entry/);
	assert.match(receipt.text, /aaa → src\/a\.ts/);

	// The usage line still answers an unknown verb, and now names the new one.
	const unknown = await handler({ agent, rawInput: "nonsense", signal: undefined });
	assert.equal(unknown.kind, "error");
	assert.match(unknown.text, /\/memory reconcile/, "the usage line must not hide a verb the command accepts");
});
