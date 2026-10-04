# The four-section memory migration lost content, and the repair

2026-10-04. Read-only w.r.t. everything outside this repo except the two memory documents and this
directory. `probe.mjs` re-runs the whole verification; `out.json` is its recorded output.

## What happened

Batch B made the fixed four-section schema the only write path for `.agents/memory/MEMORY.md`, so the
project's own memory had to be migrated from the free-form 13-section document by running `/memory
update` (a user command; the agent has no RPC for it). The migration was lossy in **two** ways, each of
which the plugin logged:

| when (local) | what the plugin logged | what it means |
|---|---|---|
| 14:14:31 | `consolidation shortened the existing memory or context to fit the model output budget` | `fitMemoryInput` had clipped the stored memory head-and-tail before the model saw it, so the model could only re-emit the head and the tail |
| 14:40:52 | `MEMORY.md was rendered within its per-section budgets: 1 section(s) exceeded their budget and 12 whole entry(ies) were dropped` | `renderMemoryDocument` dropped whole entries that overflowed a section's share; those entries never reached the file |

Both lines are in `.agents/memory/errors.log`. Neither is silent *in the log* — but the stored file
afterwards looks healthy, which is the trap: the drop happens **before** the write, so re-rendering the
stored document reports zero losses and proves nothing about what was lost. (The render counters are
also zero for a document that was already trimmed by an earlier render.)

## State transitions (characters, measured)

| state | chars | sections | note |
|---|---|---|---|
| `git show HEAD:.agents/memory/MEMORY.md` at `fe4a212` | 31419 | 13 | last known-good; also kept as `MEMORY.md.memory-backup-2026-10-04T06-14-31-397Z-*` |
| after the 14:14 pass | 30386 | 4 | bullet-less prose lines, so `sectionsFromMarkdown` returns `undefined` and the file stays opaque |
| after the 14:40 pass (as found) | 26118 | 4 | bulleted; 12 entries from that pass's reply had already been dropped |
| after the repair | see `out.json` | 4 | rebuilt from the 31419-character document |

Whole sections did not survive the two passes: Release/versioning, Failure-cause attribution
(R1/R2/R3), the Local GUI `本会话 ¥…` note, and Probe traps.

## The repair

MEMORY.md was rebuilt from the committed 13-section document (the only surviving complete copy) into
the four sections the schema defines, written in English. English is not cosmetic: a CJK document at
the 32000-character cap cannot round-trip, because the plugin's own rate heuristic charges 1 token per
CJK character against 0.4 per ASCII character, so `fitMemoryInput` clips it — `clipped=false` at
cap ≥ 24576 tokens is only reachable for an ASCII-dominant document at this size.

Content was compressed, never guessed: closed-audit blow-by-blow, historical hash chains, retracted
analyses and read-now counts were dropped (the consolidation cut list), while conventions, invariants,
accepted-residual lists and open-task pointers were kept, and the rules that the migration had lost
(the misattribution defect class with its known-accepted residual list, the still-duplicated
mtime-wins comparison, the two dsh-line upgrade criteria, the retired `dsh-client-auto-continue`
patch) were restored.

## How to verify (and the exact criteria)

```
node probe.mjs          # prints out.json's shape
```

Pass criteria, all read from the API rather than from prose:

- `sectionsFromMarkdown(loaded.text)` returns exactly `project`, `invariants`, `pitfalls`, `index`;
- `renderMemoryDocument(sections, 32000)` reports `sectionDropped === 0`, `droppedItems === 0` **and**
  `itemTruncated === 0`;
- every section's render cost (`Σ entry length + 3` per bullet) is at or below that section's
  `memorySectionBudgets(32000)` share, and every entry is under `MAX_LIST_ITEM_CHARS` (800);
- `isMemoryTruncated(loaded.text) === false`, `damaged: 0`, `poisoned: false`;
- `fitMemoryInput(memory, context, 8192, model, 32768).clipped === false` for every output cap at or
  above 24576 tokens.

`itemTruncated` and the two structural caps are easy to miss: a document can be inside every section
share and still lose text, because each entry is clipped to 800 characters and each bullet costs 3
more characters than its entry length. The first repaired draft tripped both (2 entries over 800
characters, Index over by 5 characters including bullet overhead).

## Honest boundaries

- The model's real output cap was **not** read from the model: 24576 tokens is the smallest cap
  consistent with the observations (the 14:40 pass did not clip at ~15.9k content tokens, so the cap
  is at least ~22.5k). The probe therefore reports `clipped` across a cap grid instead of asserting
  one value.
- The 12 entries the 14:40 render dropped are **not recoverable**: the reply they came from was never
  logged, and the journal recorded only the post-render text. The repair works from the committed
  document, not from that reply.
- The repaired document is a compression of the old one, not a byte-for-byte migration: the four
  section shares sum to slightly less than the old document's free-form capacity once its content is
  redistributed, so ~2.7k characters of narrative were deliberately cut. `out.json` records what the
  result is; the cut list is the consolidation policy in memory.
- The backup files this README names live in `.agents/memory/` and are gitignored; they can be pruned,
  which is why the repair anchors on the committed revision instead.
