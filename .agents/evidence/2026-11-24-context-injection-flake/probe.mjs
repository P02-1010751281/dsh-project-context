/**
 * Read-only probe for the three candidate causes of the context-injection flake.
 *
 * Run from the repo root: `node .agents/evidence/2026-11-24-context-injection-flake/probe.mjs`.
 * Writes nothing. Exit 0 means all three candidates are excluded and the real defect reproduces.
 *
 * The point of a probe rather than prose: each claim below is a property of the built `lib/` and of
 * the write path, so re-running it re-derives the conclusion instead of trusting this file.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
	documentHeadings,
	MEMORY_INJECTION,
	renderProgressiveBody,
} from "../../../lib/project-memory/injection.js";
import { renderMemoryDocument } from "../../../lib/project-memory/sections.js";
import { detectDocumentLanguage } from "../../../lib/shared/language.js";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const failures = [];

function check(name, fn) {
	try {
		fn();
		console.log(`PASS ${name}`);
	} catch (error) {
		failures.push(`${name}: ${error.message}`);
		console.log(`FAIL ${name}\n     ${error.message}`);
	}
}

// ① "read a half-written file" — the write path is atomic, so a reader sees one whole version.
check("the memory document write is atomic (temp file + rename)", () => {
	const source = readFileSync(path.join(repoRoot, "src/shared/files.ts"), "utf8");
	const body = source.slice(source.indexOf("export async function writeAtomic"));
	const end = body.indexOf("\n}\n");
	const fn = body.slice(0, end === -1 ? undefined : end);
	assert.match(fn, /writeFile\(temporary, content/, "writes to a temporary path first");
	assert.match(fn, /rename\(temporary, file\)/, "then renames it into place");
});

// ② "a document without Project/Index" — the renderer always emits all four headings.
check("renderMemoryDocument always emits every section heading", () => {
	// An over-cap render is the only branch that could plausibly drop a section wholesale.
	const { text } = renderMemoryDocument(
		{ project: ["p"], invariants: ["i"], pitfalls: ["t"], index: ["x"] },
		4000,
	);
	for (const heading of ["Project", "Invariants", "Pitfalls", "Index"]) {
		assert.ok(
			text.split("\n").includes(`## ${heading}`),
			`the rendered document carries '## ${heading}'`,
		);
	}
	// The starved branch: a section whose budget is below the minimum still pushes its heading.
	const starved = renderMemoryDocument({ project: [], invariants: [], pitfalls: [], index: [] }, 0);
	for (const heading of ["Project", "Invariants", "Pitfalls", "Index"]) {
		assert.ok(
			starved.text.split("\n").includes(`## ${heading}`),
			`even an empty render carries '## ${heading}'`,
		);
	}
});

// ③ The real defect: a fence-blind scan disagrees with the renderer, and the section it names is
//    gone from the output, so a correct render reads as a failure.
check("a fence-blind heading scan disagrees with the renderer (the real defect)", () => {
	const doc = [
		"# Title",
		"",
		"## Project",
		"- a fact",
		"",
		"```",
		"## Example Heading",
		"demo",
		"```",
		"",
		"## Invariants",
		"- a rule",
		"",
	].join("\n");
	const language = detectDocumentLanguage([doc]);
	const rendered = renderProgressiveBody(doc, MEMORY_INJECTION, language, repoRoot);

	const fenceBlind = [...doc.matchAll(/^## (.+)$/gm)].map((match) => match[1].trim());
	const fenceAware = documentHeadings(doc);
	assert.ok(fenceBlind.includes("Example Heading"), "the regex reports the fenced heading");
	assert.ok(!fenceAware.includes("Example Heading"), "the renderer's scan does not");
	assert.equal(fenceBlind.length, fenceAware.length + 1, "exactly the fenced one differs");
	assert.ok(!rendered.includes("## Example Heading"), "the indexed section took the fence with it");

	// With the fence-blind list, that heading is "neither inline nor pointed at" — a false failure.
	const lines = rendered.split("\n");
	const inline = lines.includes("## Example Heading");
	const label = MEMORY_INJECTION.pointers["Example Heading"]?.[language];
	const pointers = label === undefined ? 0 : rendered.split(label).length - 1;
	assert.ok(!(inline || pointers === 1), "a fence-blind scan reports it uncovered, wrongly");
});

// ④ The tracked documents are covered today, under either scan.
check("the tracked documents pass under both scans", () => {
	for (const file of ["MEMORY.md", "CONTEXT.md"]) {
		const text = readFileSync(path.join(repoRoot, ".agents/memory", file), "utf8");
		const fenceBlind = [...text.matchAll(/^## (.+)$/gm)].map((match) => match[1].trim());
		assert.deepEqual(
			documentHeadings(text),
			fenceBlind,
			`${file}: no fenced heading differs today, so the defect is latent, not active`,
		);
	}
});

if (failures.length > 0) {
	console.log(`\nRESULT: FAIL (${failures.length})`);
	process.exit(1);
}
console.log("\nRESULT: PASS — three candidate causes excluded, real defect reproduces");
