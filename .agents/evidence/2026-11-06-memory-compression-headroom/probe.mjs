#!/usr/bin/env node
/**
 * Offline budget-fit probe for the tracked memory documents, run against the built `lib/` the host
 * loads. Answers one question: after a hand compression of MEMORY.md, which half of the write path
 * would refuse the next consolidation pass, and how much rewrite growth is left before it does?
 *
 *   A. budget half   -- renderer round trip + per-section occupancy + total headroom vs the cap
 *   B. growth history -- what a landed pass typically adds, measured from the journals on disk
 *   C. output half   -- `fitMemoryInput`'s request, bounded by the configured ceiling and the
 *                       model's own declared output cap
 *
 * Usage:
 *   node probe.mjs                 # real documents
 *   node probe.mjs --self-test     # proves both failure branches can actually turn red
 *   node probe.mjs --model-cap 328000   # model `defaultMaxTokens`; omit to treat it as unbounded
 *
 * Exit: 0 clear, 1 the pass would lose whole entries or clip its reply, 2 the probe cannot judge.
 * Never writes: every read is read-only, and `--self-test` mutates only in-memory copies.
 */
import fs from "node:fs";
import path from "node:path";

const repo = path.resolve(new URL("../../..", import.meta.url).pathname);
const load = (rel) => import(path.join(repo, rel));

const args = process.argv.slice(2);
const selfTest = args.includes("--self-test");
const capIndex = args.indexOf("--model-cap");
const modelCap = capIndex === -1 ? undefined : Number(args[capIndex + 1]);
if (capIndex !== -1 && (!Number.isSafeInteger(modelCap) || modelCap <= 0)) {
	console.error(`--model-cap must be a positive integer, got ${JSON.stringify(args[capIndex + 1])}`);
	process.exit(2);
}

const { DEFAULT_CONFIG } = await load("lib/shared/config.js");
const { MAX_CONTEXT_CHARS } = await load("lib/shared/limits.js");
const { MEMORY_SECTIONS, memorySchemaOverheadChars, memorySectionBudgets } = await load("lib/project-memory/memory-schema.js");
const { sectionsFromMarkdown, renderMemoryDocument } = await load("lib/project-memory/sections.js");
const { fitMemoryInput } = await load("lib/shared/conversation.js");

const memoryFile = path.join(repo, ".agents/memory/MEMORY.md");
const contextFile = path.join(repo, ".agents/memory/CONTEXT.md");
const cap = DEFAULT_CONFIG.maxMemoryChars;
const ceiling = DEFAULT_CONFIG.maxOutputTokens;
const configured = DEFAULT_CONFIG.maxTokens;

/** Budget half: render the real document back and look for a whole-entry loss. */
function budgetHalf(memory) {
	const sections = sectionsFromMarkdown(memory);
	if (!sections) return { undefined: true };
	const render = renderMemoryDocument(sections, cap);
	const roundTrip = sectionsFromMarkdown(render.text);
	const identical = JSON.stringify(roundTrip) === JSON.stringify(sections);
	const hard = new Map(memorySectionBudgets(cap).map((b) => [b.heading, b.chars]));
	const rows = MEMORY_SECTIONS.map((s) => {
		const entries = sections[s.heading.toLowerCase()] ?? [];
		const chars = entries.reduce((n, e) => n + e.length + 3, 0);
		return { heading: s.heading, entries: entries.length, chars, hard: hard.get(s.heading) };
	});
	return {
		undefined: false,
		render,
		identical,
		rows,
		lossy: render.sectionDropped > 0 || render.droppedItems > 0,
		headroom: cap - render.text.length,
	};
}

/** Growth history: one number per landed pass, normalised by the second the journal wrote it. */
function growthHistory() {
	const files = fs
		.readdirSync(path.join(repo, ".agents/memory"))
		.filter((f) => /^memory.*\.jsonl$/.test(f))
		.map((f) => path.join(repo, ".agents/memory", f));
	const perSecond = new Map();
	let records = 0;
	for (const file of files) {
		for (const line of fs.readFileSync(file, "utf8").split("\n")) {
			if (!line.trim()) continue;
			let row;
			try {
				row = JSON.parse(line);
			} catch {
				continue;
			}
			if (typeof row.text !== "string" || typeof row.ts !== "string") continue;
			records += 1;
			// Several journal appends can share one second; the last one is what that pass landed.
			perSecond.set(row.ts.slice(0, 19), row.text.length);
		}
	}
	const passes = [...perSecond.entries()].sort().map(([ts, n]) => ({ ts, n }));
	const deltas = [];
	for (let i = 1; i < passes.length; i += 1)
		deltas.push({ ts: passes[i].ts, growth: passes[i].n - passes[i - 1].n, input: passes[i - 1].n });
	return { files, records, passes, deltas };
}

function stats(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const at = (q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1))];
	return { n: sorted.length, min: sorted[0], p50: at(0.5), p90: at(0.9), max: sorted[sorted.length - 1] };
}

// ---- self-test: prove both failure branches are reachable before trusting a green run ----------
if (selfTest) {
	const real = fs.readFileSync(memoryFile, "utf8");
	const sections = sectionsFromMarkdown(real);
	if (!sections) {
		console.error("self-test: the real document is not a plain four-section bullet list");
		process.exit(2);
	}
	// Append bullets past the cap as a DOCUMENT STRING: rendering first would already have dropped
	// them, and re-rendering that trimmed text is exactly the false pass this self-test exists for.
	const filler = Array.from({ length: 40 }, () => "- " + "y".repeat(500)).join("\n");
	const inflated = `${real.trimEnd()}\n${filler}\n`;
	const lossy = budgetHalf(inflated);
	const clipped = fitMemoryInput(real, "", configured, { reasoning: true, maxTokens: 4000 }, ceiling);
	const budgetRed = lossy.lossy === true;
	const outputRed = clipped.clipped === true;
	console.log(`self-test budget branch trips: ${budgetRed} (sectionDropped ${lossy.render.sectionDropped}, droppedItems ${lossy.render.droppedItems})`);
	console.log(`self-test output branch trips: ${outputRed} (clipped ${clipped.clipped} at a 4000-token cap)`);
	process.exit(budgetRed && outputRed ? 0 : 3);
}

// ---- A. budget half -----------------------------------------------------------------------------
const memory = fs.readFileSync(memoryFile, "utf8");
const context = fs.readFileSync(contextFile, "utf8");
console.log(`inputs: MEMORY.md ${memory.length} chars, CONTEXT.md ${context.length} chars`);
console.log(`cap maxMemoryChars ${cap} (from DEFAULT_CONFIG), MAX_CONTEXT_CHARS ${MAX_CONTEXT_CHARS}`);

const budget = budgetHalf(memory);
if (budget.undefined) {
	console.error("MEMORY.md is not a plain four-section bullet document; the renderer cannot judge it");
	process.exit(2);
}
console.log("\nA. budget half");
for (const row of budget.rows)
	console.log(
		`  ${row.heading.padEnd(11)} entries ${String(row.entries).padStart(3)}  ${String(row.chars).padStart(6)} / ${String(row.hard).padStart(6)} (${((row.chars / row.hard) * 100).toFixed(1)}% of its share)`,
	);
console.log(
	`  render: sectionDropped ${budget.render.sectionDropped}, droppedItems ${budget.render.droppedItems}, itemTruncated ${budget.render.itemTruncated}, bytes identical ${budget.identical}`,
);
console.log(`  headroom: ${budget.headroom} chars (${budget.render.text.length} / ${cap}); schema overhead ${memorySchemaOverheadChars()}`);

// ---- B. growth history --------------------------------------------------------------------------
const history = growthHistory();
const deltas = history.deltas;
const mature = deltas.filter((d) => d.input >= 34000);
console.log(`\nB. growth history (${history.files.length} journal files, ${history.records} full-text records, ${history.passes.length} landed passes)`);
if (deltas.length > 0) {
	const all = stats(deltas.map((d) => d.growth));
	console.log(`  all passes      n=${all.n}  min ${all.min}  p50 ${all.p50}  p90 ${all.p90}  max ${all.max}`);
	if (mature.length > 0) {
		const m = stats(mature.map((d) => d.growth));
		console.log(`  mature (>=34000) n=${m.n}  min ${m.min}  p50 ${m.p50}  p90 ${m.p90}  max ${m.max}`);
		for (const d of mature) console.log(`    ${d.ts}  input ${d.input}  growth ${d.growth >= 0 ? "+" : ""}${d.growth}`);
		const covers = (label, value) => `${label} ${value} ${value <= budget.headroom ? "fits" : "EXCEEDS"} the ${budget.headroom}-char headroom`;
		console.log(`  headroom vs measured growth: ${covers("p50", m.p50)}; ${covers("max", m.max)}`);
	}
}

// ---- C. output half -----------------------------------------------------------------------------
const auxModel = { reasoning: true, ...(modelCap === undefined ? {} : { maxTokens: modelCap }) };
const fitted = fitMemoryInput(memory, context, configured, auxModel, ceiling);
const bound = modelCap === undefined ? ceiling : Math.min(modelCap, ceiling);
console.log("\nC. output half");
console.log(`  configured maxTokens ${configured}, ceiling maxOutputTokens ${ceiling}, model defaultMaxTokens ${modelCap ?? "(not supplied: treated as unbounded)"}`);
console.log(`  requested maxTokens ${fitted.maxTokens} (bound ${bound}); clipped ${fitted.clipped}; hidden memory ${fitted.memoryHiddenChars} / context ${fitted.contextHiddenChars}`);

// ---- verdict ------------------------------------------------------------------------------------
const failed = budget.lossy || fitted.clipped || !budget.identical || budget.render.itemTruncated > 0;
console.log(
	`\nVERDICT: ${failed ? "the current documents already lose data -- shrink before restarting" : "at the current size both halves are clear: the renderer keeps every entry and the reply is not clipped"}`,
);
if (!failed && mature.length > 0) {
	const m = stats(mature.map((d) => d.growth));
	const over = mature.filter((d) => d.growth > budget.headroom).length;
	console.log(
		`  residual: a pass still refuses if its rewrite grows past ${budget.headroom} chars; ` +
			`${over} of ${mature.length} measured mature passes did (max ${m.max}), so this is a probability, not a guarantee`,
	);
}
process.exit(failed ? 1 : 0);
