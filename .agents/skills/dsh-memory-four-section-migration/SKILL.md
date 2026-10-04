---
name: dsh-memory-four-section-migration
description: "Migrate or rebuild the tracked .agents/memory/MEMORY.md into the fixed four-section schema (Project/Invariants/Pitfalls/Index) without silent loss: prove the four-section build is live before migrating, rebuild from the last known-good committed document, and verify through the plugin API (sectionsFromMarkdown / renderMemoryDocument / loadMemory / fitMemoryInput) instead of grepping for a marker."
---

# Migrate or rebuild MEMORY.md into the fixed four-section schema

**When to use:** `.agents/memory/MEMORY.md` is still free-form (headings other than the four), a consolidation pass reported clipping or dropped entries, or you are about to rewrite the whole document. For cap compression of an already four-section document use `dsh-project-memory-cap-guard` instead.

## Ordering — do not reverse

1. The four-section code must be live *before* the migration: an older running build rewrites a four-section document back to free-form at its next automatic consolidation. Prove live: the `ss -ltnp | grep 19387` socket holder's start (`ps -o lstart= -p <pid>`) is later than the last `src/`-touching commit, and `lib/` diffs clean against a fresh `tsc` compile into a temp dir (only `lib/client.js` may differ). Never record a pid or a start time.
2. The restart is user-only: `/etc/nixos/scripts/dsh-desktop-restart.sh` exits 3 when invoked from a dsh session (only `--dry-run` / `--verify-only` are safe in-session). `/memory update` is likewise a user command with no agent RPC, so the agent cannot produce the four sections on the user's behalf; if the user has not run it, rebuild instead.

## Loss happens before the write

A stored document that re-renders clean proves nothing about what was lost — check the counters against the intended full content. Two sites, each with its per-pass log line in `.agents/memory/errors.log` and, since tier A, its count in the `/memory update` receipt (`memoryHiddenChars` for the fit, `sectionDropped`/`droppedItems` for the render):

- `fitMemoryInput` (`src/shared/conversation.ts`) clips the stored memory head-and-tail to fit the model output cap, so the model never sees the middle of the old document — log line `consolidation shortened the existing memory or context to fit the model output budget`.
- `renderMemoryDocument` drops whole entries that overflow a section's budget — log line `MEMORY.md was rendered within its per-section budgets: N section(s) exceeded their budget and M whole entry(ies) were dropped`.

The model's raw reply is not journalled, so the reply itself cannot be re-read, but the pre-write documents can: `.agents/memory/memory.jsonl` is the append-only journal of whole documents (`journal.ts`) and `backup.ts` keeps the last few byte copies (`MEMORY.md.memory-backup-*`). The last known-good committed copy is the other source for a rebuild: `git show <pre-migration-commit>:.agents/memory/MEMORY.md` (e.g. `git show HEAD:.agents/memory/MEMORY.md` when the migration is the tip).

## Rebuild

1. Read the source's shape fresh — `wc -m` (characters; `wc -c` overstates CJK by about a third) plus its section headings — never carry counts from a note into the new document.
2. Emit exactly four sections, `## Project` / `## Invariants` / `## Pitfalls` / `## Index`, each a `- ` bullet list. Section names and shares come from `src/project-memory/memory-schema.ts` (`MEMORY_SECTIONS`, `memorySectionBudgets(cap)`); do not copy those numbers elsewhere.
3. Write in English: at the 32000-character cap CJK costs roughly 1 token/char versus ~0.4 for English, so a full CJK document is inevitably clipped.
4. Keep every entry short (well under the per-entry cap) and each section comfortably inside its share: an over-cap entry is clipped (`itemTruncated`), and only a section overflowing its share drops whole entries (`sectionDropped`/`droppedItems`).
5. Edit by whole-line replacement with an in-line anchor, then read the line back and confirm no sentence appears twice.

## Verify through the plugin API, not grep

Run a throwaway probe under `/tmp` that imports the host modules by absolute path (relative imports resolve against the probe) and report:

- `sectionsFromMarkdown(text)` → exactly the four sections;
- `renderMemoryDocument(sections, 32000)` → `sectionDropped === 0`, `droppedItems === 0`, `itemTruncated === 0`, and per-section `cost` ≤ `budget` with `longest` below the item cap;
- `loadMemory(root, 32000)` → `isMemoryTruncated(loaded.text) === false`, `damaged === 0`, `poisoned === false`;
- `fitMemoryInput` reports clipped `false` across a cap grid (24576 tokens and up).

Never grep for the truncation marker: it can be present while the status object still reports a healthy document. Archive the probe, its `out.json` and a `README.md` under `.agents/evidence/<date>-memory-four-section-migration/`.

## Land

Stage only the memory files and the evidence (`git add <paths>`, never `add -A`), commit, push. A concurrent session may have written an untracked `.agents/skills/<name>/`; cross-check directory names with `ls -d .agents/skills/*/` against `git ls-files '.agents/skills/**/SKILL.md'` before committing.
