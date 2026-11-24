/**
 * Read-only probe for the memory cap headroom after A (cap 54000) and B (compression).
 *
 * Run: `node .agents/evidence/2026-11-24-memory-cap-headroom/probe.mjs`. Writes nothing.
 * Exit 0 = the document still grows without dropping an entry from any section.
 *
 * Why the demand/allocation comparison instead of a percentage: the document can sit under
 * `maxMemoryChars` and still be unable to take one more fact, because the allocator measures demand at
 * the per-item cap. A percentage of the cap therefore says nothing about growth.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadMemory } from "../../../lib/project-memory/load.js";
import { isMemoryTruncated } from "../../../lib/project-memory/document.js";
import { renderMemoryDocument, sectionsFromMarkdown } from "../../../lib/project-memory/sections.js";
import { memorySectionBudgets, memoryStructureOverheadChars } from "../../../lib/project-memory/memory-schema.js";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const failures = [];

/**
 * Run one check, awaiting it: several checks are async, and a bare `fn()` would let their assertions
 * run after the summary — a failing probe that still exits 0. Every call site below is awaited.
 */
async function check(name, fn) {
	try {
		await fn();
		console.log(`PASS ${name}`);
	} catch (error) {
		failures.push(`${name}: ${error.message}`);
		console.log(`FAIL ${name}\n     ${error.message}`);
	}
}

/** The cap the running profiles actually configure — read from disk, never remembered. */
function configuredCaps() {
	const caps = [];
	for (const profile of ["desktop", "web"]) {
		const file = path.join(process.env.HOME ?? "", ".dsh/profiles", profile, "cordis.patch.yml");
		let text;
		try {
			text = readFileSync(file, "utf8");
		} catch {
			continue;
		}
		const match = /^\s*maxMemoryChars:\s*(\d+)/m.exec(text);
		if (match) caps.push({ profile, cap: Number(match[1]) });
	}
	return caps;
}

const caps = configuredCaps();
console.log(`configured caps: ${caps.map((c) => `${c.profile}=${c.cap}`).join(", ") || "(none readable)"}`);

// ① Both profiles must agree: the two share one MEMORY.md, so the smaller cap clips first.
await check("both installed profiles configure the same maxMemoryChars", () => {
	assert.ok(caps.length > 0, "no profile cap could be read");
	const distinct = new Set(caps.map((c) => c.cap));
	assert.equal(distinct.size, 1, `profiles disagree: ${[...distinct].join(" vs ")}`);
	assert.ok([...distinct][0] >= 54000, `cap ${[...distinct][0]} is below the 54000 this probe was written for`);
});

const CAP = [...new Set(caps.map((c) => c.cap))][0] ?? 54000;

await check("the loaded document is not truncated and parses into four sections", async () => {
	const loaded = await loadMemory(repoRoot, CAP);
	assert.equal(isMemoryTruncated(loaded.text), false, "isMemoryTruncated must be false");
	assert.equal(loaded.damaged, 0, "damaged must be 0");
	const sections = sectionsFromMarkdown(loaded.text);
	assert.ok(sections, "the document must parse into sections");
	assert.deepEqual(Object.keys(sections).sort(), ["index", "invariants", "pitfalls", "project"]);
});

await check("rendering the stored document is byte-identical and loses nothing", async () => {
	const loaded = await loadMemory(repoRoot, CAP);
	const sections = sectionsFromMarkdown(loaded.text);
	const rendered = renderMemoryDocument(sections, CAP);
	assert.equal(rendered.sectionDropped, 0, "sectionDropped");
	assert.equal(rendered.droppedItems, 0, "droppedItems");
	assert.equal(rendered.itemTruncated, 0, "itemTruncated");
	assert.equal(rendered.text, loaded.text, "round trip must be byte-identical");
});

// ② The real criterion: demand against what the allocator may spend.
await check("there is real headroom, measured the way the allocator measures demand", async () => {
	const loaded = await loadMemory(repoRoot, CAP);
	const sections = sectionsFromMarkdown(loaded.text);
	const demand = Object.values(sections).reduce(
		(sum, entries) => sum + entries.reduce((n, e) => n + Math.min(e.length, 800) + 3, 0),
		0,
	);
	const usable = CAP - memoryStructureOverheadChars();
	console.log(`     demand ${demand} / usable ${usable} -> headroom ${usable - demand}`);
	assert.ok(usable > demand, "demand must be below the usable budget");
	// One typical fact must still fit; a 1-char margin is the state this batch fixed.
	assert.ok(usable - demand >= 500, `headroom ${usable - demand} is too thin to take a typical fact`);
});

// ③ The consequence the batch removed: adding to ANY section must not drop another section's entry.
await check("adding one fact to any section drops nothing", async () => {
	const loaded = await loadMemory(repoRoot, CAP);
	const sections = sectionsFromMarkdown(loaded.text);
	for (const key of Object.keys(sections)) {
		const grown = { ...sections, [key]: [...sections[key], "- 探针新增的事实（zz9）。"] };
		const rendered = renderMemoryDocument(grown, CAP);
		assert.equal(rendered.sectionDropped, 0, `adding to ${key}: sectionDropped`);
		assert.equal(rendered.droppedItems, 0, `adding to ${key}: droppedItems`);
		assert.ok(rendered.text.includes("探针新增的事实"), `adding to ${key}: the new fact must survive`);
	}
});

// ④ The sections keep their targets; an over-target section is borrowing, which is by design.
await check("every section still renders all of its entries", async () => {
	const loaded = await loadMemory(repoRoot, CAP);
	const sections = sectionsFromMarkdown(loaded.text);
	const rendered = renderMemoryDocument(sections, CAP);
	for (const budget of memorySectionBudgets(CAP)) {
		const key = budget.heading.toLowerCase();
		for (const entry of sections[key]) {
			assert.ok(rendered.text.includes(`- ${entry}`), `${budget.heading}: an entry is missing from the render`);
		}
	}
});

if (failures.length > 0) {
	console.log(`\nRESULT: FAIL (${failures.length})`);
	process.exit(1);
}
console.log("\nRESULT: PASS — cap agrees across profiles, headroom is real, growth drops nothing");
