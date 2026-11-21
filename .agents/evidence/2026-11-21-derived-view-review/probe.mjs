import { mkdtemp, mkdir, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os"; import path from "node:path";
import { memoryStatusReply } from "/mnt/Data/Projects/dsh-project-context/lib/project-memory/index.js";
import { memoryJournalFile } from "/mnt/Data/Projects/dsh-project-context/lib/project-memory/journal.js";
import { memoryDir, memoryFile } from "/mnt/Data/Projects/dsh-project-context/lib/shared/paths.js";
const doc = (x) => `# Project Memory\n\n## Project\n- ${x}\n\n## Invariants\n- b\n\n## Pitfalls\n- c\n\n## Index\n- d\n`;
async function run(label, setup) {
  const root = await mkdtemp(path.join(tmpdir(), "dvp-")); await mkdir(memoryDir(root), { recursive: true });
  await setup(root);
  const r = await memoryStatusReply(await (await import("/mnt/Data/Projects/dsh-project-context/lib/project-memory/load.js")).loadMemory(root, 40000), { projectRoot: root, journal: memoryJournalFile(root), maxMemoryChars: 40000 });
  console.log("=== " + label + "\n" + r.text);
}
await run("empty journal file, MEMORY.md only", async (root) => { await writeFile(memoryFile(root), doc("hand")); await writeFile(memoryJournalFile(root), ""); });
await run("journal + newer external MEMORY.md edit", async (root) => {
  await writeFile(memoryJournalFile(root), JSON.stringify({ ts: new Date().toISOString(), op: "replace", text: doc("old") }) + "\n");
  const t = new Date(Date.now() - 60000); await utimes(memoryJournalFile(root), t, t);
  await writeFile(memoryFile(root), doc("external edit"));
});
