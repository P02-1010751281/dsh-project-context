# Batch D port brief — autolearn may supersede a skill it generated

**Status: ruled 2026-10-05, not started.** Decided to be portable by the fourth pi triage pass
(`docs/upstream-pi-triage.md` §"Fourth pass", commit `2d562ce` of the range `6707376..f6bea1d`). Nothing
here is implemented; this file states everything a fresh session needs, and every claim in it is either a
pi path at a stated revision or a read-now command.

## 1. Why

Today this repo's pipeline can only **add** skills: `rejectionReason` refuses any name that already
exists (`src/project-autolearn/candidate.ts`, `if (existing.has(skill.name)) return ... already exists`),
so a learned skill that later turns stale or wrong can only be corrected by hand, and a proposal that
covers the same ground is thrown away as a near-duplicate. pi recorded "updating or merging an existing
skill" as an explicit non-goal for exactly one reason: it could not tell **its own output** from a
hand-written or imported skill. `2d562ce` removes that reason by putting the provenance in the artifact.

## 2. What pi does — read at `f6bea1d`

```sh
P=/mnt/Data/Projects/pi-project-context          # working tree is 6707376; read origin/master
git -C $P show f6bea1d:extensions/project-context/autolearn/skill.ts
git -C $P show 2d562ce                            # the whole change, tests included
```

1. **The marker lives in the body**, not the frontmatter (pi injects only name/description/path at
   session start, and unknown frontmatter keys are undefined behaviour):
   `const PROVENANCE_COMMENT = "<!-- autolearn-generated: this skill may be superseded by a later autolearn pass -->"`,
   matched by `/<!--\s*autolearn-generated[^>]*-->/g`. Helpers: `autolearnProvenance(raw)`,
   `withoutAutolearnProvenance(body)`, `skillBody(raw)`, and `promotedDocument(name, description, body)`
   as the single owner of what a promoted `SKILL.md` looks like (frontmatter, marker, body).
2. **The gate is provenance-aware**: a name collision is allowed only when the colliding inventory entry is
   `scope === "project" && autolearn`.
3. **Both write paths re-read the artifact** rather than trusting a cached list: the pass's publish path
   and `approveCandidate` both refuse to overwrite an existing file that does not carry the marker, and
   their notices say "Updated" instead of "Learned"/"Activated".
4. **A merge needs the text**: learned *project* skills' whole bodies travel in the prompt under
   `<learned-skill-bodies>`. Whole bodies only — a skill that does not fit the budget is left out
   entirely, and the prompt then forbids reusing its name this pass (a truncated body would invite a
   lossy merge).
5. **The inventory marks which skills are learned** (`- <name> (project, learned): …`), so the model can
   tell its own output from the rest.

pi's acceptance evidence is five one-sided assertion groups (its own suite); the load-bearing mutant is
dropping the marker from the shared renderer, which reddens all eight of its assertions.

## 3. What it maps onto here

| pi | dsh today | dsh after |
| --- | --- | --- |
| `PROVENANCE_COMMENT` / `autolearnProvenance` / `skillBody` / `promotedDocument` in `autolearn/skill.ts` | absent; `skillDocument(skill)` builds the header and body inline (`src/project-autolearn/skill.ts`) | same shape: one owner for the promoted document, so the marker cannot be forgotten in one path |
| collision check in `rejectionReason` | `src/project-autolearn/candidate.ts` refuses every existing name | allow the collision only for a skill carrying the marker |
| publish + `approveCandidate` re-read the destination | `src/project-autolearn/candidate.ts` (approve) and `src/project-autolearn/pass.ts` (publish) both refuse when the file exists | both read the marker off the file being replaced |
| `SkillInfo.autolearn` + `body`, `learnedBodiesText` | `SkillInventory` is `{ name, description }` and only scans the project's `skillsDir` (`src/project-autolearn/inventory.ts`); there is no global scope here | add the flag and the whole-body carrier; no scope field is needed |
| `RECORD_SKILL_TOOL` says the name is never reused | `src/project-autolearn/schema.ts` | state the one exception, since the model must now be allowed to rewrite a learned skill |

Two dsh-only facts the port must respect:

- **Our skills are tracked.** `.agents/skills/**/SKILL.md` is inside the tracking boundary, so a superseded
  skill is an ordinary `git status` change — no side file may become the source of truth. That is the same
  argument pi makes for the marker; here it also means a supersede is reviewable in the working tree.
- **Our candidate flow is the human gate.** A proposal with `candidate: true` lands in
  `.agents/memory/skill-candidates/` (untracked) for `/autolearn approve`, and the evidence rule is
  `MIN_CANDIDATE_SESSIONS` (1) vs `MIN_SKILL_SESSIONS` (2). A supersede must not quietly bypass it.

## 4. Rulings (2026-10-05)

1. **Yes — the pipeline may supersede, but only its own output.** The marker is what makes "its own
   output" checkable on the artifact, and our `.agents/skills/` corpus is tracked, so the alternative is
   exactly the hand-maintenance cost pi removed. Nothing about the port weakens the boundary: a name that
   belongs to a hand-written, imported or (here) unmarked skill stays refused.
2. **The evidence rule does not relax.** A supersede writes a *whole new body*, so it is grounded like a
   creation: `MIN_SKILL_SESSIONS` (2) for a non-candidate proposal and `MIN_CANDIDATE_SESSIONS` (1) for a
   candidate. The replaced skill's own evidence is not evidence for new claims, and a candidate file is
   deleted on approval, so neither can be cited instead.
3. **A supersede always lands through the candidate gate.** The pass proposes `candidate: true`; only
   `/autolearn approve` performs the replacement. Two consequences for §5: the *publish* path keeps its
   blanket refusal (D3's marker check stays there as the belt to the approve path's braces), and "the
   pipeline updated a skill" is always a change a human approved. This diverges from pi deliberately —
   pi's pass publishes a two-session proposal directly.
4. **The marker lives in the body**, immediately after the frontmatter, as pi puts it. Our
   `skillDescription` and the candidate parser read the frontmatter, and the next pass would read an
   unknown key there as a candidate field.
5. **Both wordings change, or the exception is dead code.** `RECORD_SKILL_TOOL`'s description has to say
   that rewriting a marked learned skill is the one allowed reuse, and `inventoryText` has to mark which
   skills are learned; without both the model never proposes a supersede.

## 5. Acceptance criteria

- **D1** a promoted skill carries the marker; `autolearnProvenance` reads it from the raw document, and a
  candidate never carries it.
- **D2** the gate allows a collision only for a marked project skill; a hand-written or imported skill with
  the same name is still refused.
- **D3** the approve path reads the marker off the destination file it is replacing, so a name freed
  by deleting a skill and then taken by a hand-written one is never superseded; the publish path keeps
  its blanket refusal (ruling 3), and the marker check there is the second reading of the same fact.
- **D4** the merge prompt carries learned bodies whole; a skill that does not fit is excluded and the
  prompt forbids reusing its name this pass.
- **D5** the marker dies with its skill: delete the file, recreate it by hand, and the next pass refuses
  the collision.
- **D6** nothing about the tracked boundary changes: an approved supersede is ordinary file churn in
  `.agents/skills/`, and no new side file becomes load-bearing.
- Mutants that must each redden exactly their own cases: drop the marker from the shared promoted-document
  renderer (all of D1–D3), ignore the marker in the gate (D2), fall back to a blanket refusal in approve
  (D3), drop the body injection (D4).
