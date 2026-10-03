---
name: dsh-plugin-review-fix-batch
description: "Run a review-driven fix batch on the dsh-project-context plugins: adversarial read-only review, independent reproduction of each finding, minimal scoped fix with a mutation-checked regression test, full typecheck/test/build, then per-task commit and push."
---

Use this when a batch of dsh-project-context changes (a fix, a port follow-up, or an audit item) must be independently scrutinized before it is trusted and landed on `main`. It is the repo's established cycle: review -> reproduce -> fix -> mutation-check -> verify -> commit/push -> closure review.

Repo: `/mnt/Data/Projects/dsh-project-context` (plugins: `project-context`, `project-memory`, `project-autolearn`, `project-handoff`). Toolchain: pnpm, `tsc`, `node --test`. If pnpm scripts cannot find node, prepend the node you just verified — after `node -v`, `PATH="$(dirname "$(command -v node)"):$PATH"` — never a pasted store path (recorded ones have gone dead).

1. Freeze the batch scope. List the files actually changed for this task. The batch is one reviewable unit; do not mix unrelated work into it.

2. Launch the adversarial review. Spawn (or request) a subagent whose prompt is explicitly READ-ONLY: do not modify the repo, hunt false claims, untested paths, and invariant violations. Give it the diff plus the project invariants that matter for the change, e.g. plugins must never append a custom session event type (dsh-session rejects unknown types unless `ignorable: true`; write `.agents/memory/` files instead), handoff cuts by message never by turn, only continuable subagents count as outstanding (one-shot never "settles"), per-session state prefers `ownEvents()` (`src/project-handoff/guard.ts` reads `ownEvents?.() ?? session.snapshotEvents()` — so a bare `snapshotEvents()` in `src/project-context/` or `src/shared/conversation.ts` is NOT a violation; say which rule you mean instead of flagging the call), journal fold must fail closed. A reviewer session must never edit files.

3. Reproduce every finding before implementing it. Do not implement from review prose. Verify each claim with a probe: read-only RPC against the port of the host that is actually serving (`ss -ltnp | grep -E '19387|3080'` — desktop vs web; `/tmp/rpc.sh <method> '<json args>' <port>`), Cordis Inspect for host services/slots/RPC contracts, `zstdcat ~/.dsh/sessions/*/*/session.v*.jsonl.zstd` parsed as JSONL for session-log claims, or a throwaway test harness under `/tmp`. Record which findings reproduced and which did not; discard or explicitly rebut the non-reproducing ones.

4. Implement the smallest fix per reproduced finding, inside the module that owns the invariant — the four plugin roots (`src/project-context/`, `src/project-memory/`, `src/project-autolearn/`, `src/project-handoff/`) plus `src/shared/`. Name the file by the symbol it owns (`git grep -n '<symbol>' -- src/`), never by a path remembered from an earlier layout: the old single-file paths (`src/handoff.ts`, `src/learn-state.ts`, `src/memory.ts`) are gone, and a citation to one sends the next agent to a file that does not exist. Keep fixes independent so each can be reviewed and committed separately.

5. Add a regression test for each fix and mutation-check it: temporarily break or revert the production change, confirm the new test fails, restore the fix and confirm it passes. A test that still passes without the fix is not evidence and must be rewritten. For the full validity rules of a mutant (compiles, reaches `lib/`, changes behaviour, `sha256sum -c` restore) use the `dsh-plugin-mutation-round` skill — do not restate them here.

6. Run the full verification set with the Nix node on PATH: `pnpm typecheck`, `pnpm test`, `pnpm build`. All three must pass; report the counts **this run printed** — never a baseline recorded in a skill or a doc (a recorded "132/132" long outlived reality).

7. If any `client/**` file changed, `pnpm build` is mandatory; the bundle is served live via HMR, and already-open tabs need one hard reload. For whether a host-side (`src/**`) change is actually loaded by the running host, use the `dsh-host-build-restart-verify` skill rather than reasoning from timestamps here; never restart the user's running host unprompted — state the required restart in the report and offer it.

8. Commit and push. Stage only explicit paths (`git add <paths>`) - never `git add -A` - because a second agent session is frequently editing this same repo concurrently. Commit messages follow Conventional Commits in English (`fix:`, `docs:`, `chore(release):`). Push to `origin main` (established practice). Keep code fix and its README/doc adjustment as adjacent commits, not one megacommit.

9. Document user-visible consequences where the user will look: README wording for behavior changes and limitations (for example that skipped auto-handoff is only server-logged, with `/handoff status` and `/handoff now` as the user-facing paths). Untracked `.agents/` and `thinking-effort-loaded.json` in this repo are normal; do not "fix" them.

10. Close the loop: request a read-only closure review of the final commit range. If it finds anything, restart at step 3 with the new findings.

Do not write custom session event types, do not touch the user's real sessions, and keep unresolved tasks/open items in project memory or context rather than in this procedure.
