# Batch I — progressive disclosure for the two injected documents (offline acceptance)

**Claim.** The two documents injected into every turn's system prompt no longer enter whole: the
sections where a wrong answer is a violation (`MEMORY.md`'s `## Invariants`, `## Pitfalls`) or a lost
open thread (`CONTEXT.md`'s `## Key points`, `## Open tasks`) stay verbatim, and each remaining
section becomes one pointer line naming the file and when to read it, followed by a read-first
sentence. No heading may be dropped by the split.

**Command** (read-only; it drives the built `lib/`, the code the host loads, never `src/`):

```sh
node .agents/evidence/2026-10-06-progressive-injection/measure.mjs
```

**Observed output** (this tree, documents as of 2026-10-06; the script prints both lengths so a
re-run whose figures moved can say which input moved):

```
MEMORY.md: 34650 -> 25865 chars (25.4% smaller), headings 4, missing 0, pointer language zh, kept Invariants + Pitfalls
CONTEXT.md: 7774 -> 5797 chars (25.4% smaller), headings 3, missing 0, pointer language zh, kept Key points + Open tasks

total injected per turn: 42424 -> 31662 chars, saved 10762 (25.4%)
VERDICT: every heading survived the split
```

Exit 0 means no heading was lost; exit 1 names the lost ones.

**Revision.** The carrying commit is read fresh rather than written here:

```sh
git log -1 --format='%H %cI %s' -- .agents/evidence/2026-10-06-progressive-injection/
git log -1 --format='%H %cI %s' -- src/project-memory/injection.ts
```

## What this does and does not prove

- **Proved offline**: the split is total (every real heading appears exactly once, inline or as a
  pointer), the saving is ~10.8k characters per turn on the tracked documents, and the pointer block
  renders in the document's own language.
- **Not proved**: that a model actually reads the indexed sections when a question turns on them.
  pi's own audits reached this boundary and disagreed with themselves about it —
  `10cd4da` found the read-on-demand result **model-dependent, not mechanism-dependent**, and
  `a6d18e4` found the read-first sentence is what rescues a non-reading model. dsh's compliance is
  therefore an open question until a real session shows the corresponding `read` calls.
- **Deliberately out of scope**: every section the spec does not name stays inline, and a document
  with no usable heading is returned unchanged, so a schema change degrades to the previous behaviour
  instead of dropping content. That is what makes the coverage assertion above the right control.

## An observed consequence worth stating plainly

Both tracked documents contain CJK, so their pointer blocks render in **Chinese** even though most of
`MEMORY.md` is English. That is not a defect and not a drift: the rule is pi's
(`extensions/project-context/shared/lang.ts` at `4e40d43`: `countCjk([text]) >= LANGUAGE_CJK_MIN ? "zh" : "en"`,
`LANGUAGE_CJK_MIN = 2`), and this batch reuses dsh's single detector rather than adding a second one.
If the mixed-language pointer block turns out to be unwanted, the lever is the threshold, not a second
classifier.

## Reproducible checks

```sh
cd /mnt/Data/Projects/dsh-project-context
node .agents/evidence/2026-10-06-progressive-injection/measure.mjs          # exit 0
git grep -cn 'scanDocument\|splitSections\|renderProgressiveBody' -- src/    # 1 file: the new module
git grep -n 'buildMemoryInjection\|buildContextInjection' -- src/project-memory/index.ts  # the two providers
git grep -cn 'detectDocumentLanguage' -- src/shared/language.ts src/project-handoff/language.ts
```
