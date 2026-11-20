# Post-restart acceptance of `f247e77` — behavioural half (task-2)

Date: 2026-11-20, run started 11:05 local. Repository HEAD `f247e77` (`f247e777f922f15c57359b1bca4b1cf4eb91c478`).
Host restarted 11:03:08 local = `2026-11-20T03:03:08Z`; installed copy written 10:58:26; the installed
`lib/` tree is byte-identical to the repository `lib/` (proof below). The lead already proved the
resident module source for `lib/shared/model-call.js` and `lib/project-memory/status-report.js` equals
disk; this report covers the behavioural half only.

Nothing here ran `/memory update`, nothing built anything, and every file written by this run is inside
this evidence directory. The two modified tracked files under `.agents/memory/` were written by the
plugin's own pass at `03:07:21Z`, four minutes after the restart (attribution in item 4).

## Verdicts

| # | Item | Verdict | One line |
|---|------|---------|----------|
| 1 | Receipt layout (`loadMemory` + `memoryStatusReply`, cap 52000) | **PASS** | 5 lines / 356 chars, line 1 = `Memory: 51154/52000 chars (98%) · 160 entries (…)`, max line 97 chars, no `source` line because the source *is* the journal; the `source` line appears in the crafted case where it differs. |
| 2 | Cap two-state (`formatMemoryStatus`, crafted reports) | **PASS** | Marker + `cappedDroppedChars: 0` → `Note:` only, neither `this read is cut` nor `read-capped-refused`; the same document with `cappedDroppedChars: 9621` → `Warning:` with both phrases. Also proven: the count alone (no marker) warns, and neither marker nor count stays silent. |
| 3 | Retry wiring, positive and negative | **PASS** | Memory call site passes `extraCodes: ["MALFORMED_RESPONSE"]`; autolearn passes no options (0 occurrences of either string); shared allowlist still exactly `INVALID_REQUEST` / `HTTP_400` / `HTTP_413`; executed behaviour matches on all four cases. |
| 4 | Runtime evidence after `03:03:08Z` | **PASS (observation) / UNOBSERVABLE (activation)** | Exactly one timestamped entry after the restart: `03:07:21.518Z [memory] memory regression: 1 …` — analysed below, it is a rewording report, not a lost fact. No `MALFORMED_RESPONSE` and no retry line after the restart, so whether the new retry actually fires is still **UNOBSERVABLE**: it needs a pass whose `record_memory` reply is malformed, and no one can force that. |

Nothing failed. Two things the lead should know, neither a defect of this batch:

- **A real pass landed at `03:07:21.514Z`, after the restart**, and wrote `MEMORY.md` (51,154 chars,
  byte-identical to the newest journal record). It moved the document from the 49,989 chars quoted in
  the task to **51,154 / 52,000 (98 %) — 846 characters of headroom left**. The document grew by 1,165
  characters and 6 entries (154 → 160). Headroom is now the operational risk, not this batch.
- **The one after-restart log line is the memory-regression guard reporting a rewrite as a removal.**
  The guard compares entry text; the pass rewrote the Tier-C pitfall entry ("Candidate design in
  `docs/memory-rewrite-loss-gate-spec.md`" → "§9 of … gates the metric: …"). The old text is gone, so
  the guard fired, but all five backticked tokens and every distinctive sentence of the old entry are
  still in the new document (checked below). This is the known text-identity semantics of the report
  layer, not a new defect — but it does mean a reworded entry costs a `memory regression:` line.

## How each item was exercised

Every check ran against the **installed** copy
`/home/user/.dsh/profiles/desktop/node_modules/dsh-project-context/lib/`, imported directly by `node`
(ESM, absolute paths), and was repeated against the repository `lib/`. The two trees are identical:

```
$ diff -rq lib /home/user/.dsh/profiles/desktop/node_modules/dsh-project-context/lib && echo "no differences (exit 0)"
no differences (exit 0)
```

`node -v` here is `v24.22.2`. The installed copy carries no `@deepseek-ai/*` packages of its own (the
host injects them in-process), so `probe.mjs` registers a small resolve hook
(`resolve-hook.mjs` / `register.mjs`, this directory) that binds those bare imports to the same dsh
store (`/nix/store/…-dsh-desktop-0.2.2-rc.3/…/repo/node_modules`) the running host loaded. The status
path never calls into them (the only value imports anywhere in `lib/` are `@deepseek-ai/dsh-session` and
`@deepseek-ai/schemastery`, neither reached by `loadMemory`, `memoryStatusReply` or `formatMemoryStatus`), so this
only satisfies side-effect imports; it borrows no behaviour. This is the one deviation from "plain
`node` ESM imports" and it is recorded here deliberately.

Command:

```
$ node --import ./.agents/evidence/2026-11-20-post-restart-acceptance/register.mjs \
    .agents/evidence/2026-11-20-post-restart-acceptance/probe.mjs
```

Full, unedited output (`probe-output.txt`), 36 checks, exit 0:

```text
=== module identity: installed copy vs repo lib ===
SAME  project-memory/status-report.js  installed=25ac6dc0468961aef67489e06efe75b91b5e03d2ccbde6bfe0e7aa6e62af0bbe  repo=25ac6dc0468961aef67489e06efe75b91b5e03d2ccbde6bfe0e7aa6e62af0bbe
[CHECK sha:project-memory/status-report.js] PASS — installed built file is byte-identical to repo lib
SAME  project-memory/load.js  installed=e38a07f40c744eb111b612c023fadcf532520c02b6ed8175a83fd224646c586c  repo=e38a07f40c744eb111b612c023fadcf532520c02b6ed8175a83fd224646c586c
[CHECK sha:project-memory/load.js] PASS — installed built file is byte-identical to repo lib
SAME  project-memory/index.js  installed=30e5cd1d5ec9487c1bafd8c4daf235445f456e5b602b7ae7d025e54bc7333920  repo=30e5cd1d5ec9487c1bafd8c4daf235445f456e5b602b7ae7d025e54bc7333920
[CHECK sha:project-memory/index.js] PASS — installed built file is byte-identical to repo lib
SAME  project-memory/consolidate.js  installed=6cc50f7111d421f03c80da9cb5f067606d01c89fb4d2f2ec1758712b7d683817  repo=6cc50f7111d421f03c80da9cb5f067606d01c89fb4d2f2ec1758712b7d683817
[CHECK sha:project-memory/consolidate.js] PASS — installed built file is byte-identical to repo lib
SAME  project-autolearn/pass.js  installed=63f71e33f944339d006b4bf6153e47ddd6ef1841baf2d15e4432d58b8e8021f6  repo=63f71e33f944339d006b4bf6153e47ddd6ef1841baf2d15e4432d58b8e8021f6
[CHECK sha:project-autolearn/pass.js] PASS — installed built file is byte-identical to repo lib
SAME  shared/model-call.js  installed=6a3ed5924640c0fdd414ae705a7b5d116e98e59c1cc06a4e3b35de767e45a7ed  repo=6a3ed5924640c0fdd414ae705a7b5d116e98e59c1cc06a4e3b35de767e45a7ed
[CHECK sha:shared/model-call.js] PASS — installed built file is byte-identical to repo lib

=== ITEM 1: live /memory receipt (installed copy, cap 52000) ===
journal path: /mnt/Data/Projects/dsh-project-context/.agents/memory/memory.jsonl
memory.source: /mnt/Data/Projects/dsh-project-context/.agents/memory/memory.jsonl
memory.text.length: 51154
memory.cappedDroppedChars: 0
memory.damaged: 0  poisoned: false  unreadable: false
kind: success
text.length: 356
line count: 5
line[0] len=96 "Memory: 51154/52000 chars (98%) · 160 entries (Project 18, Invariants 73, Pitfalls 51, Index 18)"
line[1] len=41 "31 bound entries · stale 4: dc5, bde, c79"
line[2] len=97 "journal /mnt/Data/Projects/dsh-project-context/.agents/memory/memory.jsonl 6 lines / 311838 bytes"
line[3] len=56 "3 backups · 207 archived sessions · errors.log 870 lines"
line[4] len=62 "no last-pass result (consolidation outcomes are not persisted)"
[CHECK 1a-line1] PASS — line 1 is the measurements form ("Memory: 51154/52000 chars (98%) · 160 entries (Project 18, Invariants 73, Pitfalls 51, Index 18)")
[CHECK 1b-len] PASS — line 1's printed length equals the loaded document length 51154
[CHECK 1c-sections] PASS — line 1 ends with the four-section entry counts
source lines: []
[CHECK 1d-source-conditional] PASS — source line present iff source !== journal (source === journal)
[CHECK 1e-max-line] PASS — max line length 97 < the recorded old single-line 416 (CHANGELOG.md:38)
old single-line reconstruction length: 433
old single-line reconstruction (first 160 / last 120): "Memory: /mnt/Data/Projects/dsh-project-context/.agents/memory/memory.jsonl · 51154/52000 chars (98%) · 160 entries (Project 18, Invariants 73, Pitfalls 51, Inde" … " backups · 207 archived sessions · errors.log 870 lines · no last-pass result (consolidation outcomes are not persisted)"
[CHECK 1f-flat] PASS — flattening the same facts reproduces a >=416-char single line (433) — this is the form the multi-line layout replaces

=== ITEM 1 (repo lib parity) ===
[CHECK 1g-repo-parity] PASS — repo lib renders the byte-identical receipt for the same facts

=== ITEM 2: cap two-state (crafted reports, installed copy) ===
crafted document length: 130; isMemoryTruncated: true
[CHECK 2a-marker-present] PASS — the crafted document does carry a truncation marker (so the marker branch is reachable)
--- (a) marker + cappedDroppedChars:0 (len 499) ---
a.line[0] len=85 "Memory: 130/52000 chars (0%) · 1 entry (Project 1, Invariants 0, Pitfalls 0, Index 0)"
a.line[1] len=203 "Note: MEMORY.md still carries the marker of an earlier cap, but nothing was dropped from this read — the document was rewritten short since; the next consolidation pass rewrites it and clears the marker."
a.line[2] len=94 "journal /mnt/Data/Projects/dsh-project-context/.agents/memory/memory.jsonl 2 lines / 100 bytes"
a.line[3] len=51 "1 backup · 2 archived sessions · errors.log 0 lines"
a.line[4] len=62 "no last-pass result (consolidation outcomes are not persisted)"
[CHECK 2b-note] PASS — (a) renders the Note line
[CHECK 2c-no-cut] PASS — (a) does not contain 'this read is cut'
[CHECK 2d-no-refused] PASS — (a) does not contain 'read-capped-refused'
[CHECK 2e-no-warning] PASS — (a) does not render a Warning:
--- (a) source line present: false (source === journalPath here) ---
--- (b) same document + cappedDroppedChars:9621 (len 542) ---
b.line[0] len=85 "Memory: 130/52000 chars (0%) · 1 entry (Project 1, Invariants 0, Pitfalls 0, Index 0)"
b.line[1] len=246 "Warning: MEMORY.md is at the 52000-character cap — this read is cut, so a consolidation pass refuses to rewrite it (status read-capped-refused), and anything appended past the cap is dropped on write; raise maxMemoryChars or shorten the document."
b.line[2] len=94 "journal /mnt/Data/Projects/dsh-project-context/.agents/memory/memory.jsonl 2 lines / 100 bytes"
b.line[3] len=51 "1 backup · 2 archived sessions · errors.log 0 lines"
b.line[4] len=62 "no last-pass result (consolidation outcomes are not persisted)"
[CHECK 2f-warning] PASS — (b) renders the Warning line
[CHECK 2g-cut] PASS — (b) contains 'this read is cut'
[CHECK 2h-refused] PASS — (b) contains 'read-capped-refused'
[CHECK 2i-no-note] PASS — (b) does not render the Note
[CHECK 2j-differ] PASS — the same document renders differently under the two counts — the marker alone is not the discriminator
NEGATIVE CONTROL: a renderer keyed on isMemoryTruncated alone would emit the Warning in case (a) and fail 2c/2d.
--- (c) control: no marker + 0 (len 346) ---
[CHECK 2k-control] PASS — (c) neither marker nor cap drop renders no Note/Warning at all
--- (d) control: no marker + cappedDroppedChars:9621 (len 593) ---
[CHECK 2o-count-alone] PASS — (d) the cap count alone produces the Warning, with no marker in the document — the two states are independent

=== ITEM 2 (repo lib parity) ===
[CHECK 2l-repo-parity] PASS — repo lib renders byte-identical two-state receipts

=== ITEM 2 (source-line conditional, crafted: source differs from journal) ===
d.line[0] "Memory: 37/52000 chars (0%) · sections unparseable (not a plain four-section bullet document — entry counts withheld, not reported as 0)"
d.line[1] "source /mnt/Data/Projects/dsh-project-context/.agents/memory/MEMORY.md"
d.line[2] "journal /mnt/Data/Projects/dsh-project-context/.agents/memory/memory.jsonl 2 lines / 100 bytes"
d.line[3] "1 backup · 2 archived sessions · errors.log 0 lines"
d.line[4] "no last-pass result (consolidation outcomes are not persisted)"
[CHECK 2m-source-present] PASS — a source line appears when source !== journal path
[CHECK 2n-source-absent] PASS — no source line when source === journal path (the journal line already names the file)

=== ITEM 3: retry wiring, behavioural (installed copy) ===
[CHECK 3a-memory-declares] PASS — installed lib/project-memory/consolidate.js contains `extraCodes: ["MALFORMED_RESPONSE"]` verbatim
[CHECK 3b-autolearn-silent] PASS — installed lib/project-autolearn/pass.js mentions neither extraCodes nor MALFORMED_RESPONSE (0 / 0)
REQUEST_SHAPE_CODES: const REQUEST_SHAPE_CODES = new Set(["INVALID_REQUEST", "HTTP_400", "HTTP_413"]);
[CHECK 3c-allowlist] PASS — the shared allowlist is exactly INVALID_REQUEST / HTTP_400 / HTTP_413 (untouched, no MALFORMED_RESPONSE)
[CHECK 3d-log-line] PASS — the retry log line exists verbatim in the memory pass (and not in the shared module, which owns no log)
memory policy (extraCodes MALFORMED_RESPONSE): {"outcome":"retried-ok","seen":[true,false],"retried":["MALFORMED_RESPONSE"],"state":{"toolsAttempted":true,"toolsDisabled":true}}
[CHECK 3e-memory-retries] PASS — a MALFORMED_RESPONSE first call is retried exactly once, without tools, and onRetry fires once
autolearn policy (no options): {"error":"MALFORMED_RESPONSE","seen":[true],"retried":[],"state":{"toolsAttempted":true}}
[CHECK 3f-autolearn-no-retry] PASS — the same failure with no extraCodes throws immediately — the retry is opted into per caller, not global
shared-set control (INVALID_REQUEST, no options): {"outcome":"retried-ok","seen":[true,false],"retried":[],"state":{"toolsAttempted":true,"toolsDisabled":true}}
[CHECK 3g-shape-control] PASS — INVALID_REQUEST still spends the retry with no extraCodes — the shared request-shape set is intact
no-tools-offered control: {"error":"MALFORMED_RESPONSE","seen":[false],"retried":[],"state":{}}
[CHECK 3h-no-tools] PASS — with no tools offered there is nothing to fall back from, so no retry even with extraCodes

=== SUMMARY: ALL CHECKS PASS ===
```

The same run against the repository `lib/` is folded into the output above as the `*-repo-parity`
checks: the repo renderer produces byte-identical receipts for the same facts, so the verdict holds
for both trees.

### What would have made each item FAIL

- **Item 1** — line 1 not matching `Memory: <len>/<cap> chars (<pct>%) · <4 section counts>`; the
  printed length disagreeing with the loaded document length; a `source` line on the live receipt
  (where `source === journal`) or its absence when they differ; any line reaching the old single-line
  length.
- **Item 2** — case (a) emitting `Warning:`, `this read is cut` or `read-capped-refused`; case (b)
  emitting `Note:` instead of the `Warning:`; the two cases rendering identically. The regression the
  review caught would fail `2c`/`2d` exactly, because the pre-fix condition was
  `isMemoryTruncated(document) || cappedDroppedChars > 0`.
- **Item 3** — `extraCodes` absent from the memory call site, present in autolearn, `MALFORMED_RESPONSE`
  inside `REQUEST_SHAPE_CODES`, or the executed policy retrying (or not retrying) contrary to the
  wiring.
- **Item 4** — an after-restart `MALFORMED_RESPONSE` entry that changes the conclusion, or a journal
  tail showing no landed pass. Note the cutoff itself discriminates: the `2026-11-20T03:03:06.278Z`
  dispose-time `cannot get required service "llm"` line is two seconds *before* the restart and is
  correctly excluded; an unanchored grep would have pulled it in.

## Item 1 — receipt layout (live document, installed copy, cap 52000)

`memoryStatusReply(memory, { projectRoot, journal, maxMemoryChars: 52000 })` — the same composition the
`/memory` handler calls, with the cap the desktop profile declares (`grep maxMemoryChars
~/.dsh/profiles/desktop/cordis.patch.yml` → `maxMemoryChars: 52000`; the platform's settings card
rewrites that whole file, so it is cited by key, not by line).

Rendered receipt (5 lines, 356 characters total):

```text
Memory: 51154/52000 chars (98%) · 160 entries (Project 18, Invariants 73, Pitfalls 51, Index 18)
31 bound entries · stale 4: dc5, bde, c79
journal /mnt/Data/Projects/dsh-project-context/.agents/memory/memory.jsonl 6 lines / 311838 bytes
3 backups · 207 archived sessions · errors.log 870 lines
no last-pass result (consolidation outcomes are not persisted)
```

- Line 1 is the measurements form and its printed length (51,154) equals the loaded document length.
- The four-section counts are on line 1; the `stale 4: dc5, bde, c79` line lists three ids for a count
  of four by design (`StalenessFacts.staleIds` is capped at three "for a receipt that must stay short").
- **No `source` line**: `memory.source` is the journal itself, and the journal line already names that
  file. The conditional is proven in both directions with crafted reports (`2m` present when the source
  differs, `2n` absent when it does not) rather than asserted from the live case alone.
- Line lengths are 96 / 41 / 97 / 56 / 62 — max 97. The recorded old single-line form measured
  **416 characters** at Batch V (`CHANGELOG.md:38`). Reconstructing the pre-`ed167f4` single line from
  the same measured facts (old shape = every clause joined by ` · `, led by `Memory: <absolute path>`)
  gives **433** characters today, i.e. the flattened form still exists and is still unmanageable; every
  rendered line is under a quarter of it.
- The document is **51,154 / 52,000 (98 %)**, not the ~49,989 stated in the task: a pass landed at
  `03:07:21Z` after the task was written. The verdict is for the live document; the layout does not
  depend on the size.

## Item 2 — cap two-state (crafted reports)

One 130-character document that carries the truncation marker
`_[memory truncated at 52000 characters: 9621 dropped]_` was rendered twice; only `cappedDroppedChars`
differed. Exact lines:

(a) marker present, `cappedDroppedChars: 0`:

```text
Memory: 130/52000 chars (0%) · 1 entry (Project 1, Invariants 0, Pitfalls 0, Index 0)
Note: MEMORY.md still carries the marker of an earlier cap, but nothing was dropped from this read — the document was rewritten short since; the next consolidation pass rewrites it and clears the marker.
journal /mnt/Data/Projects/dsh-project-context/.agents/memory/memory.jsonl 2 lines / 100 bytes
1 backup · 2 archived sessions · errors.log 0 lines
no last-pass result (consolidation outcomes are not persisted)
```

No `Warning:`, no `this read is cut`, no `read-capped-refused`.

(b) same document, `cappedDroppedChars: 9621`:

```text
Memory: 130/52000 chars (0%) · 1 entry (Project 1, Invariants 0, Pitfalls 0, Index 0)
Warning: MEMORY.md is at the 52000-character cap — this read is cut, so a consolidation pass refuses to rewrite it (status read-capped-refused), and anything appended past the cap is dropped on write; raise maxMemoryChars or shorten the document.
journal /mnt/Data/Projects/dsh-project-context/.agents/memory/memory.jsonl 2 lines / 100 bytes
1 backup · 2 archived sessions · errors.log 0 lines
no last-pass result (consolidation outcomes are not persisted)
```

Both phrases present; no `Note:`. Controls: (c) no marker + `0` renders neither line; (d) no marker +
`9621` renders the `Warning:` — so the two states are independent and the marker is neither necessary
nor sufficient for the warning. The crafted file facts (2 journal lines, 1 backup, 2 archived sessions,
0 error lines) are synthetic so the wording case cannot be confused with the live store.

## Item 3 — retry wiring, positive and negative

Static (installed copy; identical in repo `lib/`, see the sha checks above):

```
$ grep -n "extraCodes\|MALFORMED_RESPONSE" lib/project-memory/consolidate.js
609:                    // other unusable replies, so this knowingly spends the retry on those too.
610:                    extraCodes: ["MALFORMED_RESPONSE"],
614:                        void logError(projectRoot, "memory", `the model's record_memory reply was unusable (${code}); the pass was retried once without tools`).catch(() => undefined);

$ for pat in "extraCodes" "MALFORMED_RESPONSE"; do printf '%-20s consolidate=%s autolearn/pass=%s\n' "$pat" \
    "$(grep -c "$pat" lib/project-memory/consolidate.js)" "$(grep -c "$pat" lib/project-autolearn/pass.js)"; done
extraCodes           consolidate=1 autolearn/pass=0
MALFORMED_RESPONSE   consolidate=1 autolearn/pass=0

$ grep -n "REQUEST_SHAPE_CODES = " lib/shared/model-call.js
206:const REQUEST_SHAPE_CODES = new Set(["INVALID_REQUEST", "HTTP_400", "HTTP_413"]);
```

The autolearn call site passes only three arguments (`lib/project-autolearn/pass.js:137`), so no
`extraCodes` reaches the shared helper from there. The retry log text exists verbatim in the memory
pass and nowhere in the shared module (which owns no log), checked by `3d`.

Executed behaviour (the same built `callWithToolsFallback`, fake caller that throws a coded error on
its first call):

| case | policy | observed |
|---|---|---|
| memory | `extraCodes: ["MALFORMED_RESPONSE"]` | retried once as `[true,false]`, `onRetry("MALFORMED_RESPONSE")` once, `toolsDisabled: true` |
| autolearn | no options | throws `MALFORMED_RESPONSE` after one `[true]` call — no retry |
| control | `INVALID_REQUEST`, no options | retried once `[true,false]` — the shared request-shape set still works |
| control | `MALFORMED_RESPONSE`, but the call never offered tools | throws after one `[false]` call — nothing to fall back from |

So the retry is opted into per caller, the shared allowlist was not widened, and autolearn's policy is
unchanged — proven by execution, not only by reading the source.

## Item 4 — runtime evidence after the restart

Command:

```
$ node .agents/evidence/2026-11-20-post-restart-acceptance/log-analysis.mjs
```

Full, unedited output (`log-analysis.txt`):

```text
errors.log lines: 871; timestamped entries: 290
first entry: 2026-09-17T11:47:36.226Z
last entry:  2026-11-20T03:07:21.518Z

=== entries with a line-leading timestamp >= 2026-11-20T03:03:08Z: 1 ===
--- entry @ 2026-11-20T03:07:21.518Z (2 line(s)) ---
2026-11-20T03:07:21.518Z [memory] memory regression: 1 Invariants/Pitfalls entry(ies) are no longer present, e.g. Tier C counts only structural loss (`sectionDropped` / `droppedItems` / `itemTruncated`), so a pass that regenerates the whole document in condensed wording reports all three as 0 and a clean `updated` while facts vanish; a byte-identical round trip with 0 drops proves structure, never that facts survived — diff backticked tokens per line against the previous document. Candidate design in `docs/memory-rewrite-loss-gate-spec.md`.


=== last 3 entries BEFORE the restart (control) ===
2026-11-20T02:31:19.103Z [memory] memory regression: 1 Invariants/Pitfalls entry(ies) are no longer present, e.g. The `本会话 ¥…` line is third-party `ds
2026-11-20T02:53:57.871Z [memory] Error: plugin model call failed (MALFORMED_RESPONSE): Tool call "record_memory": Expected ',' or ']' after array ele
2026-11-20T03:03:06.278Z [memory] Error: cannot get required service "llm" in inactive context

=== counts among the after-restart entries ===
memory regression: lines      1
MALFORMED_RESPONSE anywhere   0
record_memory unusable retry  0

whole-file counts (any time): memory regression=24, MALFORMED_RESPONSE=5, retry-line=0

=== journal tail: 6 record(s) ===
[0] ts=2026-11-20T02:14:19.927Z op=replace text.length=48560
[1] ts=2026-11-20T02:31:19.094Z op=replace text.length=49547
[2] ts=2026-11-20T02:37:00.887Z op=replace text.length=49797
[3] ts=2026-11-20T02:37:26.291Z op=replace text.length=49810
[4] ts=2026-11-20T02:57:46.742Z op=replace text.length=49989
[5] ts=2026-11-20T03:07:21.514Z op=replace text.length=51154

=== the entry the 03:07 guard reported as no longer present ===
len=432
in previous journal record: true
in newest journal record:   false
backticked tokens in the removed entry: 5; missing from the newest record: 0

=== MEMORY.md on disk ===
chars=51154 bytes=53095 mtime=2026-11-20T03:07:21.516Z
chars === newest journal text.length: true
backups=3 newest=MEMORY.md.memory-backup-2026-11-20T03-07-21-507Z-ecd70afd mtime=2026-11-20T03:07:21.507Z
headroom to the 52000 cap: 846
```

Readings:

- **Exactly one timestamped entry after `2026-11-20T03:03:08Z`:**
  `2026-11-20T03:07:21.518Z [memory] memory regression: 1 Invariants/Pitfalls entry(ies) are no longer present, e.g. …`.
  It is the only entry, so `memory regression:` = 1, `MALFORMED_RESPONSE` = 0, and the retry line = 0 in
  that window. Whole-file counts: 24 `memory regression:` lines, 5 `MALFORMED_RESPONSE` lines (all
  before the restart; the last is `02:53:57.871Z`), and **zero** occurrences of
  `the model's record_memory reply was unusable` anywhere to date.
- **The `MALFORMED_RESPONSE` retry has therefore not been observed in production.** Its wiring is
  proven by execution (item 3), but its activation needs a pass whose `record_memory` reply is
  malformed — nobody can force that. **UNOBSERVABLE** from here. The absence of the log line is
  explained by the window containing no memory-pass failure at all (one entry, and it is the regression
  report), and is not by itself evidence for or against the wiring — the retry line fires for any
  covered failure, not only `MALFORMED_RESPONSE`. What the user must do: nothing specific; let passes
  run until one fails that way, then look for
  `the model's record_memory reply was unusable (MALFORMED_RESPONSE); the pass was retried once without tools`.
- **A pass landed after the restart.** Journal record 5: `2026-11-20T03:07:21.514Z op=replace
  text.length=51154`; `MEMORY.md` on disk is 51,154 characters and is byte-identical to that record
  (`chars === newest journal text.length: true`, full string equality checked separately); the newest
  backup is `MEMORY.md.memory-backup-2026-11-20T03-07-21-507Z-ecd70afd`. So the journal tail answers
  the question directly: yes, a pass has landed since the restart, and it landed through the new code
  (installed tree == repo tree, host started before it).
- **The regression line is a rewording report, not a lost fact.** The reported entry (432 characters)
  is present in journal record 4 and absent from record 5 — which is why the guard fired — but all five
  backticked tokens (`sectionDropped`, `droppedItems`, `itemTruncated`, `updated`,
  `docs/memory-rewrite-loss-gate-spec.md`) and the distinctive plain sentences
  ("regenerates the whole document in condensed wording", "a byte-identical round trip with 0 drops
  proves structure", "diff backticked tokens per line against the previous document") are still in
  record 5. The pass expanded "Candidate design in …" into "§9 of … gates the metric: …". The guard
  compares entry text, so a rewrite reads as a removal. **Not a new defect of this batch; no action
  needed beyond knowing it costs a line whenever an entry is reworded.**

Nothing else in `errors.log` after the restart looks like a defect: the log's last entry is that
regression line, and the only other late line (`2026-11-20T03:03:06.278Z [memory] Error: cannot get
required service "llm" in inactive context`) is the old instance's dispose-time cleanup two seconds
before the restart, explicitly outside the window (see the "last 3 entries before the restart"
control in the output).

## Limitations

- The line-1 percentage is a rounded integer (`98` for 51,154/52,000); that is the renderer's wording,
  not a measurement error.
- The old "416-character single-line form" is a recorded measurement (`CHANGELOG.md:38`) taken with
  fewer facts; the old code is no longer loadable. My 433-character reconstruction uses the old
  clause-joining shape on today's facts and is labelled a reconstruction, not an observation of the old
  build.
- Item 2's reports are crafted DTOs, as the task specified; the rendered wording is the production
  renderer's, the file facts are synthetic.
- Whether the `/memory` *client* card expands these five lines is a client-side question and outside
  this run (no client rebuild was made, no UI was opened).
- The activation of the `MALFORMED_RESPONSE` retry is UNOBSERVABLE until production produces one
  (item 4).

## Files in this directory

- `probe.mjs` — items 1–3 (live receipt, two-state, wiring + executed retry policy).
- `resolve-hook.mjs`, `register.mjs` — resolve the installed copy's `@deepseek-ai/*` side-effect imports
  against the dsh store the host loaded (documented above).
- `log-analysis.mjs` — item 4 (errors.log window, journal tail, regression-entry corroboration).
- `probe-output.txt`, `log-analysis.txt` — the raw outputs embedded above.
- `RESULT.md` — this report.
