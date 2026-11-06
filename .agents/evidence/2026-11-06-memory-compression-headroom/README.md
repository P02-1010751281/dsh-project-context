# Memory compression headroom (2026-11-06)

## The claim

`MEMORY.md` was compressed 39696 → 37780 chars on 2026-11-06 because two consolidation passes
(`01:36:29` and `01:47:06` UTC, both in `.agents/memory/errors.log`) refused with
`4 whole entry(ies) would have been dropped from 3 section(s) because the memory document reached
its character cap`. That message is the **budget half**: the renderer dropped whole entries, not the
model's output being cut. This probe re-measures both halves at the compressed size.

**Result: at 37780 chars both halves are clear** — the renderer keeps every entry with a
byte-identical round trip, and `fitMemoryInput` requests 29611 output tokens without clipping.

**Residual:** the pass lands only if the model's rewrite grows the document by at most the
remaining 2220 chars. Measured over the 6 mature passes in the journals (`input >= 34000`),
growth was `-156 … +3475`, median `+532`; **1 of 6 exceeded 2220**. So the compression is a
probability, not a guarantee — the exact growth of the refused reply is not recoverable, because the
journal records only landed writes and `.agents/memory/memory.jsonl` keeps no `refusedLoss` rows.

## How to re-run

```sh
node .agents/evidence/2026-11-06-memory-compression-headroom/probe.mjs --self-test   # both failure branches must trip
node .agents/evidence/2026-11-06-memory-compression-headroom/probe.mjs --model-cap 328000
```

`--model-cap` is the live model's `defaultMaxTokens`, read from the desktop profile's model catalog:

```sh
grep -n -A 4 'id: auto/deepseek-v4.1-flash' ~/.dsh/profiles/desktop/cordis.patch.yml
```

Omit it to treat the model cap as unbounded; the configured ceiling `maxOutputTokens` then binds,
which is what actually decided the outcome here (29611 < 32768). A stale cap can only fail **loud**
— a value below the requested tokens flips `clipped` to true and the probe exits 1.

Exit codes: `0` both halves clear at the current size, `1` the current documents already lose data,
`2` the probe cannot judge (document not a plain four-section bullet list, or a bad `--model-cap`),
`3` the self-test's own failure branches did not trip.

## Observed (2026-11-06, HEAD `0aee0af`)

```
inputs: MEMORY.md 37780 chars, CONTEXT.md 9820 chars

A. budget half
  Project     entries  14    5228 /   6787 (77.0% of its share)
  Invariants  entries  52   17690 /  17965 (98.5% of its share)
  Pitfalls    entries  36   11517 /  11577 (99.5% of its share)
  Index       entries  12    3278 /   3593 (91.2% of its share)
  render: sectionDropped 0, droppedItems 0, itemTruncated 0, bytes identical true
  headroom: 2220 chars (37780 / 40000); schema overhead 76

B. growth history (4 journal files, 58 full-text records, 35 landed passes)
  mature (>=34000) n=6  min -156  p50 532  p90 3475  max 3475
  headroom vs measured growth: p50 532 fits the 2220-char headroom; max 3475 EXCEEDS it

C. output half
  configured maxTokens 8192, ceiling maxOutputTokens 32768, model defaultMaxTokens 328000
  requested maxTokens 29611 (bound 32768); clipped false; hidden memory 0 / context 0
```

## Why each number is what it is

- **`clipped false` is decided by the ceiling, not the model cap.** `adaptiveOutputTokens` returns
  `min(min(needed, model.maxTokens), max(configured, ceiling))`; with `needed` 29611 and ceiling
  32768 the model's 328000 never binds. `needed` = `contentTokens` 21175 + `REPLY_OUTPUT_MARGIN_TOKENS`
  1024 + the reasoning reserve (cap at `MAX_REASONING_RESERVE_TOKENS`).
- **The reserve exists because the model is a reasoning route.** `consolidate.js` builds
  `auxModel = { maxTokens: info?.defaultMaxTokens, reasoning: info?.reasoning !== undefined }`, so a
  non-reasoning route would request 22200 instead — either way below the ceiling.
- **Per-section occupancy is diagnostic, not the gate.** Batch N makes the four shares targets, so
  `Invariants` at 98.5% and `Pitfalls` at 99.5% of their own share is not a refusal; only the whole
  document reaching `maxMemoryChars` drops an entry. That is why the headroom is `cap - length`.
- **Growth is measured per landed pass, one row per second.** Several journal appends can share one
  second; the last one is what that pass landed. Taking the first instead moves the mature maximum
  from +3475 to +2346 — both above the fold, but the tail matters, so the probe keeps the last.

## The 10:13:33 refusal, and why it does not settle the question

A third refusal was logged at `2026-11-06T02:13:33Z` (local 10:13:33), this one dropping
`3 whole entry(ies)` from `2 section(s)`, with the targeted retry dying on its own error
(`cannot get required service "llm" in inactive context`), so the first reply's loss decided the pass:

```
the targeted loss retry failed for its own reason, so the first reply's loss decides this pass
the consolidation reply would have been stored lossily (3 whole entry(ies) ... from 2 section(s)
  because the memory document reached its character cap) ...; the stored memory was kept unchanged
```

**Which document that pass read is unresolved, and this record must not claim otherwise.**
The argument for the compressed version is only that `MEMORY.md`'s mtime is `10:10:04`, earlier than
the refusal. The argument against: a pass makes up to two model calls, each emitting roughly the whole
document, so it can easily span several minutes and may have read the pre-compression document.
No disk record settles it — the request body is not logged, the cost-meter ledger aggregates per
session rather than per call, and the host writes no `[memory]` lines. A weak hint points at the
smaller input (the earlier refusals at 39696 dropped `4` entries from `3` sections; this one dropped
`3` from `2`), but reply sizes vary, so it is a hint and not evidence.

The clean discriminator: `MEMORY.md` has not changed since `10:10:04`, so **any refusal logged after
the 10:51:25 restart is unambiguously against 37780**. Until one appears, "the compression was not
enough" is unproven, and so is its opposite.

Two things this event does rule out, independently of which document it read:

- **Not a prompt gap.** `memoryBudgetRule` states the hard cap and the current size
  (`must stay at or under 40000 characters (the stored memory is currently about N)`).
- **Not the output half.** `needed` at 37780 with the current 10314-char context is 29941, under the
  32768 ceiling.

And the cap has very little room left to grow: at real token density `maxMemoryChars` 43000 gives
`needed` 32732 (fits), 43500 gives `clipped true` — about +5% of document, or the equivalent of
deleting facts instead.

## What this does not prove

- It cannot prove the next live pass lands: that needs the user's host restart, because the desktop
  host (pid 41218, started 2026-11-06 09:26:43) is older than the last `src/` commit `30e0ba1`
  (2026-11-06 09:59:03), so the two landed batches are not loaded yet.
- It does not say what the model will write. The growth distribution is empirical and small (n=6 in
  the comparable band), and it is survivor-biased: refusals leave no journal row.
- It does not cover the live config: the numbers assume the schema defaults `maxTokens` 8192 /
  `maxOutputTokens` 32768 / `maxMemoryChars` 40000. Re-read them through `cordis_inspect_query`
  (`Config`, entry `include:project-context`) if a profile ever overrides them.

## After the restart

```sh
# 1. the two batches are live: holder start later than 30e0ba1 (2026-11-06T09:59:03+08:00)
ss -ltnp | grep -E '127\.0\.0\.1:(35|19)[0-9]{3}'
ps -o lstart= -p <pid>
git -C /mnt/Data/Projects/dsh-project-context diff --exit-code -- lib

# 2. re-measure at whatever size the pass left behind, then read the refusal reason if it refused
node .agents/evidence/2026-11-06-memory-compression-headroom/probe.mjs --model-cap 328000
tail -n 20 /mnt/Data/Projects/dsh-project-context/.agents/memory/errors.log
```

A refusal that reads `N section(s) exceeded their budget` is the budget half: shrink again.
A refusal that reads `cut off by the model output limit` is the output half: lowering `maxMemoryChars`
will not help, the request itself is what got clamped.
