// F3 closure probe: hostile inputs against the shipped token-boundary rule.
// Read-only; imports the committed lib/.
import { MISSING_LITERAL_SAMPLES, backtickedLiterals, missingLiteralsBetween } from "/mnt/Data/Projects/dsh-project-context/lib/project-memory/missing-literals.js";

let failures = 0;
function check(label, actual, expected) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (!ok) failures += 1;
	console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(74)} ${JSON.stringify(actual)}${ok ? "" : ` expected ${JSON.stringify(expected)}`}`);
}

const count = (previous, next) => missingLiteralsBetween(previous, next).count;

console.log("--- punctuation-adjacent literals are mentions (the token is there) ---");
check("failureCodeOf(...)", count("- `failureCodeOf` first\n", "- failureCodeOf(...) first\n"), 0);
check("(failureCodeOf)", count("- `failureCodeOf` first\n", "- (failureCodeOf) first\n"), 0);
check('"failureCodeOf"', count("- `failureCodeOf` first\n", '- "failureCodeOf" first\n'), 0);
check("path/to/file.ts as a whole token", count("- `path/to/file.ts` first\n", "- see path/to/file.ts first\n"), 0);
check("reason === \"manual\" (space inside)", count('- `reason === "manual"` gates\n', '- see reason === "manual" gates\n'), 0);
check("/etc/nixos:", count("- `/etc/nixos` holds it\n", "- /etc/nixos: holds it\n"), 0);

console.log("\n--- a literal that is only a prefix of a longer bare word is a LOSS ---");
check("main in remaining", count("- `main` owns it\n", "- the remaining domain owns it\n"), 1);
check("test in tests", count("- `test` gates it\n", "- tests gate it\n"), 1);
check("docs in documentation", count("- `docs` holds it\n", "- documentation holds it\n"), 1);
check("memoryComparisonKey in ...WithDrop", count("- `memoryComparisonKey` normalizes\n", "- `memoryComparisonKeyWithDrop` normalizes\n"), 1);
check("prefix with a hyphen after it is a mention", count("- `main` owns it\n", "- main-page owns it\n"), 0);

console.log("\n--- CJK: whole token, including a two-character literal below the floor ---");
check("记忆库 in 记忆库扩容 (loss)", count("- `记忆库` 是事实\n", "- 记忆库扩容是事实\n"), 1);
check("记忆库 free-standing (mention)", count("- `记忆库` 是事实\n", "- 记忆库 是事实\n"), 0);
check("记忆库 against punctuation (mention)", count("- `记忆库` 是事实\n", "- 「记忆库」是事实\n"), 0);
check("two-character CJK literal is below MIN_LITERAL_CHARS", backtickedLiterals("- `记忆` 是事实\n"), []);
check("three-character CJK literal is a literal", backtickedLiterals("- `记忆库` 是事实\n"), ["记忆库"]);
check("ASCII two-character literal is below the floor", backtickedLiterals("- `ab` and `abc`\n"), ["abc"]);

console.log("\n--- fenced code blocks ---");
check("fence line ```js carries no literal", backtickedLiterals("```js\nconst x = 1;\n```\n"), []);
check("a literal inside a fence is extracted like any other", backtickedLiterals("```js\nconst y = `inFence`;\n```\n"), ["inFence"]);
check("an unchanged fenced block measures zero", count("```js\nconst y = `inFence`;\n```\n", "```js\nconst y = `inFence`;\n```\n"), 0);
check("a fenced block that became prose still mentions the token", count("```js\nconst y = `inFence`;\n```\n", "```js\nconst y = inFence;\n```\n"), 0);
check("a fence whose literal left entirely is reported", count("```js\nconst y = `inFence`;\n```\n", "```js\nconst y = 1;\n```\n"), 1);

console.log("\n--- the same literal twice on one line / across lines ---");
check("twice on one line dedupes", backtickedLiterals("- `kept` and `kept` again"), ["kept"]);
check("twice on one line, one survived", count("- `kept` and `kept` again\n", "- `kept` and it again\n"), 0);
check("twice on one line, both gone", count("- `kept` and `kept` again\n", "- it again\n"), 1);
check("kept once bare on a line with an unpaired backtick", count("- `kept`\n", "- `unpaired kept\n"), 0);

console.log("\n--- pairing: three backticks on one line (both halves use the same per-line regex) ---");
// `backtickedLiterals` and `outsideBackticks` both apply /`[^`]*`/g to each line, left to right, so a
// line with an odd backtick count leaves the same tail bare for both. A literal that textually sits in
// the *removed* span cannot be a bare mention, and one in the leftover tail must be.
check("`abc` x `def  -> literal abc, tail `def is bare", backtickedLiterals("`abc` x `def"), ["abc"]);
check("  ... and a previous literal def is a mention in the bare tail", count("- `def`\n", "`abc` x `def\n"), 0);
check("  ... while a previous literal xyz is missing", count("- `xyz`\n", "`abc` x `def\n"), 1);
check("unpaired single backtick, literal before it is a mention", count("- `alpha`\n", "`alpha\n"), 0);
check("pair split across two lines is never spliced", backtickedLiterals("a `alpha\nbeta` b"), []);
check("  ... and measures 0", count("a `alpha\nbeta` b", "nothing"), 0);
check("`` `` `x` carries nothing (all spans < 3 after trim)", backtickedLiterals("`` `` `x`"), []);

console.log("\n--- CRLF and trimming ---");
check("CRLF lines", backtickedLiterals("- `alphaGate`\r\n- `betaGate`\r\n"), ["alphaGate", "betaGate"]);
check("trimmed padding collapses", backtickedLiterals("` abc ` and `abc`"), ["abc"]);
check("a padded span still mentions the trimmed literal", count("- ` abc `\n", "` abc `\n"), 0);

console.log("\n--- the samples cap and the direction ---");
check("15 losses -> count 15, samples 10", missingLiteralsBetween(Array.from({ length: 15 }, (_, i) => `- \`fact-${i}\``).join("\n"), "- nothing left"), {
	count: 15,
	samples: Array.from({ length: MISSING_LITERAL_SAMPLES }, (_, i) => `fact-${i}`),
});
check("directional", count("- `goneSymbol` gates it\n", "- nothing here\n"), 1);
check("  ... and back", count("- nothing here\n", "- `goneSymbol` gates it\n"), 0);

console.log("\n--- pathological input at the live cap (52,000 chars) ---");
const cap = 52000;
let prev = "";
for (let i = 0; prev.length < cap - 10; i += 1) prev += `- \`sym${i}bol\`\n`;
const prose = "x".repeat(cap);
let t0 = process.hrtime.bigint();
const n = missingLiteralsBetween(prev, prose).count;
console.log(`  ${backtickedLiterals(prev).length} distinct literals vs 52k prose: count=${n} in ${(Number(process.hrtime.bigint() - t0) / 1e6).toFixed(1)} ms`);
const ticks = "`".repeat(cap);
t0 = process.hrtime.bigint();
console.log(`  52k lone backticks: literals=${backtickedLiterals(ticks).length} in ${(Number(process.hrtime.bigint() - t0) / 1e6).toFixed(1)} ms`);

console.log(`\nfailures: ${failures}`);
process.exitCode = failures === 0 ? 0 : 1;
