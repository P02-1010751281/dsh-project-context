# The `/handoff` receipt's ratio advice, swept in both directions (2026-10-06)

`src/project-handoff/threshold.ts`'s `fixedRatioAdvice` decides the only ratio a receipt may name after
batch K's physical-floor gate. This directory is the probe for it, recorded because the CHANGELOG claimed a
sweep result with no artifact behind it (a closure review caught that, along with the defect the artifact
would have caught).

## What the receipt must do

The advice is a **control**, not prose, so it has to be right in both directions: any ratio it names must
actually clear this window's floor, the smallest one that does must be the one named, and it must withhold
exactly when no legal two-decimal ratio clears. `/handoff threshold` accepts two decimals, which is why the
grid is the legal two-decimal range.

## The two defects this probe found

| direction | symptom | cause |
| --- | --- | --- |
| over-reach | the advice named `0.29` where `0.28` already cleared | `Math.ceil` on a float overshoots an exact boundary: `14 000 / 50 000 × 100` is `28.000000000000004` |
| over-withhold | the receipt said "no legal ratio clears the floor at this window" while `/handoff threshold 0.95` worked | the same `Math.ceil` pushes the candidate past `MAX_THRESHOLD_RATIO` when `0.95 × W` rounds *up* over a floor just past it; an early `needed > MAX → undefined` then gave up instead of testing `MAX` |

The over-withhold is narrow but real: 780 of 2 235 cells of a dense window sweep, and the closure review
reported 110 004 of 110 000 modellable windows, with `W > 80 010` and `frac(0.95 × W) > 0.5` as the shape.
Reproducible end-to-end case: `W = 262 144`, reported envelope `42 845`, carried tail `198 192` → floor
`249 037`; `0.95 × W = 249 036.8` rounds to exactly the floor, so `MAX` clears. The 96Ki case
(`W = 98 304`, tail `85 389`) is the same shape at a window a real session reaches.

Both are fixed: the candidate is pulled back to `MAX` rather than rejected, and the step-back loop plus the
final `clears` decide. The early `contextWindow − SAFETY_MARGIN < floor` exit is an explicit statement of
the impossible case, **not** load-bearing — 9 328 767 cells of a model difference nothing with it deleted.

## Running it

```sh
node .agents/evidence/2026-10-06-threshold-advice-sweep/advice-sweep.mjs    # exit 0 = both directions hold
```

It drives the built `lib/` (run `pnpm build` first when `src/` moved), reads nothing else, and writes
nothing. Output on the fixed tree:

```
windows 228 × tails 10 × envelopes 6 = 13680 cells
the advice named a ratio in 4996, withheld in 8684
VERDICT: both directions hold — every named ratio is the smallest that clears, and every withholding is true
```

## The honest boundary

The ground truth is `resolveThreshold` over the legal **two-decimal** grid, so "the smallest" means the
smallest two-decimal ratio — a higher-precision ratio can be smaller and still legal (at the 450K band,
`0.685` clears where the receipt names `0.69`). That is a deliberate choice, not an oversight: two decimals
is what a user can retype from the receipt, and the direction that would mislead (naming something refused)
is covered exactly. The sweep also only covers `fixed-below-floor` and the `quality-knee` /
`thresholdOverrideText` sites are asserted in `test/threshold-floor.test.mjs`; the envelope term is driven
through `overheadTokens`, which is how the harness reports it.
