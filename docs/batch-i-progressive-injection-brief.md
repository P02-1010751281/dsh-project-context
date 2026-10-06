# Batch I — progressive disclosure for the two injected documents

**Status: not-started.** No code has been written for this batch. It is a proposal with evidence,
written from the sixth pi triage pass (`docs/upstream-pi-triage.md`, section "Sixth pass").

## What pi did

| pi commit | what it is |
| --- | --- |
| `9821320` | **the code change** — `feat(memory): keep the two decision sections inline and index the rest`, in pi's v0.4.1 |
| `0b6d45c` | the design record for the split |
| `00282cb` | `docs(audit): measure the context cost of memory, skills and handoff` — the size case |
| `a453233` | `docs(audit): weight progressive disclosure by who consumes it` |
| `8efd274` | `docs(audit): probe whether an index-only memory injection triggers an on-demand read` |
| `10cd4da` | `docs(audit): the read-on-demand result is model-dependent, not mechanism-dependent` — the honest limit of the benefit |
| `a6d18e4` | `docs(audit): a strong read-first instruction rescues the non-reading model` — why the sentence is load-bearing |
| `9abd971`, `a0bcdd1`, `bd9fd3a` | review rounds on the splitter; `bd9fd3a` unifies the traversal |

Read it, never from memory and never from the pi checkout's working tree (its `master` lags
`origin/master`):

```sh
P=/mnt/Data/Projects/pi-project-context
git -C $P show 9821320
git -C $P show 4e40d43:extensions/project-context/shared/inject.ts      # scanDocument + renderProgressiveBody
git -C $P show 4e40d43:extensions/project-context/memory/injection.ts   # MEMORY_INJECTION / CONTEXT_INJECTION
```

## The mechanism pi landed

`scanDocument` walks a rendered document **once**, tracking fenced code blocks, and yields the preamble
(everything before the first `##` heading) plus the sections in order. A closing fence is the opening
character repeated at least as many times with nothing but whitespace after it. `renderProgressiveBody`
then re-emits:

- the preamble and every document-level note (`_[…]_`) **inline** — neither belongs to a section, and the
  render appends the truncation marker after the last section's body, so without this the honesty marker
  would be indexed away with the section it landed in. Only a **trailing** line is honoured as that marker;
  a `_[x]_` line mid-document stays where it was written.
- every kept section inline, in document order;
- every heading named in `pointers` reduced to one line — `` - `## Project` — module layout … ``;
- a closing read-first sentence;
- nothing else: a heading the spec does not name stays inline, and a document with **no usable heading**
  is returned unchanged, so a schema change degrades to today's behaviour instead of dropping content.

pi's chosen split:

| document | kept inline | replaced by a pointer |
| --- | --- | --- |
| `MEMORY.md` | `## Invariants`, `## Pitfalls` | `## Project`, `## Index` |
| `CONTEXT.md` | `## Key points`, `## Open tasks` | `## Summary` |

The pointer path is rendered **absolute** against the project root, because the reader's `read` resolves
relative paths against its own cwd (`a0bcdd1`). The pointer text is bilingual and chosen by the
**document's** language.

## dsh today

Both documents enter the system prompt whole, as two dynamic-context providers in
`src/project-memory/index.ts`:

```ts
ctx.systemPrompt.context({ name: "project-memory", order: 190,
  text: (assembleContext) => projectMemoryInjection(assembleContext.agent?.session.header.cwd, effectivePluginConfig(entry).maxMemoryChars) });
ctx.systemPrompt.context({ name: "project-context", order: 210, /* projectContextInjection(...) */ });
```

- `projectMemoryInjection` (`:51`) = `## Project Memory` + a fixed English sentence + the whole
  `loadMemorySync(projectRoot, limit).trim()`.
- `projectContextInjection` (`:67`) = `## Project Context` + a fixed English sentence +
  `text.slice(0, MAX_CONTEXT_CHARS)`.
- The section headings are owned by two schemas: `MEMORY_SECTIONS` (Project / Invariants / Pitfalls /
  Index, `memory-schema.ts:33–36`) and `CONTEXT_SECTIONS` (Summary / Key points / Open tasks,
  `context-schema.ts:32–36`). Both are single sources, so a keep/index table must be derived from them
  rather than restated — the same rule batch H followed for the key spellings.

Nothing to extend exists yet: `git grep -cn 'scanDocument\|splitSections\|renderProgressiveBody\|InjectionSpec' -- src/`
→ **0**.

## What dsh already has that this batch should reuse

- **A language owner.** `src/project-handoff/language.ts` owns `HandoffLanguage = "zh" | "en"`,
  `CJK_PATTERN` and `detectHandoffLanguage(samples)` (CJK-first, `LANGUAGE_CJK_MIN = 2`). A document's
  language is `detectHandoffLanguage([documentText])` — no new detector is needed, and the pointer text
  must not grow a second one.
- **A fence-aware traversal.** `sections.ts` and `language.ts` both already implement the CommonMark
  close rule as a single pass. Whatever the splitter is called, it must not become a third copy of that
  rule — either reuse or state why not.

## Decisions needing the user's ruling

1. **Which sections stay inline.** pi's choice is Invariants + Pitfalls and Key points + Open tasks,
   i.e. the sections where a wrong answer is a violation or a repeated lesson. dsh's sections carry the
   same roles, but the *sizes* differ (the sixth pass measured Pitfalls at 88.9% of its hard budget), so
   the split is also a size decision, not only a semantic one.
2. **Localize the pointer block, or keep the injection English?** dsh's two injection headers are fixed
   English today; pi localizes the pointers by document language. This decides whether batch I introduces
   the first localized injection text in this repo.
3. **Keep the read-first sentence, and word it how?** pi's audit says the pointer alone leaves a
   non-reading model answering confidently and wrongly; the sentence is what makes it read. It is the
   difference between a smaller prompt and a wrong one.
4. **What happens when the split is impossible?** pi injects the document whole when no heading is named
   or none is found. dsh has a second such case: `sectionsFromMarkdown` returns `undefined` for anything
   that is not a plain four-section bullet document, and an opaque document is deliberately preserved
   verbatim. The splitter must be **heading-based** like pi's and must not depend on `sectionsFromMarkdown`,
   or an opaque-but-valid document would be indexed into nothing.
5. **Does the truncation marker stay inline, and does it even survive?** `projectContextInjection` slices
   at `MAX_CONTEXT_CHARS` **before** any split, so a marker near the end of a long `CONTEXT.md` is already
   cut away; `projectMemoryInjection` gets its cap inside `loadMemorySync`. Decide whether the marker must
   be preserved (pi keeps it inline; pi's document-level note rule exists exactly for this).
6. **Interaction with the pending `/memory update` work.** This batch shrinks what is *injected*; it does
   **not** touch the write path, the section budgets or the output fit, so it neither fixes nor worsens the
   `/memory update` self-lock. Say so in the release note to avoid the two being conflated.

## Traps

- Do not use `sectionsFromMarkdown` as the splitter (decision 4).
- The pointer must be an **absolute** path resolved against the project root, or the reader's `read` will
  resolve it against its own cwd.
- A fenced `## X` inside a code block must not become a heading; the two-view defect pi hit (a fence-blind
  preamble scan beside a fence-aware section scan) is exactly what `a0bcdd1`/`bd9fd3a` fixed — land the
  single traversal, not the bug.
- The injected providers are **synchronous** (`loadMemorySync`, `readTextCachedSync`). The splitter must
  stay pure and sync.
- pi's own measurement says the benefit is **model-dependent** (`10cd4da`). Do not present the size saving
  as the whole result; the compliance half needs its own observation.

## Verification plan

1. Unit tests over `scanDocument`/the renderer: preamble and trailing note survive; a `## X` inside a fence
   is content; a document with no pointer heading is returned unchanged; a document with a non-trailing
   `_[x]_` line keeps it in place; the pointer path is absolute.
2. A real-prompt test: assemble the provider text for the stored `.agents/memory/{MEMORY.md,CONTEXT.md}`
   and assert every kept section is present verbatim and every indexed heading appears exactly once (inline
   or as a pointer) — a total-coverage assertion, so a schema change cannot silently drop a section.
3. `pnpm typecheck`, `pnpm test`, and `pnpm build` only if `client/` changes.
4. A mutation round per `dsh-plugin-mutation-round`: at minimum, a fence-blind scan, a dropped note rule
   and a relative pointer path must each turn a named test red.
5. Measure the saving on the real documents (characters per turn) into `.agents/evidence/<date>-progressive-injection/`,
   and record the compliance question as **unproven** until a real session shows the `read` calls — pi's
   own audit reached exactly that boundary.
6. This batch touches `src/`, so it moves the restart criterion and its release commit carries the rebuilt
   `lib/`.
