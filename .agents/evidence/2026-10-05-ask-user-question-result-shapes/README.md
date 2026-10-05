# ask_user_question result shapes — 2026-10-05

Ground truth for the claims the decision-carry code makes about `ask_user_question`. Read from the
dsh-desktop **0.2.0-rc.2** store checkout at these paths (read the checkout fresh; its `/nix/store`
prefix rotates on every rebuild):

- `packages/interaction/tool-ask-user/src/index.ts` — the default blocking tool.
- `packages/interaction/tool-ask-user/src/timed.ts` — the opt-in timed tool.
- `packages/client/ui-user-questions/src/client/QuestionComposer.tsx` — the Skip control that produces
  the skipped shape.

## The two result shapes

Both tools render their result as one text block, `JSON.stringify(value)`
(`index.ts` `render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }]`; same in
`timed.ts`). The output schema is a `oneOf` of exactly two shapes (`timed.ts`, and the same
`answers` shape in `index.ts`):

```json
{"answers":[{"id":"…","selected":["…"],"custom":"…"}]}
{"pending":true,"callId":"…","message":"No answer batch arrived before the timeout. …"}
```

`pending` is timed-mode only and is explicitly **not an answer**: its own description reads "True when
the foreground wait expired before the user submitted an answer batch. The questions remain
answerable; this is not a skipped answer.", and `timed.ts` overwrites `message` with a notice saying
the user can still answer and that the payload is not permission to proceed.

## Three facts the carrier depends on

1. **`answers` is "one item per question"** (`timed.ts` schema description). So position is the
   pairing contract between a call's `questions[]` and the result's `answers[]`; `id` is a cross-check
   ("Stable question id echoed from the request").
2. **A skipped question is `selected: []` with no `custom`**, and is not something the user said:
   "Empty with no custom means the user explicitly skipped this question" (`timed.ts` selected
   description), "A skipped question has empty selected and no custom; unlike pending, the user has
   completed the batch." The client produces exactly that on Skip
   (`QuestionComposer.tsx`: `if (value.skipped) return { id: item.id, selected: [] }`).
3. **Only the timed tool validates unique ids.** `timed.ts` calls `validateQuestionIds`, which throws
   on a repeat; the blocking tool's schema only *describes* a "Stable id" and does not enforce one. So
   a repeated id is reachable in the default deployment, and pairing by an id lookup first would
   attribute one answer to several questions.

## Why it matters here

`src/project-handoff/conversation.ts` reads that pair to carry the user's last input into a handoff
continuation. Reading `answers` as the only answer-bearing shape is what keeps the plugin's own
copied `pending` notice, a Skip, and a failed invocation out of the continuation as if the user had
spoken — the misattribution class this repo treats as its worst defect. The behaviours are pinned by
`test/handoff-decision.test.mjs` ("a result that is not an answer batch is never carried as the user's
words", "a skipped question is not the user stating something", "multiple questions are paired by
position…", "an errored result is not an answer even when its text looks like one").
