# Batch J — drop the generated handoff summary and carry a pointer

**Status: not-started.** No code has been written for this batch. It is a proposal with evidence,
written from the sixth pi triage pass (`docs/upstream-pi-triage.md`, section "Sixth pass").

## What pi did

| pi commit | what it is |
| --- | --- |
| `b4c9405` | **the code change** — `refactor(handoff): drop the generated summary and carry a pointer instead`, in pi's v0.4.1 |
| `9737a8e`, `ff94f16`, `4b96464`, `c06b292` | the design records: the last-turn design, its frozen revision, the payload experiments |
| `98abe01` | `docs: the handoff carries a pointer, and the injection is progressive` |
| `9abd971`, `a0bcdd1`, `bd9fd3a` | review rounds 1–3 on this change and on batch I |
| `50fb893`, `fa4c15b` | the record corrections, including the retirement rationale |

Read it, never from memory and never from the working tree of the pi checkout (its `master` lags
`origin/master`):

```sh
P=/mnt/Data/Projects/pi-project-context
git -C $P log -1 --format='%H %cI %s' b4c9405
git -C $P show b4c9405
git -C $P show 4e40d43:extensions/project-context/handoff/prompt.ts
```

## The mechanism pi landed

The whole summarizer is deleted: the auxiliary model call, its token-cap retry (and
`SUMMARY_OUTPUT_RESERVE_TOKENS`), the model-window cap it ran under, `summaryFocus`, and the localizer
that rewrote the summary's section headings. `buildHandoffPrompt` now assembles the successor's first
message from mechanical parts only — the carried tail's token count, a "details" section naming the
previous session id and its raw transcript, and a **strong lookup instruction** — and
`buildHandoffDocument` writes the archived `HANDOFF.md` with title, created, project, log and index and
**no summary**:

```
- A detail that is not in this session must be looked up in the session log linked by
  .agents/memory/session-logs/INDEX.md (grep; do not load whole files); a fact you are not sure of
  must not be answered from memory.
```

pi's stated basis is two field facts and one measurement: folding a real transcript into the prompt made
the successor go off track; and "pointer + real tail + strong instruction" answered all three probe
questions on the same model with a real log
(`.codestable/audits/2026-10-05-context-cost-and-progressive-disclosure.md` §9, on pi's side).

## dsh today

The chain is live and reached from `src/project-handoff/perform.ts:95`:

```ts
await summarize(ctx, target, config, handoffPrompt(projectRoot, memory.text, older, fileOperations(session), language), withTimeout(signal), resolveSummaryEffort(config, session, resolved))
```

| where | what moves |
| --- | --- |
| `src/project-handoff/summary.ts` | `handoffPrompt`, `summarize`, `summaryAttemptBudgets`, `SUMMARY_RETRY_FLOOR`, `SUMMARY_TIMEOUT_MS`, `resolveSummaryEffort`, `renderHandoff` — the summarizer in full. `continuation()` survives in reduced form |
| `src/project-handoff/perform.ts` | the call site (:95), `handoffArtifacts`' `localizeSummaryHeadings(args.rawSummary, …)` (:42), the empty-summary verdict (:101), and the "summary came back empty" / "the summary call is the wide window" comments |
| `src/project-handoff/language.ts` | `localizeSummaryHeadings` (:134) and `SCAFFOLDING[lang].summaryDirective` (:202/:225). Keep the fence-aware helper only if something else still uses it — `localizeSummaryHeadings` is its only consumer; check before deleting |
| `src/project-handoff/threshold.ts` | `MIN_SUMMARIZE_TOKENS` (:15, :58, :135, :173–174) → `MIN_DROP_TOKENS`, and the refusal text's "摘要下限 / summarize minimum" (:140–144, :192–193) |
| `src/shared/config.ts` | the `handoffThinking` field (:56), its default (:82), its validation (:163–165) and its normalization (:203) |
| `src/shared/settings.ts` | the `handoffThinking` schema row (:60) |
| `client/card-fields.ts` | the `handoffThinking` type (:38) and card row (:100) |
| `client/locales.ts` | `field.handoffThinking` / `field.handoffThinkingHint` (:60–61, :123–124) |
| `src/project-handoff/command.ts` | the `thinking off\|session` verb (:42–43), the `summary thinking N` status line (:151), `USAGE` (:78), and the `budget summary` description (:58–73) |
| tests | `test/{logic,handoff-language,card-render,settings-form,config-vocabulary}.test.mjs`, plus wherever `test/handoff-decision.test.mjs` pins the artifacts |

Two keys do **not** move, and this is deliberate in pi too:

- `handoffBudgetSummaryTokens` and `/handoff budget summary` **survive** — dsh reads the key in the
  override formula (`threshold.ts:346 const asked = room.overhead + room.keep + config.handoffBudgetSummaryTokens`),
  and pi kept the spelling explicitly because the two config surfaces share it. Only its *meaning* shifts:
  nothing is handed to a summary any more. pi's own verb description became "the trigger request the pass
  reports (no model call)".
- `handoffBudgetRecentTokens` / `/handoff budget recent` are untouched, but they become the only thing
  that decides how much verbatim tail rides — which is why batch J pairs naturally with the
  `handoffCarry` work already landed in `904152d`.

## What dsh must not copy from pi

1. **pi's claim that `handoffThinking` has no reader "on either side" is false here.** dsh reads it:
   `summary.ts:23 if (config.handoffThinking === "session")` inside `resolveSummaryEffort`, called from
   `perform.ts:95`. Retiring the key is correct **only because this batch deletes that reader** — it is
   not independently retirable, and doing it first would drop a working setting.
   Verify: `git grep -n 'resolveSummaryEffort' -- src/` → `perform.ts:95`.
2. pi deleted its own `loadMemorySync` and therefore `newestMemoryArchiveSync` (`8f4eab7`). That is a
   different commit, but the same trap: never port a pi deletion by symbol name. See the triage section.
3. pi's finish-reason spelling differs (`length` vs dsh's `max-tokens`) and the retry it guards is being
   deleted here anyway.

## Decisions needing the user's ruling

1. **Delete the summary outright, or keep some generated text?** pi deleted it. The consequence is that
   the successor's first message is purely mechanical and its quality rests on the carried tail plus the
   lookup instruction. The evidence for doing so is pi's, on pi's models; dsh's own `904152d` carry is
   already in place, so dsh has more mechanical payload than pi had before this change.
2. **Retire `handoffThinking` and `/handoff thinking`, or keep the verb?** If the summary goes, the key
   has no reader and no meaning. **No profile stores it** — verified 2026-10-06, 0 hits across
   `~/.dsh/profiles/*/cordis.patch.yml` — so unlike the batch-H renames this is a pure code removal with
   no profile edit and no apply-time throw. A retired name gets no alias (batch H's rule).
3. **`MIN_SUMMARIZE_TOKENS` → `MIN_DROP_TOKENS`?** The rename is right once nothing is summarized
   (the constant then names the minimum span worth dropping). Note the double-literal in the refusal text
   is user-visible and localized in both languages.
4. **What replaces the summary in the successor's message, and in what wording?** pi's shape is:
   preamble → carried/not-carried sentence → "verify current state with tools" → `## Previous session
   details` (session id, raw transcript path, lookup instruction) → file list → pending question →
   closing. dsh's `continuation()` (`summary.ts:67`) also carries the **user's decision block** from
   `904152d`, which pi has no equivalent of — that block must survive the rewrite intact.
5. **Does `/handoff now` still require a routed model?** Today `command.ts:176–177` refuses with
   "No routed model available for the handoff summary" when no target resolves. The summary is the stated
   reason, but the auto path separately needs `resolveModelInfo` for `contextWindow` (`auto.ts:38–40`), so
   the *threshold* keeps needing a routed model even after the summary is gone. Decide whether the manual
   path should relax to pi's behaviour (proceed and warn) or keep refusing, and re-word the refusal either
   way.
6. **Receipt and card wording.** The `/handoff status` line `summary thinking N` (`command.ts:151`) and
   the card hints for `handoffBudgetSummaryTokens` and `handoffThinking` all describe the summary. Batch H
   established the rule that a key's label mirrors the command path; decide the new wording with the
   removal, not after it.

## Traps

- `handoffSummaryThinking` → `handoffThinking` appears as a migration entry in pi. dsh has no legacy-name
  reader (`git grep -in legacy -- src/shared/config.ts` → 0), so there is nothing to remove here; do not
  invent one.
- Six faces move together for a key change (`config.ts`, `settings.ts`, `client/card-fields.ts`,
  `locales.ts`'s `field.*`, every reader and `settingPatch` write-back key, tests) — `settings-form.test.mjs`
  scans every schema key, so a half-done removal fails the suite rather than passing quietly.
- `perform.ts` must not be split as part of this (repo invariant); the deletion is inside it.
- The threshold's floor shares the `CHARS_PER_TOKEN = 4` / `contextBreakdown` base with `keep` and
  `handoffSplit`; after the rename, re-read that invariant rather than re-deriving the arithmetic.

## Verification plan

1. `pnpm typecheck` and `pnpm test` with 0 failures, counts read fresh; `pnpm build` because
   `client/locales.ts` and `client/card-fields.ts` move.
2. A mutation round per `dsh-plugin-mutation-round`: each removed reader must be pinned by a test that
   turns red when the reader is put back, and the "no model call happens" property asserted after every
   integration scenario (pi pins exactly this).
3. Evidence under `.agents/evidence/<date>-handoff-drop-summary/`: the diff of the successor's message
   before/after on one real session, and the `errors.log`/receipt wording check.
4. A profile check before landing: confirm again that no profile stores the retired keys
   (`grep -n 'handoffThinking' ~/.dsh/profiles/*/cordis.patch.yml` → 0), because a stored retired key is an
   unknown key and the settings-namespace owner throws at apply.
5. Release only after the desktop restart that loads it; this batch touches `src/`, so it moves the
   restart criterion and its release commit carries the rebuilt `lib/`.
