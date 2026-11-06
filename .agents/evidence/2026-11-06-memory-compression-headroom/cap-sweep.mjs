// Sweep the memory size through fitMemoryInput with the auxModel shape the plugin really builds, so a
// cap choice is judged on the call that will run. Reads the stored documents, writes nothing.
// Run: node .agents/evidence/2026-11-06-memory-compression-headroom/cap-sweep.mjs
import fs from "node:fs";
import path from "node:path";
const repo = "/mnt/Data/Projects/dsh-project-context";
const { fitMemoryInput } = await import(path.join(repo, "lib/shared/conversation.js"));
const real = fs.readFileSync(path.join(repo, ".agents/memory/MEMORY.md"), "utf8");
const ctx = fs.readFileSync(path.join(repo, ".agents/memory/CONTEXT.md"), "utf8");
const lines = real.split("\n").filter((l) => l.startsWith("- "));
const grow = (target) => { let out = "# MEMORY.md\n\n## Invariants\n"; let i = 0; while ([...out].length < target) out += lines[i++ % lines.length] + "\n"; return out; };
for (const [label, model] of [["reasoning", { reasoning: true, maxTokens: 328000 }], ["no-reasoning", { maxTokens: 328000 }]]) {
  console.log(`\n--- auxModel ${label} ---`);
  for (const target of [34000, 36000, 39587, 41000, 43000, 43500, 45000, 48000]) {
    const doc = target === real.length ? real : grow(target);
    const fit = fitMemoryInput(doc, ctx, 8192, model, 32768);
    console.log(`memory ${String(doc.length).padStart(6)} -> maxTokens ${String(fit.maxTokens).padStart(6)}  clipped ${String(fit.clipped).padEnd(5)} hidden ${fit.memoryHiddenChars}`);
  }
}
