---
name: dsh-doc-claim-closure-review
description: "Run a closure review and mechanical residual check after correcting false or volatile claims in dsh-project-context tracked docs/memory, replacing hard-coded counts, byte sizes, hashes, and anchors with read-now commands."
---

Use after a review-driven fix batch that edited tracked documentation or memory: `.agents/memory/MEMORY.md`, `.agents/memory/CONTEXT.md`, `CHANGELOG.md`, or `.agents/skills/**/SKILL.md`. The goal is to catch new false assertions introduced by the fixes and to stop volatile facts from being written back into the tracked tree.

1. Start an independent closure review.
   - Use a separate read-only reviewer/agent.
   - Scope it to the delta since the previous review, not the whole repo.
   - Ask only: do the fixes introduce new false assertions, stale claims, or self-contradicting statements?
   - The reviewer must not edit files.

2. Reproduce every finding before accepting or rejecting it.
   - Do not edit code or docs from review prose.
   - Use commands that show the current disk/repo state, e.g.:
     - `git grep -nF '<string>' -- .` or `git grep -oF '<string>' -- .`
     - `git log -1 --format=%cI -- src/` and `git log -1 --oneline -- src/`
     - `git rev-parse HEAD origin/main`
     - `ls -d .agents/skills/*/` compared with `git ls-files '.agents/skills/**/SKILL.md'`
     - plugin API: `loadMemory(root, 32000)` plus `isMemoryTruncated(loaded.text)`; do not grep for the truncation marker.
   - If the finding is false, record why and move on.

3. Fix by replacing volatile facts with live-check commands.
   - Never write a hard-coded hit count, byte size, HEAD hash, tag name, anchor number, or zero-hit claim into tracked docs/memory.
   - Instead write the command to read it: e.g. `git grep -oF DSH_PROFILES_ROOT -- .` or use `loadMemory(root, 32000)` and check `truncated`.
   - For claims about a revision, write the command (`git log -1 -- src/`), not the hash.
   - For counts of tracked skills, write the comparison command, not the number.

4. Edit long memory/doc lines safely.
   - Do not use prefix-based replace scripts; they can leave a duplicated half-sentence.
   - Use whole-line replacement with an inline anchor assertion.
   - After editing, read back the line and check that the same sentence does not appear twice.
   - If parentheses were inserted or removed, verify they balance.

5. Run a mechanical residual check.
   - Grep for the exact strings from the previous false claims (old counts, stale anchors, removed claims) and assert they are 0.
   - Confirm the new live-check commands are present where intended.
   - Check for duplicated sentences and unbalanced parentheses on changed long lines.
   - Use the same command style as the closure reviewer so the check is reproducible.

6. Verify project invariants without relying on remembered numbers.
   - Baseline: `git log -1 -- src/` and `git log -1 --format=%cI -- src/`.
   - Memory: `loadMemory(root, 32000)`; check `truncated`, `damaged`, `poisoned`.
   - Tracked skills: compare `ls -d .agents/skills/*/` with `git ls-files '.agents/skills/**/SKILL.md'`.
   - Gate: `pnpm typecheck`, `pnpm build`, `pnpm test` (or per project script).
   - Do not cite old test counts or byte sizes as fixed values.

7. Commit and verify.
   - Stage only the doc/memory paths changed for this task: `git add <paths>`.
   - Commit with `git commit -F <msg> -- <paths>` (options before `--`).
   - Push, then verify `git rev-parse HEAD origin/main` and `git status --short`.
   - If the fix touched only docs/memory, do not restart the desktop host.

Traps:
- A sentence that lists the strings it claims are absent is self-contradicting; do not write zero hits and then list them.
- A second writer may be editing MEMORY.md/CONTEXT.md/CHANGELOG.md concurrently; scoped add/commit only.
- A closure review can find new false assertions introduced by the fixes; that is the point, not a failure of the review.
- Do not fix a false claim by writing another hard-coded count; that restarts the cycle.
