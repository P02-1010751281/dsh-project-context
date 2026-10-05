# Memory share fix — offline verification against the stored documents

Date: 2026-10-05. Revision read: the working tree at `8174aed` (`git rev-parse HEAD`), whose `lib/`
was verified stale-free with `git diff --exit-code -- lib` (empty).

## Why this exists

`/memory update` refused twice on 2026-10-05 for two unrelated reasons, and the handoff that opened
this batch carried one of them as an open question: *"份额修复重启后是否真正解掉 `/memory update`
自锁，尚未实测"*. The share rebalance (`f38a0ba`) is committed and built but the 19387 host was still
pid 300511 (started 17:17:29), earlier than the commit, so the running code is the old table and no
live run can settle it yet. This probe answers the budget half ahead of the restart, on the real
documents, using the built `lib/` — and bounds the output half without claiming to have tested it.

Running `share-fit.mjs` writes nothing and greps for no marker; it reads `MEMORY.md` / `CONTEXT.md`,
calls `sectionsFromMarkdown` → `renderMemoryDocument` → `fitMemoryInput` from `lib/`, and exits
non-zero when the render would drop a whole entry.

## Command

```
node .agents/evidence/2026-10-05-memory-share-fix-offline-verify/share-fit.mjs
```

## Observed output

Captured at `MEMORY.md` 34078 chars and `CONTEXT.md` 7642 chars — the context is an **input** to the
fit, so the output-side figures below move with it and every re-run will print its own.

```
cap 40000  schema overhead 76  document 34078 chars
rates: memory 0.4014 tok/char, context 0.4023 tok/char

section occupancy (a kept entry costs its text + 3 chars of bullet overhead):
  Project     entries  15    5908 / hard  6787 (87.0%)  prompt  6108  inside prompt target
  Invariants  entries  42   15309 / hard 17965 (85.2%)  prompt 16168  inside prompt target
  Pitfalls    entries  25    9717 / hard 11577 (83.9%)  prompt 10419  inside prompt target
  Index       entries  10    3077 / hard  3593 (85.6%)  prompt  3233  inside prompt target

render: sectionDropped 0, droppedItems 0, itemTruncated 0, text 34078 chars
round-trip byte-identical: true

output fit (maxTokens the pass would request, configured 8192, ceiling 32768):
  non-reasoning, adapter cap unknown maxTokens  17778  clipped false  hidden memory 0 / context 0
  reasoning, adapter cap unknown     maxTokens  23642  clipped false  hidden memory 0 / context 0
  reasoning, adapter cap 16384       maxTokens  16384  clipped true  hidden memory 15062 / context 3028
  reasoning, adapter cap 27816       maxTokens  23642  clipped false  hidden memory 0 / context 0

VERDICT: no whole-entry loss -- the budget half of the self-lock is clear
```

## What it establishes

- **The budget half of the self-lock is clear for the document that is actually stored.**
  `sectionDropped 0`, `droppedItems 0`, and a byte-identical `sectionsFromMarkdown` round trip, so
  tier C's "would lose whole entries → refuse" trigger has nothing to fire on. The two refused passes
  logged `2 section(s) exceeded their budget and 3 whole entry(ies) would have been dropped`; with the
  rebalanced table no section is even over its **prompt** target (84–87% of the hard budget, against a
  90% target), which is the headroom the old `0.2 / 0.4 / 0.25 / 0.15` split had spent.
- **`itemTruncated 0` is new, and it is explained by the same table.** The 10:04:16 landing logged
  `1 entry(ies) exceeded their section's per-item cap and were truncated` — that pass ran on the old
  shares, because the host still holds pid 300511. The per-item cap is `min(800, budget − 3)`, so
  Invariants' larger share lifts it as well.
- **The output half is bounded, not tested.** At the sizes above `fitMemoryInput` clips nothing and
  would request 23642 output tokens on a reasoning route (17778 without the reserve). The 09:20:54
  truncation logged `27816 tokens requested`, i.e. a **larger** document than the one stored now —
  size is the lever, and the stored document has come down since. A route whose adapter cap is 16384
  is the one caution: the cap then binds and the input *is* clipped (15062 + 3028 chars hidden), so a
  small-cap route pays in input truncation rather than in the section budgets. Only an actual
  post-restart `/memory update` settles which route the aux pass uses and whether its reply comes
  back whole.

These are point-in-time numbers and every one of them moves with the documents; re-run the script
rather than quoting this file. The historical counts above are kept because they are what the
`errors.log` lines say, not as current state.

## Related

- `.agents/memory/errors.log` — the four 2026-10-05 lines this reads against.
- `.agents/memory/MEMORY.md`, `.agents/memory/CONTEXT.md` — the inputs.
- `src/project-memory/memory-schema.ts` — the share table, the prompt share and the overhead;
  `src/project-memory/sections.ts` — `BULLET_OVERHEAD_CHARS = 3` and the whole-entry drop rule;
  `src/shared/conversation.ts` — `fitMemoryInput`; `src/shared/output-budget.ts` — the reserve.
