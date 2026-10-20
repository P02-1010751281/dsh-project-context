# dsh 0.2.0-rc.2 → 0.2.1-rc.2: do the four plugins still fit, and is the new line's prompt change covered?

Read-only, 2026-10-20. The candidate line is **already running** (the desktop host booted on it on
2026-10-19), so unlike the 2026-10-03 pass this is a post-boot audit with one live binding fact
below: a landed fix in this repo is **not** in the running process.

| leg | what it answers | control | result |
|---|---|---|---|
| A. compile probe (`compile-probe.txt`) | does our host half / client half still **typecheck** against the new line's shipped `.d.ts`? | the repo's own `pnpm typecheck` against its pinned devDeps (0.1.7-rc.2) → `exit 0, errors 0` | host `exit=0 errors=0`, client `exit=0 errors=0` |
| B. peer gate (`peer-gate.txt`) | would `dsh-app-boot` skip or disable any of our rows? | — | desktop: live inventory active, 0 enabled-but-not-active; web/ctxdev: 0 disabled rows among ours |
| C. behaviour change (`interpolate-probe.txt`) | does 0.2.x interpolate our injected documents, and does our opt-out work? | `--lib=` against a copy with the flag stripped → claim D fails, `exit 1` (`interpolate-probe-control.txt`) | all four claims PASS |
| D. load state (`load-state.txt`) | is the landed fix in the running process? | per-commit attribution in the same file | **NEGATIVE** — `6109688` was committed 33 min after the holder started |

## 1. A — the compile probe

`run-probe.sh` is the 2026-10-03 script, reused unchanged (it takes the store path as an argument
because store hashes rotate on every rebuild):

```sh
node --version >/dev/null  # not needed; the probe uses the repo's own tsc
bash .agents/evidence/2026-10-03-dsh-020rc2-api-compat/run-probe.sh \
  "$(ls -d /nix/store/*-dsh-desktop-0.2.1-rc.2 | head -1)" /tmp/dsh-api-probe-021
```

Both halves print `exit=0 errors=0` and no module is missing from the mapping. The control is the
repo's `pnpm typecheck`, which compiles the same sources against `@deepseek-ai/dsh-*@0.1.7-rc.2`
(now the *minimum* peer line, no longer the running one): `exit 0`, `error TS` count 0.

## 2. B — the peer gate, per profile

The runtime version is `dsh --version` = **0.2.1-rc.2** (read now, never quoted), and our peers are
`>=0.1.7-rc.2`, which `includePrerelease: true` accepts.

- **desktop** cannot be dumped (`error: profile "desktop" is managed exclusively by the Electron
  application`), so the gate is read from the running host instead: the host inventory reports
  `include:project-context` `active`/`enabled`, `enabled 但非 active: 0`, and this very session's
  prompt carries the two injected documents — the bundle composed, loaded, and is doing its work.
- **web** and **ctxdev** compose the four rows (`project-context`, `project-memory`,
  `project-autolearn`, `project-handoff`) with **0** `disabled: true` among them. `dsh
  --profile <p> --dump-config` exits 0 for both.

## 3. C — the one *behavioural* change we had to adapt to

0.2.x added prompt-variable interpolation to `systemPrompt.context`
(`packages/core/system-prompt/src/index.ts`: `PromptContext.interpolate?`, "Defaults to true", and
`renderContextSections` interpolates unless `interpolate === false`). Both of our documents are
prose files, so a literal `{{…}}` inside MEMORY.md or CONTEXT.md would be read as a variable
reference; a *malformed* one throws `malformed prompt variable reference …` while the prompt is
assembled — before the model is called — and fails the whole turn. Commit `6109688` opts both
registrations out.

`interpolate-probe.mjs <store>` decides four independent claims by importing the **host's own**
`renderContextSections` (our pinned types predate the flag, so our types cannot decide it):

| claim | expected | observed |
|---|---|---|
| A default is interpolate-on | `handlebars: {{name}}` → `handlebars: INTERPOLATED` | PASS |
| B the hazard is real | a prose `{{ model }}` throws `malformed prompt variable reference` | PASS |
| C the opt-out works on the context path | `interpolate: false` returns the text verbatim | PASS |
| D our build carries the opt-out | two `interpolate: false` in `lib/project-memory/index.js` | PASS (`["false","false"]`) |

The falsifier is `--lib=<path>`: against a copy with the two flags stripped, D reports
`found []` and the probe exits 1 (`interpolate-probe-control.txt`).

**Status: the claims hold, but the code that carries them is not running.** The host that serves
this session booted 2026-10-19 09:42; `6109688` landed 10:15. Host plugins load at boot and there is
no host-side reload for them, so the running process still registers both contexts *without* the
opt-out. Neither tracked document contains `{{` today (read now:
`grep -c "{{" .agents/memory/MEMORY.md .agents/memory/CONTEXT.md` → 0 0), so nothing is failing
right now; the exposure is any doc, note or skill text that starts carrying a placeholder.

A regression test now pins our side of the contract: `test/literal-injection.test.mjs` applies the
real plugin and asserts both registrations carry `interpolate: false`, with the registration list as
its positive control. Mutation-checked: dropping one flag from `src/` makes the named case red
(`mutant-test.log`), and the tree was restored from a `sha256sum`-verified copy.

## 4. Honest limits

- `tsc` proves the **type** surface. A field that changed meaning without changing type passes
  leg A; leg C is the one place this round had to read the new source and *behaviour* instead.
- A byte-level `diff` against the 0.1.7 line (the 2026-10-03 pass's leg B) is no longer possible:
  no `*-dsh-desktop-0.1.7-rc.2` or `0.2.0-rc.2` store path survives in `/nix/store` (GC), so there is
  no baseline tree to diff. The compile probe and the live host stand in for it.
- The desktop peer gate is inferred from the running host rather than from a composed dump, because
  the desktop profile refuses `--dump-config` by design.
- This round does not re-derive the 0.2.1 line's other behaviour; only the surfaces this repo
  actually uses were checked, and only the prompt-context one changed meaning.

## 5. What this round hands to the user

One restart of the desktop host makes `6109688` live. No `src/` or `lib/` change is pending besides
that commit, so the load criterion is the whole-tree one:
`node .agents/evidence/2026-10-11-pre-restart-readiness/check.mjs --port <the new port>` must print
`VERDICT: POSITIVE` (holder start later than `6109688`'s commit time). The restart script and
`/memory update` remain user-only.
