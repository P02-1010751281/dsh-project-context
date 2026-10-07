/**
 * Re-runnable per-section **share** control for the tracked `.agents/memory/CONTEXT.md`.
 *
 * `roundtrip.mjs` (`.agents/evidence/2026-10-06-context-doc-roundtrip/`) proves two things: no item
 * is over `MAX_LIST_ITEM_CHARS`, and the stored document is byte-identical to what the renderer
 * would write for the same content. It does **not** measure the third clamp: `clipProse` / `clipList`
 * drop whole trailing items, or clip the summary, once a section exceeds its own budget from
 * `contextSectionBudgets()`. `## Open tasks` sat at 99.7% of its share that way — 25 characters of
 * headroom, longest item 794/800 — with every existing probe green.
 *
 * This script gates that: a section may not exceed 90% of its share (`MAX_SECTION_FILL`), the same
 * prompt-target convention the MEMORY sections use, so the drift is caught while it is still
 * harmless instead of when a `/memory update` pass discovers it by dropping a section's tail.
 *
 * Two independent readings must agree, so a formula drift here cannot silently mis-report headroom:
 * the script reproduces the renderer's dropped-character count from the parsed content and compares
 * it against the marker `renderContextDocument` itself appends.
 *
 * Run: `node .agents/evidence/2026-10-07-context-section-balance/measure.mjs [path]`
 *   (default = the tracked `.agents/memory/CONTEXT.md`; the argument lets `control.sh` exercise the
 *    failure paths on copies without touching the tracked document)
 * Exit code 0 = byte-identical round trip, nothing clipped, every section at most `MAX_SECTION_FILL`
 * of its share. Otherwise it names the section and exits 1.
 */

import { readFileSync } from "node:fs";
import { renderContextDocument } from "../../../lib/project-memory/context-doc.js";
import { clipToLineBoundary } from "../../../lib/project-memory/document.js";
import { contextSectionBudgets, contextTruncationDropped, isContextTruncated } from "../../../lib/project-memory/context-schema.js";
import { MAX_LIST_ENTRIES, MAX_LIST_ITEM_CHARS } from "../../../lib/shared/limits.js";

/** A section may fill at most this share of its own budget before this probe goes red. */
const MAX_SECTION_FILL = 0.9;

const PATH = process.argv[2] ?? new URL("../../../.agents/memory/CONTEXT.md", import.meta.url).pathname;
const stored = readFileSync(PATH, "utf8");

const normalize = (value) => value.replace(/\s+/g, " ").trim();
const stamp = stored.match(/^Last updated: (.*)$/m)?.[1] ?? "";
const title = stored.match(/^<!-- latest-session-title: (.*) -->$/m)?.[1] ?? "";
const bodies = new Map();
for (const part of stored.split(/^## /m).slice(1)) {
	const [heading, ...rest] = part.split("\n");
	bodies.set(heading.trim(), rest.join("\n").trim());
}
/** The bullet values of one section, as `ContextUpdate` carries them (without the `- ` prefix). */
const bullets = (heading) =>
	(bodies.get(heading) ?? "")
		.split("\n")
		.filter((line) => line.startsWith("- ") && line.slice(2).trim() !== "")
		.map((line) => line.slice(2));

const update = {
	summary: bodies.get("Summary") ?? "",
	title,
	key_points: bullets("Key points"),
	open_tasks: bullets("Open tasks"),
};

/** What a list section wants to hold, and what the renderer's own clamps leave of it. */
function listMeasure(items, limit) {
	const content = items.map(normalize).filter((item) => item.length > 0);
	const full = content.map((item) => `- ${item}`);
	const kept = content.map((item) => `- ${clipToLineBoundary(item, MAX_LIST_ITEM_CHARS)}`).slice(0, MAX_LIST_ENTRIES);
	let fitting = kept;
	while (fitting.length > 1 && fitting.join("\n").length > limit) fitting = fitting.slice(0, -1);
	return {
		raw: kept.join("\n").length,
		kept: fitting.join("\n").length,
		items: content.length,
		entryCapped: content.length - kept.length,
		budgetDropped: kept.length - fitting.length,
		dropped: full.join("\n").length - fitting.join("\n").length,
	};
}

/** The summary is prose: `clipProse` normalizes, then clips on a line boundary. */
function summaryMeasure(text, limit) {
	const prose = normalize(text);
	const clipped = clipToLineBoundary(prose, limit);
	return { raw: prose.length, kept: clipped.length, dropped: prose.length - clipped.length };
}

const rendered = renderContextDocument(update, { updatedAt: stamp });
const truncated = isContextTruncated(rendered);
const reportedDrop = contextTruncationDropped(rendered) ?? 0;
const identical = rendered === stored;

let ok = identical;
console.log(`path: ${PATH}`);
console.log(`stored ${stored.length} chars; rendered ${rendered.length} chars; byte-identical: ${identical}`);
console.log(`renderer's own clip: ${truncated ? `yes, ${reportedDrop} characters dropped` : "no"}`);
if (!identical) {
	const before = stored.split("\n");
	const after = rendered.split("\n");
	const at = before.findIndex((line, index) => line !== after[index]);
	ok = false;
	console.log(`  first difference at line ${at + 1}:`);
	console.log(`    stored  : ${(before[at] ?? "<absent>").slice(0, 140)}`);
	console.log(`    rendered: ${(after[at] ?? "<absent>").slice(0, 140)}`);
}

let expectedDrop = 0;
for (const section of contextSectionBudgets()) {
	const isProse = section.entry === "summary";
	const measured = isProse ? summaryMeasure(update.summary, section.chars) : listMeasure(bullets(section.heading), section.chars);
	expectedDrop += measured.dropped;
	const fill = (measured.raw / section.chars) * 100;
	const headroom = section.chars - measured.raw;
	const overShare = measured.raw > section.chars;
	const thin = !overShare && measured.raw > section.chars * MAX_SECTION_FILL;
	if (overShare || thin) ok = false;
	const notes = [];
	if (overShare) notes.push(`OVER its share — ${measured.raw - section.chars} chars past the budget, the renderer drops trailing items`);
	else if (thin) notes.push(`THIN — under the ${Math.round(MAX_SECTION_FILL * 100)}% fill gate`);
	if (!isProse) {
		if (measured.entryCapped > 0) notes.push(`${measured.entryCapped} item(s) past the ${MAX_LIST_ENTRIES}-entry cap`);
		if (measured.budgetDropped > 0) notes.push(`${measured.budgetDropped} trailing item(s) dropped`);
	}
	console.log(
		`  ${section.heading.padEnd(11)} wants ${String(measured.raw).padStart(5)} / ${String(section.chars).padStart(5)} = ${fill.toFixed(1).padStart(5)}%  headroom ${String(headroom).padStart(5)}  keeps ${String(measured.kept).padStart(5)}  ${notes.length > 0 ? notes.join("; ") : "inside its share"}`,
	);
}

// Cross-check: the count this script derives must equal the count the renderer itself reports.
if (expectedDrop !== reportedDrop) {
	ok = false;
	console.log(`  MISMATCH: this script derives ${expectedDrop} dropped characters, the renderer reports ${reportedDrop}`);
}

const items = [...update.key_points, ...update.open_tasks];
const overCap = items.filter((item) => normalize(item).length > MAX_LIST_ITEM_CHARS);
if (overCap.length > 0) {
	ok = false;
	for (const item of overCap) console.log(`  OVER the ${MAX_LIST_ITEM_CHARS}-char item cap: ${normalize(item).length} — ${item.slice(0, 80)}…`);
}

console.log(
	ok
		? `VERDICT: fixpoint, nothing clipped, every section at most ${Math.round(MAX_SECTION_FILL * 100)}% of its share`
		: "VERDICT: this document is not a renderer fixpoint, would lose content on the next write, or is too close to a section budget",
);
process.exit(ok ? 0 : 1);
