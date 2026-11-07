// Find the (memory, context, maxOutputTokens) points that reproduce the two input-fit shapes, against
// the built lib/ the host loads. Writes nothing.
//
// The distinction that matters:
//   first-clipped  fitMemoryInput's first call clips -> the model is shown a partial memory and its
//                  whole-document reply deletes the hidden characters.
//   retry-clipped  the FIRST fit is clean but the tier-C retry's fit (extraHeadroomTokens > 0) clips,
//                  because extra headroom is taken out of the same output cap. This is the measured
//                  path (cap-sweep 2026-11-06: first clean at 48251 chars, retry clipping from 47087),
//                  so a gate that only covers the first fit leaves it open.
//
// Run: node .agents/evidence/2026-11-07-fit-clip-writeback/probe.mjs
// Exit: 0 = both shapes reproduced (the tests have a real basis); 1 = not reproduced.
import fs from "node:fs";
import path from "node:path";

const repo = "/mnt/Data/Projects/dsh-project-context";
const { fitMemoryInput } = await import(path.join(repo, "lib/shared/conversation.js"));

const real = fs.readFileSync(path.join(repo, ".agents/memory/MEMORY.md"), "utf8");
const entries = real.split("\n").filter((line) => line.startsWith("- "));
const meanEntry = entries.reduce((sum, entry) => sum + entry.length, 0) / entries.length;
/** A memory document of about `target` characters, built from the real entries so the token rate matches. */
const memoryOf = (target) => {
	let out = "# Project Memory\n\n## Invariants\n";
	let index = 0;
	while (out.length < target) out += `${entries[index++ % entries.length]}\n`;
	return out;
};
/** A context document of about `target` characters, in the shape the renderer produces. */
const contextOf = (target) => {
	let out = "# Project Context\n\nLast updated: 2026-11-07T00:00:00.000Z\n\n## Summary\n\n";
	const line = "- a durable key point carried by the context document for this session ".repeat(3);
	let index = 0;
	while (out.length < target) out += `${line} ${index++}\n- `;
	return out;
};

const reason = { maxTokens: 328000, reasoning: true };
const ceiling = 32_768;
const headroom = 4096;

const firstClipped = [];
const retryClipped = [];
for (const tokens of [8192, 12_288, 16_384, 20_000, 24_000, 32_768]) {
	for (const memoryLen of [20_000, 28_000, 34_000, 38_000, 42_000, 45_000]) {
		for (const contextLen of [2_000, 8_000, 16_000, 24_000, 31_000]) {
			const memory = memoryOf(memoryLen);
			const context = contextOf(contextLen);
			const first = fitMemoryInput(memory, context, 8192, reason, tokens);
			const retry = fitMemoryInput(memory, context, 8192, reason, tokens, headroom);
			if (first.clipped) firstClipped.push({ tokens, memoryLen: memory.length, contextLen: context.length, hidden: first.memoryHiddenChars + first.contextHiddenChars });
			else if (retry.clipped) retryClipped.push({ tokens, memoryLen: memory.length, contextLen: context.length, hidden: retry.memoryHiddenChars + retry.contextHiddenChars });
		}
	}
}

console.log(`built from MEMORY.md: ${entries.length} entries, mean ${meanEntry.toFixed(1)} chars`);
console.log(`first-clipped points: ${firstClipped.length} | first-clean-but-retry-clipped points: ${retryClipped.length}`);
firstClipped.sort((a, b) => b.memoryLen - a.memoryLen).slice(0, 3).forEach((p) => console.log(`  first clip: tokens ${p.tokens} memory ${p.memoryLen} context ${p.contextLen} hidden ${p.hidden}`));
retryClipped.sort((a, b) => b.memoryLen - a.memoryLen).slice(0, 5).forEach((p) => console.log(`  retry clip: tokens ${p.tokens} memory ${p.memoryLen} context ${p.contextLen} hidden ${p.hidden}`));

// The largest memory that is still clean on the first fit but clipped on the retry is the point a test
// wants: it is as close to "everything fits" as possible, so the first reply is realistic.
const best = retryClipped.sort((a, b) => b.memoryLen - a.memoryLen)[0];
if (firstClipped.length === 0) {
	console.error("FAIL: no first-clip point in the grid; widen it");
	process.exit(1);
}
if (best === undefined) {
	console.error("FAIL: no retry-clip point with a clean first fit; widen the grid");
	process.exit(1);
}
console.log(`\nchosen retry point: maxOutputTokens ${best.tokens}, memory ${best.memoryLen}, context ${best.contextLen} (retry hides ${best.hidden})`);
console.log("RESULT: both shapes reproduced");
