/**
 * Receipt layout: the first line must survive the client's fold.
 *
 * dsh's `GenericCommandCard` renders the collapsed row as one `nowrap` ellipsized span whose text is
 * the *whole* receipt, and the expandable `<pre>` exists only when that text contains a newline. So a
 * single-line receipt is clipped after roughly eighty display columns and can never be opened, and a
 * multi-line receipt whose payload sits on line 2 shows the wrong thing at a glance.
 *
 * These cases pin the shape, not the rendering: the real proof is the user opening the card on a
 * rebuilt client (`dsh-command-receipt-render-verify` §5). What is mechanically checkable is that
 * every receipt this package builds leads with a line that fits, and that anything longer than that
 * line offers a body to expand.
 *
 * Widths are counted in display columns — a CJK glyph is two — because the folded row is measured in
 * pixels at a 13px secondary font size.
 */

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { statusText } from "../lib/project-handoff/command.js";
import { skillStatusReceipt } from "../lib/project-autolearn/skill-state.js";
import { sessionStatusReceipt } from "../lib/project-context/session-state.js";
import { formatMemoryStatus } from "../lib/project-memory/status-report.js";
import { memoryAcceptReply, memoryPruneReply, memoryUpdateReply } from "../lib/project-memory/report.js";
import { DEFAULT_CONFIG } from "../lib/shared/config.js";
import { resolvePluginConfig } from "../lib/shared/config.js";

/** Columns the collapsed summary can show before the ellipsis. */
const FIRST_LINE_COLUMNS = 80;

const CJK = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/;

/** Display columns of one string. */
function columns(text) {
	let width = 0;
	for (const glyph of text) width += CJK.test(glyph) ? 2 : 1;
	return width;
}

/** The receipt leads with a line the card can show, and offers a body when there is more. */
function assertLayout(label, text, columnsBudget = FIRST_LINE_COLUMNS) {
	const lines = text.split("\n");
	assert.ok(
		columns(lines[0]) <= columnsBudget,
		`${label}: the first line is ${columns(lines[0])} columns, over the ${columnsBudget}-column clip — ${JSON.stringify(lines[0])}`,
	);
	if (columns(text.replace(/\s+/g, " ")) > columnsBudget) {
		assert.ok(lines.length > 1, `${label}: the receipt is wider than the clip but has no newline, so it can never be expanded`);
	}
}

/** A session the handoff receipt can read: one turn, no compaction records. */
function session() {
	return {
		id: "session-receipt-layout-1",
		header: { cwd: "/mnt/Data/Projects/dsh-project-context" },
		requestHeader: () => undefined,
		snapshotEvents: () => [],
		deriveMessages: () => [],
	};
}

/** Host services the handoff receipt reads, at realistic magnitudes. */
function host({ window = 400_000, occupancy = 51_234, meter = true, projections = false } = {}) {
	const ctx = {
		get: (name) => {
			if (name === "tokenMeter" && meter) return { measure: () => ({ totalTokens: occupancy, surfaceTokens: occupancy }) };
			if (name === "sessionProjections" && projections) return { snapshot: () => ({ values: { contextBreakdown: { systemTokens: 12_000, toolsTokens: 9_000 } } }) };
			return undefined;
		},
		llm: { resolveModelInfo: async () => ({ context: { contextWindow: window } }) },
		logger: { info: () => {}, warning: () => {} },
	};
	return { get log() { return ctx.logger; }, get llm() { return ctx.llm; }, services: ctx };
}

const ROOT = "/mnt/Data/Projects/dsh-project-context";

/** A memory document in the four-section shape, big enough for realistic counts. */
function memoryDocument() {
	const entry = (prefix, index) => `- ${prefix} fact ${index} with a \`literal\` and a number ${index * 7}`;
	return [
		"## Project", ...Array.from({ length: 20 }, (_, index) => entry("project", index)),
		"## Invariants", ...Array.from({ length: 20 }, (_, index) => entry("invariant", index)),
		"## Pitfalls", ...Array.from({ length: 90 }, (_, index) => entry("pitfall", index)),
		"## Index", ...Array.from({ length: 8 }, (_, index) => entry("index", index)),
	].join("\n");
}

/** A clean consolidation report, overridable per case. */
function report(overrides = {}) {
	return {
		status: "updated",
		memoryWritten: true,
		contextWritten: true,
		memoryWriteDroppedChars: 0,
		sectionDropped: 0,
		droppedItems: 0,
		itemTruncated: 0,
		contextDroppedChars: 0,
		...overrides,
	};
}

test("the handoff status receipt leads with the numbers it decides on", async () => {
	const config = resolvePluginConfig({ provider: "test-provider", model: "test-model", handoffBudgetRecentTokens: 20_000 });
	const text = await statusText(host(), session(), config, new AbortController().signal);
	assertLayout("handoff status", text);
	const [first] = text.split("\n");
	assert.match(first, /^Auto handoff ON · context 51234\/400000 \(13%\) · threshold /, "mode, occupancy and the firing threshold are all on line 1");
	assert.match(text, /compactions 0 \(no compaction recorded\)/, "the compaction history survives on its own line");
	assert.match(text, /pending question defer/, "so does the pending-question setting");
});

test("the handoff status receipt keeps its shape when the route or the meter is missing", async () => {
	const config = resolvePluginConfig({ provider: "test-provider", model: "test-model" });
	const blind = await statusText(host({ meter: false }), session(), config, new AbortController().signal);
	assertLayout("handoff status without a meter", blind);
	assert.match(blind.split("\n")[0], /^Auto handoff ON$/, "with nothing to measure the head says only the mode");
});

test("the failure explanation does not spend the clip", async () => {
	const config = resolvePluginConfig({ provider: "test-provider", model: "test-model" });
	const failing = {
		...host(),
		llm: { resolveModelInfo: async () => { throw Object.assign(new Error("no such route"), { code: "route/unavailable" }); } },
	};
	const text = await statusText(failing, session(), config, new AbortController().signal);
	assertLayout("handoff status with a failing route", text, 80);
	assert.match(text, /Auto handoff ON/, "the mode still leads");
});

test("the memory status receipt leads with the size, not the section breakdown", () => {
	const { text } = formatMemoryStatus({
		document: memoryDocument(),
		source: path.join(ROOT, ".agents/memory/memory.jsonl"),
		expectedPath: path.join(ROOT, ".agents/memory/MEMORY.md"),
		journalPath: path.join(ROOT, ".agents/memory/memory.jsonl"),
		maxChars: 52_000,
		damaged: 0,
		unreadable: false,
		poisoned: false,
		cappedDroppedChars: 0,
		staleness: { checked: true, bound: 138, stale: 2, staleIds: ["abc"], missing: 0, unverifiable: 1 },
		files: { backups: 3, archivedSessions: 12, errorLogLines: 4, journal: { kind: "absent" } },
	});
	assertLayout("memory status", text);
	assert.match(text.split("\n")[0], /^Memory: \d+\/52000 chars \(\d+%\)$/, "line 1 is the document size against the cap");
	assert.match(text, /^sections: 138 entries \(Project 20, Invariants 20, Pitfalls 90, Index 8\)$/m, "the breakdown is on its own line");
});

test("the autolearn status receipt keeps the denominator and drops the parenthetical", () => {
	const text = skillStatusReceipt({
		total: 40,
		unmanaged: 22,
		counts: { intact: 15, expired: 1, drifted: 2, moved: 0, orphan: 0, unbaselined: 0 },
		verdicts: [
			{ state: "drifted", name: "a-skill", detail: "cites src/x.ts:12, which changed" },
			{ state: "drifted", name: "b-skill", detail: "cites src/y.ts, which is gone" },
			{ state: "expired", name: "c-skill", detail: "every file it cites is gone" },
			...Array.from({ length: 15 }, (_, index) => ({ state: "intact", name: `ok-${index}`, detail: "matches" })),
		],
	});
	assertLayout("autolearn status", text);
	assert.match(text.split("\n")[0], /^Learned skills: 18 of 40 skill\(s\) — 15 intact, 3 needing a look\.$/, "the denominator and both counts are on line 1");
	assert.match(text, /^22 hand-written skill\(s\) are not managed/m, "the hand-written split gets its own line");
});

test("the session-log status receipt keeps the repair count when INDEX.md is absent", () => {
	const text = sessionStatusReceipt({
		indexPresent: false,
		counts: { live: 120, settled: 11, stale: 2, orphan: 3, missing: 0, dangling: 1, unbaselined: 0 },
		verdicts: Array.from({ length: 137 }, (_, index) => ({
			state: index < 6 ? "orphan" : "live",
			id: `session-${String(index).padStart(4, "0")}-abcd`,
			detail: "no row in INDEX.md",
		})),
	});
	assertLayout("session-log status", text);
	assert.match(text.split("\n")[0], /6 needing a repair\.$/, "the repair count stays inside the clip");
	assert.match(text, /^131 healthy \(120 live, 11 settled\)\.$/m, "the healthy breakdown is its own line");
	assert.match(text, /^INDEX\.md is absent/m, "the absent index is its own line");
});

test("the prune receipts lead with the verdict and list the files below it", () => {
	const plan = {
		bytes: 4_500_000,
		candidates: [
			{ name: "backup-1", reason: "older than the newest 3", bytes: 1_200_000 },
			{ name: "backup-2", reason: "older than the newest 3", bytes: 1_100_000 },
			{ name: "journal-1", reason: "older than 90 days", bytes: 1_000_000 },
			{ name: "errors.log", reason: "over 1 MB", bytes: 1_200_000 },
		],
	};
	const preview = memoryPruneReply({ status: "preview", removed: 0, truncated: 0, failed: 0, plan }, ROOT).text;
	assertLayout("memory prune preview", preview);
	assert.match(preview.split("\n")[0], /^Memory prune: 4 file\(s\), 4\.3 MB, could be cleaned from \.agents\/memory\.$/, "the verdict carries the count and the size");
	assert.match(preview, /^  backup-1 \(older than the newest 3, 1\.1 MB\)$/m, "one file per line");

	const nothing = memoryPruneReply({ status: "nothing", removed: 0, truncated: 0, failed: 0, plan: { bytes: 0, candidates: [] } }, ROOT).text;
	assertLayout("memory prune nothing", nothing);
	assert.equal(nothing.split("\n")[0], "Memory prune: nothing to clean.");
});

test("the accept receipts lead with the verdict", () => {
	const confirmed = memoryAcceptReply({ kind: "confirmed", reason: "content-stale" }, "abc").text;
	assertLayout("memory accept confirmed", confirmed);
	assert.equal(confirmed.split("\n")[0], "Memory reconcile: accepted abc — recorded that you confirmed it.");

	const rebaselined = memoryAcceptReply(
		{ kind: "content-stale", outcome: { status: "accepted", paths: ["src/a.ts", "src/b.ts"] } },
		"abc",
	).text;
	assertLayout("memory accept re-baselined", rebaselined);
	assert.match(rebaselined.split("\n")[0], /^Memory reconcile: accepted abc — 2 changed file\(s\) re-baselined\.$/);
});

test("the update receipt keeps the loss counts on line 1 and the sentences below it", () => {
	const lossy = memoryUpdateReply(report({
		missingLiterals: { count: 4, samples: ["`alpha`", "`beta`", "`gamma`"] },
		restoredEntries: { count: 2, samples: ["`restored-one`"] },
		staleness: { checked: true, bound: 138, stale: 2, staleIds: ["abc"], missing: 0, unverifiable: 1 },
	})).text;
	assertLayout("memory update (lossy)", lossy);
	assert.match(lossy.split("\n")[0], /^Memory: updated MEMORY\.md and CONTEXT\.md · missing literals 4 · restored 2\.$/, "the counts stay on line 1");
	assert.match(lossy, /^Missing literals: 4 backticked literal\(s\)/m, "the sentence with samples is its own line");

	const refused = memoryUpdateReply(report({ status: "stale" })).text;
	assertLayout("memory update (stale)", refused);
	const capped = memoryUpdateReply(report({
		status: "read-capped-refused",
		readCappedRefused: { cap: 52_000, memoryHiddenChars: 3_000, contextHiddenChars: 0 },
	})).text;
	assertLayout("memory update (read-capped)", capped);
	assert.equal(capped.split("\n")[0], "Memory: was kept unchanged — the pass did not run.");
});

test("a clean update needs no detail lines", () => {
	const clean = memoryUpdateReply(report()).text;
	assert.equal(clean, "Memory: updated MEMORY.md and CONTEXT.md.", "a clean pass is one short line, not a paragraph");
});
