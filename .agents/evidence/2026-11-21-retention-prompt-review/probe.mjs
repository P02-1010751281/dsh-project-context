// Read-only evidence for the retention-prompt review (2026-11-21).
//
// Measures the prompt growth, the trigger boundary, the assembled near-cap prompt, the fit-clip
// band that hides the ladder, the near-cap test fixture, and the curation arithmetic the CHANGELOG
// claims. Imports the built `lib/`; writes nothing to the repository.
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sign = (n) => (n >= 0 ? `+${n}` : `${n}`);

const ROOT = "/mnt/Data/Projects/dsh-project-context";
const C = await import(`${ROOT}/lib/project-memory/consolidate.js`);
const S = await import(`${ROOT}/lib/project-memory/sections.js`);
const R = await import(`${ROOT}/lib/project-memory/retirement.js`);
const { fitMemoryInput } = await import(`${ROOT}/lib/shared/conversation.js`);
const { missingLiteralsBetween } = await import(`${ROOT}/lib/project-memory/missing-literals.js`);

const head = execSync("git show HEAD:src/project-memory/consolidate.ts", { cwd: ROOT, encoding: "utf8" });
const grab = (name, src) => new RegExp(`export const ${name} =\\n\\t"([^"]*)";`, "s").exec(src)?.[1];

console.log("== 1. prompt growth (characters) ==");
const oldKeep = grab("MEMORY_KEEP_RULE", head);
const oldCaption = grab("MEMORY_SURVIVAL_CAPTION", head);
const oldBudget = /return `memory_markdown([^`]*)`;/.exec(head)[1];
const newBudgetBase = C.memoryBudgetRule(40_000, 0).slice("memory_markdown".length);
console.log(`MEMORY_KEEP_RULE      ${oldKeep.length} -> ${C.MEMORY_KEEP_RULE.length} (${sign(C.MEMORY_KEEP_RULE.length - oldKeep.length)})`);
console.log(`MEMORY_SURVIVAL_CAPTION ${oldCaption.length} -> ${C.MEMORY_SURVIVAL_CAPTION.length} (${sign(C.MEMORY_SURVIVAL_CAPTION.length - oldCaption.length)})`);
console.log(`memoryBudgetRule base  ${oldBudget.length} -> ${newBudgetBase.length} (${sign(newBudgetBase.length - oldBudget.length)})`);
console.log(`MEMORY_RETENTION_LADDER ${C.MEMORY_RETENTION_LADDER.length} (+1 separator when appended)`);
const always = C.MEMORY_KEEP_RULE.length - oldKeep.length + (C.MEMORY_SURVIVAL_CAPTION.length - oldCaption.length) + (newBudgetBase.length - oldBudget.length);
console.log(`unconditional total per pass: ${sign(always)}; near-cap total: ${sign(always + C.MEMORY_RETENTION_LADDER.length + 1)}`);

console.log("\n== 2. trigger boundary ==");
for (const cap of [40_000, 52_000]) {
	const at = Math.floor(cap * 0.9);
	console.log(`cap ${cap}: fires at ${at} (${((100 * at) / cap).toFixed(3)}%), at ${at - 1}: ${C.memoryBudgetRule(cap, at - 1).includes(C.MEMORY_RETENTION_LADDER)}`);
}

console.log("\n== 3. assembled near-cap prompt: which sentences coexist ==");
const prompt = [
	...C.CONSOLIDATION_PROMPT_RULES,
	C.memorySectionRule(52_000),
	C.memoryBudgetRule(52_000, 50_000),
	"<MEMORY_ENTRY_ID_RULE>",
	"",
	C.MEMORY_SURVIVAL_CAPTION,
	"<existing-memory>", "…", "</existing-memory>",
].join("\n");
for (const sentence of [
	"A section still over its target is fixed by tightening prose",
	"Never shorten a still-true entry's wording to buy room",
	"every entry that is still true must reappear unless it is superseded",
	"Delete an entry only when it is superseded or already covered elsewhere",
	"delete only an entry that is superseded",
	"pointing at the skill or document that owns a procedure",
	"already names the skill, tracked document",
	"a section may go over its share while the document has room",
]) console.log(`[${prompt.includes(sentence) ? "PRESENT" : "absent "}] ${sentence}`);

console.log("\n== 4. fit-clip band: when the ladder is unreachable ==");
const memory = fs.readFileSync(`${ROOT}/.agents/memory/MEMORY.md`, "utf8");
const context = fs.readFileSync(`${ROOT}/.agents/memory/CONTEXT.md`, "utf8");
const clipped = (text, reasoning) => fitMemoryInput(text, context, 8192, { maxTokens: undefined, reasoning }, 32_768).clipped;
console.log(`live MEMORY.md ${memory.length} chars (${((100 * memory.length) / 52_000).toFixed(2)}% of 52,000), CONTEXT.md ${context.length}`);
for (const reasoning of [false, true]) {
	let lo = 40_000;
	let hi = memory.length;
	if (!clipped(memory, reasoning)) {
		console.log(`reasoning=${reasoning}: no clip up to ${hi}; ladder band [46,800, 52,000)`);
		continue;
	}
	while (lo + 1 < hi) {
		const mid = (lo + hi) >> 1;
		if (clipped(memory.slice(0, mid), reasoning)) hi = mid;
		else lo = mid;
	}
	console.log(`reasoning=${reasoning}: fit clips from ${hi} chars (${((100 * hi) / 52_000).toFixed(2)}%); ladder band [46,800, ${hi})`);
}

console.log("\n== 5. near-cap test fixture: raw vs id-stamped occupancy ==");
const doc = (projectBody) => ["# Project Memory", "", "## Project", projectBody, "", "## Invariants", "- alphaRule", "", "## Pitfalls", "- none yet", "", "## Index", "- docs/README.md", ""].join("\n");
const entries = [];
const estimated = () => doc(entries.join("\n")).length + entries.length * 5;
while (estimated() < 3_650) entries.push(`- fact ${entries.length} mentions token${entries.length} and stays short`);
const nearCapDoc = doc(entries.join("\n"));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ladder-fixture-"));
const plan = await R.retireWithinBudget(S.sectionsFromMarkdown(nearCapDoc), { projectRoot: root, firstSeen: new Map(), today: "2026-11-21", now: Date.now() }, 4_000);
const rendered = S.renderMemoryDocument(plan.sections, 4_000);
console.log(`entries ${entries.length}; raw ${nearCapDoc.length} (${((100 * nearCapDoc.length) / 4_000).toFixed(1)}% of 4,000); stamped ${rendered.text.length} (${((100 * rendered.text.length) / 4_000).toFixed(1)}%); clean ${rendered.sectionDropped === 0 && rendered.itemTruncated === 0}`);

console.log("\n== 6. curation arithmetic (CHANGELOG 2,083 / 11 literals) ==");
const prev = fs.readFileSync("/tmp/memory-curation/previous.md", "utf8");
const next = fs.readFileSync("/tmp/memory-curation/next.md", "utf8");
const loss = missingLiteralsBetween(prev, next);
console.log(`previous.md ${prev.length} -> next.md ${next.length} = ${prev.length - next.length}`);
console.log(`missing literals ${loss.count}: ${JSON.stringify(loss.samples.slice(0, 3))} …`);
const skill = fs.readFileSync(`${ROOT}/.agents/skills/dsh-subagent-codex-model-pin/SKILL.md`, "utf8");
const absentInSkill = loss.samples.filter((literal) => !skill.includes(literal));
console.log(`missing literals absent from the codex skill: ${absentInSkill.length}`);
const numbers = (text) => new Set((text.match(/\b\d[\d,.:%/ -]*\b/g) ?? []).map((token) => token.trim()));
const goneNumbers = [...numbers(prev)].filter((token) => !next.includes(token));
console.log(`non-backticked numeric tokens absent from next.md: ${JSON.stringify(goneNumbers.filter((token) => !loss.samples.includes(token)))}`);

console.log("\n== 7. tier C retry text ==");
console.log(JSON.stringify(C.memoryLossRetryRule([], 0).split("\n").at(-1)));
