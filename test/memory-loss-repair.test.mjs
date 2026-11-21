/**
 * Batch AC: the repair half of the rewrite-loss gate.
 *
 * `missing-literals.ts` reports; three real passes on 2026-11-21 showed reporting is not enough — the
 * same pitfall was dropped twice in one evening. This suite pins the one case that is mechanically
 * decidable: an entry whose normalized text is gone **and** whose backticked literals are gone with it.
 *
 * Every case here is a discriminator between "the model reworded or merged" (never touched) and
 * "the model dropped a fact" (put back verbatim), plus the three refusals that keep the repair from
 * resurrecting something: a `supersedes:` declaration, a section a pass is supposed to rewrite, and a
 * document where the restored lines no longer fit.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { lostEntries, repairLostEntries } from "../lib/project-memory/lost-entry-repair.js";
import { sectionsFromMarkdown, renderMemoryDocument } from "../lib/project-memory/sections.js";
import { consolidateProject, memoryUpdateReply } from "../lib/project-memory/index.js";
import { recordMemoryDocument } from "../lib/project-memory/memory-store.js";
import { resolvePluginConfig } from "../lib/shared/config.js";
import { memoryFile } from "../lib/shared/project-state.js";

const CAP = 40000;

/** A four-section document, so every case states only the entries it is about. */
function sections({ project = [], invariants = [], pitfalls = [], index = [] } = {}) {
	return { project, invariants, pitfalls, index };
}

const KEPT = sections({
	project: ["the project `dsh` is a plugin package"],
	invariants: ["rule `alpha` holds（1ab）"],
	pitfalls: ["pit `beta` bites（2cd）"],
	index: ["`docs/README.md` is the index"],
});

test("an untouched document loses nothing", () => {
	assert.deepEqual(lostEntries(KEPT, KEPT), []);
	assert.equal(repairLostEntries(KEPT, KEPT, CAP).kind, "nothing-lost");
});

test("a reworded entry keeps its literal, so rewording is not a loss", () => {
	// The model may legitimately tighten an entry's prose; the symbol it is about stays, which is the
	// whole discriminator. Repairing here would re-add a worse copy of a line the model improved.
	const after = sections({
		project: KEPT.project,
		invariants: ["the invariant is that `alpha` holds"],
		pitfalls: KEPT.pitfalls,
		index: KEPT.index,
	});
	assert.deepEqual(lostEntries(KEPT, after), []);
});

test("a merged entry hides behind the literal the merge kept", () => {
	// Two entries folded into one keeps both facts without keeping either line. This is the false
	// positive that would make the repair untrustworthy, so it is pinned next to the true case.
	const after = sections({
		project: KEPT.project,
		invariants: ["`alpha` and `beta` are both invariants now"],
		pitfalls: [],
		index: KEPT.index,
	});
	assert.deepEqual(lostEntries(KEPT, after), []);
});

test("an entry dropped with its literals is restored verbatim, in its own section", () => {
	const after = sections({
		project: KEPT.project,
		invariants: [],
		pitfalls: KEPT.pitfalls,
		index: KEPT.index,
	});
	const lost = lostEntries(KEPT, after);
	assert.deepEqual(lost, [{ section: "invariants", entry: "rule `alpha` holds（1ab）" }]);

	const repaired = repairLostEntries(KEPT, after, CAP);
	assert.equal(repaired.kind, "restored");
	assert.deepEqual(repaired.entries, lost);
	assert.deepEqual(repaired.sections.invariants, ["rule `alpha` holds（1ab）"], "the old line, id included");
	assert.deepEqual(repaired.sections.pitfalls, after.pitfalls, "sections with nothing lost are left alone");

	// Prove it through the parser: the next pass must read the restored line as an entry, not as prose.
	const rendered = renderMemoryDocument(repaired.sections, CAP);
	const parsed = sectionsFromMarkdown(rendered.text);
	assert.ok(parsed, "the repaired document is still a four-section bullet document");
	assert.deepEqual(parsed.invariants, ["rule `alpha` holds（1ab）"]);
});

test("an entry with no backticked literal is never repaired", () => {
	// "plain rule" reworded to "simple rule" reads exactly like a drop. Reporting belongs to
	// `removedSectionEntries`; repairing here would resurrect wording the model replaced on purpose.
	const before = sections({ invariants: ["a plain rule with no symbol"] });
	const after = sections({ invariants: ["a simpler rule"] });
	assert.deepEqual(lostEntries(before, after), []);
});

test("an entry the reply declares superseded is a replacement, not a loss", () => {
	const before = sections({ invariants: ["rule `alpha` holds（1ab）"] });
	const after = sections({ invariants: ["rule `gamma` replaces it（9ff）supersedes:1ab"] });
	assert.deepEqual(lostEntries(before, after), []);
});

test("Project and Index are rewritten every pass by design, so they are never restored", () => {
	const before = sections({
		project: ["the project is `dsh`"],
		index: ["`docs/README.md` is the index"],
	});
	const after = sections({ project: [], index: [] });
	assert.deepEqual(lostEntries(before, after), [], "a rewritten section is not a lost entry");
});

test("a repair that would push the document past its cap is reported, never traded", () => {
	// Small enough that the restored entry cannot fit. The repair must not silently drop another entry
	// to make room: that would be the same loss wearing the repair's name.
	// 718 characters of entry under an 800-character cap: measured on the built renderer, the restored
	// line no longer fits its section's share there (it does at 1200), which is the boundary this pins.
	const entry = `rule \`alpha\` ${"x".repeat(700)}（1ab）`;
	const before = sections({ invariants: [entry] });
	const after = sections({ pitfalls: ["a pitfall `beta` that must survive（2cd）"] });
	const result = repairLostEntries(before, after, 800);
	assert.equal(result.kind, "no-room");
	assert.equal(result.entries.length, 1);
});

test("a restored document keeps the entry id the sidecar knows", () => {
	// The id is how batch Z2's clock and `supersedes:` pointers survive; a repair that rewrote it would
	// reset the entry's age and break any pointer at it.
	const before = sections({ pitfalls: ["pit `beta` bites（2cd）"] });
	const after = sections({ pitfalls: [] });
	const repaired = repairLostEntries(before, after, CAP);
	assert.equal(repaired.kind, "restored");
	assert.match(repaired.sections.pitfalls[0], /（2cd）$/);
});

/** The receipt fixture: a clean landed pass, plus whatever the case is about. */
const report = (loss) => ({
	status: "updated",
	memoryWritten: true,
	contextWritten: true,
	contextDroppedChars: 0,
	memoryWriteDroppedChars: 0,
	sectionDropped: 0,
	droppedItems: 0,
	itemTruncated: 0,
	...loss,
});

test("the /memory update receipt names what the repair put back", () => {
	// A repaired pass is not a clean pass: the document grew without the model writing that growth, and
	// the folded card only shows the first line.
	const text = memoryUpdateReply(report({ restoredEntries: { count: 2, samples: ["alpha rule", "beta pit"] } })).text;
	assert.match(text, /Restored: 2 entry\(ies\) the reply had dropped/);
	assert.match(text, /alpha rule/);
	assert.equal(memoryUpdateReply(report({})).text, "Memory: updated MEMORY.md and CONTEXT.md.", "a clean pass is unchanged");
});

test("the receipt says when a lost entry could not be put back", () => {
	const text = memoryUpdateReply(report({ unrestoredEntries: { count: 1, samples: ["gamma"] } })).text;
	assert.match(text, /Not restored: 1 entry\(ies\)/);
});

/**
 * The wiring half: the pure function can be perfect and still never be called. This drives the real
 * `consolidateProject` with the model stub shape `test/external-edit.test.mjs` uses, so the branch that
 * assigns the repaired sections, re-renders and reports the count is the code under test.
 */
const WIRE_SEED = `# Project Memory

## Project
- the project is \`dsh\`

## Invariants
- rule \`alpha\` holds（1ab）

## Pitfalls
- pit \`beta\` bites（2cd）

## Index
- \`docs/README.md\` is the index
`;

/** A complete four-section reply, with the Invariants section chosen by the case. */
function replyDocument(invariants) {
	return [
		"# Project Memory",
		"",
		"## Project",
		"- the project is `dsh`",
		"",
		"## Invariants",
		...invariants,
		"",
		"## Pitfalls",
		"- pit `beta` bites（2cd）",
		"",
		"## Index",
		"- `docs/README.md` is the index",
		"",
	].join("\n");
}

async function wiredFixture(invariants) {
	const root = await mkdtemp(path.join(tmpdir(), "dsh-loss-repair-"));
	await mkdir(path.join(root, ".agents", "memory"), { recursive: true });
	await recordMemoryDocument(root, WIRE_SEED);
	const reply = JSON.stringify({
		memory_markdown: replyDocument(invariants),
		context: { title: "t", summary: "s", key_points: [], open_tasks: [] },
	});
	const ctx = {
		get: () => undefined,
		logger: { info: () => {}, warn: () => {} },
		llm: {
			resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
			stream() {
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
			id: "session-repair",
			header: { cwd: root, createdAt: Date.now() },
			snapshotEvents: () => [],
			deriveMessages: () => [],
			requestHeader: () => undefined,
		},
	};
	const config = resolvePluginConfig({ maxTokens: 8_192, maxOutputTokens: 32_768, consolidateTurns: 1, maxMemoryChars: 40_000, forceDedupeMs: 0 });
	const report = await consolidateProject(ctx, config, agent, { force: true, silent: true });
	return { root, report, landed: await readFile(memoryFile(root), "utf8") };
}

test("the pass puts a dropped entry back into the document it actually writes", async () => {
	const { report, landed } = await wiredFixture(["- a replacement rule `gamma` holds（3ef）"]);
	assert.equal(report.status, "updated");
	assert.equal(report.restoredEntries?.count, 1, "one entry was dropped and one came back");
	assert.match(report.restoredEntries.samples[0], /alpha/);
	assert.match(landed, /rule `alpha` holds/, "the landed document carries the old line again");
	assert.match(landed, /replacement rule `gamma`/, "and the reply's own new entry is still there");
	assert.match(memoryUpdateReply(report).text, /Restored: 1 entry\(ies\)/, "the receipt says so on its first line");
});

test("a reply that keeps the fact by rewording is not repaired, so nothing is duplicated", async () => {
	const { report, landed } = await wiredFixture(["- the invariant is that `alpha` holds"]);
	assert.equal(report.status, "updated");
	assert.equal(report.restoredEntries, undefined, "a reword is not a loss");
	assert.equal((landed.match(/`alpha`/g) ?? []).length, 1, "exactly one mention, so no duplicate line");
});
