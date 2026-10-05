# Batch G port brief — autolearn pulls a learned body instead of pushing every body

**Status: landed 2026-10-05** (see §8 for the acceptance evidence and the deviations from this plan).
Opened by the fifth pi triage pass (`docs/upstream-pi-triage.md` §"Fifth pass",
commit `997447a` of the range `f6bea1d..ca71fd3`, pi's v0.3.2). Every claim here is
either a pi path at a stated revision or a read-now command, so a fresh session can start from this file
without the triage document.

## 1. Why — the defect is latent here, and one owner decision arms it

This repo's pipeline already lets a learned skill be superseded (batch D: the `autolearn-generated` marker
plus `/autolearn approve`). But **which** learned skills the model can actually see is decided by a character
budget, and the budget and the gate judge different things:

- `learnedBodiesText` (`src/project-autolearn/inventory.ts:73-84`) pushes whole bodies until
  `MAX_LEARNED_BODY_CHARS` (= `MAX_SKILL_BODY_CHARS` = `20000`, `src/shared/limits.ts`) runs out and
  `continue`s a body that does not fit — **silently**.
- `inventoryText` (same file, `:55-67`) still lists that skill's name, because its own cap is a separate
  `MAX_INVENTORY_CHARS = 8000`.
- `rejectionReason` (`src/project-autolearn/candidate.ts:53-68`) reads only `collision.autolearn`. There is no
  notion of "shown this pass": `git grep -cn 'shown' -- src/project-autolearn/candidate.ts` → `0`.
- The second rule lives only in prose — `src/project-autolearn/prompt.ts:16`, last sentence: "Never reuse the
  name of a learned skill whose body is not shown."

So "not shown" and "may not be superseded" are **two** rules here, and only the model enforces the second. A
learned skill whose body did not fit is supersedable by a blind rewrite, and which ones fall on which side
depends on inventory order (`collectSkillInventory` sorts by name).

pi reached exactly this state, then measured it. Its sequence is the warning:

| pi commit | what it did |
| --- | --- |
| `0ca0d91` | marked seventeen hand-written skills as pipeline provenance, on the owner's convention |
| `23775db` | recorded the cost: `learnedBodiesText` returned `18859` of its `20000`-character budget |
| `1029b44` | corrected the arithmetic — the budget is a **total**, `96975` characters of marked bodies, so **four** are shown and **thirteen** are dropped while their names stay reusable |
| `997447a` | the code-level guard (`body not shown this pass`), which the fix-note had explicitly left to the owner |

Our numbers are the same shape and a smaller count: `MAX_SKILL_BODY_CHARS` is `20000` here too, and **`0 of 21`
skills in this repo carry the marker** — so nothing is superseded blind *today*. The defect is latent, not
absent, and marking our own corpus is precisely the step that took pi from "add-only in code" to thirteen
invisible-but-overwritable names. That is why this batch is worth landing *before* anyone marks the corpus.

## 2. What pi does — read at `ca71fd3`

```sh
P=/mnt/Data/Projects/pi-project-context   # local tree is 6707376; read origin/master == ca71fd3
git -C $P show 997447a                              # the whole change, tests included
git -C $P show 997447a -- extensions/project-context/autolearn/inventory.ts
git -C $P show 997447a -- extensions/project-context/autolearn/pass.ts
git -C $P show ca71fd3:extensions/project-context/autolearn/inventory.ts   # the settled shape
```

1. **The first look carries no skill body at all.** pi's `buildPrompt` gained
   `options: { evidence?, learnedBodies?, notShown? }` and computes
   `followUp = Boolean(evidence || learned || notShown.length)`; the base prompt has no body block.
2. **A body is pulled by name.** A new tool field `inspectSkill` (up to two learned project skill names) is
   parsed into `Decision.inspectSkill`; the follow-up round attaches those bodies.
3. **One computation, two readers.** `learnedBodies(skills, requested)` returns `{ text, names }` — the text it
   managed to render *and* the names it rendered. The pass builds `shownNames` from `names`, hands it to the
   gate (`rejectionReason(..., shownNames)`), and re-checks it at the write path:
   `if (existing && !shownNames.has(skill.name))` → refused with the literal `body not shown this pass`.
   The write path keeps its own read of the file, which is why a one-sided mutation of the gate alone still
   leaves the live-path refusal in place.
4. **The cap lives in code.** `MAX_INSPECT_SKILLS = 2` with the reason stated in the source: `maxItems` is not
   guaranteed to be enforced by the provider, so the slice is taken in `learnedBodies`.
5. **The refusal is one literal, in both paths.** `body not shown this pass` — a name that is not a learned
   project skill still answers the older `skill "<name>" already exists`, and asking for a name that is not
   learned comes back as *not shown* rather than silently doing nothing.
6. **Approving by hand says what it is.** `approveCandidate`'s message gained
   `— approved by hand; this pass never showed its body`, because a human approval runs no prompt and the
   overwrite is blind by construction.
7. **Measured by pi**: the first look drops from `32057` to `13149` characters and every marked skill becomes
   reachable; the follow-up costs at most one body. pi's `tests/autolearn-test.mjs` went `66 → 82`
   assertions, mutation-checked one-sided (dropping the shown condition reddens the two candidate-path lines;
   not injecting the requested body reddens only the follow-up-prompt line; dropping the cap reddens only the
   cap line; reverting the approve wording reddens only that line; dropping `inspectSkill` from `required`
   reddens only the strict-ready line).

## 3. What dsh has today — read now

```sh
D=/mnt/Data/Projects/dsh-project-context
git -C $D grep -n 'learnedBodiesText\|MAX_LEARNED_BODY_CHARS' -- src/project-autolearn/
git -C $D grep -n 'backtrackPrompt\|basePrompt' -- src/project-autolearn/pass.ts
git -C $D grep -n 'AutolearnDecision\|needSessions' -- src/project-autolearn/parse.ts
git -C $D grep -cn 'shown' -- src/project-autolearn/candidate.ts        # 0: the whole gap
grep -rl autolearn-generated $D/.agents/skills/*/SKILL.md | wc -l        # 0 of 21: latent here
```

The structure is already closer to pi's than it looks — **dsh has a second round** — so the port is smaller
than pi's commit:

- `parse.ts:15` — `AutolearnDecision = { skill: ProposedSkill | null; needSessions: string[] }`. The wire name
  is `need_sessions` (`schema.ts:26` `required: ["skill", "need_sessions"]`), which dsh deliberately kept when
  pi renamed it to `inspect` (`schema.ts:11-12` says so). **This is the naming question below.**
- `pass.ts:225` — the **first** look is `basePrompt(…, skillsText, learnedText)` and already carries every
  learned body; `pass.ts:254` — the only follow-up is `backtrackPrompt(…, extracts, learnedText)`, taken when
  the model asked for session archives, and it re-sends the same `learnedText`.
- `inventory.ts:73-84` — `learnedBodiesText(skills)` returns text only, no names.
- `candidate.ts:53-68` — `rejectionReason(skill, archived, existing, candidateExists)`, no shown set;
  `:80-97` — `saveProposedSkill` re-reads the corpus fresh (the independent read pi also keeps);
  `:109-137` — `approveCandidate`.
- `prompt.ts:28` / `:58` — `basePrompt(projectRoot, memoryText, contextText, indexText, skillsText, learnedText = "")`
  and `backtrackPrompt(projectRoot, memoryText, skillsText, extracts, learnedText = "")`, with the shared
  `skillRules()`; `learnedBodiesBlock(learnedText)` emits the `<learned-skill-bodies>` block only when non-empty.

## 4. Target changes, module by module

| module | change |
| --- | --- |
| `src/project-autolearn/inventory.ts` | `learnedBodiesText(skills)` → `learnedBodies(skills, requested) => { text, names }`; add `export const MAX_INSPECT_SKILLS = 2`; slice `requested` in code; rename the budget constant so its name says what it measures (`MAX_LEARNED_BODY_CHARS` → a shown-body name) |
| `src/project-autolearn/parse.ts` | `AutolearnDecision` gains the third member; a `readInspectSkill` reader parallel to `readNeedSessions`, capped at `MAX_INSPECT_SKILLS` |
| `src/project-autolearn/schema.ts` | the new property plus `required`; the description must state the pull rule ("a learned skill's name may only be reused after its body has been shown") and, in a comment, that the count cap is in code |
| `src/project-autolearn/prompt.ts` | the first look carries **no** learned bodies; `skillRules()`'s rule 6 rewritten to the pull semantics; the follow-up block plus a `notShown` list |
| `src/project-autolearn/pass.ts` | first `ask()` without `learnedText`; widen the second-round condition to `needSessions` **or** the new field; compute `shownNames` once from `learnedBodies(...).names`; thread it into the gate **and** add pi's second independent check before the write |
| `src/project-autolearn/candidate.ts` | `rejectionReason` takes `shownNames`; the new literal `body not shown this pass`; the approve message gains the blind-overwrite clause |

Keep the two model-visible spellings consistent with what dsh already settled: the wire field is
**snake_case** (`need_sessions`), so the new one should be `inspect_skill` on the wire and `inspectSkill` in
code, and the refusal literals stay lowercase with no period (`CHANGELOG.md` and the vocabulary work record
that shape).

## 5. User-visible surface

- A new **model-visible** tool field on `record_skill` (the settings card is untouched; no config key moves).
- A new refusal literal reaching the user when a pass is forced: `body not shown this pass`.
- The `/autolearn approve` completion message gains "— approved by hand; this pass never showed its body".
- A behaviour change in what a pass can supersede: a learned name whose body was not requested is now refused
  instead of blind-rewritten.
- No `CHANGELOG.md` entry until the code lands; this brief is not a release note.

## 6. Acceptance criteria

- **G1** — the first look's prompt carries no `<learned-skill-bodies>` block, whatever the marked population
  is (assert on the prompt string, not on a call).
- **G2** — `learnedBodies(skills, requested)` returns only requested names, and its `names` is exactly the set
  the text rendered; a body that does not fit is absent from **both** `text` and `names`.
- **G3** — `MAX_INSPECT_SKILLS` is enforced in code: a requested list longer than the cap attaches at most two
  bodies (pin the boundary, not only the happy path).
- **G4** — a proposal reusing a marked name whose body was **not** shown is refused with
  `body not shown this pass`, on the candidate path *and* on the direct-publish path, independently.
- **G5** — the same proposal **with** its body shown still takes the batch-D path (candidate, then
  `/autolearn approve`).
- **G6** — the write-path guard alone is sufficient: a one-sided mutation that removes the gate's shown
  condition must still leave the live-path refusal in place (pi's `mutation-checked one-sided` claim).
- **G7** — `git grep -cn 'shown' -- src/project-autolearn/candidate.ts` is no longer 0, and the prompt's rule 6
  no longer states a rule the code does not also enforce.

## 7. Verify, then land

```sh
cd /mnt/Data/Projects/dsh-project-context
pnpm typecheck && pnpm build && node --test      # read the counts, never a recorded one
grep -rn 'MUTANT' lib/ | wc -l                   # expect 0
# mutation round: registry of valid mutants + the restore-from-hash procedure
#   -> .agents/skills/dsh-plugin-mutation-round/
# then the loaded-vs-not check for the host serving the session
#   -> .agents/skills/dsh-host-build-restart-verify/
```

This batch changes what a reply *produces*, so a half-landed version is worse than none: land the six modules
in one commit with its tests, run the mutation round, and only then ask the user for the host restart.
See `docs/batch-d-autolearn-supersede-brief.md` for the format a landed batch takes (status line, mutants,
acceptance criteria pinned by tests).

## 8. Landed — what actually shipped, and where it departed from this plan

Commit: one `src/` + test commit on 2026-10-05. Gate re-read after it: `pnpm typecheck` 0 errors,
`pnpm build` 0 (`lib/client.js` 28529 bytes, client untouched), `node --test` **340 pass / 0 fail**
(336 before the batch), `lib/` matches a fresh `tsc` except `client.js`, 0 mutant markers. Evidence and
the reproduction script: `.agents/evidence/2026-10-05-autolearn-pull-model/`.

Acceptance criteria, each pinned by a named case:

| # | pinned by |
| --- | --- |
| G1 | `the first look carries no learned body, and the follow-up shows only the body it asked for` |
| G2 | same case + `learnedBodies renders only requested, marked bodies and reports exactly what it rendered` |
| G3 | `the body ask is capped in code, and the names left out are named in the follow-up` (boundary) + the `learnedBodies` unit case (the function's own contract) |
| G4 | `a learned name is refused unless this pass showed its body` — the direct-publish and candidate paths in separate roots — plus the `saveProposedSkill` assertions in `only a skill the pipeline wrote may be superseded, and only through the candidate gate` |
| G5 | `a learned name is refused unless this pass showed its body` (candidate stored, then `/autolearn approve` lands the merge) |
| G6 | the mutation round: mutants A (gate condition only) and B (write-path condition only) stay green; mutant C (both) turns G4's two cases red |
| G7 | the G1 case asserts the rewritten rule 6, and `git grep -cn 'shown' -- src/project-autolearn/candidate.ts` reads 9, not 0 |

Three deliberate departures from §4/§5 of this plan:

1. **`parse.ts` does not slice `inspect_skill`.** The plan's parse row said "capped at `MAX_INSPECT_SKILLS`"; a
   cap in the reader *and* in `learnedBodies` would be two owners of one bound. `MAX_INSPECT_SKILLS` is defined
   and enforced in `learnedBodies` alone, which is the computation that decides what counts as shown — the
   same function the gate and the write path read. `readInspectSkill` only filters non-strings, trims and drops
   blanks, so `notShown` still names every request that could not be rendered.
2. **The write-path guard sits before the candidate branch, not only on the live path.** pi's second read
   guards the direct-publish branch, which in this repo is blanket-refused for any existing destination, so
   copying that placement would have been dead code. Here the check is placed before the `skill.candidate`
   branch, which is this repo's only real supersede route. Consequence reported honestly: mutants A and B are
   *equivalent* mutants (each guard alone suffices), which is exactly what G6 asks for; the load-bearing mutant
   is C, which removes the fact from both readers.
3. **The approve message is worded around the approval, not "this pass".** pi writes
   `this pass never showed its body`; the pass that stored a candidate may have shown the body — that is how a
   legitimate merge gets stored — so that wording is a wrong cause here. dsh writes
   `— approved by hand; the body was not shown to the approval`.

One behaviour this plan listed as user-visible that is narrower in the port: the follow-up round is taken only
when there is material to attach (`extracts.length > 0 || bodies.text !== ""`), not whenever a body was asked
for. §5's "the follow-up costs at most one body" still holds; a request that resolves to nothing still spends
no second call, which is this repo's pre-existing rule and is pinned by the existing
`evidence ids without an archive on disk are dropped` case.
