---
name: dsh-structural-batch-spec-round
description: "Run the fact-first diagnosis-to-spec round when the user reports several structural defects in dsh-project-context (index completeness/schema, memory layering and expiry, handoff friction) and wants analysis before code: verify each claim in the real source with file:line, re-verify reads that came back empty, correct your own earlier counts, challenge false premises, land the diagnosis and the batch split in docs/batch-*-spec.md, then hold a numbered ruling round before any src/ edit."
---

<!-- autolearn-generated: this skill may be superseded by a later autolearn pass -->

# Structural batch spec round (dsh-project-context)

Use when the user opens a round with several structural complaints (session index incomplete, stale memory interfering, no purge channel, several tasks per project, schema too coarse, handoff friction) plus "analyse, and look at the other machine". The deliverable of this round is a spec document and a decision round — **not** code.

## 1. Establish disk facts first
- `git rev-parse HEAD origin/main`, `git status --short`, `ls -d .agents/memory/session-logs/*/ | wc -l`.
- Report real state: an unpushed commit, a dirty `MEMORY.md`/`CONTEXT.md`, or a leftover `?? .agents/skills/<name>/` from an earlier session is a fact to state, not noise to hide.

## 2. Ground every claim in the implementation
- Read the code, quote `file:line`: e.g. `MAX_INDEX_LINES`, `entryLines()`, `LINE_PATTERN` in `src/project-context/session-index.ts`; `sectionsFromMarkdown` in `src/project-memory/sections.ts`; the autolearn window `MAX_INDEX_ENTRIES` in `src/project-autolearn/pass.ts`.
- Never diagnose from README prose, from project memory, or from a previous turn's summary.
- Find the only consumers of a surface before declaring it useless (the 200-line index cap protects nothing because the sole reader takes the newest 50).

## 3. Re-verify any read that came back empty or missing
- Nix store paths rotate and can be GC'd mid-session; re-list `ls -d /nix/store/*-dsh-desktop-*/lib/dsh-desktop/repo/packages` and retry before concluding a package lacks an API (`ctx.skills.register`, `todo_write`).
- A missing path in one turn is a transient read, not evidence of absence.

## 4. Correct your own earlier counts
- Recount session directories by parsing each `INDEX.md` bullet's link target and diffing against the directory list. Never count with a `session-*` glob: some directories do not start with `session-`, so the glob under-reports.
- A dangling/stranded finding is your measurement error until the link-target comparison says otherwise.

## 5. Challenge a premise that the source contradicts
- Say it plainly before accepting the problem as given (the short-term/long-term memory layers already exist; the real gap is promotion and retirement rules; the todo store already exists as `todo/write` snapshots, so do not build a second one).
- Then answer each numbered complaint with evidence and a recommendation.

## 6. Land the diagnosis as a spec
- Write into `docs/batch-<letter>-*-spec.md`: the problems, the evidence, root causes, the proposed batch split, and the open user decisions. Keep the split canonical **in the spec**; the memory entry carries only a pointer to it.
- Answer a follow-up round in a new section (e.g. §10) instead of rewriting earlier sections.

## 7. Keep the memory document under cap
- After editing `.agents/memory/MEMORY.md`, re-measure occupancy with the offline probe `share-fit.mjs` under `.agents/evidence/2026-10-05-memory-share-fix-offline-verify/`, against the profile's configured `maxMemoryChars` (not the library default).
- If the new bullet pushes the document past ~95%, compress it to a pointer and report the remaining headroom, warning that the next `/memory update` may hit `lossy-refused`.
- Fix any bullet that now contradicts the fresh split (stale batch lettering) in the same commit.

## 8. Commit and push docs-only
- English Conventional Commits (`docs(spec): …`, `docs(memory): …`), push, and verify local HEAD equals the remote ref.
- Because the round is docs-only no host restart is involved; say so.

## 9. Hold the ruling round
- Numbered questions, each with options and one recommended answer, worded so "yes" accepts the recommendation; state the reason for each recommendation.
- Explicitly state that no `src/` change has been made and that nothing unanswered will be guessed into code.
- Reconcile contradictory answers before asking further ("delete immediately" and "delete after 90 retired days" cannot both hold) and propose the resolution that satisfies both intents.
- Keep the frontier rule: a question whose answer depends on another still open question belongs to a later round.

## 10. Do not let conclusions depend on session survival
- Persist the round's conclusions into `CONTEXT.md` (and the spec), because auto handoff may skip with nothing-to-drop when the recent window already covers the session; a host-injected handoff banner is not user input.
