// Hostile-input probe for backtickedLiterals / missingLiteralsBetween (shipped lib/).
import { MISSING_LITERAL_SAMPLES, backtickedLiterals, missingLiteralsBetween } from "/mnt/Data/Projects/dsh-project-context/lib/project-memory/missing-literals.js";

const show = (label, value) => console.log(label.padEnd(58), JSON.stringify(value));

show("unbalanced: 'a ` b'", backtickedLiterals("a ` b"));
show("unbalanced: '`a` `b'", backtickedLiterals("`a` `b"));
show("three backticks: '```'", backtickedLiterals("```"));
show("fence line: '```js'", backtickedLiterals("```js"));
show("fence line: '```code```'", backtickedLiterals("```code```"));
show("entire doc is one fenced block", backtickedLiterals("```\nalpha beta\n```\n"));
show("pair split across lines", backtickedLiterals("a `alpha\nbeta` b"));
show("CRLF line", backtickedLiterals("- `alphaGate`\r\n- `betaGate`\r\n"));
show("CJK literal", backtickedLiterals("- `改写失败` and `失败`"));
show("nested punctuation", backtickedLiterals('- `reason === "manual"` gates it'));
show("literal repeated across lines", backtickedLiterals("- `dup`\n- `dup` again"));
show("empty document", backtickedLiterals(""));
show("trim collapses padding", backtickedLiterals("` abc ` and `abc`"));

console.log("\n-- bare-text suppression: real losses the measure does not see --");
// A symbol that left, but survives as a SUBSTRING of another backticked symbol.
const p1 = "- the write path uses `memoryComparisonKey` as its baseline\n";
const n1 = "- the write path uses `memoryComparisonKeyWithDrop` as its baseline\n";
show("previous `memoryComparisonKey` -> next `...WithDrop`", missingLiteralsBetween(p1, n1));
// A symbol that left, but survives as a SUBSTRING of unrelated prose.
const p2 = "- `main` owns the entry point\n";
const n2 = "- the remaining domain owns the entry point\n";
show("previous `main` -> next 'remaining domain'", missingLiteralsBetween(p2, n2));
// A literal whose text left as a fact but whose characters remain anywhere.
show("previous `dsh` -> next 'the dsh project'", missingLiteralsBetween("- `dsh` is the host\n", "- the dsh project is the host\n"));

console.log("\n-- the other direction: a genuine miss is reported --");
show("previous `goneSymbol` -> unrelated next", missingLiteralsBetween("- `goneSymbol` gates it\n", "- nothing here\n"));

console.log("\n-- performance / pathological input (52k chars, the live maxMemoryChars) --");
function time(label, fn) {
	const t0 = process.hrtime.bigint();
	const out = fn();
	const ms = Number(process.hrtime.bigint() - t0) / 1e6;
	console.log(label.padEnd(58), `${ms.toFixed(1)} ms`, out === undefined ? "" : JSON.stringify(out));
}
const cap = 52000;
// Worst case for the includes() loop: ~7000 DISTINCT literals in the previous doc, and a next doc of
// the same size whose text never contains any of them.
let prev = "";
for (let i = 0; prev.length < cap - 10; i++) prev += `- \`sym${i}bol\`\n`;
const next = "x".repeat(cap);
console.log("prev literals:", backtickedLiterals(prev).length, "prev chars:", prev.length);
time("missingLiteralsBetween(7000 distinct, 52k prose)", () => missingLiteralsBetween(prev, next).count);
time("backtickedLiterals(52k, balanced)", () => backtickedLiterals(prev).length);
// A single line that is nothing but backticks and never closes a pair.
const ticks = "`".repeat(cap);
time("backtickedLiterals(52k lone backticks)", () => backtickedLiterals(ticks).length);
// One huge unterminated span per line.
const longSpans = ("`" + "a".repeat(500) + "\n").repeat(100);
time("backtickedLiterals(100 x 500-char unterminated)", () => backtickedLiterals(longSpans).length);
// Many long literals, each checked with includes over a 52k next doc.
let longPrev = "";
for (let i = 0; longPrev.length < cap - 600; i++) longPrev += `- \`${"k".repeat(500)}${i}\`\n`;
time("missingLiteralsBetween(~100 x 505-char literals)", () => missingLiteralsBetween(longPrev, next).count);
console.log("sample cap:", MISSING_LITERAL_SAMPLES);
