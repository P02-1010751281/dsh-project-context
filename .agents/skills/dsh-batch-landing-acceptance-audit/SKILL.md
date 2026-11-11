---
name: dsh-batch-landing-acceptance-audit
description: "Use after a batch of dsh-project-context changes was committed and the host restarted: prove the batch is live with independent criteria, re-measure the archive invariants it touched, and split every remaining check into agent-verifiable, test-pinned, or user-must-run."
---

<!-- autolearn-generated: this skill may be superseded by a later autolearn pass -->

# Batch landing acceptance audit (dsh-project-context)

Use when a multi-feature batch (Z-style: several `src/` commits) has been committed and the user has restarted the dsh host, and the question is "is this batch actually live, and what is left to accept?". Read-only by default: this pass changes no code.

## 1. Pin the facts read-now, never from memory or CONTEXT.md

```bash
git rev-parse HEAD origin/main
git status --short
git log -1 --format='%H %ci' -- src/      # last src/ commit = the criterion baseline
```

Any hash, count, byte size or occupancy number quoted from memory/context is stale until re-measured; quote the command output.

## 2. Liveness criterion A - the process serving the session

Find the dsh host process holding the session (socket holder / the pid behind `dsh --version`'s store) and read its start time (`ps -o pid,lstart= -p <pid>` or `/proc/<pid>/stat`). The host start must be **later** than the last `src/` commit time. Both directions must be checked: a host started before the last commit has not loaded the batch.

## 3. Liveness criterion B - built artifacts match source

`lib/**` is tracked, so a landed batch carries its rebuild. Prove it:

```bash
pnpm exec tsc -p . --outDir /tmp/libcheck
diff -r /tmp/libcheck lib
```

`lib/client.js` is the only expected extra - it is the esbuild client bundle, not a tsc artifact. Any other diff means the tracked `lib/` is stale against `src/`.

## 4. Host self-report

- `--verify-only` probe (restart script / acceptance script) -> expect `RESULT: PASS`, enabled-but-not-active = 0, wrapper matching the current store.
- cordis `Config` query: the plugin entry exists with `status: schema`, i.e. `apply()` succeeded (a throw loses the card while the other plugins silently fall back to `DEFAULT_CONFIG`).
- No new `crash-*-host.log` dated today, and `.agents/memory/errors.log` unchanged since before the restart.

## 5. Feature markers in the built output

Grep each landed symbol in `lib/` by its assignment form:

```bash
grep -n "<SYMBOL> = " lib/...
```

`tsc` emits tagged templates as `String.raw` + the template with a space, so `grep -cF` for an in-template marker returns 0 and looks like a failed load. One marker per feature in the batch, listed explicitly in the report.

## 6. Archive invariants the batch touched

- Count directories **containing `meta.json`** and compare with `INDEX.md` row count; never glob `session-*`, which undercounts.
- Verify no dangling index rows by parsing each bullet's link target, never by matching an id anywhere in the line (a session title can quote another id).
- 0 empty session directories, unless a batch added one deliberately - after an abandoned-handoff cleanup, a remaining empty dir is pre-existing history, not the fix's evidence.
- Read bindings (e.g. `kind`/`parentId`/`task`) from the session's own `meta.json`; confirm the parent sits in `workspace.json`'s archived set when a handoff retired it.
- Render real data through the loaded `lib/` (offline probe over `lib/`) and record the numbers (sessions / roots / handoff continuations) plus the parent chain.

## 7. Split every remaining check into three buckets

1. **Agent-verifiable** - anything already done above.
2. **Test-pinned only** - branches whose trigger cannot be produced on a healthy route (a dead provider/model pair, a handoff that fails mid-way). State plainly that the current clean invariant is not the trigger's evidence and name the suite that pins it.
3. **User-must-run** - slash commands (`/session-log tree`, `/memory update`, `/handoff now`) and the desktop restart script: the agent has no channel to drive the session UI. Hand over the exact command and the expected first lines verbatim.

Also call out negative controls: an absent field whose presence was never requested (e.g. no `task` in an unbound session's meta) is correct behaviour, not a defect - say so before the user reads it as a bug.

## 8. Close out

Persist the result into `CONTEXT.md` (key points + an open-tasks entry per user-side command, with the fresh numbers and the exact expected output). Do not restart the host, do not touch the user's sessions, and never report the batch as fully accepted while a bucket-3 item is outstanding.
