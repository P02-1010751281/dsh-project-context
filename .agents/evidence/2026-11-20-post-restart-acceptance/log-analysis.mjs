// Runtime evidence for item 4: errors.log entries after the 11:03:08 local restart
// (03:03:08Z) and the journal tail. Read-only.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const MEMORY = "/mnt/Data/Projects/dsh-project-context/.agents/memory";
const CUTOFF = "2026-11-20T03:03:08"; // lexicographic compare works for these ISO stamps
const TS = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\s/;

const log = readFileSync(path.join(MEMORY, "errors.log"), "utf8");
const lines = log.split("\n");

// A line-leading timestamp starts an entry; every following line that does not start with one is
// that entry's continuation (stack frames, the echoed model arguments).
const entries = [];
for (const line of lines) {
  const m = TS.exec(line);
  if (m) entries.push({ ts: m[1], head: line, body: [line] });
  else if (entries.length > 0) entries[entries.length - 1].body.push(line);
}

console.log(`errors.log lines: ${lines.length}; timestamped entries: ${entries.length}`);
console.log(`first entry: ${entries[0].ts}`);
console.log(`last entry:  ${entries[entries.length - 1].ts}`);

const after = entries.filter((e) => e.ts.slice(0, 19) >= CUTOFF);
console.log(`\n=== entries with a line-leading timestamp >= ${CUTOFF}Z: ${after.length} ===`);
for (const e of after) {
  console.log(`--- entry @ ${e.ts} (${e.body.length} line(s)) ---`);
  console.log(e.body.slice(0, 4).join("\n"));
}

const before = entries.filter((e) => e.ts.slice(0, 19) < CUTOFF);
const nearestBefore = before.slice(-3);
console.log(`\n=== last 3 entries BEFORE the restart (control) ===`);
for (const e of nearestBefore) console.log(e.head.slice(0, 150));

function countEntries(predicate) {
  return after.filter((e) => e.body.some(predicate)).length;
}
const isRegression = (l) => l.includes("memory regression:");
const isMalformed = (l) => l.includes("MALFORMED_RESPONSE");
const isRetryLine = (l) => l.includes("the model's record_memory reply was unusable");
console.log(`\n=== counts among the after-restart entries ===`);
console.log(`memory regression: lines      ${countEntries(isRegression)}`);
console.log(`MALFORMED_RESPONSE anywhere   ${countEntries(isMalformed)}`);
console.log(`record_memory unusable retry  ${countEntries(isRetryLine)}`);
console.log(`\nwhole-file counts (any time): memory regression=${lines.filter(isRegression).length}, MALFORMED_RESPONSE=${lines.filter(isMalformed).length}, retry-line=${lines.filter(isRetryLine).length}`);

// Did the pass that landed at 03:07 lose a fact, or rewrite an entry's wording?
const journal = readFileSync(path.join(MEMORY, "memory.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
console.log(`\n=== journal tail: ${journal.length} record(s) ===`);
journal.forEach((r, i) => console.log(`[${i}] ts=${r.ts} op=${r.op} text.length=${r.text.length}`));
const prev = journal[journal.length - 2];
const last = journal[journal.length - 1];
const sampleMatch = after.find((e) => e.body.some(isRegression));
const sample = sampleMatch?.body.find(isRegression)?.replace(/^.*?memory regression: \d+ Invariants\/Pitfalls entry\(ies\) are no longer present, e\.g\. /, "") ?? "";
console.log(`\n=== the entry the 03:07 guard reported as no longer present ===`);
console.log(`len=${sample.length}`);
console.log(`in previous journal record: ${prev.text.includes(sample)}`);
console.log(`in newest journal record:   ${last.text.includes(sample)}`);
const tokens = [...sample.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const missing = tokens.filter((t) => !last.text.includes(t));
console.log(`backticked tokens in the removed entry: ${tokens.length}; missing from the newest record: ${missing.length}${missing.length ? ` -> ${JSON.stringify(missing)}` : ""}`);

const doc = readFileSync(path.join(MEMORY, "MEMORY.md"), "utf8");
console.log(`\n=== MEMORY.md on disk ===`);
console.log(`chars=${doc.length} bytes=${statSync(path.join(MEMORY, "MEMORY.md")).size} mtime=${statSync(path.join(MEMORY, "MEMORY.md")).mtime.toISOString()}`);
console.log(`chars === newest journal text.length: ${doc.length === last.text.length}`);
const backups = readdirSync(MEMORY).filter((n) => n.startsWith("MEMORY.md.memory-backup-")).sort();
const newest = backups[backups.length - 1];
console.log(`backups=${backups.length} newest=${newest} mtime=${statSync(path.join(MEMORY, newest)).mtime.toISOString()}`);
console.log(`headroom to the 52000 cap: ${52000 - last.text.length}`);
