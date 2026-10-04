---
name: dsh-memory-doc-loss-repair
description: "Repair the tracked .agents/memory docs (MEMORY.md, CONTEXT.md) of dsh-project-context after a lossy /memory update pass: diagnose what was lost via the plugin API and store mtimes, enumerate the vanished literals against the last committed version, restore them, then re-fit through the plugins' own renderer behind a byte-identical round-trip control that refuses any lossy write."
---

# dsh-memory-doc-loss-repair

**When to use.** After a `/memory update` pass whose receipt or `.agents/memory/errors.log` shows loss, or whenever the tracked `.agents/memory/MEMORY.md` / `.agents/memory/CONTEXT.md` must be restored or rewritten. A stored document that re-renders clean proves nothing: the loss happens at or before the write. This is the loss-repair loop; `dsh-project-memory-cap-guard` covers plain cap pressure, `dsh-doc-claim-closure-review` covers false or volatile claims, and `dsh-memory-four-section-migration` covers the schema itself.

## 1. Diagnose read-only

Run the archived read-only probe (per-section entries/cost/budget/headroom plus `sectionDropped`/`droppedItems`/`itemTruncated` and `isMemoryTruncated`):

```
node .agents/evidence/2026-10-04-memory-four-section-migration/probe.mjs
ls -l --time-style=full-iso .agents/memory/memory.jsonl .agents/memory/errors.log
ss -ltnp | grep 19387      # then: ps -o lstart= -p <pid>
git log -1 --format=%cI -- src/
```

Compare the store mtimes with the socket holder's start: a pass older than the loaded host did not run under the current build. Every loss leaves its own `errors.log` line, so a receipt with zero counts and no new line means no pass (or no loss) — never infer a count from the truncation marker (its `dropped` is normalized length minus kept prefix, not original minus kept), and never verify by grepping for the marker.

## 2. Enumerate what vanished

Diff the working documents against the last committed versions, then compare the *backtick code spans* of the two revisions as sets:

```
git show HEAD:.agents/memory/MEMORY.md > /tmp/memory-head.md
diff -u /tmp/memory-head.md .agents/memory/MEMORY.md
```

Classify every span that disappeared:

- regenerable enumeration (evidence dirs, skill names, source-file lists) → may become a read-now pointer such as `ls -d .agents/evidence/*/` or `ls -d .agents/skills/*/`;
- repo-unique literal → must be restored verbatim: a host `Config` key name, a diagnostic literal, an example path owned by another repo or session, an API or field name;
- plugin-internal vocabulary that is still load-bearing (measurement bases, gate names) → restore.

Also look for entries cut mid-sentence by the per-item cap: a truncated entry must be rewritten whole, not left clipped.

## 3. Restore, then re-fit through the renderer

Never hand-edit the layout, and do not use the edit tool: that bypasses the plugin write path and the next plugin write silently drops the excess. Write a throwaway script under `/tmp` that imports the built modules by absolute path — a relative import from `/tmp` resolves against itself:

```js
const ROOT = "/mnt/Data/Projects/dsh-project-context";
const { loadMemory } = await import(ROOT + "/lib/project-memory/load.js");
const { isMemoryTruncated } = await import(ROOT + "/lib/project-memory/document.js");
const { sectionsFromMarkdown, renderMemoryDocument } = await import(ROOT + "/lib/project-memory/sections.js");
```

Sequence inside the script:

1. **Control line first**: `renderMemoryDocument(sectionsFromMarkdown(loaded.text), cap).text` must equal `loaded.text` byte-for-byte. If it does not, your model of the format is wrong — stop and print the difference instead of writing.
2. Build the corrected sections, render, and **refuse to write** when `sectionDropped > 0`, `droppedItems > 0`, `itemTruncated > 0`, or the render would be cut at the cap; report the numbers and the offending section instead.
3. Write, then read back with `loadMemory(ROOT, cap)` and require: `truncated === false`, `damaged === 0`, `poisoned === false`, zero drops, the read-back text equal to the render, and a re-render stable across a second call.
4. `CONTEXT.md` goes through the same shape with `renderContextDocument`; read its section budgets fresh from the module rather than copying them anywhere.
5. Duplicate check: no bullet line may appear twice in either document.

Take `cap` in force from the running host's own settings schema, not from a profile file or a written-down constant.

## 4. Confirm what landed

The next turn's injected Project Memory is the new document — if it shows the corrected text, the host is serving it. Re-read through the API (`loadMemory` plus `isMemoryTruncated`) rather than quoting characters.

## 5. Land it

Stage exactly the two document paths (`git add .agents/memory/MEMORY.md .agents/memory/CONTEXT.md`), commit with an English Conventional Commit (`docs(memory): …`) written to a message file and passed with `-F`, push, then confirm `git rev-parse HEAD origin/main`, a clean `git status --short`, and an unchanged `.agents/skills/` name list. A concurrently running session may be in the same files — see `dsh-project-context-concurrent-writer-guard`.

## Traps

- Do not quote a character count, cap, byte size, hash, pid or mutation number as a premise; read it fresh in the same command that uses it.
- A loss report is not proof a write happened, and a clean re-render is not proof nothing was lost.
- Restoring content and re-fitting it can eat the section headroom the next pass needs: after restoring, re-read the per-section headroom and pay for the addition with a merge or a drop in the same section.
