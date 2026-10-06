/**
 * Re-runnable round-trip control for the tracked `.agents/memory/CONTEXT.md`.
 *
 * `renderContextDocument` is the only writer of this document, and it clamps twice before it writes:
 * `clipList` trims every bullet to `MAX_LIST_ITEM_CHARS` (800) and drops whole trailing items once a
 * section exceeds its budget. Hand edits with the `edit` tool bypass that path, so a stored bullet
 * over the cap is invisible until the next `/memory update` clips it mid-sentence and appends the
 * `_[context truncated: N characters dropped]_` marker to the file.
 *
 * There is no parser for this document in the plugin (the write path only ever receives a
 * `ContextUpdate` from the model), and `isContextTruncated` proves nothing about a *hand* edit, so
 * this probe does the round trip by hand: parse the stored document back into the `ContextUpdate`
 * shape, render it through the built `lib/`, and compare byte for byte. Any difference is content
 * the next write would silently drop.
 *
 * Run: `node .agents/evidence/2026-10-06-context-doc-roundtrip/roundtrip.mjs`
 * Exit code 0 = every item is inside the per-item cap and the render is byte-identical; otherwise it
 * prints the over-cap items and the first differing line and exits 1.
 */

import { readFileSync } from "node:fs";
import { renderContextDocument } from "../../../lib/project-memory/context-doc.js";
import { MAX_LIST_ITEM_CHARS } from "../../../lib/shared/limits.js";

const PATH = new URL("../../../.agents/memory/CONTEXT.md", import.meta.url);
const stored = readFileSync(PATH, "utf8");

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
const items = [...update.key_points, ...update.open_tasks];
const overCap = items.filter((item) => item.length > MAX_LIST_ITEM_CHARS);
const rendered = renderContextDocument(update, { updatedAt: stamp });

console.log(`items: ${items.length}; over the ${MAX_LIST_ITEM_CHARS}-char cap: ${overCap.length}`);
for (const item of overCap) console.log(`  OVER ${item.length}: ${item.slice(0, 80)}…`);
console.log(`stored ${stored.length} chars, rendered ${rendered.length} chars`);
console.log(`byte-identical round trip: ${rendered === stored}`);

let ok = overCap.length === 0 && rendered === stored;
if (rendered !== stored) {
	const before = stored.split("\n");
	const after = rendered.split("\n");
	const at = before.findIndex((line, index) => line !== after[index]);
	console.log(`  first difference at line ${at + 1}:`);
	console.log(`    stored  : ${(before[at] ?? "<absent>").slice(0, 140)}`);
	console.log(`    rendered: ${(after[at] ?? "<absent>").slice(0, 140)}`);
	ok = false;
}
process.exit(ok ? 0 : 1);
