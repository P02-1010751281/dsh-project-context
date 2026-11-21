import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
const ROOT = "/mnt/Data/Projects/dsh-project-context";
const lib = (m) => import(path.join(ROOT, "lib/project-memory", m));
const { readEntrySidecar } = await lib("entry-sidecar.js");
const { sectionsFromMarkdown } = await lib("sections.js");
const { entryTid } = await lib("retirement.js");
const { measureStaleness } = await lib("staleness-source.js");

const doc = await readFile(path.join(ROOT, ".agents/memory/MEMORY.md"), "utf8");
const facts = await measureStaleness(ROOT, doc);
console.log("headline:", JSON.stringify(facts));
console.log("document chars:", doc.length);

const sections = sectionsFromMarkdown(doc);
const sidecar = await readEntrySidecar(ROOT);
console.log("sidecar readable:", sidecar.readable, "entries:", sidecar.entries.size, "bound tids:", sidecar.sources.size);
const entries = new Map();
for (const key of Object.keys(sections)) for (const e of sections[key]) { const t = entryTid(e); if (t) entries.set(t, e); }

const sha = (b) => createHash("sha256").update(b).digest("hex").slice(0, 16);
const rows = [];
for (const [tid, bindings] of sidecar.sources) {
  if (entries.size && !entries.has(tid)) { rows.push({ tid, entry: "(entry no longer in document)", changed: [...bindings.keys()], note: "orphan binding" }); continue; }
  const changed = [];
  const gone = [];
  for (const [rel, recorded] of bindings) {
    let now;
    try { now = sha(await readFile(path.join(ROOT, rel))); } catch { gone.push(rel); continue; }
    if (now !== recorded) changed.push(rel);
  }
  if (changed.length || gone.length) rows.push({ tid, changed, gone, entry: (entries.get(tid) ?? "").slice(0, 160) });
}
console.log("\nentries with drift/missing:", rows.length);
for (const r of rows) console.log(JSON.stringify(r, null, 0));
