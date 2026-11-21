// F2 closure probe: recompute every calibration number now written down, independently of the
// evidence pack's own script (this one folds the journal the way `loadMemory` does, and prints each
// extractor side by side). Read-only.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const REPO = "/mnt/Data/Projects/dsh-project-context";
const { backtickedLiterals, missingLiteralsBetween } = await import(`${REPO}/lib/project-memory/missing-literals.js`);

const dir = path.join(REPO, ".agents", "memory");
const files = readdirSync(dir).filter((f) => /^memory.*\.jsonl$/.test(f)).sort();

// Every `op: "replace"` document in file order, exactly as it was written to disk.
const docs = files.map((file) => ({
	file,
	texts: readFileSync(path.join(dir, file), "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => { try { return JSON.parse(line); } catch { return undefined; } })
		.filter((record) => record?.op === "replace" && typeof record.text === "string")
		.map((record) => record.text),
}));
const pairs = docs.flatMap(({ file, texts }) => texts.slice(1).map((next, i) => ({ file, previous: texts[i], next })));

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const p90 = (xs) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.9) - 1];

// The extractor §8 of the spec used (filters short spans at the match stage).
function filterAtMatch(text) {
	return new Set([...text.split("\n").join("\n").matchAll(/`([^`\n]{3,})`/g)].map((m) => m[1].trim()));
}

function filterAtMatchRaw(previous, next) {
	const kept = filterAtMatch(next);
	return [...filterAtMatch(previous)].filter((literal) => !kept.has(literal)).length;
}
function filterAtMatchBare(previous, next) {
	const kept = filterAtMatch(next);
	return [...filterAtMatch(previous)].filter((literal) => !kept.has(literal) && !next.includes(literal)).length;
}
function pairingFirstSubstring(previous, next) {
	const kept = new Set(backtickedLiterals(next));
	return backtickedLiterals(previous).filter((literal) => !kept.has(literal) && !next.includes(literal)).length;
}
const preRuleRaw = filterAtMatchRaw;

// The landed rule: pairing first, then drop short spans, then bare mentions only as whole tokens.
const landed = pairs.map(({ previous, next }) => missingLiteralsBetween(previous, next).count);
// F3's first version: `next.includes(literal)`.
const substring = pairs.map(({ previous, next }) => {
	const kept = new Set(backtickedLiterals(next));
	return backtickedLiterals(previous).filter((literal) => !kept.has(literal) && !next.includes(literal)).length;
});
// The retired pre-§9.1 extractor: pair/filter at the match stage, bare text by substring.
const preRule = pairs.map(({ previous, next }) => {
	const kept = new Set([...next.split("\n").flatMap((line) => [...line.matchAll(/`([^`\n]{3,})`/g)].map((m) => m[1].trim()))]);
	return [...filterAtMatch(previous)].filter((literal) => !kept.has(literal) && !next.includes(literal)).length;
});

function row(label, counts) {
	const total = counts.reduce((a, b) => a + b, 0);
	console.log(
		`${label.padEnd(34)} transitions=${counts.length} zero=${counts.filter((n) => n === 0).length}` +
		` (${Math.round((counts.filter((n) => n === 0).length / counts.length) * 100)}%)` +
		` mean=${mean(counts).toFixed(2)} median=${median(counts)} max=${Math.max(...counts)} p90=${p90(counts)} total=${total}`,
	);
	return total;
}

console.log("journals:", docs.map(({ file, texts }) => `${file}(${texts.length})`).join(" "));
console.log(`pairs: ${pairs.length}\n`);
row("landed (pair, then whole token)", landed);
row("substring rule (F3 first version)", substring);
row("pre-§9.1 (filter at the match)", preRule);

const landedTotal = landed.reduce((a, b) => a + b, 0);
const substringTotal = substring.reduce((a, b) => a + b, 0);
console.log(`\nsubstring rule hid: ${landedTotal - substringTotal} losses = ${((landedTotal - substringTotal) / landedTotal * 100).toFixed(1)}% of the landed total`);
console.log(`landed means: ${(landedTotal / landed.length).toFixed(2)} / substring means: ${(substringTotal / substring.length).toFixed(2)}`);
console.log(`histogram (landed): ${JSON.stringify(landed.reduce((acc, n) => (acc[n] = (acc[n] ?? 0) + 1, acc), {}))}`);

// The "61 vs 57 on the same bytes" claim (§9.1, repeated in the CHANGELOG and the module comment):
// it is the spec §1 pair, 44,996 -> 39,900 characters with 553 -> 514 literals. Recompute all variants.
const specPair = pairs.findIndex(({ previous, next }) => previous.length === 44996 && next.length === 39900);
if (specPair < 0) {
	console.log("\nspec §1 pair (44996 -> 39900) NOT FOUND in the journals");
} else {
	const { previous, next, file } = pairs[specPair];
	console.log(`\nspec §1 pair in ${file}: ${previous.length} -> ${next.length} chars, ${backtickedLiterals(previous).length} -> ${backtickedLiterals(next).length} literals`);
	console.log(`  filter-at-match, no bare check      : ${preRuleRaw(previous, next)}   (spec §1: 74 missing)`);
	console.log(`  literal counts by rule: ${backtickedLiterals(previous).length} -> ${backtickedLiterals(next).length}; the spec's extractor reports 553 -> 514 (it keeps spans that only trim below three characters)`);
	console.log(`  filter-at-match, substring bare     : ${filterAtMatchBare(previous, next)}   (spec §9.1: 61)`);
	console.log(`  pairing-first, substring bare       : ${pairingFirstSubstring(previous, next)}   (spec §9.1: 57)`);
	console.log(`  pairing-first, whole token (shipped): ${landed[specPair]}   (the landed rule in this batch)`);
	console.log(`  shipped rule, this pair             : ${missingLiteralsBetween(previous, next).count}`);
	const keptSpec = filterAtMatch(next);
	console.log(`  backticked-only under the substring rule: ${[...filterAtMatch(previous)].filter((literal) => !keptSpec.has(literal) && next.includes(literal)).length}   (spec §1: 13)`);
}

// Provenance check for the retired numbers the README calls "§8's one-shot regex". The rotate
// archives are immutable, so this is reproducible: try the four rule shapes over the five archives.
const archives = docs.filter(({ file }) => file !== "memory.jsonl");
const archivePairs = archives.flatMap(({ texts }) => texts.slice(1).map((next, i) => ({ previous: texts[i], next })));
const archiveCounts = (fn) => archivePairs.map(fn);
row("\n5 archives, §8 rule (filter, no bare)", archiveCounts(({ previous, next }) => {
	const kept = filterAtMatch(next);
	return [...filterAtMatch(previous)].filter((literal) => !kept.has(literal)).length;
}));
row("5 archives, filter + substring bare", archiveCounts(({ previous, next }) => {
	const kept = filterAtMatch(next);
	return [...filterAtMatch(previous)].filter((literal) => !kept.has(literal) && !next.includes(literal)).length;
}));
row("5 archives, pairing + substring bare", archiveCounts(({ previous, next }) => {
	const kept = new Set(backtickedLiterals(next));
	return backtickedLiterals(previous).filter((literal) => !kept.has(literal) && !next.includes(literal)).length;
}));
row("5 archives, pairing + NO bare check", archiveCounts(({ previous, next }) => {
	const kept = new Set(backtickedLiterals(next));
	return backtickedLiterals(previous).filter((literal) => !kept.has(literal)).length;
}));
console.log("retired numbers (README / old CHANGELOG): 59 transitions, zero 26, mean 6.41, max 68");

const maxPre = Math.max(...preRule);
console.log(`filter-at-match max=${maxPre};  the README prose says the landed tail reaches 57 while its table says max 67`);
