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
import { buildContextInjection, buildMemoryInjection, CONTEXT_INJECTION, MEMORY_INJECTION, renderProgressiveBody } from "../lib/project-memory/injection.js";
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

test("keeps the named sections verbatim and reduces the rest to one pointer line each", () => {
	const out = renderProgressiveBody(doc, spec, "en", "/root");
	assert.ok(out.includes("## Invariants\n\n- a rule"), "kept section is inline and verbatim");
	assert.ok(out.includes("## Pitfalls\n\n- a trap"), "the second kept section is inline");
	assert.equal(out.split("`## Project`").length - 1, 1, "the indexed heading appears as exactly one pointer");
	assert.equal(out.split("`## Index`").length - 1, 1, "the other indexed heading too");
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

test("the real tracked documents keep every heading", () => {
	for (const [file, injection, rendered] of [
		["MEMORY.md", MEMORY_INJECTION, buildMemoryInjection(readFileSync(path.join(repoRoot, ".agents/memory/MEMORY.md"), "utf8"), repoRoot)],
		["CONTEXT.md", CONTEXT_INJECTION, buildContextInjection(readFileSync(path.join(repoRoot, ".agents/memory/CONTEXT.md"), "utf8"), repoRoot)],
	]) {
		for (const heading of injection.keep) {
			assert.ok(rendered.includes(`## ${heading}`), `${file}: the kept section ${heading} is inline`);
		}
		for (const heading of Object.keys(injection.pointers)) {
			assert.equal(rendered.split(`\`## ${heading}\``).length - 1, 1, `${file}: ${heading} has exactly one pointer`);
		}
		assert.ok(rendered.includes("read"), `${file}: the read-first sentence is present`);
	}
});
