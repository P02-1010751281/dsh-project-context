/**
 * Independent fuzz probe for batch N (段配额降为目标值, commit 2462d59).
 *
 * Reads the repo's built `lib/` and writes nothing: run it with `node` from anywhere.
 * It exists because the in-repo property test samples 2,000 cases; this one samples 200,000 and
 * additionally pins that the tier-C overage function describes the SAME render it is asked about.
 *
 *   P1  renderMemoryDocument(...).text.length <= cap, for every cap that can hold the document
 *       skeleton (cap >= memoryStructureOverheadChars() = 67).
 *   P2  structureOverhead + sum(entry costs) <= cap  =>  droppedItems === 0   (the pool's promise)
 *   P3  sum(rows.droppedEntries) === render.droppedItems and
 *       sum(rows.truncatedEntries) === render.itemTruncated     (memorySectionOverage has no drift)
 *
 * Exit 0 = PASS. The tiny-cap boundary is NOT a property: a cap below the skeleton's own 67
 * characters yields a 67-character document in BOTH the pre-port and the post-port renderer
 * (verified by extracting `lib/` at 2462d59^ and comparing 602 cap/content pairs: overNewOnly 0).
 * That cap is unreachable in production — `maxMemoryChars` floors at MIN_MEMORY_CHARS (4000) — so
 * the probe excludes it and reports the excluded count instead of asserting it.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const imp = (rel) => import(pathToFileURL(path.join(repo, "lib", rel)).href);
const sections = await imp("project-memory/sections.js");
const schema = await imp("project-memory/memory-schema.js");

const HEADINGS = ["project", "invariants", "pitfalls", "index"];
const SKELETON = schema.memoryStructureOverheadChars(); // 67: header + four `## H\n` + three separators
const rnd = (n) => Math.floor(Math.random() * n);

const makeEntry = () => {
  const pick = Math.random();
  if (pick < 0.2) return "x".repeat(1 + rnd(60));
  if (pick < 0.7) return "x".repeat(60 + rnd(400));
  if (pick < 0.95) return "x".repeat(500 + rnd(600));
  return "x".repeat(900 + rnd(4000));
};
const makeSections = () => {
  const out = { project: [], invariants: [], pitfalls: [], index: [] };
  for (const heading of HEADINGS) {
    const count = rnd(40);
    for (let index = 0; index < count; index += 1) out[heading].push(makeEntry());
  }
  return out;
};
// The renderer's own normalization, so P2's premise is measured on the entries it will actually pack.
const normalize = (value) => value.replace(/\s+/g, " ").trim().replace(/^-\s+/, "").trim();
const costOf = (list) => list.map(normalize).filter((entry) => /[\p{L}\p{N}]/u.test(entry)).reduce((sum, entry) => sum + entry.length + 3, 0);

const N = 200_000;
let p1 = 0;
let p2 = 0;
let p3 = 0;
let considered = 0;
let excluded = 0;
for (let iter = 0; iter < N; iter += 1) {
  // 15% of cases probe the small end; the rest span the real configuration range.
  const cap = Math.random() < 0.15 ? rnd(400) : 4000 + rnd(196_001);
  if (cap < SKELETON) {
    excluded += 1;
    continue;
  }
  const input = makeSections();
  const need = HEADINGS.reduce((sum, heading) => sum + costOf(input[heading] ?? []), 0);
  const render = sections.renderMemoryDocument(input, cap);
  if (render.text.length > cap) {
    p1 += 1;
    if (p1 < 3) console.log("P1 violation", { cap, len: render.text.length });
  }
  if (SKELETON + need <= cap) {
    considered += 1;
    if (render.droppedItems > 0) {
      p2 += 1;
      if (p2 < 3) console.log("P2 violation", { cap, need, dropped: render.droppedItems });
    }
  }
  const rows = sections.memorySectionOverage(input, cap);
  const droppedByName = rows.reduce((sum, row) => sum + row.droppedEntries, 0);
  const truncatedByName = rows.reduce((sum, row) => sum + row.truncatedEntries, 0);
  if (droppedByName !== render.droppedItems || truncatedByName !== render.itemTruncated) {
    p3 += 1;
    if (p3 < 3) console.log("P3 violation", { cap, droppedByName, renderDropped: render.droppedItems, truncatedByName, renderTruncated: render.itemTruncated });
  }
}

console.log(`iterations ${N}  (excluded ${excluded} caps below the ${SKELETON}-character skeleton)`);
console.log(`P1 cap never exceeded (cap >= skeleton)   violations ${p1}`);
console.log(`P2 fits the cap => nothing dropped        violations ${p2}  (considered ${considered})`);
console.log(`P3 overage agrees with the render         violations ${p3}`);
const pass = p1 === 0 && p2 === 0 && p3 === 0 && considered > 100_000;
console.log(`VERDICT ${pass ? "PASS" : "FAIL"}`);
process.exit(pass ? 0 : 1);
