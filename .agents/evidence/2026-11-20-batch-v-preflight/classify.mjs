import { statSync, lstatSync } from "node:fs";
import path from "node:path";
import { loadMemory } from "file:///mnt/Data/Projects/dsh-project-context/lib/project-memory/load.js";
import { sectionsFromMarkdown } from "file:///mnt/Data/Projects/dsh-project-context/lib/project-memory/sections.js";
const root="/mnt/Data/Projects/dsh-project-context";
const secs=sectionsFromMarkdown((await loadMemory(root,45000)).text);
const EXT=new Set(["ts","tsx","js","jsx","mjs","cjs","mts","cts","json","md","yml","yaml","sh","log","txt","lock","toml","html","css","patch"]);
const ANCHOR=/(?:^|[\s(（`'"[：:，,])((?:\/|[\w.@+-]+\/)+[\w.@+-]+)(?::(\d+)(?:[–-](\d+))?)?/g;
const out={bind:new Set(), self:new Set(), outside:new Set(), missing:new Set(), unreadable:new Set()};
for(const k of Object.keys(secs)) for(const e of secs[k]){
  ANCHOR.lastIndex=0; let m;
  while((m=ANCHOR.exec(e))!==null){const c=m[1];
    if(c.includes("{")||c.includes("*"))continue;
    const ext=(c.split("/").pop()??"").split(".").pop()?.toLowerCase();
    if(!ext||!EXT.has(ext))continue;
    const abs=c.startsWith("/")?c:path.join(root,c);
    try{if(!lstatSync(path.dirname(abs)).isDirectory())continue;}catch{continue;}
    let st;try{st=statSync(abs);}catch{out.missing.add(c);continue;}
    if(path.isAbsolute(c)) { out.outside.add(c); continue; }
    if(c.startsWith(".agents/memory/")) { out.self.add(c); continue; }
    try{ st=statSync(abs); }catch{ out.unreadable.add(c); continue; }
    out.bind.add(c);
  }
}
for(const [k,v] of Object.entries(out)) console.log(k, v.size, [...v].slice(0,4));
