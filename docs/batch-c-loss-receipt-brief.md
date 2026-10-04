# Batch C brief — the receipt names the loss (tier A)

**Status: tier A landed 2026-10-04 in `038557b`, widened by its own adversarial review.** The tiers
below were scoped after the four-section memory migration turned out to be lossy in two places; the
user's ruling was "the safest one with the lowest complexity", which is tier A. The implementation, the
recorded probe output and the mutation round are in
`.agents/evidence/2026-10-04-memory-loss-receipt/`; the change is described in the unreleased section
of `CHANGELOG.md` under project-memory. Tiers B and C are **not** implemented.

## 1. The problem, restated precisely

A consolidation pass can lose project memory in **five** reachable places, all of them before or at
the write:

1. **Input fit** — `fitMemoryInput` (`src/shared/conversation.ts`) clips the stored memory and the
   stored context head-and-tail when the two cannot fit the model's output budget, so the model
   re-emits a document built from a partial view. A truncated-reply retry reserves 4096 more tokens
   of headroom out of the same cap, so the retry clips sooner than the first attempt.
2. **Section render** — `renderMemoryDocument` (`src/project-memory/sections.ts`) cuts each entry to
   its section's per-item cap (`min(800, budget − 3)`) and drops an entry whole when it no longer
   fits the section's budget.
3. **Context read cap** — `consolidate.ts` slices the stored context to `MAX_CONTEXT_CHARS` before
   the fit ever sees it, so an over-cap stored `CONTEXT.md` loses the tail on every pass.
4. **Context render** — `renderContextDocument` (`src/project-memory/context-doc.ts`) clips its own
   sections and writes a truncation marker into the stored document.
5. **Memory write cap** — `normalizeMemoryDocument` on the write path (`record.ts:89`) caps the
   document once more. A reply that is not a four-section bullet document never reaches the section
   renderer at all, so this cap was the *only* place its loss existed — with no receipt wording and
   no log line.

The stored document cannot show any of them afterwards: it is already trimmed, so re-rendering it
reports zero losses and looks healthy. Before this batch, none of the five reached the
`/memory update` receipt. `ConsolidateReport` was the string union
`"updated" | "clipped" | "unchanged" | "deduped" | "failed" | "stale" | "stale-context"` and
`MemoryInput.clipped` a bare boolean, so a pass that dropped twelve entries and a pass that dropped
none produced receipts identical character for character.

## 2. The three tiers that were scoped

| tier | behaviour | cost | risk |
|---|---|---|---|
| **A — receipt names the loss** | counts flow from the pass into the receipt; nothing about the write changes | 4 source files + tests | none: no new failure mode |
| B — refuse the write | if `usedInput.clipped` or `droppedItems > 0`, keep the old memory, return an error receipt, write `errors.log` | larger | **self-lock**: this repo's own memory rides near the cap, so a lossy pass would be refused forever with nothing to break the cycle |
| C — refuse after one targeted retry | as B, but first re-issue the call through the existing `max-tokens` retry path with the loss named in the retry prompt | largest | needs the full retry semantics designed (what the retry prompt may say, what happens when the retry also loses content, how the refusal is worded) |

**Ruling: tier A.** It is the only tier with zero behaviour risk and the smallest change, and it is a
prerequisite for C — the counts C would put into a retry prompt are the counts A computes. B's
self-lock risk is real today (`.agents/memory/MEMORY.md` sits close to the 32000-character cap), and
C without a designed retry contract would be a second, larger guess.

## 3. What actually landed

- `MemoryInput` gained `memoryHiddenChars` / `contextHiddenChars`; `clipped` is kept as their summary
  (`clipped === (memoryHiddenChars > 0 || contextHiddenChars > 0)`), `clipTo` only ever shortens so
  both are non-negative, and a test pins `sent + hidden === stored` per artifact.
- `ConsolidationOutcome.contextHiddenChars` now folds in mechanism 3, so the field means what it
  says: characters of the stored context the model was not shown.
- `ConsolidateReport` is an object: `{status, memoryWritten, contextWritten, memoryHiddenChars,
  contextHiddenChars, contextDroppedChars, memoryWriteDroppedChars, sectionDropped, droppedItems,
  itemTruncated}`, with `ConsolidateStatus` the old string union. Counts describe **only what
  landed**: a refused memory write zeroes the memory-side counts, an unwritten context zeroes the
  context-side ones, and the write-cap count is taken from the same normalizer the write used.
- `memoryUpdateReply` words the receipt per mechanism and names only the artifacts that landed
  (`Project memory updated.` rather than claiming both when the context was skipped). A `failed`
  receipt that followed a landed write says what landed and what it lost instead of zeroing it. Every
  status with zero counts **and** both artifacts written produces the byte-identical string it
  produced before the change.
- Three per-project log gates were removed (`memorySectionClipLogged`, `contextClipLogged`,
  `contextUnusableLogged`): each made every loss after the first silent. Mechanism 5 now logs at all.
- Two counter-honesty bugs: `itemTruncated` no longer counts an entry that the same render then drops
  whole (it is not in the document), and a reply below the 40-character floor is logged instead of
  discarded silently.

## 4. Acceptance criteria and their results

Criteria were fixed **before** implementation. A6/A7 apply only to tiers B/C, which are not
implemented; A2 was tightened during the review (see §5).

| id | criterion | result |
|---|---|---|
| A1 | every loss mechanism reproducible on `lib/`, on the **pre-write** reply/input, not by re-rendering a stored document | met for all five: `out.json` records the clip, drop, context-read/render and write-cap cases through the real write path, plus the trap (`droppedItems 354` → `storedReRenderDrops 0`) |
| A2 | lossy and clean receipts differ; the lossy one names mechanism and count; a clean both-artifacts pass is byte-identical | met: seven new/exact-string assertions in `test/logic.test.mjs`, and `out.json`'s clean case is a real pass producing `Project memory and context updated.` with 0 log lines |
| A3 | no new silent path; a degradation is not reported only once per project | met: all three per-project gates removed, pinned by two-pass assertions on the drop, context-clip and unusable-context logs |
| A4 | `pnpm typecheck` 0 errors, `pnpm build`, `pnpm test` all green (counts read fresh) | met: 0 / build ok (`lib/client.js` 28376 bytes) / **302 pass, 0 fail** |
| A5 | mutation check: valid mutants compile, reach `lib/`, turn a named new test red; a hashed `/tmp` restore plus rebuild leaves 0 markers | met: five mutants across the two rounds (see §5) |
| A6 | self-lock check (tiers B/C only) | not applicable to tier A |
| A7 | retry bound and retry-failure wording (tier C only) | not applicable to tier A |

## 5. The adversarial review and what it changed

The first version closed mechanisms 1–2 and claimed the receipt could no longer read clean after a
lossy pass. An independent adversarial review (read-only, separate agent) falsified the claim on
three reachable paths and found three dishonest or under-stated counts:

| finding | what it was | disposition |
|---|---|---|
| opaque reply over the cap truncated on write, **no receipt and no log** | mechanism 5 | fixed: counted, logged, receipted |
| `CONTEXT.md` render truncation never reached the receipt | mechanism 4 | fixed: `contextDroppedChars` |
| `contextHiddenChars` under-reported by the pre-fit read cap | mechanism 3 | fixed: folded into the count |
| `contextUnusable` receipt claimed both artifacts updated; a third once-per-project gate | wording + gate | fixed: `memoryWritten`/`contextWritten` wording and the gate removed |
| a failure after a landed write reported its loss as 0 | counts contract | fixed: landed loss carried into the `failed` report |
| `itemTruncated` counted an entry the same render then dropped whole | counter honesty | fixed: counted only once kept |
| a reply below the 40-character floor vanished with no trace | silence | fixed: logged |
| `clipped` with all counts zero is reachable (the loss belonged to an artifact that did not land) | boundary | accepted and documented: the base sentence is accurate, and inventing a count for an artifact that did not land would be the misattribution this repo warns about |
| doc framing said "two mechanisms" and "the stored document cannot show them" | docs | fixed: five mechanisms, each named, with the write-path one's marker acknowledged |
| test gap: the zeroing filter and the reinstated gates were not pinned | tests | fixed: the new end-to-end tests kill those mutants |

The review also confirmed, mechanically, the claims it could not falsify: all seven statuses produce
byte-identical wording to the pre-change function when counts are zero; the report describes the
**retry** fit rather than the first fit; and `probe.mjs` reproduces `out.json` byte for byte.

## 6. Deliberately not done

- Tier B's refusal and tier C's targeted retry, per the ruling. A lossy pass still writes; that
  residual is recorded in `CHANGELOG.md` and `CONTEXT.md` rather than fixed.
- The memory-side loader cap is **not** counted: a hand-edited over-cap `MEMORY.md` is truncated by
  `loadMemory` before the pass sees it, and the stored marker plus the `/memory status` warning are
  its only traces. Counting it would mix the loader's normalization with the cap, so it is left as a
  stated residual instead of a guessed number.
- The empty-skeleton gate is untouched. A drop still does not block a write — tier A only makes drops
  visible, it does not make them fatal.
- No new configuration key and no change to the retry contract.

## 7. How to re-check

```sh
pnpm build
cd .agents/evidence/2026-10-04-memory-loss-receipt && node probe.mjs     # compare against out.json
pnpm typecheck && pnpm test                                              # read the counts fresh
```
