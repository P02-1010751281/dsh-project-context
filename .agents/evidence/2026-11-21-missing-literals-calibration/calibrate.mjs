// Offline calibration of the missing-literals measure over the journals this project kept.
// Read-only: it reads `.agents/memory/memory*.jsonl` and prints one table.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { missingLiteralsBetween } from "../../../lib/project-memory/missing-literals.js";

const dir = ".agents/memory";
const files = (await readdir(dir)).filter((name) => /^memory.*\.jsonl$/.test(name)).sort();
const rows = [];
for (const name of files) {
	const lines = (await readFile(path.join(dir, name), "utf8")).trim().split("\n").filter(Boolean);
	const texts = lines.map((line) => { try { return JSON.parse(line); } catch { return undefined; } }).filter((record) => record?.op === "replace" && typeof record.text === "string").map((record) => record.text);
	const counts = [];
	for (let index = 1; index < texts.length; index += 1) counts.push(missingLiteralsBetween(texts[index - 1], texts[index]).count);
	rows.push({ name, records: texts.length, counts });
}
const all = rows.flatMap((row) => row.counts);
const sorted = [...all].sort((a, b) => a - b);
console.log(`journals: ${rows.length}  transitions: ${all.length}`);
for (const row of rows) console.log(`  ${row.name.padEnd(46)} records=${String(row.records).padStart(3)} lost=[${row.counts.join(", ")}]`);
const zero = all.filter((n) => n === 0).length;
const mean = all.reduce((sum, n) => sum + n, 0) / all.length;
const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
console.log(`\ntransitions ${all.length}  zero-loss ${zero} (${Math.round((zero / all.length) * 100)}%)  mean ${mean.toFixed(2)}  median ${median}  max ${Math.max(...all)}  p90 ${sorted[Math.ceil(sorted.length * 0.9) - 1]}`);
console.log(`histogram ${JSON.stringify(all.reduce((acc, n) => (acc[n] = (acc[n] ?? 0) + 1, acc), {}))}`);
