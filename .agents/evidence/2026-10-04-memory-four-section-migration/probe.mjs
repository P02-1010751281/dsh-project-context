// Read-only: memory four-section state, per-section render cost, and round-trip clipping.
// Archived from the 2026-10-04 migration repair. Run: node probe.mjs
import { readFileSync } from "node:fs";
const ROOT = "/mnt/Data/Projects/dsh-project-context";
const { loadMemory, readMemoryDamage } = await import(ROOT + "/lib/project-memory/load.js");
const { isMemoryTruncated } = await import(ROOT + "/lib/project-memory/document.js");
const { sectionsFromMarkdown, renderMemoryDocument } = await import(ROOT + "/lib/project-memory/sections.js");
const { memorySectionBudgets } = await import(ROOT + "/lib/project-memory/memory-schema.js");
const { fitMemoryInput } = await import(ROOT + "/lib/shared/conversation.js");
const CAP = 32000, BULLET = 3; // renderMemoryDocument's BULLET_OVERHEAD_CHARS
const loaded = await loadMemory(ROOT, CAP);
const sections = sectionsFromMarkdown(loaded.text);
const render = sections ? renderMemoryDocument(sections, CAP) : undefined;
const context = readFileSync(ROOT + "/.agents/memory/CONTEXT.md", "utf8");
const budget = {};
if (sections) for (const b of memorySectionBudgets(CAP)) {
  const arr = sections[b.heading.toLowerCase()] ?? [];
  budget[b.heading] = { entries: arr.length, cost: arr.reduce((a, e) => a + e.length + BULLET, 0), budget: b.chars, longest: Math.max(0, ...arr.map((e) => e.length)) };
}
const clip = {};
for (const cap of [undefined, 16384, 24576, 32768, 65536]) for (const reasoning of [false, true])
  clip[`cap=${cap ?? "none"}/reasoning=${reasoning}`] = fitMemoryInput(loaded.text, context, 8192, cap ? { maxTokens: cap, reasoning } : { reasoning }, 32768).clipped;
console.log(JSON.stringify({
  loaded: { source: loaded.source, chars: loaded.text.length, poisoned: loaded.poisoned, unreadable: loaded.unreadable ?? false, damaged: loaded.damaged ?? 0, isMemoryTruncated: isMemoryTruncated(loaded.text) },
  damage: await readMemoryDamage(ROOT),
  sectionKeys: sections ? Object.keys(sections) : null,
  render: render && { chars: render.text.length, sectionDropped: render.sectionDropped, droppedItems: render.droppedItems, itemTruncated: render.itemTruncated },
  perSection: budget,
  clipped: clip,
  maxListItemChars: 800,
}, null, 2));
