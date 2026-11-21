// Recalibration of the missing-literals measure over the memory journals this repo kept.
//
// The CHANGELOG claims: "memory.jsonl 六份日志共 59 次转换：零丢失 26 次，平均每次丢 6.4 个字面量，
// 最大 68". This probe prints (a) what the landed measure reports over the six journals, and (b) what
// the pre-§9.1 rule ("lost = old − new", no bare-text check) reports over the same history, which is
// where the CHANGELOG's four numbers come from.
//
// Run: node recalibrate.mjs
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const LIB = "/mnt/Data/Projects/dsh-project-context/lib/project-memory";
const { foldMemoryJournal } = await import(`${LIB}/memory-store.js`);
const { missingLiteralsBetween, backtickedLiterals } = await import(`${LIB}/missing-literals.js`);

const dir = "/mnt/Data/Projects/dsh-project-context/.agents/memory";
const files = readdirSync(dir).filter((f) => /^memory.*\.jsonl$/.test(f)).sort();
const CAP = 52000; // the live profile's maxMemoryChars

const journals = files.map((f) => ({
	file: f,
	entries: readFileSync(path.join(dir, f), "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line))
		.filter((entry) => entry?.op === "replace" && typeof entry.text === "string"),
}));

/** Consecutive folded documents of one journal: one state per landed document, in file order. */
function states(entries) {
	const out = [];
	for (let i = 1; i <= entries.length; i += 1) out.push(foldMemoryJournal(entries.slice(0, i), CAP));
	return out;
}

function pairsOf(js) {
	return js.flatMap(({ entries }) => {
		const s = states(entries);
		return s.slice(1).map((next, i) => [s[i], next]);
	});
}

function stats(label, pairs, bare) {
	const counts = pairs.map(([previous, next]) => {
		const kept = new Set(backtickedLiterals(next));
		return backtickedLiterals(previous).filter((literal) => !kept.has(literal) && !(bare && next.includes(literal))).length;
	});
	const sum = counts.reduce((a, b) => a + b, 0);
	console.log(`${label}: transitions=${counts.length} zero=${counts.filter((c) => c === 0).length} mean=${(sum / counts.length).toFixed(2)} max=${Math.max(...counts)} sum=${sum}`);
}

console.log("journals:", files.join(", "));
console.log("replace records per journal:", journals.map((j) => j.entries.length).join(","));
stats("landed measure, six journals          ", pairsOf(journals), true);
stats("pre-§9.1 rule (no bare check), six    ", pairsOf(journals), false);
// `memory.jsonl`'s first record is the rotation genesis, a duplicate of the archive's last document;
// the pre-fix runs that quote 59 transitions were taken before the sixth journal's later writes.
stats("pre-§9.1 rule (no bare check), five   ", pairsOf(journals.slice(0, 5)), false);
console.log("CHANGELOG claims: transitions=59 zero=26 mean=6.41 max=68");
