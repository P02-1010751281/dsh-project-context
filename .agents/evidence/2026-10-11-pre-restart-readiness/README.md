# Pre-restart readiness (2026-10-11)

Read-only round run by the successor session of `80392b34`, immediately before handing the user the
desktop restart that makes batches O/Q/R live. Re-run it instead of quoting this file:

```
node .agents/evidence/2026-10-11-pre-restart-readiness/check.mjs      # exit 1 = not loaded yet
```

Exit codes: `0` = the last `src/` commit is live and `lib/` is clean, `1` = nothing new is live (the
expected pre-restart reading), `2` = indeterminate (not the repo root, or nothing listening on the
port — reachable with `--port 19999`).

## What was read (2026-10-11 ~12:00 +08:00)

| fact | value | how |
| --- | --- | --- |
| 19387 holder | pid 341488, started **10:44:22** local | `ss -ltnp` + `ps -o etimes=` |
| last `src/` commit | `ee2e3b9` @ **11:54:13 +08:00** | `git log -1 --format=%cI -- src/` |
| `lib/` | `git diff --exit-code -- lib` clean; identical to a fresh `node_modules/.bin/tsc --outDir $TMP` | second half of the criterion |
| HEAD | `1bc5cfa` == `origin/main`, worktree clean | `git rev-parse HEAD origin/main` |
| our plugin | `include:project-context` `fiberPhase=active` | `dsh-live-inventory-probe.mjs --expect dsh-project-context --expect-store off` |

## Finding 1 — the whole-tree criterion is negative, but it cannot name a batch

The criterion the repo uses ("holder started after the last `src/` commit") answers *is everything
new live*, not *which batch is live*. Attributed per batch against the 10:44:22 holder:

- **batch N is already live** — `2462d59` (08:34) and `a3977c9` (08:54); both commits carried rebuilt
  `lib/project-memory/*`, and the tree stayed at that state (next `src/` commit 10:51) until the
  10:44 boot. `check.mjs` prints this attribution for every recent `src/` commit.
- **batch O (`d405708` 10:51), batch Q (`1b18799` 11:22) and batch R (`ee2e3b9` 11:54) are not live.**

A previous turn wrote "N/O/Q/R four batches all offline"; that is an over-claim of the whole-tree
verdict and is corrected in `CONTEXT.md`. Nothing about the restart changes: it certifies all four
at once, and it is the only way to be certain about N given the next finding.

## Finding 2 — a boot attempt 3 s earlier recorded `dsh-project-context: import failed`

`~/.config/@deepseek-ai/dsh-desktop/logs/crash-2026-10-11T02-44-17-932Z-web-boot.log` (shell pid
315409) ends with `Error: web boot: 1 entry did not activate / dsh-project-context: import failed`.
The surviving app is a *different* process pair — shell 341345 (10:44:20) and host 341488 (10:44:21)
— and its `include:project-context` is `active` with the plugin's injected documents in this session.
So that log is a failed first attempt that was retried, **not** the running state; read the newest
`crash-*-web-boot.log` after the next restart before concluding anything from a boot error.

## Finding 3 — the restart target is a different store than the running one

`~/.nix-profile/bin/dsh-desktop` resolves to `pi1d7928…-dsh-desktop-0.2.0-rc.2`, while the live
instance runs `cl7chjvxjw…-dsh-desktop-0.2.0-rc.2` (the launcher-cache trap the restart script exists
to undo). The two stores are the same dsh build:

- identical file inventories under `lib/dsh-desktop` (33 613 files each, `diff` of the path lists
  empty) and identical `package.json` / `apps/desktop/package.json` / `repo/package.json` hashes;
- `diff -rq -x node_modules` reports **20** differing files, all bundled Python `.so` binaries;
- the store *references* differ in Electron: `pi1d79…` pairs with electron 44.5.1, `cl7chj…` with
  44.3.0 (the running process confirms `electron-unwrapped-44.3.0`).

So the restart changes the store and the Electron runtime, not the dsh core version — the plugin's
peer line is not affected.

## Finding 4 — `--verify-only` will keep printing FAIL, and does not check our plugin

`scripts/dsh-live-inventory-probe.mjs` fails whenever **more than one** store has live desktop
processes. The DSH-AV `.dsh-sec` desktop (store `baaadm…-dsh-desktop-0.2.1-alpha.2`, port 19388) is
alive on purpose and loads none of our plugins, so `bash /etc/nixos/scripts/dsh-desktop-restart.sh
--verify-only` prints `RESULT: FAIL` today *and will print FAIL after a correct restart*. Its
`EXPECT` list is the five experimental entries (computer-use / browser-use / subagent-codex) — it
never looked at `dsh-project-context`. Accept either through `check.mjs` above, or through
`node /etc/nixos/scripts/dsh-live-inventory-probe.mjs --expect dsh-project-context --expect-store off`
(which passes now and needs no restart).

## What only the restart can prove

1. batches O/Q/R are live — `check.mjs` must flip to exit `0` (holder start later than `ee2e3b9`);
2. the store switch to `pi1d79…` completes without a peer/boot failure, and `fiberPhase=active`
   survives on the new store;
3. batch N's attribution above (if the restart is skipped, this file's Finding 1 stands as the
   reading, and only N may be treated as live).

## Post-restart acceptance

```
ss -ltnp | grep 19387                      # new holder pid
ps -o lstart= -p <pid>                     # must be later than 2026-10-11T11:54:13+08:00
git diff --exit-code -- lib                # must be empty
node .agents/evidence/2026-10-11-pre-restart-readiness/check.mjs   # must exit 0
```

Then the user-only follow-ups: `/memory update`, and a release when one is due.
