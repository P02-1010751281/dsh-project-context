---
name: pi-upstream-triage-pass
description: "Triage a range of upstream pi-project-context commits against dsh-project-context before porting: pin the revision range, classify each commit as already-in-dsh / pi-only / port-worthy, record the dispositions with reproducible commands, and split real port work into batches."
---

## When
Run a pass when pi's `master` has moved past the revision the last recorded pass ended at (see the pass sections of `docs/upstream-pi-triage.md`), or when the user asks what in pi is worth porting. The pass decides *whether* anything needs to move; the porting mechanics themselves belong to the `pi-to-dsh-feature-port` skill.

## 1. Pin the upstream revision (never from memory)
```
git -C /mnt/Data/Projects/pi-project-context rev-parse HEAD origin/master
git -C /mnt/Data/Projects/pi-project-context log --all --oneline --not master
git -C /mnt/Data/Projects/pi-project-context tag -l --sort=-v:refname | head -1
```
- pi's `HEAD` moves: state the revision you read, never a remembered hash, and never write a hash into tracked memory.
- If a tag bounds the range, peel it: `rev-parse <tag>^{commit}`. A tag can point at a commit that is *not* `HEAD`; say which is which rather than pairing the tag with `HEAD`.
- An empty `log --all --not master` is the evidence that the range is complete; if it is not empty, name the other branches.
- Take the lower bound from the last pass section in `docs/upstream-pi-triage.md`, then list the range with `git -C <pi> log --oneline <since>..<HEAD>` and count it.

## 2. Read pi's own record for each commit
Read the commit body plus the docs file that commit touched. pi commit messages often say they are converging on dsh (e.g. `the shape dsh landed`, `porting dsh's already-correct implementation`); treat that as a signal to check our tree, not as a reason to skip reading it.

## 3. Classify against this repo, one commit at a time
For every commit, find the mechanism under its **dsh name** before concluding it needs a port. The default disposition is ALREADY IN DSH.
- Search and read: `git grep -n <symbol-or-phrase> -- src/`, `git grep -c`, then open the named module and confirm the behaviour, not just the symbol.
- Three dispositions: (a) ALREADY IN DSH - name the module/symbol that implements it; (b) PI-ONLY - dsh has no counterpart mechanism (different provider/settings mechanism), so record it as such and do not invent a port; (c) PORT-WORTHY - a behaviour fix dsh lacks, with the target module named.
- A commit message claiming a fix is never evidence that the fix exists here (or landed there): read the diff.
- Any claim about dsh core or pi internals the pass will lean on must be read from upstream source at a stated revision (sparse clone + read), not inferred from our call path.

## 4. Write the pass into the tracked record
Append a new dated section to `docs/upstream-pi-triage.md`; earlier passes are records, so do not rewrite them. Include:
- the revision read (`HEAD == origin/master == <rev>`) and the exact commit range;
- a per-commit table: commit | subject | disposition | where it already lives / where it must land;
- the reproducible commands behind the classification (the `git grep` / `rev-parse` commands a later session can re-run), including any command whose expected result is zero hits;
- the honest boundary: this is a per-module read of the fixes pi touches, not a semantic diff of the two trees, and anything outside this repo (dsh core, the delivery line) is named as not owned here.
If a row or revision turns out wrong after writing, correct it in place and keep the range explicit.

## 5. Split port work into batches and record the decisions
If disposition (c) is non-empty, group it into coherent batches by mechanism (not by commit) and for each batch state the pi reference path, the dsh target module, the user-visible changes (command renames/removals, memory format), and the decisions that need the user's ruling. When a batch is large enough that a half-landed version is worse than none (it changes what MEMORY.md is, or how a reply is produced), write `docs/batch-<x>-port-brief.md` for a fresh session: everything load-bearing stated in the file or reachable from a command in it, with batch status marked not-started.

## 6. Record, commit, verify
- Add one line to `.agents/memory/MEMORY.md`: the conclusion (ported N / ported nothing), where the detail lives (`docs/upstream-pi-triage.md`), and the durable lesson (pi fixes commonly converge on dsh, so compare first; pi's `R3` and dsh's `R3` name different audits - do not cross-reference).
- Verify the memory edit through the plugin API (`loadMemory(root, <the cap read from `src/shared/limits.ts`>)` and `isMemoryTruncated(loaded.text) === false`), never by grepping for a truncation marker.
- A pass that ports nothing still changes `docs/` and memory. Stage only those paths (`git add <paths>`, never `add -A`; another agent session may be editing this repo), commit with a `docs(upstream): ...` Conventional Commit, push, then confirm `git rev-parse HEAD origin/main` and a clean tree.
- Do not add a CHANGELOG entry and do not imply the gate ran for a docs-only pass; say plainly that `src/` was untouched and no host restart is needed.
