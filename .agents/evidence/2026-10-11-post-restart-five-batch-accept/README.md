# Post-restart acceptance — the five batches one restart certified (2026-10-11)

Read-only round run by the successor session of `55cee6d8` after the user restarted the desktop at
**15:21**, certifying batches **N / O / Q / R / Q2** (all of which changed `src/project-memory/`).
Re-run it instead of quoting this file:

```
bash .agents/evidence/2026-10-11-post-restart-five-batch-accept/verify.sh          # exit 0 = PASS
CHECK_ARGS='--port 19999' bash .agents/evidence/2026-10-11-post-restart-five-batch-accept/verify.sh
                                                                                   # NEGATIVE control: exit 1
```

The negative control was exercised, not asserted: with nothing listening on the probe's port the
script prints `FAIL check.mjs exit 2` and ends `RESULT: FAIL` with exit 1.

## What was read (2026-10-11 ~15:30 +08:00)

| fact | value | how |
| --- | --- | --- |
| 19387 holder | pid **4887**, started **15:21:26** local | `ss -ltnp` + `ps -o etimes=` |
| last `src/` commit | `9edd119` @ **13:10:24 +08:00** (batch Q2) | `git log -1 --format=%cI -- src/` |
| verdict | **POSITIVE** — the whole tree is live; margin 7862 s | `check.mjs` (exit 0) |
| `lib/` | `git diff --exit-code -- lib` clean, and identical to a fresh `node_modules/.bin/tsc --outDir $TMP` (`lib/client.js` the only extra) | second half of the criterion |
| restart target | running store **is** the wrapper store `pi1d7928…-dsh-desktop-0.2.0-rc.2` (electron 3960, host 4887) | `check.mjs` §4, restart script `--verify-only` |
| our plugin | `include:project-context` `active`, `enabled`; `enabled 但非 active: 0` | `dsh-live-inventory-probe.mjs --expect dsh-project-context --expect store off` |
| `dsh --version` | `0.2.0-rc.2` | read fresh |
| client bundle | `lib/client.js` unchanged since `0016119` (2026-10-06) | no hard reload is required by this restart |

The holder's start reads 15:21:24 (`ps -o lstart=`), 15:21:25 (the retitle probe's own `etimes` read)
and 15:21:26 (`check.mjs`) — a ±2 s skew between three second-resolution readings, irrelevant against
the 7862 s margin, and any of them beats the 13:10:24 `src/` commit.

Per-batch attribution against the 15:21:26 holder — `check.mjs` prints this for every recent `src/`
commit: `9edd119` (Q2), `ee2e3b9` (R), `1b18799` (Q), `d405708` (O) and `a3977c9` / `2462d59` (N) are
all **IN the holder (live)**. This is the strongest reading the repo's criterion can give, and it is
whole-tree: it certifies that the five write-path batches are loaded, not that any of them has been
exercised.

## The behavioural half, and what it can and cannot witness

The new holder demonstrably executes this repo's `lib/`: `.agents/evidence/2026-10-07-handoff-retitle-accept/retitle-accept.mjs`
printed `RESULT: PASS — 3 continuation(s) re-titled after their own first input`, among them **this
session** (`b2a9894b`, parent `55cee6d8`), whose title moved from the bare parent id to
`↪ handoff · 已重启` when the user's `已重启` arrived at 15:30:03.

That witness belongs to the **handoff** module. Batches N/O/Q/R/Q2 live in `src/project-memory/`,
and none of them has a triggerable online surface — they need a real consolidation reply (a partial
document, a lossy render, a truncation that spends the retry headroom), which only `/memory update`
produces. So the acceptance chain is: criterion + `lib/` identity (checks 1-2) prove the loaded code,
and check 4 re-runs the Q2 guard probe and the share-fit probe **against that same `lib/`** to pin
what the loaded code does. It does **not** prove the memory write path has run in the live host.

## Finding — `dsh-desktop-restart.sh --verify-only` still prints FAIL, for the outside-instance reason

Its own probe now sees **two** live stores: the wrapper store `pi1d7928…` (electron 3960 / host 4887,
our 19387) and `baaadm430…-dsh-desktop-0.2.1-alpha.2` (electron 7474 / host 8566) — DSH-AV's own
deployment, which loads none of our plugins. This is the pre-restart-documented condition, not a
defect of this restart: our instance did move onto the wrapper store. Accept through the criterion
above (or `--dsh-live-inventory-probe --expect dsh-project-context --expect store off`), which is
what `check.mjs` and this script do. That instance is transient: electron 7474 started 15:30:47 and
host 8566 at 15:30:52, i.e. **after** the 15:30:2x reading that saw only one store — never infer its
presence from an earlier reading (or its absence from a later one).

## Not witnessed here

- The memory write path has not run since the restart (`errors.log`'s newest line is still
  2026-10-06; no consolidation pass has happened). The next `/memory update` is where the five
  batches would first be exercised end to end.
- `MEMORY.md` / `CONTEXT.md` headroom was re-measured before the restart: `sectionDropped 0`,
  `droppedItems 0`, `itemTruncated 0`, byte-identical round trip, sections at 87.0 / 89.9 / 90.0 /
  88.2 % of their hard budgets — so the pass should not be refused for budget.
