# 2026-10-07 — handoff child-title label survey (read-only)

Answers one decision question for candidate **(c)** in `docs/handoff-candidates-b-c.md`:
*if a handoff child's title is going to be computed from text, which text, and how good is it in practice?*

## Run it

```sh
node .agents/evidence/2026-10-07-handoff-title-label-survey/survey.mjs
```

Read-only: folds `~/.dsh/sessions/--mnt-Data-Projects-dsh-project-context--/` (the store of
**this** workspace) with `zstdcat`, writes nothing, uses no network. Counts grow with every
handoff, so re-run it and read the printed output — never quote the numbers below.

## What it folds

* the title = last `session/title` event → tells which sessions are handoff children
  (`↪ handoff · ` prefix, `src/project-handoff/marker.ts`)
* every human turn = `user/message` with `source.kind === "user"`

The jump to `user/message` runs on the **decompressed** stream, where `runtime-context` and
`handoff-pressure` messages carry the whole injected memory document. Only lines containing
`"session/title"` or `"user/message"` are parsed, and only the text parts are kept.

## What it answers

* **candidate 1/3 (eager)** — label = the *parent* session's last human input: a real
  instruction / no source at all (parent never received a human turn → falls back to the
  parent id) / ≤4-char noise (`要`, `好了`) / an old handoff banner / an injected status line
  (`handoff Auto handoff ON · context …`) / `继续`.
* **candidate 4/5 (deferred)** — label = the *child's* own first human input: available only
  for children that were actually typed into; the rest stay on the parent id, which is today's
  behaviour.

## Two facts the survey output depends on

* A handoff child's log header carries **no `origin`** field, so `isTopLevel` is true for it and
  the plugin already receives its `session/event`s.
* Seeds are written with `source.kind = "dsh-project-context"`, so a `source.kind === "user"`
  trigger cannot mistake a fresh seed for a human turn. Older children (pre-fix seeding) did
  write the seed as `kind=user`; the survey counts them separately for exactly this reason.
