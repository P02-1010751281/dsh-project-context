REVIEW: FIX 4

# 2026-11-21 · missing-literals loss gate — adversarial read-only review

Batch under review: `src/project-memory/missing-literals.ts` (new), the observation half wired into
`src/project-memory/index.ts`, the barrel re-export, 8 unit cases + 2 end-to-end cases, the
`CHANGELOG.md` entry and the rebuilt `lib/`.

Nothing in the repository was modified. Every probe below lives in
`.agents/evidence/2026-11-21-missing-literals-review/probes/` and runs against the tracked `lib/`
(recompiled `src/` is byte-identical to `lib/`: `diff -r /tmp/mlreview/tscout lib --exclude=client.js`
is empty, `tsc -p tsconfig.json` exits 0, full suite `tests 713 / pass 713 / fail 0`).

## 速查清单

- **[F1] `src/project-memory/index.ts:387`** — the measure's baseline is `outcome.basisKey`
  (`consolidate.ts:1053`, the raw store), but the model is shown the **retirement-shrunk** document
  (`consolidate.ts:686-690`). A pass that deliberately retires an entry (batch Z2) therefore reports
  that entry's literals as "the previous memory carried no longer appear", on the receipt and in
  `errors.log`, with no cause named → baseline the measure on the document the model was shown
  (`plan?.sections`, exactly what batch Q2's layer already does at `consolidate.ts:1003`); acceptance:
  the retirement probe below reports `count 0` and writes no line, while a genuine generalization still
  reports.
- **[F2] `CHANGELOG.md:16-17`** — the quoted calibration (59 transitions / 26 zero-loss / mean 6.4 /
  max 68) is the **retired pre-§9.1** measurement; the batch's own evidence file
  (`.agents/evidence/2026-11-21-missing-literals-calibration/README.md`, "与旧数字的差别") says the
  landed measure gives 66 / 31 / 4.74 / 57 and "引用数字时用这一份", and `output.txt` records exactly
  that → quote 66 / 31 (47%) / 4.74 / max 57 (and correct the 844 clause); acceptance: the numbers are
  reproducible by the evidence file's own command.
- **[F3] `src/project-memory/missing-literals.ts:70`** — the bare-text rule is
  `next.includes(literal)` over the whole document, so a literal also reads as "not missing" when it
  survives only as a **substring of another word or of a longer literal** (`memoryComparisonKey` inside
  `memoryComparisonKeyWithDrop`, `main` inside "remaining domain") → require a token-bounded, non-backticked
  occurrence; acceptance: both probe cases report 1, `dsh` → "the dsh project" stays 0.
- **[F4] `src/project-memory/index.ts:385-387`** — the measured document is read back **after**
  `withMemoryLock` released, so under a concurrent second host it is another pass's document; the bytes
  this pass wrote are deterministic (`record.ts:127,139`) and are already computed one statement above
  (`index.ts:377`) → measure `normalizeMemoryWithDrop(memoryText, config.maxMemoryChars).text`, or return
  the landed bytes from inside the lock; acceptance: the measurement is a pure function of this pass's
  reply, and a test distinguishes "reply" from "landed bytes" (mutant M7 below currently survives).

## Detail

### F1 (Medium) — a deliberate Z2 retirement is reported as an unexplained lost literal

Code path:

- `consolidate.ts:1053` — `basisKey: existing.text`, the stored document **before** retirement.
- `consolidate.ts:679-690` — the retirement plan is computed from `existing.text`, then
  `promptMemory = rendered.text` (the retirement-shrunk view) is what the model is shown; the comment
  says so: "a retired entry leaves the document *and* the view the model is shown".
- `index.ts:387` — `missingLiteralsBetween(outcome.basisKey, landed)`.

So every entry the pass deliberately removes is, by construction, a missing literal. The 180-day /
`supersedes:` / anchor-drift triggers all funnel through `retirement.ts:418-421`.

Probe (`probes/probe-e2e-retirement.mjs`, real `consolidateProject` + `memoryUpdateReply`, a stored
entry citing `src/project-memory/gone.ts`):

```
status: updated memoryWritten: true
report.removedEntries (batch Q2's layer): {"count":0,"samples":[]}
report.missingLiterals: {"count":1,"samples":["orbitalDriftGate"]}
landed still carries orbitalDriftGate? false
--- errors.log lines naming the deletion / the literals ---
  2026-11-21T02:00:18.926Z [memory] 1 backticked literal(s) the previous memory carried no longer appear in the new document, e.g. orbitalDriftGate
--- receipt ---
Memory: updated MEMORY.md and CONTEXT.md. Missing literals: 1 backticked token(s) the previous memory carried no longer appear (e.g. orbitalDriftGate).
--- retired.md (Z2 tombstones) ---
- 2026-11-21 · the `orbitalDriftGate` lives in src/project-memory/gone.ts · anchor-drift
```

The tombstone proves the deletion was this pass's own deliberate Z2 retirement, and the same file's
Q2 layer reports `count 0` for it — with the comment at `consolidate.ts:1002-1003` giving the exact
rule: "an entry the retirement pass removed is a deliberate deletion, and reporting it as a regression
would misname the cause". The new layer reports the opposite for the same entry, on the receipt and in
the log, and names no cause. A human or agent reading it will chase a generalization that did not
happen — and §4 of the spec says this count is what decides whether the measure is later promoted to a
refusal, so a Z2 retirement silently inflates the calibration.

Minimal fix: baseline the measure on the document the model was shown (`plan?.sections`, or the same
`promptMemory` value), not on `outcome.basisKey`; if a retired literal can still reach the count, name
the retirement in the log line the way `itemTruncated` is named (`index.ts:389-391`).

Acceptance: the probe above reports `missingLiterals: { count: 0, samples: [] }`, writes no
"backticked literal(s)" line and no receipt sentence; a reply that drops an entry the retirement pass
did **not** remove still reports.

### F2 (Medium) — the CHANGELOG quotes the calibration numbers its own evidence retires

`CHANGELOG.md:16-17`: "离线校准（`memory.jsonl` 六份日志共 59 次转换）：零丢失 26 次，平均每次丢 6.4
个字面量，最大 68；而最近一次落盘字符数还涨了 844。"

The batch's own evidence directory already measured this, and says the opposite:

- `.agents/evidence/2026-11-21-missing-literals-calibration/output.txt` — `journals: 6 transitions: 66`,
  `zero-loss 31 (47%) mean 4.74 median 1 max 57 p90 12`.
- `.agents/evidence/2026-11-21-missing-literals-calibration/README.md`, "与旧数字的差别（必须记住）":
  "上一轮（2026-11-20）用规格 §8 那行一次性正则量到的是 **59 次转换、平均 6.41、最大 68** … 用落地
  实现（先配对、后过滤）重算，同一批 journal 得到上表的 66 / 4.74 / 57。**引用数字时用这一份。**"

Independent reproduction (`probes/recalibrate.mjs`, cap 52000 = the live `maxMemoryChars`):

```
replace records per journal: 15,13,12,12,12,8
landed measure, six journals        : transitions=66 zero=31 mean=4.74 max=57 sum=313
pre-§9.1 rule (no bare check), six  : transitions=66 zero=29 mean=5.91 max=68 sum=390
pre-§9.1 rule (no bare check), five : transitions=59 zero=26 mean=6.41 max=68 sum=378
CHANGELOG claims: transitions=59 zero=26 mean=6.41 max=68
```

The landed measure over the six journals the sentence names prints **66 / 31 / 4.74 / 57**, exactly
`output.txt`. The four quoted numbers are precisely the **pre-§9.1** rule over the five archives (the
snapshot that predates the sixth journal's later writes) — the extractor §9.1 exists to disown. So the
CHANGELOG quotes the measurement the batch's own evidence retires, in the direction that overstates the
loss (6.4 vs 4.74 mean), and "六份日志共 59 次转换" mixes a five-archive transition count with a
six-journal file list (the six-journal set is 66).

The trailing clause also has no reproducible referent: no consecutive landed-length delta in the six
journals equals 844 (the deltas include +1,759 and +3,337 for the two 2026-11-20 passes the spec's §1
table names), and `HEAD`'s `MEMORY.md` (51,221 characters) to the working tree (51,998) is +777.

Minimal fix: copy the three statistics from `output.txt` (66 transitions, 31 zero-loss, mean 4.74,
max 57) and drop or correct the 844 clause.

Acceptance: the quoted numbers are exactly what
`node .agents/evidence/2026-11-21-missing-literals-calibration/calibrate.mjs` prints.

### F3 (Low) — the bare-text rule also suppresses real losses (substring, and inside another literal)

`missing-literals.ts:70` is `!kept.has(literal) && !next.includes(literal)`.

Probe (`probes/probe-measure.mjs`):

```
previous `memoryComparisonKey` -> next `...WithDrop`       {"count":0,"samples":[]}
previous `main` -> next 'remaining domain'                 {"count":0,"samples":[]}
previous `dsh` -> next 'the dsh project'                   {"count":0,"samples":[]}   <- correct: the fact is on the page
```

The rule §9.2 states is "a literal that survived only without its backticks is not missing" — the fact
is still on the page. A symbol that survives as a **prefix of a different, longer literal**, or as a
substring of an unrelated word, is not that case: the fact that the symbol named is gone while the
document only carries different words. Materiality: the bare rule is worth 1.27 literals per
transition (F2's 6.41 → 5.14), so this is a systematic ~20% under-report, in the direction that hides
exactly what the measure exists to see.

Minimal fix: require a bare occurrence to be token-bounded (non-`[\w./-]` on both sides) and to lie
outside any backticked span (strip the spans from `next` before the check).

Acceptance: the first two probe cases report `count 1`; the third (`dsh` → "the dsh project") stays
`count 0`.

### F4 (Low) — the measurement is read back outside the lock, so it need not describe this pass's document

`index.ts:384-387`:

```ts
const snapshot = await withMemoryLock(memoryFile(projectRoot), async () => { … });
…
if (snapshot.written) {
    const landed = await readOptional(memoryFile(projectRoot));
```

The lock is released before the read. A concurrent second host (the case `options.basisKey` and
`nextRenderSupersedes` exist for, and which the suite already exercises with four real processes and a
barrier file) can replace `MEMORY.md` in that window; this pass then measures its own baseline against
**the other pass's** document and attaches the count and samples to its own receipt — a measurement of
a document that did not land, which the batch's own contract forbids. The window is narrow (two
syscalls), so this is Low, but the comment's justification is also wrong: `record.ts:127` renders
`normalizeMemoryDocument(text, limit)` and `record.ts:139` writes exactly those bytes, so the landed
document is a pure function of the reply and the cap — `index.ts:377` already computes it for
`memoryWriteDroppedChars`.

Related, and the reason no test catches it: mutant **M7** ("measure `memoryText` instead of the landed
bytes") survives both end-to-end cases, because the reply and the landed bytes coincide in both
fixtures (`probes/mutate.mjs`):

```
### M7 measurement taken from the reply instead of the landed bytes
  unit: pass=8 fail=0
  e2e : pass=2 fail=0
```

Minimal fix: `missingLiteralsBetween(outcome.basisKey, normalizeMemoryWithDrop(memoryText, config.maxMemoryChars).text)`,
or have the lock body return the landed bytes; add the case where the write path caps the reply
(`memoryWriteDroppedChars > 0`) so "reply" and "landed bytes" differ.

Acceptance: the measured document is a pure function of this pass's reply and the cap, and M7 turns a
test red.

## Smaller issues (not separate findings)

- `index.ts:986` labels the metric "Missing literals" but counts "backticked **token**(s)"; the report
  field, the log line and §9.2 all say **literal**. One name per fact.
- `index.ts:986`'s `samples.length === 0` arm is unreachable: `count > 0` implies
  `samples.length > 0` (`missing-literals.ts:71-73`, `MISSING_LITERAL_SAMPLES = 10`). Harmless, but it
  reads as a case someone believed was possible.
- The second assertion of `test/missing-literals.test.mjs:31` ("a short span *after* a long one must not
  be counted either") is satisfied by both implementations — it does not discriminate pairing-first from
  filter-first. The first assertion in the same case does.
- `index.ts:392`'s caveat names `itemTruncated` only. The write-cap drop is named by the receipt's
  existing `detail` (`memoryLossDetail`, `index.ts:833`) but not by the log line; F1's retirement is
  named by neither.

## 保留 (confirmed correct — do not re-litigate)

- **No refusal logic was added, and tier C is untouched.** The diff is additive: the only new
  conditional (`index.ts:384-395`) writes a log line and a report field. `sectionDropped` /
  `droppedItems` / `itemTruncated` keep their exact meaning; no status changed; nothing can refuse.
- **Report only after a successful write.** Every non-landing path returns before or without the field:
  basis-key staleness (`record.ts:116-120` → `written:false` → `snapshot.written` false),
  `nextRenderSupersedes` (`record.ts:131-137`), `semanticEmpty` and `memoryRefused`
  (`index.ts:310`, `memoryChanged` false), `read-capped-refused` / `fit-capped-refused`
  (`consolidate.ts:656`/`727`), and a deduped pass (`cleanReport("deduped")`, `index.ts:599`). A cached
  outcome cannot replay a stale measurement.
- **A task-bound session is not a false-positive source.** The binding redirects only the context half
  (`index.ts:481-484`); the memory half still writes `MEMORY.md`, which is the file measured.
- **The receipt sentence is on line 1 and only for a landed memory.** `memoryUpdateReply` returns a
  single-line string for `updated`; the sentence is guarded by `wroteMemory` and by `count > 0`, so a
  count of 0 is never shown, and it cannot be confused with `memoryLossDetail`'s wording (verified
  above: `Memory: updated … Missing literals: 1 …`).
- **`/memory status` cannot and does not report the count.** Nothing is persisted (grep: the only
  consumers are `index.ts` and tests); `formatMemoryStatus` reads files. The CHANGELOG claim is correct.
- **Per-line pairing is equivalent to "pair in order within a line"**, and no pair is spliced across a
  line: `a `alpha\nbeta` b` yields `[]` (probe). Unbalanced backticks, lone ```` ``` ````, a fence line
  ```` ```js ````, CRLF, CJK, nested punctuation, a repeated literal and the empty document all behave
  sanely; a document that is entirely one fenced block yields no literals.
- **No performance or backtracking hazard.** Worst case over a 52,000-character document (the live
  `maxMemoryChars`) with 3,540 distinct literals: 4.0 ms; 52k lone backticks: 1.5 ms; 100 unterminated
  500-char spans: 0.1 ms. `[^`]*` cannot consume a backtick, so it never backtracks across a line.
- **The §9.1 "61 vs 57" claim is real.** On the 2026-11-20 archive's 8th transition the filter-at-match
  extractor reports 61 and pairing-first reports 57 — the "多报 4 条" in the CHANGELOG and the module
  comment is measured, not asserted.
- **The three extraction rules are implemented as stated** (pair first, then drop spans < 3 characters
  after trimming; per line; bare text is not a loss) — F3 is about one rule being *too broad*, not
  missing.
- **The tests pin what their names say, and the negative control is not vacuous.** Mutation spot-check
  against a sandbox copy of `lib/` (`probes/mutate.mjs`): M1 filter-at-match → 2 unit red; M2 bare check
  removed → unit red; M3 sample cap 10→20 → unit red; M4 report field not carried → both e2e red; M5
  receipt sentence removed → e2e red; M6 log line not written → e2e red. Six of the seven claimed
  mutants are therefore killed; the seventh ("report field not carried") is M4. The only surviving
  mutant is M7 above, which the CHANGELOG does not claim was killed.
- **`lib/` is in sync with `src/`** and the build is deterministic (`tsc` to a temp `outDir` diffs clean
  against `lib/project-memory`, `diff -r` over the whole tree excluding `client.js` is empty).
- **The suite is green**: 713 tests, 0 failures, run directly against `lib/` without rebuilding.
