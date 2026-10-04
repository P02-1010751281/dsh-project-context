# Batch C tier C design — refuse a lossy memory write after one targeted retry

**Status: approved and implemented 2026-10-04** (the rulings are in §10, the two implementation deviations in
§11). Tier A landed in `038557b` (see `docs/batch-c-loss-receipt-brief.md`); tiers B and C were scoped in
§2 of that brief and deliberately not implemented. The prerequisite that unblocked C is now in place: the
per-project cap was raised 32000 → 40000, read live from the running host's own
`settings.describe` (`ns: project-context`, `maxMemoryChars: 40000`) — and the default layer followed the
same day by raising `MAX_MEMORY_CHARS`, so the headroom is no longer profile-only — which leaves
Project 2355 / Invariants 3255 / Pitfalls 2083 / Index 1343 characters of headroom at a 30953-character
document. Without that headroom, a refusing tier self-locks (§5).

## 1. Scope

Memory only. One retry, one refusal decision, no new configuration key. The context keeps its own
trace: `renderContextDocument` writes a truncation marker into the stored file and the pass logs
`contextClipNotice`, so its loss is durable and visible where memory's whole-entry drop is not.

## 2. What counts as lossy

The trigger is evaluated on the **pass's own reply**, after rendering it — never by re-rendering the
stored document, which proves nothing because the loss happened before the write.

| mechanism | source | retry | refuse |
|---|---|---|---|
| 1 input fit hid stored characters | `usedInput.clipped` | no | **decision D2** (default: no) |
| 2 section render dropped whole entries | `sectionDropped > 0 \|\| droppedItems > 0` | yes | yes |
| 2b section render cut an entry to the per-item cap | `itemTruncated > 0` | yes | no (§5) |
| 5 write cap on an opaque reply | `memoryTruncationDropped(normalizeMemoryDocument(result.memory, cap)) > 0` | yes | yes |
| 3/4 context | `contextHiddenChars` / `contextDroppedChars` | no | no (§1, non-goal) |

Mechanism 5 is lifted into the pass so it shares the one retry: the pass already holds
`result.memory`, and `renderDocument`-less replies (`render === undefined`) are exactly the ones the
write cap is the only trace of.

## 3. Retry contract

- **Bound**: at most **one** loss-triggered retry per pass, so at most **3 model calls** total:
  first (with `RECORD_MEMORY_TOOL`) → optional existing `max-tokens` retry → optional loss retry.
  Never chained: if the loss retry is itself cut off by `max-tokens`, or is still lossy, the pass
  takes that reply as final and moves to §4. A truncated loss retry is **not** retried again.
- **Tools**: none (`allowTools: false`, the JSON-text shape), like the existing `max-tokens` retry —
  a tool call cannot satisfy a prompt that asks for a shorter document anyway.
- **Input**: the same `usedInput` the previous call used. No re-fit: re-fitting would change what the
  model is shown between the two calls, and then the retry's loss could no longer be attributed to
  the reply. (decision D1, default: same input)
- **Prompt**: `CONSOLIDATION_PROMPT_RULES` + `memorySectionRule(cap)` + `memoryBudgetRule(cap, …)` +
  a new exported `memoryLossRetryRule(overage)`, where `overage` comes from a new exported
  `memorySectionOverage(sections, cap)` that **mirrors `renderMemoryDocument`'s own arithmetic**:
  per entry `min(entry.length, itemCap) + BULLET_OVERHEAD_CHARS`, with
  `itemCap = max(1, min(MAX_LIST_ITEM_CHARS, budget.chars − BULLET_OVERHEAD_CHARS))`.
  The rule names sections and numbers and never carries content:

  > Your previous reply overflowed the per-section budgets, so entries would have been dropped:
  > Invariants needed about 1400 characters beyond its budget of 15969; 1 entry exceeded the
  > 800-character per-item cap. Retry this same consolidation without the tool: return exactly one
  > complete JSON object with string memory_markdown and object context, and bring every section
  > inside its budget by merging duplicates and dropping the least durable entries.

## 4. Refusal contract

- **Condition**: the final render is still lossy, or the loss retry threw and the first reply was
  already refusable — whole entries lost, or over the write cap. A first reply whose only loss is a
  per-item truncation is excluded, because that one still lands (§2, §13).
- **Memory**: `recordMemoryDocument` is not called; no backup is taken; the stored `MEMORY.md` stays
  byte-identical (pinned by a sha256 before/after in the test).
- **Context**: unchanged — it still lands when usable. The two artifacts are separate and the split
  already exists in the `stale-context` status.
- **Version claim**: released when the memory did not land, mirroring the existing rule at
  `index.ts`'s catch block, so a forced pass after a refusal actually re-runs instead of answering
  `deduped` for a write that never landed.
- **Status**: a new `ConsolidateStatus` member **`"lossy-refused"`** (decision D3). It is emitted only
  when a lossy memory was refused, so no existing status changes wording.
- **Receipt**: for this status only,
  `Project memory was kept unchanged: the reply would have been stored lossily (2 section(s) exceeded their budget and 14 whole entry(ies) would have been dropped) and the one targeted retry did not fix it. The context was updated, with this loss: … Raise maxMemoryChars, or retry the pass later, to give the reply more room.`
  A refused pass must never read like `updated`, `unchanged` or `stale`, and a context that landed in the
  same pass is named rather than reported as clean.
- **Log**: one `logError(projectRoot, "memory", …)` line per refusal, never gated per project — the
  lesson the three removed gates taught.
- **Counts**: a refusal zeroes the memory-side loss counts, because the report's contract is that
  every count describes only what landed.

## 5. Self-lock analysis

- **The old lock is gone.** At 32000 with a 30953-character document the model had ~1000 characters of
  room, so nearly every pass was lossy; a refusing tier would have refused forever with nothing to
  break the cycle. The cap raise is the fix, and it is live.
- **`itemTruncated` must not refuse.** A legitimate entry longer than `min(800, budget − 3)` can never
  be re-emitted inside that cap by any retry — the model has no legal form for it except splitting it,
  which the format forbids. Treating it as refusal-worthy would refuse that project permanently, so it
  retries once and then accepts the truncation, which stays counted and logged.
- **Mechanism 1 must not refuse** (default). Characters the model was never shown cannot be restored
  by asking again, so the retry is a guaranteed second failure and the refusal would turn every
  clipped pass into a stale memory. It stays a reported loss.
- **An escape hatch exists either way.** A refusal is a distinct status, a receipt worded as a
  refusal and a log line every pass; the operator's lever is `maxMemoryChars`, the same lever this
  round already used. A refusal is diagnosable and actionable, never silent — which is what makes it
  better than a silent shrink, and what keeps it from being a trap.

## 6. Rejected alternatives

| alternative | why not |
|---|---|
| refuse on `usedInput.clipped` too | self-lock: no retry can restore characters the model never saw (§5, D2) |
| re-fit the input for the retry | changes what the model sees between calls, so the retry's loss is no longer attributable to the reply (D1) |
| refuse on `itemTruncated` alone | deadlock: no legal reply satisfies the per-item cap (§5) |
| put the refusal only in the write path | the model call lives in the pass, so the write path can neither retry nor name the section overage |
| reuse the `stale` status for a refusal | `stale` means the stored memory moved on since the prompt — a different cause; reusing it is the misattribution this repo treats as its central defect class |
| cover the context loss with the same retry | the context marker is durable and visible; broadening C would double the retry surface for a loss that already has a trace |

## 7. Acceptance criteria

| id | criterion |
|---|---|
| C1 | lossy first reply + compliant retry → memory lands, exactly 2 calls, receipt `updated` with zero loss counts |
| C2 | lossy first reply + still-lossy retry → stored `MEMORY.md` sha256-identical, status `lossy-refused`, receipt names the count, one `errors.log` line |
| C3 | bound: first truncated → `max-tokens` retry → still lossy → loss retry, exactly 3 calls, and a lossy loss-retry never chains a fourth |
| C4 | `memorySectionOverage` mirrors the renderer: on a fixture whose render drops 2 entries, it names the same section with a non-zero overage |
| C5 | every pre-existing status keeps byte-identical wording when counts are zero (no behaviour change on the clean path) |
| C6 | self-lock: with the real 40000 budgets and the real 30953-character document, a normal pass is not refused |
| C7 | `pnpm typecheck` 0 errors, `pnpm build`, `pnpm test` green — counts read fresh, never quoted |
| C8 | mutation check: each new guard has a valid mutant that compiles, reaches `lib/` and reddens a named test; end with a hashed `/tmp` restore and a rebuild leaving 0 markers |

A6 (self-lock check) and A7 (retry bound and retry-failure wording) from the tier-A brief are C6/C3
here. A7's wording half is C2's receipt.

**2026-10-05 — C5's literal form is narrowed by §14.** The zero-count `clipped` combination became
unreachable (the status is derived from the landed counts), and a landed read-cap loss now reports
`clipped` where it used to report `updated`. C5's intent — a clean pass that wrote both artifacts with
no loss reads exactly as before — still holds: `updated` with zero counts is byte-identical, and that
is what the §14 round re-pinned.

## 8. Non-goals

- No new configuration key; the retry bound is a constant.
- The memory-side loader cap stays uncounted (stated residual from tier A).
  **Superseded 2026-10-05** — closed, see §14.
- `clipped` with all counts zero stays reachable and documented.
  **Superseded 2026-10-05** — closed, see §14.
- The empty-skeleton gate is untouched.

## 9. Files in scope

`src/project-memory/consolidate.ts` (trigger, prompt builder, the one retry, the outcome flag),
`src/project-memory/sections.ts` (exported `memorySectionOverage`, beside `renderMemoryDocument`),
`src/project-memory/index.ts` (status member, refusal branch, receipt wording, claim release),
`test/logic.test.mjs` (plus a new case file if the existing one gets unwieldy), and the documentation
sync in `CHANGELOG.md` + §6 of `docs/batch-c-loss-receipt-brief.md`.

## 10. Decisions (settled 2026-10-04)

- **D1** retry input: the same `usedInput` — no re-fit. Settled as designed.
- **D2** mechanism 1 (`usedInput.clipped`): **report only, never refuse.** The user's ruling: a retry cannot
  restore characters the model was never shown, so refusing would turn every clipped pass into a stale
  memory. It stays counted and logged by tier A.
- **D3** status name: `lossy-refused`.

## 11. What implementation changed about this design

Two deviations, both found while writing the tests, both kept deliberately:

1. **A retry that parses but carries no memory must not replace the first reply.** The loss retry sends no
   tool, so a model (or a fixture) that answers with a tool call again produces an empty text stream —
   which `parseConsolidation` reads as an opaque reply with no content. Adopting it replaced a real but
   oversized memory with "no new memory", and the semantic-empty gate then skipped the write while the
   receipt reported a plain update — exactly the misattribution this repo treats as its central defect.
   The retry now replaces the first reply only when it is not semantically empty; otherwise the first
   reply's own loss decides the refusal.
2. **Mechanism 5 is now unreachable on a landed write, by construction.** A section render's output is
   `<= cap` by construction and an over-cap opaque reply is refused, so `memoryWriteDroppedChars` can no
   longer be non-zero for a write that lands. The branch, its count and its log line are kept as the
   invariant's own alarm (if the render and the cap ever diverge again, they still fire); the number a
   refusal reports lives in `refusedLoss.writeCapDroppedChars`. The test that used to assert a capped
   document landing was rewritten to assert the refusal and the untouched artifact.

The retry prompt's numbers come from the new `memorySectionOverage`, which mirrors
`renderMemoryDocument`'s arithmetic rather than estimating it: the mirror is pinned by a test on the same
three fixtures the renderer's own test uses.

## 12. Open decisions (superseded by §10)

## 13. The adversarial review and its dispositions

An independent read-only reviewer (two of them, independently, on the frozen diff) produced 10 findings:
1 blocking, 3 should-fix, 6 notes. Every one was reproduced with a probe before being acted on; the
full report is `/tmp/dsh-tier-c-review.md` (throwaway, not a repo artifact).

| finding | what it was | disposition |
|---|---|---|
| blocking: the refusal was decided by a **marker line**, not by a real cut | `normalizeMemoryDocument` re-appends a marker the *input* already carried even when the body fits, and the count was parsed back out of it — so a fitting reply carrying an old marker was refused for a cut that never happened, with a number that could exceed the cap (unescapable by raising `maxMemoryChars`) | fixed: `normalizeMemoryWithDrop` returns `{text, dropped}` from the cut itself; both callers (the pass's trigger, the write path's count) use it, and `memoryTruncationDropped` — the parser whose contract invited the defect — is deleted now that it has no caller |
| the refusal receipt ignored `detail` | a context loss that landed in the same pass was reported as clean | fixed: the refusal names it, like `stale-context` |
| the claim release does not make the next forced pass re-run | inside `forceDedupeMs` the pass is cached, so an immediate re-run only re-reports; the receipt promised a fresh consolidation | fixed in wording (`Raise maxMemoryChars, or retry the pass later`); the release itself is kept and now pinned by a test that separates `deduped` from `lossy-refused` |
| a **worse** retry replaced a first reply that would have landed | asking for a smaller document cost the memory entirely | fixed: a retry that would be refused does not replace a storable first reply |
| a body-less over-cap reply was reported as a refusal | the semantic gate was the real blocker, not the cap | fixed: the gate owns that reply; no retry, no refusal |
| a refusal's counts vanished on a later throw | `failed` hid a decision the pass had already made | fixed: the refusal is carried across the landed-loss reset and named in the `failed` receipt |
| `DEFAULT_CONFIG.maxMemoryChars` was still 32000 | a profile that relies on the bundle insert (e.g. `ctxdev`) kept the old headroom | **closed 2026-10-04**, by the user's own naming: `MAX_MEMORY_CHARS` — the single constant that `DEFAULT_CONFIG.maxMemoryChars` and every fallback default read — went 32000 → 40000, so the default and the two profiles agree |
| test gaps: `retryWorthy`'s `itemTruncated` clause and the refusal's `written.delete` were unpinned; three new assertions were vacuous | the guards could be reverted without reddening anything | fixed: both are now pinned by named tests and the vacuous assertions are gone (all of it is in the mutation round) |

The reviewers could not falsify: `memoryWriteDroppedChars > 0` on a landed write (168 shape×cap
combinations plus 400 fuzz passes), byte-identical refusal with no backup or journal append (61
refusals), the three-call bound with no repeat of the loss retry, the empty-retry guard across every
reply shape, the landed-counts contract and `refusedLoss`'s exclusivity, `memorySectionOverage`
mirroring the renderer (40,438 rows, 0 mismatches), the retry prompt carrying no reply content, and
byte-identical wording for every pre-existing status.

A second, read-only **closure review** of the committed range (`e9559bb..9fe8917`) re-probed every
finding and confirmed F1–F6 and all the load-bearing claims closed, with no new defect
(48-case receipt differential, 10045-case normalizer differential, `lib/` matching a fresh `tsc`). Its
remaining notes are kept here with their dispositions — all three closed, the last two on 2026-10-04:

- a refusal cached inside `forceDedupeMs` still answers with the refusal if the cap is raised within
  that window — the receipt no longer promised a fresh consolidation, and the window is 15 s.
  **closed 2026-10-04**: the cached outcome is keyed on the cap it was decided under, so a forced pass
  under a new cap re-runs instead of answering the refusal receipt's own lever with the old verdict. The
  throttled path is deliberately not keyed — it must never spend a surprise model call, and re-reporting
  the last real decision beats claiming "already up to date" for a memory that was never written.
- a throw from the **loss retry itself** is reported as `failed`, not as a refusal. §4's second clause
  was written before implementation: nothing is written either way and the memory is kept, so `failed`
  is the honest label for a retry that failed for its own reason. **closed 2026-10-04**: §4's clause
  was right in its consequence, with one precision the implementation settled — §4's "already lossy"
  means "already refusable", because a first reply whose only loss is a per-item truncation still lands.
  The retry is an improvement attempt, so its own failure now leaves the first reply's loss in charge —
  whole entries lost stays `lossy-refused` with its `refusedLoss`, a per-item truncation lands as before
  — and the retry's failure leaves its own `errors.log` line, so a refusal that follows does not read as
  "the retry answered and was still too large". The one exception is a caller-cancelled pass: the
  caller's **own** `options.signal` being aborted still fails the pass, because carrying on would let it
  write artifacts after that cancel. A stream that merely *reports* `aborted` is not that exception —
  `model-call.ts` throws the same shape without consulting the signal, so it stays a retry failure and
  the first reply's loss decides.
- `DEFAULT_CONFIG.maxMemoryChars` no longer trails the profiles: **closed 2026-10-04** by raising
  `MAX_MEMORY_CHARS` 32000 → 40000, the one constant the default and every fallback default read, so a
  profile relying on the bundle insert (e.g. `ctxdev`) gets the same headroom the desktop and web
  profiles carry.

- **D1** retry input: the same `usedInput` (default) vs a re-fit.
- **D2** mechanism 1 (`usedInput.clipped`): report only (default) vs also refuse.
- **D3** status name: `lossy-refused` (default) vs another spelling.

## 14. Addendum 2026-10-05 — the two tier-A residuals closed

Both non-goals §8 listed as "stated residual from tier A" are now fixed, at the user's naming. The
work is a separate batch: `CHANGELOG.md`'s `未发布` carries the full entry (reproduction, tests,
mutation round, gate), and this section records only what it changes about *this* design.

- **R1 — `clipped` with all landed counts zero.** The status was derived from the pass-level
  `outcome.clipped` (whether the last input sent had been clipped), while every count in the receipt
  describes only what landed. When the shortened artifact was the one that did not land, the receipt
  said "clipped" with no count and blamed the artifact that did land. It is now derived from the landed
  counts (`loss.memoryHiddenChars > 0 || loss.contextHiddenChars > 0`), so status and numbers agree by
  construction. The pass-level fact is not lost: `outcome.clipped` still drives the `errors.log` line
  and the informational note on every pass that landed something, with mechanism-neutral wording
  ("a shortened version of the existing memory or context (the read cap or the output budget)").
- **R2 — the memory-side loader cap.** `loadMemory` applies `maxMemoryChars` before the pass sees the
  text; its cut was counted nowhere, so a pass re-rendering a nearly empty view of an over-cap stored
  document read as a clean `updated`. `LoadedMemory` now carries `cappedDroppedChars`, taken from the
  normalizer that did the cutting (`foldMemoryJournalWithDrop` / `decodePoisonedMemoryWithDrop` /
  `memoryComparisonKeyWithDrop`), never from a difference against the raw bytes: `normalizeMemoryDocument`
  is **not** idempotent on a capped document, and a stored reply's JSON wrapper is not memory. The pass
  folds it into `outcome.memoryHiddenChars` (the read cap and the input fit are added, never
  substituted), and `/memory status`'s cap warning now fires on the count as well as on the marker, so
  the no-journal read — which clips without writing a marker — is no longer silent.
- **What §14 does not change.** The landed-count contract, `refusedLoss`'s exclusivity, the refusal
  path, the retry bound, and tier C's criteria C1–C4 and C6–C8. `loadMemorySync` (prompt injection) is
  out of scope on purpose: it returns a string and has no receipt. The review that produced these two
  items also proposed carrying the *pass-level* hidden counts as their own report field (the
  `refusedLoss` shape) instead of changing the status; that was declined because the repo's own rule is
  "silent degradation is tolerable, a wrong cause is not" — the log line carries the non-landing case,
  and the landed-count contract stays single.

