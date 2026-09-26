---
name: dsh-artifact-claim-verification
description: "Verify the load-bearing claims in a delegated audit or implementer report, a handoff doc, or a memory entry against the repo and disk before fixing, committing, or repeating them to the user."
---

# Verify claims against the artifact before acting

Use this whenever a teammate's report, a previous session's handoff, or your own MEMORY/CONTEXT states a finding, a cause, a count, a revision, or a necessity claim that changes what you are about to do (fix code, commit, or repeat it to the user). Work from the repo, not from prose: in this project audit-ready reports have repeatedly carried citations that do not resolve and causes that are one branch away from the truth.

## 1. Enumerate and label the load-bearing claims
Before touching code or committing, list every claim that changes your action: file/line/symbol citations, counts, root cause, "the fix is X", "this out-of-scope edit is required", and rebuttals of earlier hypotheses.

## 2. Citations
- `wc -l <file>` first, then `grep -n <symbol> <file>`. Paths and line numbers drift when a module is split: a report cited `src/autolearn.ts:449` while that file is 111 lines (the code lived in `src/shared/autolearn.ts`). A fixer following the citation opens a file that does not contain the code.
- `grep -rn <symbol> src/` for anything the report vouches for. One symbol marked as confirmed had zero hits in the tree.
- Carry symbol names forward, not line numbers; a path/line stale by one refactor is enough to send the next agent to the wrong file.

## 3. Counts
Reproduce the number and state the scan domain. The same question about reachable states yielded 170 / 84 / 12 / 1608 under different domains, and the number in the report matched none of them, so nobody could verify it. Give the mechanism plus a named domain, or omit the number. Do not let a re-derived count from your own domain become the next report's bare number.

## 4. Root cause
Re-derive the failing expression yourself instead of accepting the label. A report blamed a floor that was too high; the failing term was `min(floor, usable - SAFETY_MARGIN_TOKENS)` applying the 4K margin a second time, on a different branch than the one cited. Fixing the named cause would have left the defect in place.
- Check internal arithmetic: a percentage and a baseline that cannot both be true, or a tally that disagrees with its own table, are the same error class as the one already corrected in an earlier round.

## 5. Rebuttals
When a reviewer rebuts a hypothesis, read the cited code and confirm the identity claim yourself (for example, three call sites really do pass the same expression because the `const model = resolveAuxModel(...)` binding is never reassigned before use). Retire the rebutted hypothesis explicitly; do not keep it in circulation or act on it later.

## 6. Necessity and scope claims
- If a report says an extra edit is required, test it: copy the edits aside, revert them, rebuild, and observe exactly which test turns red. Restore them byte-identically afterwards, then confirm the suite is green again. If exactly the expected test fails, the necessity claim holds.
- If a report deviates from upstream to satisfy a stated contract, verify against the contract, not against upstream's code: sweep the parameter space (every limit x padding combination) and show the contract holds. Upstream violating the contract makes it a justified deviation; record it as one instead of as scope creep.

## 7. Confidence boundaries
Keep the report's own limits. Source plus types plus a probe agreeing is not an end-to-end run; if the reviewer states it never ran the real boot path, do not upgrade that to verified end-to-end when you summarize it.

## 8. Handoff docs, memory, and revision ids
The same rule applies to your own records. Re-derive before continuing: `git rev-parse HEAD origin/main` and the unpushed count; the gate (`pnpm typecheck`, the `pnpm test` pass/fail counts, `pnpm build` output, and the marker count in `lib/`); the loaded memory size via the plugin API (edits made with the edit tool bypass the write path and make the recorded size stale); and any claimed gap against the filesystem (an index/directory mismatch can be the archive working as designed, not a gap). Revision hashes written into memory go stale on the next docs-only commit, so re-derive them instead of copying them forward.

## 9. Write down only what survives
Commit the verified finding, and record in MEMORY/CHANGELOG which claim was rebutted and which number was replaced, so the next session does not re-derive it. A report whose metadata is wrong must not be cited as-is.
