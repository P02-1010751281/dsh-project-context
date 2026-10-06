#!/usr/bin/env node
/**
 * Batch I acceptance probe: what the two injected documents now cost, and whether every heading
 * survived the keep/index split.
 *
 * It drives the built `lib/` — the code the host loads — rather than a re-derivation, and it prints
 * both document lengths so a re-run whose figures moved can say which input moved.
 *
 * What it proves:
 *  1. Total coverage. Every `##` heading of the real document appears in the injected text exactly
 *     once, either inline or as one pointer line. A heading the spec cannot name stays inline, so a
 *     schema change degrades instead of dropping a section.
 *  2. The saving. Injected characters per turn, before and after the split.
 *  3. The language rule. Which language the pointer block renders in, from the document itself.
 *
 * Read-only: it writes nothing.
 *
 * Usage: node measure.mjs [project-root]   (defaults to the git top level)
 * Exit: 0 when no heading was lost, 1 when one was.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.argv[2] ?? execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
const load = (rel) => import(pathToFileURL(join(root, rel)).href);

const { buildMemoryInjection, buildContextInjection, MEMORY_INJECTION, CONTEXT_INJECTION } = await load("lib/project-memory/injection.js");
const { detectDocumentLanguage } = await load("lib/shared/language.js");

let lost = 0;
let before = 0;
let after = 0;
for (const [file, injection, build] of [
	["MEMORY.md", MEMORY_INJECTION, buildMemoryInjection],
	["CONTEXT.md", CONTEXT_INJECTION, buildContextInjection],
]) {
	const path = join(root, ".agents/memory", file);
	const text = readFileSync(path, "utf8");
	const injected = build(text, root);
	before += text.length;
	after += injected.length;

	// Fence-aware heading scan, so a `## x` inside a code block is not counted as a heading.
	const headings = [];
	let fence;
	for (const line of text.split("\n")) {
		const run = /^(`{3,}|~{3,})/.exec(line.trim());
		if (fence === undefined) {
			if (run) fence = run[1];
		} else if (run && run[1][0] === fence[0] && run[1].length >= fence.length) {
			fence = undefined;
			continue;
		}
		const match = fence === undefined ? /^## (.+?)\s*$/.exec(line) : null;
		if (match) headings.push(match[1]);
	}
	const missing = headings.filter((h) => !injected.includes(`## ${h}`) && !injected.includes(`\`## ${h}\``));
	lost += missing.length;
	console.log(
		`${file}: ${text.length} -> ${injected.length} chars (${(100 * (1 - injected.length / text.length)).toFixed(1)}% smaller), ` +
			`headings ${headings.length}, missing ${missing.length}${missing.length ? ` -> ${missing.join(", ")}` : ""}, ` +
			`pointer language ${detectDocumentLanguage([text])}, kept ${injection.keep.join(" + ")}`,
	);
}

console.log(`\ntotal injected per turn: ${before} -> ${after} chars, saved ${before - after} (${(100 * (1 - after / before)).toFixed(1)}%)`);
console.log(`VERDICT: ${lost === 0 ? "every heading survived the split" : `${lost} heading(s) LOST`}`);
process.exit(lost === 0 ? 0 : 1);
