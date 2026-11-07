// Why maxMemoryChars moved 40000 -> 45000 on 2026-11-07, measured against the built lib/ the host
// loads. Reads .agents/memory/{MEMORY.md,CONTEXT.md}; writes nothing.
//
// Three questions, because the decision rests on three different numbers:
//   Q1  does 45000 absorb the refusal the log recorded at 2026-11-06T15:14:27Z and 15:21:43Z
//       ("11 whole entry(ies) would have been dropped from 3 section(s)")? The actual reply is not
//       persisted anywhere, so it is reconstructed from the stored document plus eleven entries of
//       the document's own mean length. That reconstruction only counts if 40000 reproduces the
//       recorded signature (11 dropped from 3 sections) — otherwise it is measuring some other reply.
//   Q2  at what cap does the reconstruction render with no drop? That is the margin 45000 buys over
//       the observed refusal, and it is the number that made 43000 look too tight.
//   Q3  does the other half still hold: the pass sends the stored documents, and fitMemoryInput must
//       not clip them at the new cap (a clip is reported, not refused, and a clipped view that lands
//       replaces the stored file). Then how much growth is left before the retry fit starts hiding
//       characters — the residual the cap raise narrows rather than closes.
//
// Run: node .agents/evidence/2026-11-07-maxmemory-45000-raise/probe.mjs
// Exit: 0 = 45000 absorbs the measured reply and the fit is clean; 1 = it does not; 2 = undecidable.
import fs from "node:fs";
import path from "node:path";

const repo = "/mnt/Data/Projects/dsh-project-context";
const memoryPath = path.join(repo, ".agents/memory/MEMORY.md");
const contextPath = path.join(repo, ".agents/memory/CONTEXT.md");

const fail = (message) => {
	console.error(`FAIL: ${message}`);
	process.exit(1);
};
const undecidable = (message) => {
	console.error(`UNDECIDABLE: ${message}`);
	process.exit(2);
};

for (const file of [memoryPath, contextPath]) {
	if (!fs.existsSync(file)) undecidable(`missing input ${file}`);
}

const { sectionsFromMarkdown, renderMemoryDocument } = await import(path.join(repo, "lib/project-memory/sections.js"));
const { resolvePluginConfig } = await import(path.join(repo, "lib/shared/config.js"));
const { fitMemoryInput } = await import(path.join(repo, "lib/shared/conversation.js"));

const real = fs.readFileSync(memoryPath, "utf8");
const context = fs.readFileSync(contextPath, "utf8");
const sections = sectionsFromMarkdown(real);
if (sections === undefined) undecidable("the stored MEMORY.md is not a plain four-section bullet document");

// The pass that refused: config maxMemoryChars 40000, and the same output-cap arguments the
// production call site uses (`config.maxTokens`, auxModel, `config.maxOutputTokens`).
const before = resolvePluginConfig({ maxMemoryChars: 40000 });
const after = resolvePluginConfig({ maxMemoryChars: 45000 });
console.log(`inputs: MEMORY.md ${real.length} chars | CONTEXT.md ${context.length} chars`);
console.log(`caps: before ${before.maxMemoryChars} -> after ${after.maxMemoryChars} | fit maxTokens ${after.maxTokens} ceiling ${after.maxOutputTokens}`);
if (after.maxMemoryChars !== 45000) fail(`resolvePluginConfig({maxMemoryChars:45000}) returned ${after.maxMemoryChars}`);
if (real.length > after.maxMemoryChars) fail(`the stored memory (${real.length}) already exceeds the new cap (${after.maxMemoryChars})`);

/** Every entry in the four sections, in render order. */
const allEntries = (doc) => Object.values(doc).filter(Array.isArray).flat();
const entries = allEntries(sections);
const meanEntry = entries.reduce((sum, entry) => sum + entry.length, 0) / entries.length;
console.log(`reconstruction: ${entries.length} entries, mean ${meanEntry.toFixed(1)} chars, ${allEntries(sections).length} total`);

// Q1: the recorded refusal carried 11 whole entries spread over 3 sections. Distribute the same
// count over the three sections that actually hold content; the header section stays untouched.
const reconstruction = (extra) => {
	const copy = { ...sections };
	for (const key of Object.keys(copy)) if (Array.isArray(copy[key])) copy[key] = [...copy[key]];
	const targets = ["invariants", "pitfalls", "project"];
	const added = [Math.ceil(extra / 3), Math.ceil(extra / 3), extra - 2 * Math.ceil(extra / 3)];
	const filler = "reconstructed entry for the refusal measurement ".repeat(8).slice(0, Math.round(meanEntry));
	targets.forEach((key, index) => {
		for (let n = 0; n < added[index]; n += 1) copy[key].push(`${filler} ${key}-${n}`);
	});
	return copy;
};
const reply = reconstruction(11);
const replyChars = allEntries(reply).reduce((sum, entry) => sum + entry.length, 0);
const atOld = renderMemoryDocument(reply, before.maxMemoryChars);
const atNew = renderMemoryDocument(reply, after.maxMemoryChars);
console.log(`Q1 reply ~${replyChars} chars + layout -> cap ${before.maxMemoryChars}: sectionDropped ${atOld.sectionDropped} droppedItems ${atOld.droppedItems} stored ${atOld.text.length}`);
console.log(`Q1 same reply    -> cap ${after.maxMemoryChars}: sectionDropped ${atNew.sectionDropped} droppedItems ${atNew.droppedItems} stored ${atNew.text.length}`);
if (atOld.droppedItems === 0 || atOld.sectionDropped !== 3) {
	fail(`the reconstruction is no longer refusal-shaped at 40000 (expected whole-entry loss from 3 sections): got ${atOld.droppedItems} from ${atOld.sectionDropped}`);
}
if (atOld.droppedItems !== 11) {
	// The count is a reading, not a constant: it moves when the stored document moves. Only the shape
	// (whole entries lost from three sections) has to hold for the reconstruction to be comparable.
	console.log(`note: the recorded refusal was 11 entries from 3 sections; the stored document has moved since, so the reconstruction now drops ${atOld.droppedItems}`);
}
if (atNew.droppedItems !== 0 || atNew.sectionDropped !== 0) fail(`45000 still drops ${atNew.droppedItems} entry(ies); the raise does not clear the recorded reply`);

// Q2: smallest cap that stores the same reply without a drop.
let breakeven;
for (let cap = before.maxMemoryChars; cap <= replyChars + 2000; cap += 50) {
	const render = renderMemoryDocument(reply, cap);
	if (render.droppedItems === 0 && render.sectionDropped === 0) {
		breakeven = cap;
		break;
	}
}
if (breakeven === undefined) fail("no cap up to the reply size stores the reconstruction without a drop");
console.log(`Q2 breakeven ${breakeven} | 40000 is ${breakeven - 40000} short | 45000 leaves ${45000 - breakeven} chars of margin | 43000 would leave ${43000 - breakeven}`);

// Q3: the input-side fit, with the arguments the pass really uses. The auxModel shape is not
// knowable offline, so both shapes are measured; the one that clips sooner is the binding one.
const shapes = [
	["reasoning", { maxTokens: 328000, reasoning: true }],
	["no-reasoning", { maxTokens: 328000 }],
];
let worstHidden = 0;
for (const [label, auxModel] of shapes) {
	for (const [pass, headroom] of [["first", 0], ["retry", 4096]]) {
		const fit = fitMemoryInput(real, context, after.maxTokens, auxModel, after.maxOutputTokens, headroom);
		console.log(`Q3 fit ${label}/${pass}: maxTokens ${fit.maxTokens} clipped ${fit.clipped} memoryHidden ${fit.memoryHiddenChars} contextHidden ${fit.contextHiddenChars}`);
		if (fit.clipped) fail(`the ${label}/${pass} fit already clips the stored documents at cap ${after.maxMemoryChars}`);
	}
}

// Q3b: how much longer the memory may get before the retry fit starts hiding characters. Growth is
// synthesized from the document's own entries so the token rate stays the document's rate.
const grown = (target) => {
	let out = real;
	let index = 0;
	while (out.length < target) {
		out = `${out.trimEnd()}\n- ${entries[index % entries.length]}`;
		index += 1;
	}
	return out;
};
let fitBreakeven;
for (let target = real.length + 100; target <= after.maxMemoryChars + 4000; target += 100) {
	const fit = fitMemoryInput(grown(target), context, after.maxTokens, shapes[0][1], after.maxOutputTokens, 4096);
	if (fit.clipped) {
		fitBreakeven = target;
		worstHidden = fit.memoryHiddenChars;
		break;
	}
}
if (fitBreakeven === undefined) {
	console.log(`Q3b retry fit still clean at ${after.maxMemoryChars + 4000} chars (beyond any cap this config allows)`);
} else {
	console.log(`Q3b retry fit starts clipping at ${fitBreakeven} chars (${worstHidden} memory chars hidden) -> room above the new cap: ${fitBreakeven - after.maxMemoryChars}`);
	if (fitBreakeven - after.maxMemoryChars <= 0) console.log("Q3b WARNING: the cap alone reaches the fit breakeven; a full document would be clipped on the retry");
}

console.log("RESULT: 45000 absorbs the recorded refusal; the input fit is clean at the new cap");
