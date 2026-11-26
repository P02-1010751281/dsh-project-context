---
name: dsh-batch-residual-closure
description: "Close out a dsh-project-context plugin batch's named residuals (or a landed spec half) end to end: implement in the pure core, add a denominator to the receipt, run the new command against this machine's real .agents/memory store before claiming it works, kill 4-6 mutants with named tests, rebuild lib/, update spec + CHANGELOG 未发布, commit per residual, push, and hand the restart-gated checks to the user with the exact command order."
derived_from: autolearn
evidence: ["session-e841bd7b-486f-4b35-8298-05273505e4df", "session-ce640169-d28b-4f8a-b480-d3d7d0466630"]
---

<!-- autolearn-generated: this skill may be superseded by a later autolearn pass -->

# Batch residual closure (dsh-project-context)

Use when a spec batch has landed and its last section / `CHANGELOG.md` 未发布 names remaining residuals ("残余"), or when a read-only state core needs its next state. Not for reviewing new designs, not for the post-restart acceptance audit (that is `dsh-batch-landing-acceptance-audit`).

## 1. Establish the real residual list

- Read the spec's closure section (e.g. `docs/batch-aa-state-machines-spec.md` §8/§9) and the 未发布 body of `CHANGELOG.md`. Only what those name is in scope.
- Re-derive every count by reading now (`wc -m .agents/memory/MEMORY.md`, `git rev-parse HEAD origin/main`, `ls -d .agents/skills/*/`). Never copy a number out of prose; the memory file's size and the skill inventory both move.
- Note which residual is a design boundary rather than work (e.g. hand-written skills stay read-only; `confirmed` is a local sidecar) and say so instead of implementing it.

## 2. Implement in the owner module

- Pure decision core owns the vocabulary and takes plain facts, no I/O: `src/project-memory/entry-state.ts`, `src/project-context/session-state.ts`, `src/project-autolearn/skill-state.ts`. The disk half lives in the matching `*-source.ts` (`session-state-source.ts`, `skill-state-source.ts`, `staleness-source.ts`, `expiry-source.ts`).
- Aggregation/counting that both the receipt and the writers read goes in a module extracted to avoid cycles (`entry-states.ts`).
- Reuse existing shared lexica instead of re-deriving: `src/shared/anchors.ts` (`anchorCandidates`, `isLocalArtifact`), `src/shared/config.ts`, `humanUserText` / `isHandoffContinuationText` for turn counting.
- Receipts must carry a denominator (`N of M skill(s) (K hand-written, not managed)`), payload on line 1 (see `dsh-command-receipt-render-verify`).

## 3. Regression tests in the matching suite

- Suites: `test/session-state.test.mjs`, `test/skill-state.test.mjs`, `test/logic.test.mjs`, `test/prompt-bounds.test.mjs`, `test/settings-form.test.mjs`.
- Fixtures must use real shapes: hex entry ids (`entryTid` only accepts `[0-9a-f]{3,4}`), mtimes written old enough against the injected clock (otherwise `live` instead of `stale`), and the aliasing case the real store produces (see step 4).
- Run the package script, not bare node: `pnpm test` (`tsc && node --test`). Non-TTY TAP is off; judge on exit code.

## 4. Smoke-run the new command against the real store before claiming it works

This is the step that earns the batch. Run the freshly built command over the machine's actual data and treat any exception on a real record as a defect, never as data noise:

- `/session-log status` over `.agents/memory/session-logs/` (re-derive the counts rather than quoting them: `ls -d .agents/memory/session-logs/*/ | wc -l`; 226 directories on 2026-11-26, and a handoff child with **no** `session.jsonl` at all exists there).
- `/autolearn status` then `/autolearn bind` over `.agents/memory/skill-bindings.json` and `~/.agents/skills`.
- `/memory reconcile` over `src/project-memory/index.ts` + `.agents/memory/entries.json`.
- `.agents/memory/errors.log` for the lines the run wrote.

If the run throws (ENOENT, dangling, misclassified state), that is the primary deliverable: fix the guard, add a fixture built from the real record's shape, and re-run until the receipt prints clean. Skip `bind` / `expire` when the user's judgement is required — say so.

## 5. Mutation round

Follow `dsh-plugin-mutation-round`. 4-6 mutants, `src/` only, each must compile and be killed by a named test: never judge a mutant, judge an unmeasured record as measured, remove a guard, collapse a new state back into the old one, let a denominator go constant 0, drop the state from the priority order. Restore `src/` from a hash-verified `/tmp` copy, then `pnpm build` to zero markers (`lib/` is tracked).

## 6. Bookkeeping and push

- Update the spec's 落地状态 section with commit hashes and the live readings, and add a 未发布 line to `CHANGELOG.md`.
- `pnpm typecheck` (both `tsc --noEmit` and `tsc -p tsconfig.client.json --noEmit`), `pnpm test`, `pnpm build`, then `git add <explicit paths>` per residual and `git commit -F <msg> -- <paths>` (another agent session may share the tree; never `add -A`).
- Push to `main`; report `git rev-parse HEAD` after.

## 7. Hand the restart-gated part to the user

The resident desktop/web host runs a pinned build, so the new code is live only after the user restarts `dsh-desktop-restart.sh` (never run it from a dsh session). Give the exact order and the expected first readings, e.g.:

```
/session-log status   # N healthy, K abandoned
/autolearn status     # managed of total, unbaselined
/autolearn bind       # records the current bodies as the baseline
/memory reconcile     # N of M entries to re-verify
```

State plainly which numbers are predictions from the dev-tree run and that a baseline recorded now cannot detect drift that already existed.
