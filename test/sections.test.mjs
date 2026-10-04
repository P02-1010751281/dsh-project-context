/**
 * Tests for the sectioned memory representation: the fixed four-section table, the renderer that
 * enforces each section's budget, the `record_memory` tool schema, the extractor that reads a stored
 * document back, and the two halves of the "never replace a memory with nothing" gate.
 *
 * Ported with the feature from the pi sibling's `tests/sections-test.mjs`. The pi-side cases that
 * drive pi-ai's strict-schema machinery (`makeStrictJsonSchema`, `resolveJsonSchemaStrictSampling`)
 * have no dsh counterpart — dsh's `ToolSchema` is a plain declaration the adapter forwards — so this
 * file pins the strict-by-construction shape instead (every property required, no banned keyword).
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
	isHeadingOnlyDocument,
	isMemoryEntryEmpty,
	memorySectionOverage,
	normalizeMemoryEntry,
	RECORD_MEMORY_TOOL,
	renderMemoryDocument,
	sectionsFromMarkdown,
	sectionsFromToolCall,
	sectionsSemanticallyEmpty,
} from "../lib/project-memory/sections.js";
import { MEMORY_SECTIONS, memorySchemaOverheadChars, memorySectionBudgets } from "../lib/project-memory/memory-schema.js";
import { MAX_MEMORY_CHARS } from "../lib/shared/project-state.js";

/** The documented contract, spelled out here so a silent table edit is caught. */
const DOCUMENTED = [
	["Project", "purpose, stack, structure", 0.2],
	["Invariants", "standing decisions, conventions, hard constraints, user preferences", 0.4],
	["Pitfalls", "operational traps and the lessons behind them", 0.25],
	["Index", "pointers to docs, source files, and commands", 0.15],
];

test("the section table matches the documented contract and the shares sum to 1", () => {
	assert.deepEqual(
		MEMORY_SECTIONS.map((section) => [section.heading, section.description, section.share]),
		DOCUMENTED,
	);
	const total = MEMORY_SECTIONS.reduce((sum, section) => sum + section.share, 0);
	assert.equal(Math.round(total * 1000) / 1000, 1);
});

test("the per-section budgets divide the remainder after the fixed layout and sum under the cap", () => {
	const budgets = memorySectionBudgets(MAX_MEMORY_CHARS);
	assert.deepEqual(
		budgets.map((budget) => budget.heading),
		DOCUMENTED.map(([heading]) => heading),
	);
	const body = MAX_MEMORY_CHARS - memorySchemaOverheadChars();
	assert.equal(
		budgets.reduce((sum, budget) => sum + budget.chars, 0),
		MEMORY_SECTIONS.reduce((sum, section) => sum + Math.floor(body * section.share), 0),
	);
	assert.ok(budgets.reduce((sum, budget) => sum + budget.chars, 0) + memorySchemaOverheadChars() <= MAX_MEMORY_CHARS);
});

test("the record_memory tool is strict-by-construction and declares both members", () => {
	assert.equal(RECORD_MEMORY_TOOL.name, "record_memory");
	assert.ok(RECORD_MEMORY_TOOL.description.length > 0);
	const parameters = RECORD_MEMORY_TOOL.parameters;
	assert.equal(parameters.type, "object");
	assert.equal(parameters.additionalProperties, false);
	assert.deepEqual(parameters.required, ["memory", "context"]);
	const memory = parameters.properties.memory;
	assert.equal(memory.additionalProperties, false);
	assert.deepEqual(memory.required, ["project", "invariants", "pitfalls", "index"]);
	assert.deepEqual(Object.keys(memory.properties).sort(), ["index", "invariants", "pitfalls", "project"]);
	// No keyword that a strict validator rejects: the cap is enforced in code, not by the schema.
	const flat = JSON.stringify(parameters);
	for (const banned of ["maxItems", "maxLength", "$ref", "anyOf"]) assert.ok(!flat.includes(banned), banned);
	const context = parameters.properties.context;
	assert.deepEqual(context.required, ["summary", "title", "key_points", "open_tasks"]);
	assert.equal(context.additionalProperties, false);
});

test("entry hygiene: bullet prefixes and embedded newlines are removed, empty entries are recognised", () => {
	assert.equal(normalizeMemoryEntry("-  foo\n bar  "), "foo bar");
	assert.equal(normalizeMemoryEntry("-32°C threshold"), "-32°C threshold");
	for (const value of ["", "   ", "\u200b", "##"]) assert.ok(isMemoryEntryEmpty(value), JSON.stringify(value));
	assert.ok(!isMemoryEntryEmpty("x"));
});

test("renderMemoryDocument writes the canonical header, schema order, and no truncation marker", () => {
	const rendered = renderMemoryDocument({ project: ["p1"], invariants: ["i1", "i2"], pitfalls: ["q1"], index: ["x1"] }, MAX_MEMORY_CHARS);
	assert.ok(rendered.text.startsWith("# Project Memory\n\n"));
	assert.match(rendered.text, /## Project\n- p1\n\n## Invariants\n- i1\n- i2\n\n## Pitfalls\n- q1\n\n## Index\n- x1\n$/);
	assert.equal(rendered.sectionDropped, 0);
	assert.equal(rendered.droppedItems, 0);
	assert.equal(rendered.itemTruncated, 0);
	// The storage format puts no blank line after a heading.
	assert.ok(!rendered.text.includes("## Project\n\n- "));
	assert.ok(!rendered.text.includes("_[memory truncated"));
	// Byte-for-byte round trip is what lets the fallback entry and the guard reuse this renderer.
	const parsed = sectionsFromMarkdown(rendered.text);
	assert.deepEqual(parsed, { project: ["p1"], invariants: ["i1", "i2"], pitfalls: ["q1"], index: ["x1"] });
});

test("renderMemoryDocument enforces the cap per section: clip an item, drop a flooded section whole", () => {
	// A huge single entry: the per-item cap has to come from the section budget, not MAX_LIST_ITEM_CHARS.
	const big = renderMemoryDocument({ project: [], invariants: [], pitfalls: [], index: ["x".repeat(803)] }, 4000);
	assert.ok(big.text.length <= 4000);
	assert.equal(big.itemTruncated, 1);
	assert.equal(big.sectionDropped, 0);

	const many = renderMemoryDocument({ project: Array.from({ length: 400 }, (_, index) => `short entry ${index}`), invariants: [], pitfalls: [], index: [] }, 4000);
	assert.ok(many.text.length <= 4000);
	assert.equal(many.sectionDropped, 1);
	assert.ok(many.droppedItems > 0);
	assert.ok(!many.text.includes("_[memory truncated"));

	// An entry clipped to the per-item cap and then rejected for good is dropped, not truncated: it is
	// not in the document, so counting it as truncated would report a loss that never landed.
	const clippedThenDropped = renderMemoryDocument({ project: ["p".repeat(500), "q".repeat(900)], invariants: [], pitfalls: [], index: [] }, 4000);
	assert.equal(clippedThenDropped.droppedItems, 1, "the second entry does not fit beside the first");
	assert.equal(clippedThenDropped.itemTruncated, 0, "the dropped entry is not also reported as truncated");
	assert.ok(clippedThenDropped.text.includes("p".repeat(500)), "the kept entry is in the document");
	assert.ok(!clippedThenDropped.text.includes("q".repeat(100)), "the dropped entry is not");
});

test("memorySectionOverage mirrors the renderer, so a retry prompt names the real overage", () => {
	// The tier-C retry tells the model how much to cut. That number has to come from the rule that
	// stores the document: an estimate that drifts asks for the wrong amount, which is worse than not
	// retrying. Each fixture here is one the renderer's own test already pins.
	const clean = { project: ["p1"], invariants: ["i1", "i2"], pitfalls: ["q1"], index: ["x1"] };
	assert.deepEqual(memorySectionOverage(clean, MAX_MEMORY_CHARS), [], "a document that fits reports no overage");

	const big = { project: [], invariants: [], pitfalls: [], index: ["x".repeat(803)] };
	const bigRender = renderMemoryDocument(big, 4000);
	const bigRows = memorySectionOverage(big, 4000);
	assert.equal(bigRows.length, 1, "only the offending section comes back");
	assert.equal(bigRows[0].heading, "Index");
	assert.equal(bigRows[0].droppedEntries, 0, "no entry would be dropped");
	assert.equal(bigRows[0].truncatedEntries, bigRender.itemTruncated, "the over-long entry is the truncation");
	assert.equal(bigRows[0].over, 0, "a single entry always fits its section, so nothing is over budget");
	assert.ok(bigRows[0].itemCap > 0 && bigRows[0].itemCap < 803, `the entry was cut to the section's own item cap, got ${bigRows[0].itemCap}`);
	assert.equal(bigRows[0].budget, memorySectionBudgets(4000).find((section) => section.heading === "Index").chars, "the budget in the prompt is the section's real share");

	const many = { project: Array.from({ length: 400 }, (_, index) => `short entry ${index}`), invariants: [], pitfalls: [], index: [] };
	const manyRender = renderMemoryDocument(many, 4000);
	const manyRows = memorySectionOverage(many, 4000);
	assert.equal(manyRows.length, 1);
	assert.equal(manyRows[0].heading, "Project");
	assert.equal(manyRows[0].droppedEntries, manyRender.droppedItems, "the drop count is the renderer's own");
	assert.equal(manyRows[0].truncatedEntries, manyRender.itemTruncated);
	assert.ok(manyRows[0].over > 0, "a flooded section is over its budget, not merely truncated");

	// The clipped-then-dropped shape: the entry is cut to the cap and then rejected whole, which the
	// renderer reports as a drop and not as a truncation. The overage must agree.
	const clippedThenDropped = { project: ["p".repeat(500), "q".repeat(900)], invariants: [], pitfalls: [], index: [] };
	const ctdRender = renderMemoryDocument(clippedThenDropped, 4000);
	const ctdRows = memorySectionOverage(clippedThenDropped, 4000);
	assert.equal(ctdRows[0].droppedEntries, ctdRender.droppedItems);
	assert.equal(ctdRows[0].truncatedEntries, 0, "the clipped-then-dropped entry is not counted as truncated");
	assert.ok(ctdRows[0].over > 0);
});

test("renderMemoryDocument fits 2000 random caps (the budget holds by construction)", () => {
	let over = 0;
	for (let index = 0; index < 2000; index += 1) {
		const cap = 4000 + Math.floor(Math.random() * 196_001);
		const make = () => Array.from({ length: Math.floor(Math.random() * 10) }, () => "y".repeat(1 + Math.floor(Math.random() * 900)));
		const text = renderMemoryDocument({ project: make(), invariants: make(), pitfalls: make(), index: make() }, cap).text;
		if (text.length > cap) over += 1;
	}
	assert.equal(over, 0);
});

test("sectionsFromMarkdown accepts only a plain four-section bullet document and falls back otherwise", () => {
	const good = "## Project\n- a\n\n## Invariants\n- b\n\n## Pitfalls\n- c\n\n## Index\n- d";
	assert.deepEqual(sectionsFromMarkdown(good), { project: ["a"], invariants: ["b"], pitfalls: ["c"], index: ["d"] });
	const reject = {
		"a preamble before the first heading": `Here is the memory.\n${good}`,
		"an unknown section": "## Project\n- a\n\n## Notes\n- z\n\n## Invariants\n- b\n\n## Pitfalls\n- c\n\n## Index\n- d",
		"a missing section": "## Project\n- a\n\n## Invariants\n- b\n\n## Pitfalls\n- c",
		"prose inside a section": "## Project\n- a\ncontinued on the next line\n\n## Invariants\n- b\n\n## Pitfalls\n- c\n\n## Index\n- d",
		"a star bullet": "## Project\n* a\n\n## Invariants\n- b\n\n## Pitfalls\n- c\n\n## Index\n- d",
		"an indented bullet": "## Project\n  - a\n\n## Invariants\n- b\n\n## Pitfalls\n- c\n\n## Index\n- d",
		"content after the last section": `${good}\ntrailing prose`,
		"an empty string": "",
	};
	for (const [label, text] of Object.entries(reject)) {
		assert.equal(sectionsFromMarkdown(text), undefined, label);
	}
	// The header line is optional.
	assert.deepEqual(sectionsFromMarkdown(`# Project Memory\n\n${good}`), sectionsFromMarkdown(good));
	// Without this, every memory that was ever over the cap would be rejected as "not bullets".
	const capped = `${good}\n\n_[memory truncated at 8000 characters: 123 dropped]_`;
	assert.deepEqual(sectionsFromMarkdown(capped), sectionsFromMarkdown(good));
	// A bare skeleton parses (all four headings present) and the semantic gate is what refuses it.
	const empty = sectionsFromMarkdown("## Project\n\n## Invariants\n\n## Pitfalls\n\n## Index\n");
	assert.notEqual(empty, undefined);
	assert.ok(sectionsSemanticallyEmpty(empty));
});

test("sectionsFromToolCall reads the memory member and the semantic gate judges content", () => {
	const args = { memory: { project: ["- p"], invariants: ["i"], pitfalls: [], index: [] }, context: {} };
	const parsed = sectionsFromToolCall(args);
	assert.notEqual(parsed, undefined);
	assert.equal(parsed.project[0], "p");
	assert.equal(sectionsFromToolCall({ memory: { project: ["p"], invariants: ["i"], pitfalls: [] } }), undefined);
	assert.equal(sectionsFromToolCall({ memory: { project: [1], invariants: [], pitfalls: [], index: [] } }), undefined);
	assert.equal(sectionsFromToolCall("nope"), undefined);
	assert.equal(sectionsFromToolCall({ memory: "nope" }), undefined);

	for (const value of [[""], [" "], ["\u200b"], ["##"]]) {
		const empty = sectionsFromToolCall({ memory: { project: value, invariants: [], pitfalls: [], index: [] } });
		assert.notEqual(empty, undefined);
		assert.ok(sectionsSemanticallyEmpty(empty), JSON.stringify(value));
	}
	assert.ok(!sectionsSemanticallyEmpty({ project: [], invariants: ["x"], pitfalls: [], index: [] }));
});

test("isHeadingOnlyDocument refuses a body-less reply, however it is wrapped", () => {
	const skeleton = "# Project Memory\n\n## Project\n\n## Invariants\n\n## Pitfalls\n\n## Index\n";
	const skeletons = {
		"a four-heading skeleton": skeleton,
		"a partial skeleton": "# Project Memory\n\n## Project\n\n## Invariants\n",
		"a ```markdown fence": `\`\`\`markdown\n${skeleton}\`\`\``,
		"a ```md fence": `\`\`\`md\n${skeleton}\`\`\``,
		"a ```json fence": `\`\`\`json\n${skeleton}\`\`\``,
		"a bare ``` fence": `\`\`\`\n${skeleton}\`\`\``,
		"a ~~~ fence": `~~~\n${skeleton}~~~`,
		"a frontmatter delimiter": `---\n${skeleton}`,
		"a thematic break": `${skeleton}\n---\n`,
		"a zero-width prefix line": `\u200b\n${skeleton}`,
		"soft hyphens and BOM": `\u00ad\ufeff\n${skeleton}`,
		"a star separator line": "*".repeat(60),
		"a 7-hash pseudo-heading only": "####### Project\n####### Invariants\n",
		"a U+2028 line separator": "# Project\u2028## Invariants\u2028## Pitfalls\n",
		"a U+2029 line separator": "# Project\u2029## Invariants\n",
		"CR line endings": skeleton.replace(/\n/g, "\r"),
		"an HTML comment only": "<!-- Project Memory -->\n<!-- Invariants -->\n",
		"bullets with no text": "- \n- \n- \n",
		"an empty string": "",
		"whitespace only": "   \n\t\n",
		"a marker-only document": "_[memory truncated at 8000 characters: 12 dropped]_",
		"a bullet-prefixed skeleton": "- # Project Memory\n- ## Project\n- ## Invariants\n",
		"a nested bullet-prefixed skeleton": "- - # Project Memory\n- - ## Project\n",
		"a blockquote-prefixed skeleton": "> # Project Memory\n> ## Project\n",
		"an ordered-marker skeleton": "1. # Project Memory\n2. ## Project\n",
		"an XML-tag-wrapped skeleton": `<memory>\n${skeleton}</memory>`,
		"an HTML-heading skeleton": "<h2>Project Memory</h2>\n<h2>Invariants</h2>\n",
		"a setext skeleton": "Project Memory\n===\nInvariants\n===\n",
		"a fence line alone": "```",
		"a ZWSP-prefixed heading line": "\u200b# Project Memory\n\u200b## Project\n",
		"a U+200E LRM-prefixed skeleton": "\u200e# Project Memory\n\u200e## Project\n",
		"a U+200F RLM-prefixed skeleton": "\u200f# Project Memory\n\u200f## Project\n",
		"a U+202A bidi-prefixed skeleton": "\u202a# Project Memory\n\u202a## Project\n",
		"a U+2066 isolate-prefixed skeleton": "\u2066# Project Memory\n\u2066## Project\n",
		"an `<foo_bar>`-wrapped skeleton": "<foo_bar>\n# Project Memory\n## Project\n</foo_bar>",
		"an `<ns:memory>`-wrapped skeleton": "<ns:memory>\n# Project Memory\n## Project\n</ns:memory>",
		"a `<my.tag>`-wrapped skeleton": "<my.tag>\n# Project Memory\n## Project\n</my.tag>",
		"an `<_x>`-wrapped skeleton": "<_x>\n# Project Memory\n## Project\n</_x>",
		"a `<1memory>`-wrapped skeleton": "<1memory>\n# Project Memory\n## Project\n</1memory>",
		"a CJK-tag-wrapped skeleton": "<\u8bb0\u5fc6>\n# Project Memory\n## Project\n</\u8bb0\u5fc6>",
		"a tag whose attribute holds a `>`": '<x title="a>b">\n# Project Memory\n## Project\n</x>',
		"an unterminated tag wrapper": "<memory\n# Project Memory\n## Project",
		"a `<tel:…>` line alone (recorded boundary)": "<tel:+15551234567>\n",
	};
	for (const [label, text] of Object.entries(skeletons)) {
		assert.ok(isHeadingOnlyDocument(text), label);
	}

	// A fenced reply joined by anything other than `\n` must still count as content: the separators
	// are normalized before the anchored structural matchers run.
	const real = "# Project Memory\n\n## Project\n- a durable fact worth storing in the memory\n";
	for (const [name, separator] of [["LF", "\n"], ["CR", "\r"], ["CRLF", "\r\n"], ["U+2028", "\u2028"], ["U+2029", "\u2029"]]) {
		const fenced = `\`\`\`md${separator}${real.replace(/\n/g, separator)}\`\`\``;
		assert.ok(!isHeadingOnlyDocument(fenced), name);
	}
	assert.ok(!isHeadingOnlyDocument(`\`\`\`md\n${real}`));

	const content = {
		prose: "# Project Memory\n\n## Project\nThis project does a thing.\n",
		"a bullet": "# Project Memory\n\n## Project\n- a\n",
		"a star bullet": "# Project Memory\n\n## Project\n* a free-form note\n",
		"a plus bullet": "+ a free-form note\n",
		"a numbered rule that starts with a hash": "#1 rule must hold\n",
		"a bulleted rule that starts with a hash": "- #1 rule must hold\n",
		"a quoted fact": "> a quoted durable fact\n",
		"a bare number": "42\n",
		"a date": "2026-10-02\n",
		"a CJK-only line": "\u4e00\u4e2a\u771f\u7684\u9879\u76ee\n",
		"a fenced code block with a body": "```md\n# Project Memory\n\n## Project\n- real\n```",
		"an autolink as the only line": "<https://example.com/notes>\n",
		"a mailto autolink as the only line": "<mailto:someone@example.com>\n",
		"a bare email autolink as the only line": "<user@example.com>\n",
		"an upper-cased MAILTO autolink": "<MAILTO:x@y.example>\n",
		"a `<3 …` line": "<3 this project\n",
		"a fenced block whose body ends in a `===` line": "# Project Memory\n## Project\n```\nvalue\n===\n```\n",
		"a `~~~` block containing a ``` line and a `===` line": "# Project Memory\n## Project\n~~~\n```\nreal fact must hold\n===\n~~~\n",
		"a decorated fence line inside a block": "# Project Memory\n## Project\n```\n> ```\nreal fact must hold\n===\n```\n",
		"a block whose body holds an info-string fence line": "# Project Memory\n## Project\n```\n```js\nreal fact must hold\n===\n```\n",
		"a 4-backtick block closed by 3": "# Project Memory\n## Project\n````\n```\nreal fact must hold\n===\n",
		"a real line followed by `- ===`": "real fact must hold\n- ===\n",
	};
	for (const [label, text] of Object.entries(content)) {
		assert.ok(!isHeadingOnlyDocument(text), label);
	}

	// A heading's own text is not a body: a document made only of heading lines carries nothing.
	assert.ok(isHeadingOnlyDocument("## Project Memory uses Postgres\n"));
	// The recorded fail-open boundary: a wrapper that holds real words is content.
	assert.ok(!isHeadingOnlyDocument(`Here is the consolidated project memory:\n${skeleton}`));
	assert.ok(!isHeadingOnlyDocument("Project Memory\n---\nInvariants\n---\n"));
});
