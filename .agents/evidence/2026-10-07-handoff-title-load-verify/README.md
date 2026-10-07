# Handoff-title batch — post-restart acceptance

`verify.sh` answers one question: **is the "name the continuation after the parent's own last input"
batch (`162b12d..cb21b5a`) what the running host executes?** Run it from the repo root:

```bash
bash .agents/evidence/2026-10-07-handoff-title-load-verify/verify.sh
```

Exit 0 = the load criterion passed and, wherever it was observable, a label was seen instead of a bare
id. Exit 1 = at least one check failed (check 1 alone is enough to make the whole run fail).

## The three checks

1. **Load criterion** — the process holding `127.0.0.1:19387` started *after* the last `src/` commit,
   re-derived in the run (never quoted from a doc). This is the authoritative check: the host loads
   `lib/` at its own start, so a holder older than the last `src/` commit cannot be running the batch.
2. **The loaded `lib/` is the committed one** — `git status --porcelain -- lib` empty, and `lib/`
   identical to a fresh `node_modules/.bin/tsc --outDir $TMP` compile (`lib/client.js`, the esbuild
   bundle, is the only expected extra).
3. **An observed handoff child** — every handoff child titled *after* the holder started is classified
   by title shape, with the parent's own input resolved from the seed banner.

## Why check 3 cannot simply fail on a bare id

`handoffLabel` returns the parent's short id when the parent carries **no human input**
(`source.kind === "user"` and not a continuation banner), so `↪ handoff · <8 hex>` is the documented
outcome for a chain the user never typed into — the exact shape the old code always produced, and 38
of the 93 surveyed children. Three design traps were found while building this and are handled
explicitly, so the probe never names a wrong cause:

- **A bare id is judged only against the code that could have written it.** A child titled after the
  holder started but *before* the last `src/` commit was written by the pre-batch code; its bare id
  proves nothing. The verdict is gated on check 1: when the criterion fails, such a child is reported
  as "cannot discriminate until the restart", never as a failure. Only when check 1 passes does a bare
  id next to human input become a failure (the new code must have labelled it).
- **File mtime is not creation time.** A session republished to the v4 log format gets a fresh mtime
  while keeping its original events, so a first version scoped by `-newermt` and reported five
  pre-restart children as failures. The deciding timestamp is now the `session/title` event's own
  `time`; the mtime check remains only as a cheap prefilter.
- **The parent's input is filtered wider than the plugin does.** Dropping every message that starts
  with `从会话 ` / `Handoff from session ` can only make this probe *less* likely to fail, never turn a
  real label into a false failure.

The **negative control** is printed alongside: an ordinary (non-handoff) session titled after the
holder started must show a service source (`fallback`, then `provider`) citing at least one message
seq, never our `rename` shape. The shape discriminator itself is read from the host source rather than
assumed:

```bash
V=$(dsh --version); R=$(ls -d /nix/store/*dsh-desktop-"$V"/lib/dsh-desktop/repo)
sed -n '500,505p' "$R/packages/session/session-title/src/index.ts"   # a user rename pins the title
sed -n '20,35p'  "$R/packages/session/session-title/src/invariant.ts" # messageSeqs empty iff kind=user
```

That is why every handoff child shows `source=user messageSeqs=0` (our `rename` pins it, so no
automatic revision may override it) while the controls show `source=fallback messageSeqs=1`.

## As of the run recorded here (do not quote these counts later)

Run pre-restart on 2026-10-07: check 1 **FAIL** (`pid 4996` started `15:10:27`, last `src/` commit
`cb21b5a` at `16:43:28`) → check 3 is the unobservable half; it counted **11 handoff children titled
after the holder start, 0 labelled**, all `source=user messageSeqs=0`, five of them from parents the
user did type into ("继续", "继续？另外：…") — each reported as "cannot discriminate until the
restart", which is the correct reading of the window between the holder start and the last commit.
Five non-handoff sessions started in the same window and supplied the controls. The pre-restart run is
therefore also the proof that the failing path is reachable.

## What only a post-restart run can prove, and the residual

Only the restart makes check 1 pass. After it, check 3 becomes discriminating: a child titled from a
parent the user typed into must show that text (clipped to 20 characters) instead of the parent id. If
**no** handoff runs after the restart, the script says "unobservable yet" and relies on check 1 — that
is not a failure of the code.

Residual, already recorded in `CHANGELOG.md` and not claimed as fixed: a bare id that a *normalized*
label produced is corrected by `perform.ts`'s `retitleAfterRename` backstop, but the backstop cannot
recover a switch decision the browser already made — `planHandoffWatch` adds a scanned row to
`markSeen`, which is never re-checked, so the correction restores the stored title, not necessarily
the automatic tab switch.
