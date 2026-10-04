# The pre-write memory losses, reproduced and receipted

2026-10-04. Read-only w.r.t. everything outside this repo except throwaway tmp projects the probe
writes into. `probe.mjs` re-runs the whole check; `out.json` is its recorded output
(`node probe.mjs > out.json`). Imports resolve against `lib/` by absolute path, so run it after
`pnpm build`.

## What this archives

Batch C tier A — "the receipt names the loss" — plus the loss sites an independent adversarial review
found on top of the two the batch started from. A consolidation pass can lose project memory in five
reachable places; **all five now reach the `/memory update` receipt and `errors.log`**, and the
probe reproduces each through the real write path:

| # | mechanism | function | probe key | how the receipt names it |
|---|---|---|---|---|
| 1 | input fit | `fitMemoryInput` (`src/shared/conversation.ts`) | `clipCase` | `the model was not shown N character(s) of the stored memory` |
| 2 | section render | `renderMemoryDocument` (`src/project-memory/sections.ts`) | `dropCase` | `N section(s) exceeded their budget and N whole entry(ies) were dropped` |
| 3 | context read cap | `consolidate.ts`'s `slice(0, MAX_CONTEXT_CHARS)` before the fit | `contextClipCase` | counted into the same "not shown" clause |
| 4 | context render | `renderContextDocument` (`src/project-memory/context-doc.ts`) | `contextClipCase` | `N character(s) of the context were dropped to fit its section budgets` |
| 5 | memory write cap | `normalizeMemoryDocument` on the write path (`record.ts:89`) | `writeCapCase` | `N character(s) of the reply exceeded the memory cap and were dropped on write` |

Before this batch, `ConsolidateReport` was a string union and `MemoryInput.clipped` a bare boolean, so
a pass that dropped twelve entries produced a receipt identical, character for character, to a clean
one, and nothing named which artifact was hidden or by how much. Mechanism 5 was worse than
unreceipted: an opaque (non-four-section) reply that exceeded the memory cap was truncated on write
with **no receipt wording and no log line at all**.

## The trap this probe measures

Mechanisms 1–5 all act **before** or **at** the write, and the document that lands is already
trimmed, so re-rendering it reports zero losses and looks perfectly healthy. `out.json` demonstrates
this directly: after the drop case reports `droppedItems: 354`, the stored document re-renders with
`storedReRenderDrops: 0`. A post-write mechanical check is not evidence that nothing was lost; the
counts have to come from the pass.

## What the recorded run shows

- **clip** — a 60 018-character memory + 60 011-character context under a 32 768-token ceiling:
  `clipped true`, `memoryHiddenChars 20336`, `contextHiddenChars 20334`, and both identities hold
  (`sent + hidden == stored`). The retry fit (4096 more headroom) hides `50910`, more than the first
  fit's `40670` — the retry clipping sooner.
- **render** — a 400-entry reply section rendered against a 4000-character cap: `sectionDropped 1`,
  `droppedItems 354`; a single 803-character entry against the same cap: `itemTruncated 1`.
- **through the real write path** (`pass` in `out.json`) — the clip case reports `status "clipped"`
  with `memoryHiddenChars 7272`; the drop case reports `sectionDropped 1 / droppedItems 354` and, on
  a second lossy pass, a second `errors.log` line; the context case reports `contextHiddenChars 28000`
  (the 60 000-character stored context less the 32 000-character read cap) **and**
  `contextDroppedChars 14000`; the write-cap case reports `memoryWriteDroppedChars 10401` with a stored
  document that carries the `_[memory truncated` marker.
- **clean** — a real pass that wrote both artifacts and lost nothing: receipt
  `Project memory and context updated.`, byte-for-byte the wording this repo produced before the
  change, with **0** `errors.log` lines. "The sentence did not change" still means "nothing was lost".
- **only what landed** — every count is filtered to the artifact that reached disk. A pass whose
  context is never written reports `contextHiddenChars: 0` and reads `Project memory updated.`
  instead of claiming both were updated.

## Limits, deliberately

Tier A changes no behaviour: a lossy pass still writes. Tiers B (refuse the write) and C (refuse after
one targeted retry) were scoped and are not implemented; the ruling and the acceptance criteria are in
`docs/batch-c-loss-receipt-brief.md`. Two loss sites remain outside the receipt because they are not
countable from the pass: a hand-edited over-cap `MEMORY.md` is truncated by the loader before the pass
sees it (`/memory status` warns about that one and the stored marker records it), and a reply discarded
by the 40-character floor is now logged but not counted. If a future mechanism loses content without
incrementing one of the report's counts, this receipt cannot see it.
