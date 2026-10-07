# 2026-10-07 — the handoff label's banner filter is reachable on the real corpus (read-only)

Companion to `2026-10-07-handoff-title-label-survey/`. That survey graded each candidate *source* for
a handoff child's title; this probe answers the follow-up review question: **does the landed
`handoffLabel` (档 1/3, `162b12d`) actually need the shared banner predicate, or is its
`source.kind === "user"` filter enough?**

It is not enough. Seeding used to run through the prompt RPC, which hardcodes
`source.kind = "user"` (`src/project-handoff/perform.ts` deliberately stopped using it), so an old
child's own banner is a *human-kind* message. A handoff whose parent is such a child would be titled
after **the session its parent was continued from** — worse than the parent id it replaces.

## Run it

```sh
node .agents/evidence/2026-10-07-handoff-label-banner-repro/probe.mjs
```

Read-only: folds `~/.dsh/sessions/--mnt-Data-Projects-dsh-project-context--/` with `zstdcat`, writes
nothing, uses no network. Counts grow with every handoff, so re-run it and read the printed output —
never quote the numbers below.

## What it drives

For every archived handoff child (`session/title` starting with `↪ handoff · `) it finds the parent by
the id in the title, reconstructs the parent as the minimal session shape the label reader consumes
(`deriveMessages()`, `user/message` events only), and calls **the built
`lib/project-handoff/conversation.js` `handoffLabel`** on it. Alongside it computes the pre-fix reader
locally (`source.kind === "user"` only) and the shared predicate `isHandoffContinuationText` on the
same text, so the three agree on which rows the filter changes.

## What it asserts (both directions)

* the premise holds: the store really carries `runtime-context` and `dsh-project-context` user/message
  kinds, so the kind filter is not vacuous;
* the class is non-empty: at least one real parent's last human-*kind* message is a banner — otherwise
  the regression fixture `a legacy kind=user seed banner does not name the continuation` has gone
  stale and this probe fails;
* the built function rejects every such banner (this check does not go through the pre/post
  comparison, so it still fires when the filter is removed from `lib/`);
* every row where pre and post differ is explained by the banner predicate.

## Failure path (proved reachable)

Replace the banner guard in `handoffLabel`'s loop inside the built
`lib/project-handoff/conversation.js` (the `if (text.length === 0 || isHandoffContinuationText(text))
continue;` line, followed by `last = text;`) with the pre-fix body
(`if (text.length > 0) last = text;`) and re-run: exit 1 with `FAIL: the built function still labels
child <id> after its parent's banner` per row, plus the stale-corpus check. Rebuild (`pnpm build`)
afterwards; do not edit `lib/` as a fix.

## What the corpus showed on 2026-10-07

6 of 97 archived handoff children have a banner as their parent's last human-kind message, and the
pre-fix filter turned each into `从会话 session-<another session>…`. With the predicate, all six fall
back to their own parent id. Label census for the built function over the same corpus: 37 useful
instructions, 47 parent-id fallbacks, 6 `继续`, 7 ≤4 characters.
