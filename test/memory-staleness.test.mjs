/**
 * Batch V: memory entries bound to the files they cite, and the content drift that binding exposes.
 *
 * What this pins, and why each one exists:
 *
 *  - A binding is written **once**, when an entry is authored, and never refreshed while the entry's
 *    body is unchanged. Refreshing it on every pass would make the feature a tautology: a stale entry
 *    copied forward verbatim would end the pass "fresh" with nobody having re-read the file.
 *  - The four states stay distinct: `stale` (file changed), `missing` (file gone — the retirement pass
 *    owns that decision), `unverifiable` (could not read it), and no binding at all (never judged).
 *    Reporting any of them as `fresh` is the misattribution this repository treats as worst.
 *  - Nothing here deletes or rewrites: a stale entry stays in the document, and no tombstone is written.
 *  - The two halves stay split: `staleness.ts` judges plain maps with no disk access, and only
 *    `staleness-source.ts` knows what a path is on this filesystem.
 *  - A v1 sidecar (dates only) upgrades in place, and a sidecar carrying keys this version does not
 *    know about keeps them.
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { anchorCandidates } from "../lib/shared/anchors.js";
import { readEntrySidecar } from "../lib/project-memory/entry-sidecar.js";
import { memoryUpdateReply } from "../lib/project-memory/index.js";
import { anchorDriftReasons } from "../lib/project-memory/retirement.js";
import { sectionsFromMarkdown } from "../lib/project-memory/sections.js";
import { bindAndMeasure, measureStaleness } from "../lib/project-memory/staleness-source.js";
import { UNCHECKED_STALENESS, stalenessClause, summariseStaleness } from "../lib/project-memory/staleness.js";
import { formatMemoryStatus } from "../lib/project-memory/status-report.js";
import { entryDatesFile, memoryFile } from "../lib/shared/paths.js";

/** A four-section document with one anchored entry, so `sectionsFromMarkdown` accepts it. */
function documentWith(body, tid = "a1b") {
	return [
		"## Project",
		"",
		`- ${body}（${tid}）`,
		"",
		"## Invariants",
		"",
		"## Pitfalls",
		"",
		"## Index",
		"",
		"",
	].join("\n");
}

async function tempProject() {
	const root = await mkdtemp(path.join(tmpdir(), "batch-v-"));
	await mkdir(path.dirname(memoryFile(root)), { recursive: true });
	await mkdir(path.join(root, "src"), { recursive: true });
	return root;
}

async function writeSource(root, relative, text) {
	const file = path.join(root, relative);
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, text);
	return file;
}

/** The verdict for one entry of a document, measured against the real files. */
async function measure(root, document) {
	const sections = sectionsFromMarkdown(document);
	assert.notEqual(sections, undefined, "the fixture must parse as a four-section document");
	const bindings = (await readEntrySidecar(root)).sources;
	const map = {};
	for (const [tid, value] of bindings) map[tid] = Object.fromEntries(value);
	return summariseStaleness(sections, map, await hashesOf(root, map));
}

/** Hash the paths a binding map mentions, exactly as the adapter would. */
async function hashesOf(root, bindings) {
	const states = new Map();
	for (const entry of Object.values(bindings)) {
		for (const relative of Object.keys(entry)) {
			if (states.has(relative)) continue;
			try {
				const bytes = await readFile(path.join(root, relative));
				states.set(relative, { kind: "sha", value: createHash("sha256").update(bytes).digest("hex").slice(0, 16) });
			} catch (error) {
				states.set(relative, error?.code === "ENOENT" ? { kind: "missing" } : { kind: "unreadable" });
			}
		}
	}
	return states;
}

// --- the pure core -------------------------------------------------------------------------

test("the clause prints a zero as zero and an unmeasured verdict as unknown", () => {
	assert.equal(stalenessClause({ bound: 0, stale: 0, staleIds: [], missing: 0, unverifiable: 0, checked: true }), "stale 0 (no entry cites a bound file yet)");
	assert.equal(stalenessClause(UNCHECKED_STALENESS), "stale unknown (source bindings could not be read)");
	const clause = stalenessClause({ bound: 4, stale: 2, staleIds: ["a1b", "c2d"], missing: 0, unverifiable: 0, checked: true });
	assert.match(clause, /4 bound entries · stale 2: a1b, c2d/);
	assert.doesNotMatch(clause, /missing|unverifiable/, "absent categories are not printed as 0");
});

test("stale, missing and unverifiable are three different verdicts", () => {
	const sections = sectionsFromMarkdown(documentWith("the run passes `src/a.ts`"));
	const bindings = { a1b: { "src/a.ts": "0000000000000000" } };
	const stale = summariseStaleness(sections, bindings, new Map([["src/a.ts", { kind: "sha", value: "1111111111111111" }]]));
	const missing = summariseStaleness(sections, bindings, new Map([["src/a.ts", { kind: "missing" }]]));
	const unreadable = summariseStaleness(sections, bindings, new Map([["src/a.ts", { kind: "unreadable" }]]));
	assert.deepEqual([stale.stale, stale.missing, stale.unverifiable], [1, 0, 0]);
	assert.deepEqual([missing.stale, missing.missing], [0, 1]);
	assert.deepEqual([unreadable.stale, unreadable.unverifiable], [0, 1]);
	// No reading at all is "unverifiable", never "fresh": a missing map entry is not evidence of health.
	const unread = summariseStaleness(sections, bindings, new Map());
	assert.deepEqual([unread.stale, unread.unverifiable], [0, 1]);
});

// --- the adapter ---------------------------------------------------------------------------

test("a landed document binds the files it cites and reports them fresh", async () => {
	const root = await tempProject();
	await writeSource(root, "src/a.ts", "export const a = 1;\n");
	const document = documentWith("the run passes `src/a.ts`");
	await writeFile(memoryFile(root), document);
	const { facts } = await bindAndMeasure(root, document);
	assert.deepEqual([facts.bound, facts.stale, facts.checked], [1, 0, true]);
	const sidecar = await readEntrySidecar(root);
	const binding = sidecar.sources.get("a1b");
	assert.notEqual(binding, undefined, "the binding was written to the sidecar on disk");
	assert.equal(binding.get("src/a.ts"), createHash("sha256").update(await readFile(path.join(root, "src/a.ts"))).digest("hex").slice(0, 16));
});

test("a file changed after the entry was written reads stale, and a second pass does not clear it", async () => {
	const root = await tempProject();
	const file = await writeSource(root, "src/a.ts", "export const a = 1;\n");
	const document = documentWith("the run passes `src/a.ts`");
	await bindAndMeasure(root, document);
	await writeFile(file, "export const a = 2;\n");
	const first = await measure(root, document);
	assert.equal(first.stale, 1, "the changed file is reported");
	// The pass runs again with the same document: the entry was not re-authored, so its baseline must
	// survive — a refresh here would erase the only signal the feature produces.
	await bindAndMeasure(root, document);
	const second = await measure(root, document);
	assert.equal(second.stale, 1, "a pass that did not re-derive the fact must not clear its staleness");
});

test("a file deleted after the pass is `missing`, not `stale` and not fresh", async () => {
	const root = await tempProject();
	const file = await writeSource(root, "src/a.ts", "export const a = 1;\n");
	const document = documentWith("the run passes `src/a.ts`");
	await bindAndMeasure(root, document);
	await import("node:fs/promises").then(({ rm }) => rm(file));
	const facts = await measure(root, document);
	assert.deepEqual([facts.stale, facts.missing], [0, 1]);
});

test("generated and self-referential paths are not bound", async () => {
	const root = await tempProject();
	await writeSource(root, "lib/client.js", "// built\n");
	await mkdir(path.dirname(path.join(root, ".agents/memory/MEMORY.md")), { recursive: true });
	await writeSource(root, ".agents/memory/MEMORY.md", "# x\n");
	const document = documentWith("the built `lib/client.js` and `MEMORY.md` under `.agents/memory/`");
	const { facts } = await bindAndMeasure(root, document);
	assert.equal(facts.bound, 0, "lib/ is generated and .agents/memory/ is rewritten by this very pass");
	assert.equal(facts.stale, 0);
});

test("an opaque document binds nothing and leaves the sidecar alone", async () => {
	const root = await tempProject();
	await writeSource(root, "src/a.ts", "export const a = 1;\n");
	await writeFile(entryDatesFile(root), `${JSON.stringify({ version: 2, entries: {}, sources: { a1b: { "src/a.ts": "ffffffffffffffff" } } }, null, "\t")}\n`);
	const before = await readFile(entryDatesFile(root), "utf8");
	const { facts, written } = await bindAndMeasure(root, "just a sentence, not a memory document");
	assert.equal(written, false);
	assert.equal(facts.checked, false);
	assert.equal(await readFile(entryDatesFile(root), "utf8"), before, "a refused/opaque pass must not clear bindings");
});

test("a re-authored entry keeps its own identity: the old binding is pruned and the new one bound", async () => {
	const root = await tempProject();
	const file = await writeSource(root, "src/a.ts", "export const a = 1;\n");
	await bindAndMeasure(root, documentWith("the run passes `src/a.ts`", "a1b"));
	await writeFile(file, "export const a = 2;\n");
	// The model rewrote the fact: a new tid means a new authoring moment, so the baseline is re-taken.
	const reauthored = documentWith("the run passes `src/a.ts` (still)", "c2d");
	await bindAndMeasure(root, reauthored);
	const sidecar = await readEntrySidecar(root);
	assert.equal(sidecar.sources.has("a1b"), false, "the vanished id left no binding behind");
	const facts = await measure(root, reauthored);
	assert.deepEqual([facts.bound, facts.stale], [1, 0], "the newly authored entry is fresh against the current bytes");
});

test("the fingerprint is over bytes, not over a decoded string", async () => {
	const root = await tempProject();
	await writeSource(root, "src/a.ts", "export const é = '中文';\n");
	const document = documentWith("the run passes `src/a.ts`");
	await bindAndMeasure(root, document);
	const expected = createHash("sha256").update(await readFile(path.join(root, "src/a.ts"))).digest("hex").slice(0, 16);
	const stored = (await readEntrySidecar(root)).sources.get("a1b").get("src/a.ts");
	assert.equal(stored, expected, "a utf8-string hash would differ from the byte hash on non-ASCII content");
});

test("a v1 sidecar upgrades in place and keeps keys this version does not know", async () => {
	const root = await tempProject();
	await writeSource(root, "src/a.ts", "export const a = 1;\n");
	const legacy = { version: 1, entries: { a1b: "2026-01-02" }, note: "hand-added" };
	await writeFile(entryDatesFile(root), `${JSON.stringify(legacy, null, "\t")}\n`);
	await writeFile(memoryFile(root), documentWith("the run passes `src/a.ts`"));
	await bindAndMeasure(root, documentWith("the run passes `src/a.ts`"));
	const raw = JSON.parse(await readFile(entryDatesFile(root), "utf8"));
	assert.equal(raw.version, 3);
	assert.deepEqual(raw.confirmed, {}, "the v3 map is written even when nothing was accepted");
	assert.equal(raw.entries.a1b, "2026-01-02", "the age clock survives the upgrade");
	assert.equal(raw.note, "hand-added", "an unknown top-level key is preserved");
	assert.equal(typeof raw.sources.a1b["src/a.ts"], "string");
});

// --- the receipts ---------------------------------------------------------------------------

test("the status receipt carries the verdict, and omits it when nothing measured", () => {
	const base = {
		document: documentWith("the run passes `src/a.ts`"),
		source: "/p/.agents/memory/MEMORY.md",
		expectedPath: "/p/.agents/memory/MEMORY.md",
		journalPath: "/p/.agents/memory/memory.jsonl",
		maxChars: 45_000,
		damaged: 0,
		unreadable: false,
		poisoned: false,
		cappedDroppedChars: 0,
		files: { journal: { kind: "absent" }, backups: 0, archivedSessions: 0, errorLogLines: 0 },
	};
	const withVerdict = formatMemoryStatus({ ...base, staleness: { bound: 2, stale: 1, staleIds: ["a1b"], missing: 0, unverifiable: 0, checked: true } });
	assert.match(withVerdict.text, /2 bound entries · stale 1: a1b/);
	const without = formatMemoryStatus(base);
	assert.doesNotMatch(without.text, /bound entr|stale /, "an unmeasured verdict is absent, never printed as 0");
});

test("the update receipt appends the verdict only when an entry was actually judged", () => {
	const report = {
		status: "updated",
		memoryWritten: true,
		contextWritten: false,
		contextDroppedChars: 0,
		memoryWriteDroppedChars: 0,
		sectionDropped: 0,
		droppedItems: 0,
		itemTruncated: 0,
		partialRefused: false,
	};
	assert.equal(memoryUpdateReply(report).text, "Memory: updated MEMORY.md.", "no bindings → no sentence");
	const judged = memoryUpdateReply({ ...report, staleness: { bound: 3, stale: 1, staleIds: ["a1b"], missing: 0, unverifiable: 0, checked: true } });
	assert.match(judged.text, /Source bindings: 3 bound entries · stale 1: a1b\.$/);
	const unbound = memoryUpdateReply({ ...report, staleness: { bound: 0, stale: 0, staleIds: [], missing: 0, unverifiable: 0, checked: true } });
	assert.equal(unbound.text, "Memory: updated MEMORY.md.", "a pass that judged nothing must not add noise");
});

// --- refactor equivalence -------------------------------------------------------------------

test("the anchor rules are the same ones drift detection already used", async () => {
	// Froze the pre-refactor answers: dedupe asymmetry (one reason for a missing path, one per
	// past-EOF line), the range's *end* line, the lenient line count, absolute paths, `..`, globs,
	// local artifacts and a missing parent.
	const root = await mkdtemp(path.join(tmpdir(), "batch-v-equivalence-"));
	// Rule 2 of drift detection: a missing *parent* is ambiguity, not drift — so the parent exists here
	// and only the file is gone, which is the case that must report once.
	await mkdir(path.join(root, "no-such"), { recursive: true });
	assert.deepEqual(anchorCandidates("see `src/a.ts` and `src/a.ts:12`").map((token) => [token.path, token.line]), [["src/a.ts", undefined], ["src/a.ts", 12]]);
	assert.deepEqual(anchorCandidates("`src/*.ts` and `src/**/*.ts`"), [], "a glob is not a candidate");
	// A bare file name is not a candidate at all (the rule needs a slash); its local-artifact twin is a
	// candidate that drift then filters out.
	assert.deepEqual(anchorCandidates("`errors.log`"), []);
	assert.deepEqual(anchorCandidates("`.agents/memory/errors.log`").map((token) => token.path), [".agents/memory/errors.log"]);
	const reasons = anchorDriftReasons("see `no-such/a.ts` and `no-such/a.ts:5`", root);
	assert.deepEqual(reasons, ["no-such/a.ts does not exist"], "the missing path is reported once, by its bare form");
});
