import { readFileSync, statSync, lstatSync } from "node:fs";
import path from "node:path";
import { loadMemory } from "file:///mnt/Data/Projects/dsh-project-context/lib/project-memory/load.js";
import { sectionsFromMarkdown } from "file:///mnt/Data/Projects/dsh-project-context/lib/project-memory/sections.js";
import { anchorDriftReasons, stripEntryTid, entryTid } from "file:///mnt/Data/Projects/dsh-project-context/lib/project-memory/retirement.js";

const root = process.argv[2] ? new URL(`file://${process.argv[2]}/`).pathname : "/mnt/Data/Projects/dsh-project-context";
const mem = await loadMemory(root, 45000);
const secs = sectionsFromMarkdown(mem.text);
if (!secs) { console.log("UNPARSEABLE"); process.exit(1); }

const ANCHOR_EXTENSIONS = new Set(["ts","tsx","js","jsx","mjs","cjs","mts","cts","json","md","yml","yaml","sh","log","txt","lock","toml","html","css","patch"]);
const ANCHOR = /(?:^|[\s(（`'"[：:，,])((?:\/|[\w.@+-]+\/)+[\w.@+-]+)(?::(\d+)(?:[–-](\d+))?)?/g;

function anchors(entry) {
  const out = new Map();
  ANCHOR.lastIndex = 0; let m;
  while ((m = ANCHOR.exec(entry)) !== null) {
    const c = m[1];
    if (c.includes("{") || c.includes("*")) continue;
    const dot = (c.split("/").pop() ?? "").lastIndexOf(".");
    if (dot <= 0) continue;
    const ext = c.split("/").pop().slice(dot + 1).toLowerCase();
    if (!ANCHOR_EXTENSIONS.has(ext)) continue;
    const abs = c.startsWith("/") ? c : path.join(root, c);
    try { if (!lstatSync(path.dirname(abs)).isDirectory()) continue; } catch { continue; }
    let st; try { st = statSync(abs); } catch { continue; }
    if (c.includes("memory.jsonl") || c.includes("errors.log") || c.includes("purge.log")) continue;
    out.set(c, st.isFile() ? st.size : -1);
  }
  return out;
}

let entries = 0, withAnchor = 0, totalAnchors = 0, files = new Set(), multiFile = 0;
const perEntry = [];
let drift = 0;
for (const k of Object.keys(secs)) {
  for (const e of secs[k]) {
    entries++;
    const a = anchors(e);
    if (a.size > 0) withAnchor++;
    totalAnchors += a.size;
    for (const f of a.keys()) files.add(f);
    if (a.size > 1) multiFile++;
    perEntry.push(a.size);
    if (anchorDriftReasons(e, root).length > 0) drift++;
  }
}
perEntry.sort((x,y)=>y-x);
console.log(JSON.stringify({
  entries, withAnchor, totalAnchors, uniqueFiles: files.size, entriesWithMoreThanOneAnchor: multiFile,
  topAnchorCounts: perEntry.slice(0,8), anchorsWithZero: perEntry.filter(n=>n===0).length,
  driftReportedByRealFunction: drift,
}, null, 1));
const ej = path.join(root, ".agents/memory/entries.json");
console.log("entries.json bytes:", statSync(ej).size, "ids:", Object.keys(JSON.parse(readFileSync(ej,"utf8")).entries).length);
