# Batch G — the autolearn pass pulls a learned body instead of pushing every body it can fit

2026-10-05. Read-only w.r.t. everything outside this repo except the throwaway tmp projects the test
suite writes into. The round is reproducible with `mutate.py` plus the runner recipe below; it edits
`src/` only and restores from a `sha256sum`-verified `/tmp` copy.

## What this archives

The port of pi's `997447a` (range `f6bea1d..ca71fd3`) into this repo. Brief:
`docs/batch-g-autolearn-pull-brief.md`. The defect it closes is **two rules where there should be
one fact**:

- `learnedBodiesText` pushed whole learned bodies into every prompt until
  `MAX_SKILL_BODY_CHARS` (20000) ran out and silently `continue`d a body that did not fit.
- `inventoryText` still listed every name, because its own cap is a separate `MAX_INVENTORY_CHARS`
  (8000).
- `rejectionReason` read only the `autolearn-generated` marker — `git grep -cn 'shown' --
  src/project-autolearn/candidate.ts` was 0, so "which skills did this pass show" was not a fact any
  code held.

So "not shown this pass" and "may not be superseded" were two rules that could drift, and only the
model enforced the second (from one sentence in `prompt.ts`). A learned name past the budget was a
blind rewrite waiting for the corpus to be marked: **0 of 21** skills carried the marker here, so the
defect was latent rather than burning.

The fix makes one computation feed both readers: `learnedBodies(skills, requested)` returns
`{text, names}`, the pass builds `shownNames` from `names`, and the gate and the write path each read
it. The first look carries no learned body at all; a body is attached only in the follow-up, and only
when the model asked for it by name with the new `inspect_skill` field.

## Mutation round

`mutate.py <letter>` applies one named mutant to `src/`; the runner builds, runs the full suite, and
restores. A mutant only counts if it compiles with 0 errors, its marker is present in `lib/` after
`pnpm build`, and it changes behaviour on a probe input.

```
rm -rf /tmp/g-src-snapshot && mkdir -p /tmp/g-src-snapshot && cp -a src /tmp/g-src-snapshot/
(cd /tmp/g-src-snapshot && find src -type f -exec sha256sum {} \; | sort -k2 > MANIFEST.sha256)
# per mutant:
python3 mutate.py <letter> && pnpm build && node --test        # read the exit code + counts
cp -a /tmp/g-src-snapshot/src/. src/ && sha256sum -c /tmp/g-src-snapshot/MANIFEST.sha256
# always: rebuild, then confirm `diff -rq lib <fresh tsc outDir>` reports only client.js
```

Baseline before the round: **340 pass / 0 fail** (336 before batch G; +4 new cases).

| # | mutation | validity trio | outcome |
|---|---|---|---|
| A | drop the gate's `shownNames` condition only | compiles, `lib` still carries 1 of the 2 literals, behaviour equivalent | **SURVIVED — by design** |
| B | drop the write path's `shownNames` condition only | compiles, `lib` carries 1 of 2 literals, behaviour equivalent | **SURVIVED — by design** |
| C | drop **both** shown conditions | compiles, `lib` literal count 2 → 0 | KILLED: `only a skill the pipeline wrote may be superseded…` + `a learned name is refused unless this pass showed its body` (338/2) |
| D | `learnedBodies` ignores `requested` (`new Set(skills.map(…))`) | compiles, marker in `lib/inventory.js` | KILLED: `the body ask is capped in code…` + `learnedBodies renders only requested, marked bodies…` (338/2) |
| E | ignore the count cap (`slice(0, 99)`) | compiles, marker in `lib` | KILLED: `the body ask is capped in code…` (339/1) |
| F | drop `inspect_skill` from the schema's `required` | compiles, marker in `lib/schema.js` | KILLED: `the record_skill schema stays strict-ready with the body ask` (339/1) |
| G | revert the approve-path honesty clause | compiles, marker in `lib/candidate.js` | KILLED: `only a skill the pipeline wrote may be superseded…` (339/1) |
| H | `readInspectSkill(undefined)` — never read the text-reply ask | compiles, marker in `lib/parse.js` | KILLED: 4 cases (336/4) |
| I | `notShownRule` always returns `[]` | compiles | KILLED: `the body ask is capped in code…` (339/1) |
| J | the follow-up is never taken (`if (false)`) | compiles | KILLED: 6 cases (334/6) |

**A and B are deliberately equivalent mutants, and that is G6's claim, not a missing pin.** The gate
judges the inventory collected at write time; the write path reads the file a promote would replace.
Both must agree that this round rendered the body, so removing either one alone leaves the refusal in
place — verified by A and B staying green, and by C (the only mutation that removes the fact from both
readers) turning two named cases red. This is stronger than pi's placement, where the write-path check
guards only the direct-publish branch: here the direct-publish path is blanket-refused anyway, so the
check sits before the candidate branch, which is this repo's only real supersede route.

## Deliberate deviations from pi

- **Follow-up trigger.** pi follows up whenever the first look requested evidence or a body. dsh keeps
  its own rule: no second call when the request resolved to no material (`extracts.length === 0 &&
  bodies.text === ""`). The existing optimisation is pinned by `test/autolearn.test.mjs`'s
  "all requested ids missing behaves like no evidence" (`ctx.calls.length === 1`), **not** by
  "evidence ids without an archive on disk are dropped" — that case keeps one valid id and asserts
  `ctx.calls.length === 2`, i.e. the follow-up is taken.
- **The count cap lives in `learnedBodies`, not in the parser.** `readInspectSkill` filters and trims
  but does not slice, so there is one owner of the cap — the computation that decides what counts as
  shown. The brief's `parse.ts` row said "capped at `MAX_INSPECT_SKILLS`"; that would have been a
  second owner of the same bound.
- **The approve message is worded around the approval, not "this pass".** pi writes
  `this pass never showed its body`; the pass that stored a candidate may in fact have shown the body
  (that is exactly how a legitimate merge gets stored), so saying otherwise is a wrong cause. dsh
  writes `— approved by hand; the body was not shown to the approval`.
