# Batch M — the injected pressure line: pre-restart evidence

Subject: `6e8c3f9` `feat(handoff): make a crossed threshold visible through the injected context`,
plus its two follow-ups: `dcf9cc0` (freeze the crossing's language with its numbers) and `3c97937`
(a tick that settles after disposal must not re-insert the line).
This file is the record a successor reads to answer "what was proven before the restart, and what is
still open".

## Why the batch exists

The automatic trigger runs only on `turn/end`, so a session that never ends a turn is never
evaluated. `↪ handoff · a00eb4ce` (`54cdf479`) sat at **316,189 / 1,000,000** against a **157,000**
threshold (**2.01×**) with **one open turn**; the user only found out by computing it by hand. The
batch adds the visible half — a line injected into the model's context, which the model relays — and
does **not** change when a handoff fires (that is the still-undecided candidate (b)).

## The cost bound this design is built around (measured, not estimated)

A registered `systemPrompt.context` is materialized as a durable user-role runtime-context snapshot,
and the harness **appends** one whenever its text changes. Evidence from this repo's own archive:

```
.agents/memory/session-logs/session-3a19d454-.../session.jsonl
  "Current runtime context" occurs 5 times, all user/message, all surfaceOp:"append"
  len 37274 / 37274 / 37761 / 37513 / 37875     (two are equal-length yet differ by sha)
  all 74 surface events in that session are append; zero ranged replaces
```

`@deepseek-ai/dsh-token-meter/src/surface-fold.ts` matches: `planSurfaceTokens` returns
`deltaTokens = tokens` for `surfaceOp: "append"`, and only a `startSeq`/`endSeq` op reaches
`commitSurfaceTokens`' splice. So one text change ≈ one ~37 KB append that is never reclaimed.
Hence the display layer freezes the crossing and re-renders only on a crossing, a reason change, or a
fall back below the threshold; the `step/start` tick skips a session whose line is already frozen.

## Re-runnable probe (offline, drives the built `lib/` only)

```sh
node .agents/evidence/2026-10-06-batchM-pressure-line/probe.mjs
```

Expected: `checks: 6/6 passed`, exit 0, and two printed lines. The line for the motivating numbers
reads (zh; the en text is the same shape):

```
**自动交接状态（宿主注入，非用户发言）**：本会话上下文 316189 / 窗口 1000000（32%），已越过阈值 157000。
自动交接只在轮次结束时评估，所以轮次内的越线不会立刻触发。请在回复中把这一状态与原因告知用户。
```

The probe's own failure path is reachable, not decorative: patching the built
`lib/project-handoff/display.js` freeze condition to `previous !== undefined && previous.tokens ===
measurement.totalTokens` makes it print `5/6 passed` and exit 1; `pnpm build` then restores `lib/`
byte-identical (`git diff --exit-code -- lib` clean).

## Gate on the committed tree

| Check | Result |
|---|---|
| `pnpm typecheck` | 0 |
| `pnpm build` | 0, `built ./lib/client.js (28575 bytes)` (client half untouched) |
| `pnpm test` | **404 pass / 0 fail** (was 395; +9 new cases in `test/handoff-pressure.test.mjs`) |
| `node_modules/.bin/tsc --outDir $TMP` then `diff -rq lib $TMP` | only `client.js` extra (the documented second load criterion) |
| mutant markers in `lib/` | 0 |

## Mutation round

Three source mutants, each compiled (`tsc` 0), reached `lib/`, and reddened only the pin it was
aimed at. Restored each time from a hash-verified `/tmp` copy (`sha256sum -c` passed), `pnpm build`,
and `git diff --exit-code -- lib` clean.

1. The freeze condition became "freeze only while the occupancy is unchanged" —
   `the line is frozen while the crossing holds: the text is byte-identical as occupancy grows` went
   red.
2. The language was restamped on a later resolution while the numbers stayed frozen —
   `a language flip does not re-render a frozen crossing` went red (with its own message, "a later en
   resolution must not re-render"), and the occupancy pin above stayed **green**, which is what makes
   the two pins distinct rather than one assertion counted twice.
3. The `disposedDuringTick` guard was dropped from the tick's `.then` — `a tick that settles after
   disposal does not re-insert the line` went red, on its own assertion message.

## A tracked-doc defect found while landing the batch

`CONTEXT.md` did **not** round-trip through `renderContextDocument`: two hand-written bullets were
over the `MAX_LIST_ITEM_CHARS` (800) cap — the load-state bullet (1002) and this batch's own landed
bullet (802) — so the next `/memory update` would have clipped 204 characters mid-sentence and
appended the truncation marker. Both were split, not shortened, and the document now round-trips
byte-identically (0 items over the cap). The check is re-runnable and lives at
`.agents/evidence/2026-10-06-context-doc-roundtrip/roundtrip.mjs`; it is the CONTEXT.md counterpart
of the MEMORY.md `sectionsFromMarkdown` → `renderMemoryDocument` control, which the built renderer
does not provide for this document.

## Load state — re-derived, never quoted

- Criterion: the 19387 holder's start must be **later** than the last `src/` commit.
- Read at the time of writing: holder pid `4583` started `二 10月 6 21:00:16 2026`; last `src/`
  commit `3c97937` @ `2026-10-06T23:00:24+08:00` → **negative: batch M is NOT loaded.** Re-derive
  both halves rather than quoting these: a recorded pid/start time and a recorded commit go stale the
  moment either moves.
- `/etc/nixos/scripts/dsh-desktop-restart.sh --verify-only` → `RESULT: PASS` (electron 3656 /
  host 4583). This proves the build a restart *will* load, not that anything is loaded.

## After the user restarts (acceptance, next session)

1. Re-derive the load criterion (it must read positive) and confirm `--verify-only` = PASS.
2. Host-side witness that needs no crossing: the plugin entry still projects its config
   (`cordis_inspect_query` Config, entry `include:project-context`), because a plugin that fails to
   activate loses its card.
3. Behavioural witness: open a session that is over its threshold and confirm the model reports the
   crossing without the user typing `/handoff status` — the line is only observable through the
   model, so this is the one check that cannot be done offline.
4. Boundary that stays open (same class as batch I): whether the model actually relays the line.
   Do not report it as proven.
