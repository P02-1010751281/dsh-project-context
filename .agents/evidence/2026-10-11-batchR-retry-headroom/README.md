# Batch R evidence — the truncation retry's headroom (2026-10-11)

Read-only, second-scale probe for the defect the ninth pi triage pass recorded as **batch R**, retry half
(pi `099ebf3`): dsh's consolidation retry after an output-cap truncation asks for a flat
`RETRY_OUTPUT_HEADROOM_TOKENS = 4096`, ignoring the hidden reasoning the first attempt actually spent —
while the reasoning reserve the cap charges that same route is itself capped at 8192. A route that spent
20489 tokens thinking (pi's field case, Quantum_Matrix 2026-10-08; quoted as pi's record, not re-measured
here) is therefore retried with the very headroom that just starved it.

Run from the repo root (anything works; the script resolves the root from its own path):

```sh
node .agents/evidence/2026-10-11-batchR-retry-headroom/probe.mjs
```

It imports the **built** `lib/` (so it judges what the host loads, not `src/`) and drives
`consolidateProject` against a throwaway root created with `mkdtemp` under `$TMPDIR`; the repo's own
`.agents/memory/MEMORY.md` is never written. Both calls are scripted: the first reply stops at the cap and
reports `reasoningTokens`, the second completes.

## Exit contract (all four codes demonstrated, not assumed)

| code | meaning | how it was demonstrated |
|---|---|---|
| 0 | DEFECT CLOSED | the shipped tree: caps `10032 -> 30032` (growth 20000) |
| 10 | DEFECT PRESENT | the fix reverted to `RETRY_OUTPUT_HEADROOM_TOKENS` (mutant M1) — output quoted below |
| 11 | CONTROL REGRESSION (a zero-spend route lost the flat constant) | mutant `Math.max(RETRY_OUTPUT_HEADROOM_TOKENS - 4095, attempt.reasoningTokens)` |
| 1 | the fixture itself did not run (no retry, or the pass failed) | a `/tmp` copy whose first reply no longer stops at the cap: `FIXTURE FAILED: calls=1 error=none` |

Only 0 is a pass. Code 11 exists because the two failure modes are different causes: the mixed result
(`carries && control !== 4096`) used to print the defect sentence and exit 1, naming the wrong cause — this
project's own central defect class. Each cause now prints its own sentence and its own code.

## Output with the fix reverted to the flat constant (mutant M1) — exit 10

Recorded by reverting the one line and rebuilding; the committed artifact cannot reproduce this by itself,
which is why the procedure is written down here.

```text
RETRY_OUTPUT_HEADROOM_TOKENS = 4096
observed hidden-reasoning spend  = 20000

a truncated reply that spent 20000 on hidden reasoning:
  requested cap 10032 -> 14128  (growth 4096)
  required growth == 20000 (the ceiling does not bind here)
  verdict: DOES NOT carry the spend

control — a reply that reports no hidden thinking (0):
  requested cap 10032 -> 14128  (growth 4096)
  flat constant preserved: true

DEFECT PRESENT: the retry does not carry the observed reasoning spend — it is not asking for the room it just used up.
```

## Expected output on the shipped tree (2026-10-11) — exit 0

```text
RETRY_OUTPUT_HEADROOM_TOKENS = 4096
observed hidden-reasoning spend  = 20000

a truncated reply that spent 20000 on hidden reasoning:
  requested cap 10032 -> 30032  (growth 20000)
  required growth == 20000 (the ceiling does not bind here)
  verdict: carries the spend

control — a reply that reports no hidden thinking (0):
  requested cap 10032 -> 14128  (growth 4096)
  flat constant preserved: true

DEFECT CLOSED: the retry carries the observed reasoning spend, and a zero-spend route is unchanged.
```

The growth is the headroom the retry passes to `fitMemoryInput`: `Math.max(4096, observed)`. The assertion
is **equality**, not a tolerance, because this fixture's ceiling (`maxOutputTokens: 131_072`) does not bind
(`cap2 = 30032`): an implementation that carries only part of the spend — e.g.
`max(4096, observed - 4096)`, growth 15904 — is now red here. A tolerance statement would have to say
"at least 79.5 % of the spend", which is a weaker claim than the fix makes.

## What each half proves

1. **The spend reaches the retry.** `model-call.ts` records `TokenUsage.reasoningTokens` off the stream into
   `CompletionOutcome.reasoningTokens` (`0` when the adapter reports none); `consolidate.ts`'s retry branch
   feeds `Math.max(RETRY_OUTPUT_HEADROOM_TOKENS, attempt.reasoningTokens)` into `fitMemoryInput`, which
   charges it into `needed` (raising the requested cap, clamped by `adaptiveOutputTokens` to the model's own
   limit and `max(configured, ceiling)`) and into `desiredReserve` (shrinking the input it sends).
2. **The plain route is unchanged.** A route that reports nothing gets exactly the flat `+4096` it always
   had — the probe's control, and the second named test in `test/logic.test.mjs`, which loops over a reported
   `0` and a reported `1024` (below the constant) so a `max` cannot be replaced by a ternary that drops the
   constant as soon as anything is reported.

## Boundary

The fixture is scripted, not a provider: it proves the arithmetic and the reachability of the retry path, not
that any real route reports its hidden thinking (dsh passes through whatever the adapter's `TokenUsage`
carries). Two costs were quantified by the independent review and are registered, not hidden:

- **Input clip on the retry.** `desiredReserve` saturates at `max(REPLY_OUTPUT_MARGIN_TOKENS,
  round(cap / 2))`, so a large headroom reserves up to half the cap away from the input the retry sends
  (worked example: cap 32768, observed 20489 → planned reserve 16384, so the retry re-emits less of the
  document). The retry's true visible room (`cap − observed`) is unchanged and the loss is reported through
  `usedInput.memoryHiddenChars`/`clipped`; it is the same trade pi makes.
- **A cap a provider rejects.** `observed ≤ cap₁`, so the retry's request can reach about `2 × cap₁` where
  the old retry asked `cap₁ + 4096`. On a route that publishes no `maxTokens` while the user's
  `maxOutputTokens` exceeds that route's real cap, a retry can now be refused (`INVALID_REQUEST`) where the
  old one was accepted. Preconditions are narrow (missing model metadata **and** a ceiling above the real
  cap) and the documented `max(configured, ceiling)` bound is unchanged.

The two halves of batch R, the notice half's probe result and the review's findings are in
`docs/batch-r-retry-headroom-brief.md`; the mutation round that keeps this pinned is in `CHANGELOG.md` under
未发布.
