/**
 * Tests for CONTEXT.md's fixed schema: the section table, the per-section budgets derived from
 * `MAX_CONTEXT_CHARS`, the truncation marker that replaced the old silent mid-line `slice()`, and
 * the prompt that states the same layout.
 *
 * Ported with the feature from the pi sibling's `tests/context-schema-test.mjs`; the cases below
 * mirror its coverage (plus the clip notice dsh logs) so a regression on either side is visible
 * here too. The once-per-project log line itself is not driven here — this repo's fixtures call
 * `consolidateProjectState`, not the plugin's pass wiring — so the notice's text is asserted
 * through `contextClipNotice` and the trigger through the marker.
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { fallbackUpdate, CONSOLIDATION_PROMPT_RULES } from "../lib/project-memory/consolidate.js";
import { renderContextDocument } from "../lib/project-memory/context-doc.js";
import {
	CONTEXT_SECTIONS,
	contextClipNotice,
	contextSchemaOverheadChars,
	contextSectionBudgets,
	contextTruncationDropped,
	contextTruncationMarker,
	isContextTruncated,
} from "../lib/project-memory/context-schema.js";
import { MAX_CONTEXT_CHARS, MAX_LIST_ENTRIES, MAX_LIST_ITEM_CHARS, MAX_SUMMARY_CHARS } from "../lib/shared/project-state.js";

const UPDATED_AT = "2026-09-12T00:00:00.000Z";
const CAP = MAX_CONTEXT_CHARS;

/** The documented contract, spelled out here so a silent table edit is caught. */
const DOCUMENTED = [
	["Summary", "what this session is about and where it stands", "summary", 0.4],
	["Key points", "facts, decisions, and findings worth carrying forward", "key_points", 0.35],
	["Open tasks", "unfinished work and the agreed next steps", "open_tasks", 0.25],
];

test("the section table matches the documented contract and the shares sum to 1", () => {
	assert.equal(CONTEXT_SECTIONS.length, DOCUMENTED.length);
	for (const [index, section] of CONTEXT_SECTIONS.entries()) {
		const [heading, description, entry, share] = DOCUMENTED[index];
		assert.equal(section.heading, heading);
		assert.equal(section.description, description);
		assert.equal(section.entry, entry);
		assert.equal(section.share, share);
	}
	assert.equal(CONTEXT_SECTIONS.reduce((sum, section) => sum + section.share, 0), 1);
});

test("the fixed overhead is reserved before the section budgets are divided", () => {
	// 16 (header) + 1 + 24 (timestamp line) + 2 + the three `## <heading>\n\n` blocks plus their
	// blank lines + 31 + 160 + 5 (trailing comment) + the worst-case marker and its blank line.
	assert.equal(contextSchemaOverheadChars(), 349);
	for (const cap of [8_001, CAP, 200_000]) {
		const overhead = contextSchemaOverheadChars();
		const body = contextSectionBudgets(cap).reduce((sum, section) => sum + section.chars, 0);
		assert.ok(overhead + body <= cap, `overhead + budgets fits ${cap} (${overhead} + ${body})`);
	}
});

test("the truncation marker has one strict shape and is read only from the last non-empty line", () => {
	assert.equal(contextTruncationMarker(12), "_[context truncated: 12 characters dropped]_");
	assert.ok(isContextTruncated(`# x\n${contextTruncationMarker(3)}\n`));
	assert.ok(!isContextTruncated("_[context truncated: three characters dropped]_"), "a word count is not a clip");
	assert.ok(!isContextTruncated("_[context truncated: 5 character dropped]_"), "the singular is not a clip");
	assert.equal(contextTruncationDropped("x\n\n  _[context truncated: 5 characters dropped]_  \n"), 5, "padding is tolerated");
	assert.equal(contextTruncationDropped("x\r\n_[context truncated: 7 characters dropped]_\r\n"), 7, "CRLF is tolerated");
	assert.equal(contextTruncationDropped("# x\n_[context truncated: 9 characters dropped]_\n\n"), 9, "trailing blanks are tolerated");
	// A model-authored line that merely looks like the marker never counts: the renderer appends
	// its marker last, so anything above another line is inside a section.
	assert.equal(contextTruncationDropped(`${contextTruncationMarker(5)}\n\nmore text\n`), undefined);
});

test("the section budgets are shares of the cap after the overhead, scale with the cap, and keep the summary cap", () => {
	const overhead = contextSchemaOverheadChars();
	const budgets = contextSectionBudgets(CAP);
	assert.deepEqual(budgets.map((section) => section.heading), DOCUMENTED.map(([heading]) => heading));
	assert.deepEqual(budgets.map((section) => section.entry), DOCUMENTED.map(([, , entry]) => entry));
	assert.equal(budgets[0].chars, MAX_SUMMARY_CHARS, "the summary keeps its long-standing per-section cap");
	assert.equal(budgets[1].chars, Math.floor((CAP - overhead) * 0.35));
	assert.equal(budgets[2].chars, Math.floor((CAP - overhead) * 0.25));
	const scaled = contextSectionBudgets(8_001);
	assert.equal(scaled[1].chars, Math.floor((8_001 - overhead) * 0.35));
	assert.equal(scaled[2].chars, Math.floor((8_001 - overhead) * 0.25));
	// The smallest budget must exceed one full item, or a single surviving item could overflow its
	// own section after the per-item trim.
	assert.ok(Math.min(...budgets.map((section) => section.chars)) > MAX_LIST_ITEM_CHARS + 2);
});

test("the renderer lays out the fixed sections in order, with the trailing comment", () => {
	const small = renderContextDocument(
		{ title: "a session", summary: "small summary", key_points: ["point a"], open_tasks: ["task b"] },
		{ updatedAt: UPDATED_AT },
	);
	assert.equal(
		small,
		`# Project Context\n\nLast updated: ${UPDATED_AT}\n\n## Summary\n\nsmall summary\n\n## Key points\n\n- point a\n\n## Open tasks\n\n- task b\n\n<!-- latest-session-title: a session -->\n`,
	);
	assert.ok(!isContextTruncated(small), "a fitting context carries no marker");
	assert.ok(small.length <= CAP);
});

test("a marker-shaped line inside a section is not mistaken for a real clip", () => {
	const phantom = renderContextDocument(
		{ title: "t", summary: contextTruncationMarker(5), key_points: [], open_tasks: [] },
		{ updatedAt: UPDATED_AT },
	);
	assert.ok(!isContextTruncated(phantom));
	assert.equal(contextTruncationDropped(phantom), undefined);
});

test("an over-budget section is clipped to its budget and the loss is reported exactly", () => {
	const longSummary = "s".repeat(9_000);
	const summaryOnly = renderContextDocument({ title: "big", summary: longSummary, key_points: [], open_tasks: [] }, { updatedAt: UPDATED_AT });
	assert.ok(!summaryOnly.includes("s".repeat(MAX_SUMMARY_CHARS + 1)), "the summary is clipped to its budget");
	assert.ok(summaryOnly.includes("s".repeat(MAX_SUMMARY_CHARS)));
	assert.ok(summaryOnly.includes(`_[context truncated: ${9_000 - MAX_SUMMARY_CHARS} characters dropped]_`));
});

test("the lists are clipped to their section budgets and the total counts every section", () => {
	const longSummary = "s".repeat(9_000);
	const longItems = Array.from({ length: 50 }, (_, index) => `${String(index).padStart(2, "0")}-${"x".repeat(700)}`);
	const truncated = renderContextDocument(
		{ title: "big", summary: longSummary, key_points: longItems, open_tasks: longItems },
		{ updatedAt: UPDATED_AT },
	);
	assert.ok(isContextTruncated(truncated));
	assert.match(truncated, /_\[context truncated: \d+ characters dropped\]_/);
	assert.ok(truncated.length <= CAP, `the truncated render fits the cap (${truncated.length})`);
	assert.ok(!truncated.includes("49-"), "the list is shed past its budget");
	assert.ok(truncated.includes("00-"));
});

test("the per-item trim and the entry cap are both counted as drops", () => {
	const perItem = renderContextDocument(
		{ title: "big", summary: "s", key_points: ["y".repeat(5_000)], open_tasks: [] },
		{ updatedAt: UPDATED_AT },
	);
	assert.ok(!perItem.includes("y".repeat(MAX_LIST_ITEM_CHARS + 1)));
	assert.ok(perItem.includes("y".repeat(MAX_LIST_ITEM_CHARS)));
	assert.ok(perItem.includes(`_[context truncated: ${5_000 - MAX_LIST_ITEM_CHARS} characters dropped]_`));

	const manyShort = Array.from({ length: MAX_LIST_ENTRIES + 10 }, (_, index) => `key point ${index}`);
	const entryCapped = renderContextDocument({ title: "t", summary: "s", key_points: manyShort, open_tasks: [] }, { updatedAt: UPDATED_AT });
	const fullMany = manyShort.map((item) => `- ${item}`);
	const entryDrop = fullMany.join("\n").length - fullMany.slice(0, MAX_LIST_ENTRIES).join("\n").length;
	assert.ok(entryCapped.includes(`key point ${MAX_LIST_ENTRIES - 1}`));
	assert.ok(!entryCapped.includes(`key point ${MAX_LIST_ENTRIES}`));
	assert.ok(entryCapped.includes(`_[context truncated: ${entryDrop} characters dropped]_`));
});

test("blank items render as no items, and whitespace normalization is not a cap loss", () => {
	const emptyItems = renderContextDocument({ title: "t", summary: "s", key_points: [""], open_tasks: ["   "] }, { updatedAt: UPDATED_AT });
	assert.equal((emptyItems.match(/- None recorded/g) ?? []).length, 2);
	assert.ok(!emptyItems.includes("\n- \n"));

	const normalizedDoc = renderContextDocument({ title: "t", summary: "a\n\n\n\nb", key_points: ["  a  b  "], open_tasks: [] }, { updatedAt: UPDATED_AT });
	assert.ok(normalizedDoc.includes("## Summary\n\na b\n"));
	assert.ok(normalizedDoc.includes("- a b"));
	assert.ok(!isContextTruncated(normalizedDoc), "normalization alone does not raise a marker");
});

test("a trimmed item or title never leaves a lone surrogate", () => {
	const document = renderContextDocument(
		{ title: `${"t".repeat(159)}😀x`, summary: "s", key_points: [`${"a".repeat(799)}😀${"b".repeat(100)}`], open_tasks: [] },
		{ updatedAt: UPDATED_AT },
	);
	assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(document), "no lone high surrogate");
	assert.ok(!/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(document), "no lone low surrogate");
});

test("a title with whitespace collapses to one line so it cannot break the trailing comment", () => {
	const document = renderContextDocument({ title: "  a\n\nb  ", summary: "s", key_points: [], open_tasks: [] }, { updatedAt: UPDATED_AT });
	assert.ok(document.includes("<!-- latest-session-title: a b -->"));
});

test("the fallback summary's loss is reported rather than pre-clipped", () => {
	const content = "z".repeat(MAX_SUMMARY_CHARS + 1_002);
	const session = { id: "session-child", header: { createdAt: 0 }, snapshotEvents: () => [{ type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: content }] } }] };
	const update = fallbackUpdate(session);
	assert.equal(update.summary.length, content.length, "the fallback keeps the raw text for the renderer to clip");
	const document = renderContextDocument(update, { updatedAt: UPDATED_AT });
	assert.ok(document.includes(`_[context truncated: ${content.length - MAX_SUMMARY_CHARS} characters dropped]_`));
});

test("the consolidation prompt states the same sections, order, budgets and the marker ban", () => {
	const prompt = CONSOLIDATION_PROMPT_RULES.join("\n");
	const budgets = contextSectionBudgets(CAP);
	for (const section of budgets) {
		assert.ok(prompt.includes(`## ${section.heading}: ${section.description} (about ${section.chars} characters)`), `the prompt budgets ${section.heading}`);
	}
	for (const [index, [heading]] of DOCUMENTED.entries()) {
		if (index === 0) continue;
		assert.ok(prompt.indexOf(`## ${DOCUMENTED[index - 1][0]}:`) < prompt.indexOf(`## ${heading}:`), `the prompt fixes the order at ${heading}`);
	}
	assert.match(prompt, /Never write omission or truncation markers/);
	assert.match(prompt, /key_points and context\.open_tasks are arrays of strings/);
});

test("the clip notice names the three clamps so the marker count can be attributed", () => {
	const notice = contextClipNotice(7);
	assert.ok(notice.includes("CONTEXT.md was clipped"));
	assert.ok(notice.includes(`${MAX_LIST_ITEM_CHARS}-character item cap`));
	assert.ok(notice.includes(`${MAX_LIST_ENTRIES}-entry list cap`));
	assert.ok(notice.includes("7 characters were dropped"));
});
