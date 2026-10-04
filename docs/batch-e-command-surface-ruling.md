# Batch E ruling — the command surface, one name per fact

**Status: ruled 2026-10-05, not started.** The fourth pi triage pass
(`docs/upstream-pi-triage.md` §"Fourth pass") marked this portable from `0399e04` at `f6bea1d`. This file
records the rulings; the rename itself is unimplemented, so `src/` still carries the old grammar.

Read the current grammar before touching it:

```sh
D=/mnt/Data/Projects/dsh-project-context
sed -n '39,66p' $D/src/project-handoff/command.ts          # settingPatch + USAGE
sed -n '150,166p' $D/src/project-handoff/index.ts          # the /handoff command itself
sed -n '120,158p' $D/src/project-context/index.ts          # /context and /session-log
git -C /mnt/Data/Projects/pi-project-context show 0399e04  # pi's change, tests included
```

## 1. What the surface does today

| spelling | effect today | the fact it sets |
| --- | --- | --- |
| `/handoff auto` | `handoffAdaptive: true` | how the threshold is decided |
| `/handoff 0.4` (bare ratio) | `handoffAdaptive: false, handoffThresholdRatio: 0.4` | the same fact, second spelling |
| `/handoff target 64k` | `handoffTargetTokens` | conversation tokens handed to *each summary* |
| `/handoff keep 20k` | `handoffKeepTokens` | recent conversation carried verbatim |
| `/session-log` (bare) | **writes** the session's artifacts | a read habit with a write side effect |
| `/session-log now` | the same write | the same fact, second spelling |

`/handoff` also carries `status`, `now`, `on`, `off`, `thinking off|session`, `pending defer|wait` and
`lang auto|zh|en`; none of those changes.

## 2. Rulings

1. **One fact, one spelling — a hard cut, no alias.** The precedent is this repo's own
   `/context-update` → `/memory update` rename with no alias: a second spelling is what let `auto` and the
   bare ratio drift apart in the first place. An old spelling must not act; the error text names the new
   one.
2. **`threshold` owns "how the threshold is decided".** `/handoff threshold auto` → `handoffAdaptive:
   true`; `/handoff threshold 0.4` → `handoffAdaptive: false, handoffThresholdRatio: 0.4`. A bare ratio
   and a bare `auto` are rejected with the usage line.
3. **`budget summary|recent` owns the two numbers**, because the old names did not say which was which:
   `budget summary <tokens>` → `handoffTargetTokens` (the config's own words: "conversation tokens handed
   to each summary"), `budget recent <tokens>` → `handoffKeepTokens` ("recent conversation tokens carried
   into the continuation verbatim"). `target`/`keep` are rejected. The 8000 floor on summary and the
   0 floor on recent stay exactly as they are — the rename moves no bound.
4. **`/session-log` reads, `write` writes.** The bare command is the "what is my state" habit, so it
   prints the log directory and the index and says how to write (`/session-log write`); `now` is retired
   rather than kept as an alias (ruling 1). `import <path…>` is unchanged. The ungated-command reasoning
   in `src/project-context/index.ts` still holds — `write` is that command under its new name — so the
   `releaseSessionQueue` path and its comment move with the verb, not away from it.
5. **"A parameter lives with the layer that owns it" is already satisfied and needs no port.** pi moved
   per-feature switches into the owning commands because in pi a command carries config. Here the settings
   card owns it: every field is declared once in `PluginSettingsSchema` and published through the shared
   namespace, so there is no umbrella-to-layer move to make. The ruling is to leave the card alone.

## 3. Acceptance criteria

- **E1** `threshold auto` and `threshold 0.4` set the same two fields the old spellings did; a bare
  `auto` and a bare ratio are rejected and the message names `threshold`.
- **E2** `budget summary 64k` sets `handoffTargetTokens` and `budget recent 20k` sets
  `handoffKeepTokens`; `target` and `keep` are rejected and the message names `budget`.
- **E3** the bounds do not move: summary keeps its 8000–200000 range and its example text, recent keeps
  0–200000.
- **E4** bare `/session-log` writes nothing and names `/session-log write`; `write` performs exactly what
  `now` did, including the queue release on the same session key; `import` is untouched.
- **E5** `USAGE`, the command `input.hint`, the README's command table and the memory/context pointers
  that name `/session-log now` all move together — a doc that still teaches a retired spelling is the
  defect this batch exists to remove.
- Mutants that must each redden exactly their own case: making the bare ratio act again (E1), dropping the
  `budget` regex while keeping `target`/`keep` (E2), making the bare session-log write (E4), leaving the
  old usage line (E5).

## 4. Not ported from `0399e04`

The **legacy-config migration** has no counterpart: pi read three pre-unification file shapes on the hot
path and folded them into flat keys once; our settings live in the shared namespace's
`PluginSettingsSchema`, `src/shared/config.ts` has no legacy term, and `src/shared/migrate.ts` migrates
directory layouts rather than config shapes. The umbrella command pi retired does not exist here, so
`89cadee`'s naming fix has nothing to rename either.
