#!/usr/bin/env node
/**
 * Offline check of the rebalanced section-share table (`f38a0ba`) against the *stored* memory
 * documents, run through the built `lib/` — the code the host loads — rather than a re-derivation.
 *
 * Two questions, both about the `/memory update` self-lock:
 *
 *  1. The budget half. `renderMemoryDocument` drops a whole entry when its section's budget is full,
 *     and a reply that would drop one is refused as `lossy-refused` (tier C) instead of written. If
 *     the renderer drops nothing for the document that is actually on disk, that half of the
 *     self-lock is clear and the next pass has room to land.
 *  2. The output half. Re-emitting memory plus context costs output tokens, and `fitMemoryInput`
 *     raises the request up to the model's own cap. A `needed` above that cap is what truncated the
 *     09:20:54 pass. This prints `needed`-derived `maxTokens` and whether the input had to be clipped.
 *
 * Read-only: it writes nothing, and it never greps for a truncation marker.
 *
 * Usage: node share-fit.mjs [project-root]   (defaults to the git top level)
 * Exit: 0 when the render round-trips without loss, 1 when it does not.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(
	process.argv[2] ?? execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim(),
);
const load = (rel) => import(pathToFileURL(join(root, rel)).href);

const { sectionsFromMarkdown, renderMemoryDocument } = await load("lib/project-memory/sections.js");
const { memorySectionBudgets, memorySectionPromptBudgets, memorySchemaOverheadChars, MEMORY_SECTIONS } = await load(
	"lib/project-memory/memory-schema.js",
);
const { MAX_MEMORY_CHARS } = await load("lib/shared/project-state.js");
const { fitMemoryInput } = await load("lib/shared/conversation.js");
const { replyTokenRate } = await load("lib/shared/text.js");

const memory = readFileSync(join(root, ".agents/memory/MEMORY.md"), "utf8");
const context = readFileSync(join(root, ".agents/memory/CONTEXT.md"), "utf8");

console.log(`cap ${MAX_MEMORY_CHARS}  schema overhead ${memorySchemaOverheadChars()}  document ${memory.length} chars`);
console.log(`rates: memory ${replyTokenRate(memory).toFixed(4)} tok/char, context ${replyTokenRate(context).toFixed(4)} tok/char`);

const sections = sectionsFromMarkdown(memory);
if (!sections) {
	console.log("\nsectionsFromMarkdown -> undefined: the document is not a plain four-section bullet list.");
	console.log("It stays opaque and is preserved verbatim; it cannot be budgeted here. Exit 2.");
	process.exit(2);
}

const hard = new Map(memorySectionBudgets(MAX_MEMORY_CHARS).map((b) => [b.heading, b.chars]));
const prompt = new Map(memorySectionPromptBudgets(MAX_MEMORY_CHARS).map((b) => [b.heading, b.chars]));
console.log("\nsection occupancy (a kept entry costs its text + 3 chars of bullet overhead):");
for (const spec of MEMORY_SECTIONS) {
	const entries = sections[spec.heading.toLowerCase()] ?? [];
	const body = entries.reduce((n, entry) => n + entry.length + 3, 0);
	const h = hard.get(spec.heading);
	const p = prompt.get(spec.heading);
	const state = body > h ? "OVER HARD BUDGET" : body > p ? "over prompt target" : "inside prompt target";
	console.log(
		`  ${spec.heading.padEnd(11)} entries ${String(entries.length).padStart(3)}  ${String(body).padStart(6)} / hard ${String(h).padStart(5)} (${((body / h) * 100).toFixed(1)}%)  prompt ${String(p).padStart(5)}  ${state}`,
	);
}

const render = renderMemoryDocument(sections, MAX_MEMORY_CHARS);
const roundTrip = sectionsFromMarkdown(render.text);
const identical = JSON.stringify(roundTrip) === JSON.stringify(sections);
console.log(
	`\nrender: sectionDropped ${render.sectionDropped}, droppedItems ${render.droppedItems}, itemTruncated ${render.itemTruncated}, text ${render.text.length} chars`,
);
console.log(`round-trip byte-identical: ${identical}`);

console.log("\noutput fit (maxTokens the pass would request, configured 8192, ceiling 32768):");
for (const [label, model] of [
	["non-reasoning, adapter cap unknown", {}],
	["reasoning, adapter cap unknown", { reasoning: true }],
	["reasoning, adapter cap 16384", { reasoning: true, maxTokens: 16384 }],
	["reasoning, adapter cap 27816", { reasoning: true, maxTokens: 27816 }],
]) {
	const fitted = fitMemoryInput(memory, context, 8192, model, 32768);
	console.log(
		`  ${label.padEnd(34)} maxTokens ${String(fitted.maxTokens).padStart(6)}  clipped ${fitted.clipped}  ` +
			`hidden memory ${fitted.memoryHiddenChars} / context ${fitted.contextHiddenChars}`,
	);
}

const lossy = render.sectionDropped > 0 || render.droppedItems > 0;
console.log(`\nVERDICT: ${lossy ? "whole entries would still be dropped -- tier C would refuse the reply" : "no whole-entry loss -- the budget half of the self-lock is clear"}`);
process.exit(lossy ? 1 : 0);
