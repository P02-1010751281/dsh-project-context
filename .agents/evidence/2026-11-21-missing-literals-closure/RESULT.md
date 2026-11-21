# Closure review — the missing-literals observation half (`406835f`)

**CLOSURE: FIX 3**

The four fixes are real and behave as claimed; the gate is green (`lib/` byte-identical to a fresh
`tsc`, 716/716 tests). Three written numbers still do not match the code or a reproducible command:
one in the evidence pack the CHANGELOG names as the single source, one causal attribution shared by
that pack and spec §10, and two ratios in the module's own comment. All three are documentation-only;
no behaviour defect was found.

Read-only: the repository was not modified. The only writes are this directory
(`.agents/evidence/2026-11-21-missing-literals-closure/`), scratch fixtures under `/tmp`, and
`/tmp/ml-closure/{tsc,mut}`. `git status` after the review: the two `.agents/memory` files were
already modified when the review started (live host writes), plus this untracked evidence directory;
`lib/` is untouched.

## 速查清单

- **[FIX 1] `.agents/evidence/2026-11-21-missing-literals-calibration/README.md:28`** — "长尾到 57"
  contradicts the same README's table (`最大 67`), the CHANGELOG, spec §10 and the commit message →
  say 67 (or attribute 57 to the substring rule explicitly).
- **[FIX 2] `.agents/evidence/2026-11-21-missing-literals-calibration/README.md:30-36`** and
  **`docs/memory-rewrite-loss-gate-spec.md:168`** — the retired `59 / 6.41 / 68` are attributed to
  "规格 §8 那行一次性正则 / §9.1 的错配正则"; that rule cannot produce them (same immutable archives:
  59 / 7.46 / 74). They are reproduced exactly by *pairing-first with no bare-text check* over the
  five rotate archives (59 / 26 / 6.41 / 68) → correct the attribution.
- **[FIX 3] `src/project-memory/missing-literals.ts:22`** and **`:102`** — "about 1.3 literals per
  transition" (measured 0.67 per transition; 1.22 per lossy one) and "about a fifth of every measured
  loss" (44 of 357 = 12.3%) → use the measured figures.

## Findings

### FIX 1 — the evidence pack's own tail number is from the other extractor

`README.md:28` reads `但另一半每条丢几个，长尾到 57。` The table nine lines above says `最大 | 67`.
Probe (`probe-output.txt`, `f2-calibration.mjs`):

```
landed (pair, then whole token)    transitions=66 zero=30 (45%) mean=5.41 median=1 max=67 p90=13 total=357
substring rule (F3 first version)  transitions=66 zero=31 (47%) mean=4.74 median=1 max=57 p90=12 total=313
```

57 is the **substring rule's** maximum, i.e. exactly the pre-F3 number the pack exists to retire.
The CHANGELOG (`最大 67`), spec §10 (`最大 67`) and the commit message (`max 67`) are all correct, so
this one sentence contradicts the pack's table and every consumer of it.

Minimal fix: `长尾到 67` (or `…长尾到 67（子串判定下是 57）` if the contrast is wanted).

### FIX 2 — the retired numbers are attributed to the wrong extractor

`README.md:30-36` says the previous round's `59 次转换、平均 6.41、最大 68` came from "规格 §8 那行一次性
正则", whose defect is "在匹配阶段就过滤「短于 3 字符」的 span". `docs/memory-rewrite-loss-gate-spec.md:168`
repeats the cause: `早先那份 59 次 / 6.41 / 68 由 §9.1 的错配正则得出`.

The rotate archives are frozen, so the claim is checkable (`f2-calibration.mjs`):

```
5 archives, §8 rule (filter, no bare) transitions=59 zero=23 (39%) mean=7.46 median=2 max=74 p90=22 total=440
5 archives, filter + substring bare   transitions=59 zero=24 (41%) mean=5.76 median=1 max=61 p90=16 total=340
5 archives, pairing + substring bare  transitions=59 zero=27 (46%) mean=5.14 median=1 max=57 p90=14 total=303
5 archives, pairing + NO bare check   transitions=59 zero=26 (44%) mean=6.41 median=1 max=68 p90=17 total=378
retired numbers (README / old CHANGELOG): 59 transitions, zero 26, mean 6.41, max 68
```

The mispairing regex reports **more**, not fewer, missing literals (the §1 pair: 57 → 61), and on the
same five archives it gives 59 / 7.46 / 74. The retired four figures are reproduced exactly only by
**pairing first (already §9.1-compliant) with no bare-text check at all**, over the five archives.
So the difference the pack describes is mostly the missing bare-text rule (plus the live journal
having no completed transition yet), not the mispairing; the mispairing's own cost is the separately
measured 61 vs 57 on the §1 pair (4 literals), which is correct and reproduces exactly.

This matters because the pack is named the single source for calibration numbers, and the paragraph
exists to stop the wrong numbers from being re-quoted; as written it would teach the next reader the
wrong cause (the repository's worst failure class).

Minimal fix: replace the explanation with the reproduced provenance, e.g. `早先那份 59 / 26 / 6.41 /
68 是「五份归档 + 先配对 + 完全不查裸文本」量出来的（六份 journal 上同一写法是 66 / 6.86 / 74）；§8 的
错配正则在同一批五份归档上是 59 / 7.46 / 74。错配本身的代价是 §1 那份文档对上 61 vs 57。`, and align
spec §10 line 168 with it. (The current six-journal numbers themselves are correct — see below.)

### FIX 3 — two ratios in the module comment do not match the measurement

`src/project-memory/missing-literals.ts:22`: `a systematic under-report of about 1.3 literals per
transition`. Measured: 44 hidden losses / 66 transitions = **0.67** per transition; 44 / 36 lossy
transitions = 1.22. `:102`: `the first version of this rule hid about a fifth of every measured loss`
— 44 / 357 = **12.3%**, which is the 12% the CHANGELOG and spec §10 both quote correctly.

Minimal fix: `about 0.7 literals per transition (1.2 on the transitions that lost anything)` and
`12% of the measured losses`. The CHANGELOG/spec figures (`44`, `12%`, `4.74`, `5.41`) are right and
need no change.

## Confirmed correct (do not re-litigate)

### F1 — the baseline is the view the model was shown, including on the retry path

- `ConsolidationOutcome.shownMemory` (`src/project-memory/consolidate.ts:89`) is set to `promptMemory`
  at `:1063`, and `promptMemory` is exactly what the prompt carries: the retirement-shrunk render
  (`:698`) or `existing.text` (`:694`). Both refusal outcomes that are constructed before any model
  call set `shownMemory: existing.text` and publish nothing (the write is gated by `memoryRefused` /
  `semanticEmpty`), so they cannot feed the measure.
- The first call sends `fitted` (`:847`); `fitMemoryInput` returns `{ text: memory }` verbatim whenever
  `!clipped` (`src/shared/conversation.ts:63-64`), and a clipped fit refuses the pass **before** the
  model call (`consolidate.ts:726-757`). The truncation retry re-fits from `promptMemory` (`:877`) and
  only runs when `retryFitted.clipped === false` (`:884-886`), so `usedInput.text === promptMemory` on
  both calls; `promptFor` embeds `input.text` verbatim (`:773-775`). The tier-C retry re-sends the same
  `usedInput` (`:956`). The cached-outcome path can also reach the write, but the write is basis-keyed
  on the store and the reply it carries came from that same outcome's prompt.
- Probe `f1-retry-retirement.mjs` (cut-off first reply, retry lands, anchor-drift retirement):

```
model calls: 2 | first stopReason path was max-tokens
report.status: updated | memoryWritten: true
report.missingLiterals: {"count":0,"samples":[]}
retired literals still visible in call-1 <existing-memory>: []
retired literals still visible in call-2 <existing-memory>: []
call-1 view === call-2 view: true
retired.md records the deletion: true
BASIS-KEY variant missingLiteralsBetween(store, landed): {"count":2,"samples":["orbitalDriftGate","src/project-memory/gone.ts"]}
```

- The control scenario (nothing retired, one shown literal dropped) reports `count 1`, so the measure
  is not a constant.
- Mutations (sandbox copy of `lib/`, never the repository): `M8` measuring `basisKey` instead of
  `shownMemory` turns the retirement e2e red; `M9` skipping the pre-prompt plan altogether also turns
  it red (`retired.md` stays empty), so the test fails for the right reason and really asserts that the
  retirement happened.

### F2 — the landed calibration numbers, and the 61-vs-57 demonstration

- Recomputing independently over the six journals (`f2-calibration.mjs`) gives exactly:
  `transitions=66 zero=30 (45%) mean=5.41 median=1 max=67 p90=13`, total 357. Matches the CHANGELOG,
  spec §10, the README table and the commit message.
- The substring variant gives `total=313 mean=4.74`, so the token rule recovered `44` losses =
  `12.3%` — the CHANGELOG/spec `44 / 12%` and `4.74 / 5.41` are correct.
- The spec §1 pair is in the journals (`memory-log-2026-11-20T02-14-19-927Z-c1461f98.jsonl`,
  records #7→#8, 44,996→39,900 chars). All of §1/§9.1 reproduces exactly: 74 missing with no bare
  check, 61 with filter-at-match + substring, **57 with pairing-first + substring**, 13 backticked-only;
  the shipped whole-token rule reports 67 on that pair. So the `61 vs 57` / `多报 4 条` claim is
  reproducible from tracked data (the only nuance is that both figures hold the substring bare-text
  rule fixed, which is what the spec says).

### F3 — the token rule, and what the fix introduced

`probes/f3-hostile.mjs` runs 43 checks, 0 failures. Verified:

- punctuation-adjacent literals are mentions (`failureCodeOf(...)`, `(failureCodeOf)`,
  `"failureCodeOf"`, `path/to/file.ts:`, `reason === "manual"`, `/etc/nixos:`);
- a literal that survives only as a prefix of a longer bare word is counted as a loss
  (`main`→`remaining`, `test`→`tests`, `docs`→`documentation`, `memoryComparisonKey`→`…WithDrop`),
  which is the documented, intended direction; a hyphen breaks the word (`main-page` is a mention);
- CJK is a whole token (`记忆库`→`记忆库扩容` = loss, free-standing = mention); two-character CJK and
  two-character ASCII spans are below `MIN_LITERAL_CHARS`, as `:41` and the test comment say;
- fenced blocks: fences carry no literal, a literal inside a fence is extracted like any other text,
  and its departure is reported — the spec §6 "code block" false-positive source is not removed but the
  behaviour is at least uniform;
- a literal twice on one line dedupes, and the samples cap holds (`count 15`, `samples 10`);
- pairing: `backtickedLiterals` (`:54-61`) and `outsideBackticks` (`:74-76`) apply the **same**
  per-line `/`[^`]*`/g` left-to-right pairing; a three-backtick line leaves the same tail bare to both
  (`"`abc` x `def"` → literal `abc`, and a previous `def` is a mention in the leftover tail). The only
  asymmetry is the trim/length filter after pairing, which cannot hide a ≥3-character literal;
- over-report from common words: not in the way the task fears — `main`/`test`/`docs` are mentions while
  they are whole tokens, and only become losses when the next document carries them solely inside a
  longer word. Cost measured: 4.74 → 5.41 with 45% of transitions still at zero, so the number is not
  unusable. The rule is deliberately one-sided to stop the under-report class (§9.1/F3).
- performance: ~3,540 distinct literals against 52,000 characters of prose = 4.8 ms; 52,000 lone
  backticks = 2.7 ms. A pathological next document made of one repeated word character costs ~1.8 s for
  316 literals (the scan advances one character per occurrence) — bounded, requires a degenerate
  model output, and runs once per landed pass under the memory lock; noted, not a defect.

### F4 — the read-back is inside the lock and unreachable when the write did not land

`src/project-memory/index.ts:362` opens `withMemoryLock(...)`; the same callback calls
`recordMemoryDocument` (`:365`, whose publish is `writeAtomic` in `record.ts:139`) and then
`const landed = result.written ? await readOptional(memoryFile(projectRoot)) : ""` (`:369`). The
measure is gated on `snapshot.written && snapshot.landed !== ""` (`:394`) and the report field on
`wroteMemory && memoryLiteralLoss !== undefined` (`:469`), so a refused write cannot reach the
measure, and an unreadable file is "no observation", not "everything was lost".

Probe `f4-lock-and-landed.mjs`, with an external edit landing during the model call:

```
report.memoryWritten: false
report.missingLiterals: undefined (undefined = no observation at all)
errors.log names the basis-key refusal: true
errors.log carries a missing-literal line: false
```

### Other written claims checked

- The receipt says `backticked literal(s)` (not `token(s)`) and carries the sentence on the **first**
  line (`src/project-memory/index.ts:992-994`); probe receipts show
  `Memory: updated MEMORY.md and CONTEXT.md. Missing literals: 1 backticked literal(s) …` on line 1.
- The unreachable `samples.length === 0` arm is gone: the condition is `count === 0`, and
  `count > 0` implies `samples.length > 0` by construction (`missing.slice(0, 10)`).
- "新增 13 条（10 条纯函数 + 3 条端到端）": 10 tests in `test/missing-literals.test.mjs`, 3 added to
  `test/logic.test.mjs`; the `test(` line count is 702 at `HEAD~1` and 715 here (+13), and the runner
  reports 716 (one top-level test per file). Suite: 716 pass.
- "变异 8 个全部命中": reproduced. `probes/mutate-closure.mjs` catches all eight claimed mutants
  (pair/filter inverted, token-boundary removed, samples cap raised, report field not carried, receipt
  absent, log absent, receipt condition inverted, baseline reverted to `basisKey`), baseline green; two
  extra mutants show `M9` (retirement skipped) red and `M10` (measure `memoryText` instead of the
  read-back) surviving — see the residual.
- Spec §10's four items are all implemented and match the code: `shownMemory` baseline, read-back
  under the lock with the empty-read fallback, whole-token/excluding-backticks bare rule, receipt only
  on `/memory update`'s first line.
- The count is not persisted and `/memory status` cannot report it: `status-report.ts` does not read
  `missingLiterals`; `src/` reads it only in `index.ts` (report + receipt) and the barrel.

### Gate

```
$ node_modules/.bin/tsc -p tsconfig.json --outDir /tmp/ml-closure-tsc      # exit 0
$ diff -r --exclude=client.js /tmp/ml-closure-tsc lib                      # exit 0 (no output)
$ pnpm typecheck                                                           # exit 0
$ node --test 'test/**/*.test.mjs'                                         # exit 0 — tests 716, pass 716, fail 0
```

`lib/client.js` is untouched by the commit and by `tsc`; `git status` shows no modified `lib/` file.
Full transcript: `gate-output.txt`.

## Residual

**The "landed bytes vs the reply" distinction is still untested — confirmed.** Mutant `M10` replaces
`snapshot.landed` with `memoryText` and the whole e2e set stays green. The two coincide by
construction outside a concurrency window: for a sectioned reply `memoryText` is already the rendered
document (`render.text`, ≤ cap), and `normalizeMemoryDocument` only strips a leading fence/header and
trims (`src/project-memory/document.ts:94-113`); the cap branch that could drop a literal is reached
only for an oversized opaque reply, which tier C refuses before any write. A test cannot be pinned
without either a concurrency harness (two writers, one holding the lock) or a seam injected at the
read — neither exists in this code. The only observable reply-vs-landed difference is the raw model
reply vs the **renderer** (an entry over `MAX_LIST_ITEM_CHARS` loses its tail; probe `f4` (b) shows
landed count 1 vs reply-text count 0), but that is not the read-back/`memoryText` distinction, and the
landed side is already the rendered document there.

So: record it as a residual ("the read-back is only distinguishable under a concurrent writer; no test
can detect a regression that measures `memoryText`"), not as a promise that the landed-byte guarantee
is pinned. The F4 *guard* that is testable — a refused write never measures and never logs — is pinned
by the probe above and could be added to the suite cheaply if wanted.

## Reproduction

```bash
node .agents/evidence/2026-11-21-missing-literals-closure/probes/f1-retry-retirement.mjs
node .agents/evidence/2026-11-21-missing-literals-closure/probes/f2-calibration.mjs
node .agents/evidence/2026-11-21-missing-literals-closure/probes/f3-hostile.mjs
node .agents/evidence/2026-11-21-missing-literals-closure/probes/f4-lock-and-landed.mjs
node .agents/evidence/2026-11-21-missing-literals-closure/probes/mutate-closure.mjs   # sandbox under /tmp
```

Combined output: `probe-output.txt`; gate: `gate-output.txt`.
