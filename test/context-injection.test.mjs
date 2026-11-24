/**
 * Progressive-disclosure tests for the two injected documents (batch I).
 *
 * The renderer is a pure function over a rendered document, so the cases are: the coverage rule
 * (every heading appears exactly once, inline or as a pointer), fence-awareness, the identity case,
 * the preamble and document-note rules, path resolution and the language choice. The last case runs
 * the real tracked documents, because a heading the spec cannot name would otherwise be indexed away
 * silently.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildContextInjection, buildMemoryInjection, CONTEXT_INJECTION, documentHeadings, MEMORY_INJECTION, renderProgressiveBody } from "../lib/project-memory/injection.js";
import { detectDocumentLanguage } from "../lib/shared/language.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const spec = {
	keep: ["Invariants", "Pitfalls"],
	pointers: {
		Project: { zh: "ZH-project", en: "EN-project" },
		Index: { zh: "ZH-index", en: "EN-index" },
	},
	heading: { zh: "其余在 `{path}`：", en: "The rest is in `{path}`:" },
	instruction: { zh: "ZH-read-first", en: "EN-read-first" },
	path: ".agents/memory/MEMORY.md",
};

const doc = [
	"# Title",
	"",
	"## Project",
	"- a fact",
	"",
	"## Invariants",
	"- a rule",
	"",
	"## Pitfalls",
	"- a trap",
	"",
	"## Index",
	"- a pointer",
	"",
].join("\n");

/**
 * How many pointer lines name `heading`.
 *
 * The coverage rule is structural: a pointer is a whole line of the form ``- `## <heading>` …``.
 * Counting the backticked heading as a substring instead is fragile, because a *kept* section may
 * quote a heading name in prose — the real CONTEXT.md does exactly that when it describes this
 * mechanism — and a prose mention is not a pointer.
 */
const pointerCount = (rendered, heading) => rendered.split("\n").filter((line) => line.startsWith(`- \`## ${heading}\``)).length;

test("keeps the named sections verbatim and reduces the rest to one pointer line each", () => {
	const out = renderProgressiveBody(doc, spec, "en", "/root");
	assert.ok(out.includes("## Invariants\n\n- a rule"), "kept section is inline and verbatim");
	assert.ok(out.includes("## Pitfalls\n\n- a trap"), "the second kept section is inline");
	assert.equal(pointerCount(out, "Project"), 1, "the indexed heading appears as exactly one pointer");
	assert.equal(pointerCount(out, "Index"), 1, "the other indexed heading too");
	assert.ok(!out.includes("- a fact"), "the indexed section's body is gone");
	assert.ok(out.includes("EN-read-first"), "the read-first sentence is present");
});

test("a heading inside a fenced code block is content, not a section", () => {
	// A *pointer-eligible* heading inside the fence is the decisive input: a fence-blind scan
	// promotes it to a section, so it becomes a pointer line and its "body" — the rest of the
	// block — is dropped with it. A heading the spec does not name would survive either way.
	const fenced = ["# Title", "", "```", "## Project", "not a section", "```", "", "## Invariants", "- a rule", ""].join("\n");
	const out = renderProgressiveBody(fenced, spec, "en", "/root");
	assert.ok(out.includes("```\n## Project\nnot a section\n```"), "the fenced block survives whole");
	assert.ok(!out.includes("`## Project`"), "a heading inside a fence is not indexed");
	assert.ok(out.includes("- a rule"), "the real section still renders");
});

test("a document with no pointer heading is returned unchanged", () => {
	const other = ["# Title", "", "## Something", "- text", ""].join("\n");
	assert.equal(renderProgressiveBody(other, spec, "en", "/root"), other);
});

test("the preamble and a trailing document note stay inline", () => {
	// The note has to land in an *indexed* section to be decisive: there the section's body is
	// dropped, so without the note rule the marker — the only trace of input the model was not
	// shown — would be indexed away with it.
	const noted = ["# Title", "", "## Invariants", "- a rule", "", "## Index", "- a pointer", "_[memory truncated at 40000 characters: 12 dropped]_", ""].join("\n");
	const out = renderProgressiveBody(noted, spec, "en", "/root");
	assert.ok(out.includes("# Title"), "the preamble survives the split");
	assert.ok(out.includes("_[memory truncated at 40000 characters: 12 dropped]_"), "the trailing marker survives");
	assert.ok(!out.includes("- a pointer"), "the indexed section's body is still dropped");
});

test("a `_[...]_` line that is not last stays where it was written", () => {
	const mid = ["# Title", "", "## Invariants", "- a rule", "_[mid]_", "- another", ""].join("\n");
	const out = renderProgressiveBody(mid, spec, "en", "/root");
	assert.ok(out.includes("_[mid]_"), "a mid-document note is not hoisted");
	assert.ok(out.indexOf("_[mid]_") > out.indexOf("- a rule"), "and keeps its position");
});

test("the pointer path is absolute when the caller knows the project root", () => {
	const out = renderProgressiveBody(doc, spec, "en", "/root");
	assert.ok(out.includes("`/root/.agents/memory/MEMORY.md`"), "resolved against the supplied root");
	const bare = renderProgressiveBody(doc, spec, "en");
	assert.ok(bare.includes("`.agents/memory/MEMORY.md`"), "and left relative without one");
});

test("the pointer text follows the document's language", () => {
	assert.equal(detectDocumentLanguage([doc]), "en");
	const zhDoc = ["# 标题", "", "## Project", "- 事实", "", "## Invariants", "- 规则", ""].join("\n");
	assert.equal(detectDocumentLanguage([zhDoc]), "zh");
	const out = renderProgressiveBody(zhDoc, spec, "zh", "/root");
	assert.ok(out.includes("ZH-project"), "the Chinese pointer is chosen for a Chinese document");
	assert.ok(out.includes("ZH-read-first"), "and the Chinese instruction");
});

test("a heading name quoted inside a kept section is not counted as a pointer", () => {
	// The real CONTEXT.md quotes the indexed headings in prose, so a substring count reports two
	// pointers for one section. The rule has to be read structurally: only a whole pointer line counts.
	const quoting = ["# Title", "", "## Invariants", "- the pointer block names `## Index` in prose", "", "## Index", "- a pointer", ""].join("\n");
	const out = renderProgressiveBody(quoting, spec, "en", "/root");
	assert.ok(out.includes("- the pointer block names `## Index` in prose"), "the prose mention survives in the kept section");
	assert.equal(pointerCount(out, "Index"), 1, "the prose mention is not a second pointer");
});

test("documentHeadings sees the renderer's sections, not a fence-blind regex", () => {
	// The discriminator the real-document case depends on: a `## …` line inside a fenced example is
	// content to the renderer, so it must not be reported as a section either. A regex scan reports
	// it, and when that fence sits in an *indexed* section the section is replaced by its pointer
	// line — the "heading" then looks uncovered even though the render is correct.
	const fenced = ["# Title", "", "## Project", "- a fact", "", "```", "## Example Heading", "demo", "```", "", "## Invariants", "- a rule", ""].join("\n");
	assert.deepEqual(documentHeadings(fenced), ["Project", "Invariants"], "a heading inside a fence is not a section");
	assert.equal([...fenced.matchAll(/^## (.+)$/gm)].length, 3, "the fence-blind regex disagrees, which is why the case above matters");
	// The real shape: the fence lives in the indexed section, so the regex-scanned heading belongs to
	// no rendered section at all.
	const rendered = renderProgressiveBody(fenced, spec, "en", "/root");
	assert.ok(!rendered.includes("## Example Heading"), "the indexed section took its fenced example with it");
	assert.ok(rendered.includes("- a rule"), "the kept section still renders");
});

test("the real tracked documents keep every heading", () => {
	// Content-independence matters here: this is the only case that reads the *tracked* documents,
	// and another session's memory pass may rewrite them between runs. So the expectation is derived
	// from the document (every heading it has must survive the render), not pinned to a heading list
	// that a rewrite may legitimately change — and a pointer is counted by its *label* (unique per
	// heading) rather than by the `` `## <heading>` `` prefix, which a memory bullet describing this
	// very mechanism can quote at line start.
	//
	// The headings come from the renderer's own fence-aware scan, never from `/^## (.+)$/gm`: a
	// fenced example inside an *indexed* section is content, and that section is replaced by its
	// pointer line, so a regex-scanned heading there is asked about a section the document does not
	// have — a correct render read as a failure.
	//
	// Deriving the expectation from the same scan makes this case blind to a scan that *under-reports*
	// (that is why the case below, not this one, pins the scan rule); what this case still pins is the
	// property the documents actually care about: no section the document carries is dropped from the
	// render, and none is both inline and pointed at.
	for (const [file, injection, build] of [
		["MEMORY.md", MEMORY_INJECTION, buildMemoryInjection],
		["CONTEXT.md", CONTEXT_INJECTION, buildContextInjection],
	]) {
		const text = readFileSync(path.join(repoRoot, ".agents/memory", file), "utf8");
		const language = detectDocumentLanguage([text]);
		const rendered = build(text, repoRoot);
		const headingLines = rendered.split("\n");
		const headings = documentHeadings(text);
		assert.ok(headings.length > 0, `${file}: the document carries no sections at all`);
		for (const heading of new Set(headings)) {
			const inline = headingLines.includes(`## ${heading}`);
			const label = injection.pointers[heading]?.[language];
			const pointers = label === undefined ? 0 : rendered.split(label).length - 1;
			assert.ok(inline || pointers === 1, `${file}: ${heading} is neither inline nor pointed at`);
			if (inline) assert.equal(pointers, 0, `${file}: ${heading} is both inline and pointed at`);
		}
		assert.ok(rendered.includes("read"), `${file}: the read-first sentence is present`);
	}
});
