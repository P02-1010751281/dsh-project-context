# dsh 0.2.2-rc.1: does the new line still typecheck and admit our four plugins?

Read-only pre-flight, 2026-11-05. The candidate line is the line **already running** (the desktop host
restarted onto it at 09:53:41), so this pass answers "does the shipped type surface still fit us and
would `dsh-app-boot` admit our rows", not "is our code live" — the latter is the sibling audit
`.agents/evidence/2026-11-05-rc5-to-022rc1-compat-audit/README.md`, and it concluded PASS.

This closes the open task that the sibling audit explicitly left unproven: plain `pnpm typecheck`
compiles against `node_modules`, which is pinned at the declared peer floor (`0.1.7-rc.2`), so it can
never go red for a newer line's type surface.

| leg | what it answers | control | result |
|---|---|---|---|
| A. host half | does `src/` typecheck against the new line's shipped `.d.ts`? | the repo's own `pnpm typecheck` vs the pinned floor → `exit 0, 0 error TS` | `exit=0 errors=0` |
| A′. client half | does `client/` typecheck against it? | same control | `exit=0 errors=0` |
| B. resolution trace | is the probe really reading the store tree, or silently falling back to `node_modules`? | count where each dsh module resolved | host 21/21 and client 94/94 from the store tree, **0** from `node_modules` |
| C. sensitivity | can this probe ever go red, or is it green by construction? | point `@deepseek-ai/dsh-session` at `dsh-llm`'s types | `exit=2`, **38** errors → RED as expected |
| D. differential | did 0.2.2-rc.1 change the surface relative to the previous line? | the same probe aimed at the `0.2.1-rc.5` store | both halves green on both lines |
| E. peer gate | would `dsh-app-boot` skip or disable our rows? | the host's own `evaluatePluginCompatibility`; negative control at a fake runtime `0.1.0` | satisfied; control reports all six dsh peers unmet |
| F. composition | do `web` / `ctxdev` compose all four rows? | `dsh --profile <p> --dump-config` | `rc=0` both, four rows present, no `disabled` on ours |
| G. live host | is the desktop actually running them? | live-inventory probe with the port read this round | 4 × `active`, `enabled 但非 active: 0`, `RESULT: PASS` |

## 1. A / A′ — the probe, and why the control is the repo's own typecheck

`run-probe.sh` (2026-10-03) is reused unchanged; it takes the store path as an argument because store
hashes rotate on every rebuild:

```sh
bash .agents/evidence/2026-10-03-dsh-020rc2-api-compat/run-probe.sh \
  "$(ls -d /nix/store/*-dsh-desktop-0.2.2-rc.1)" /tmp/dsh-api-probe-022
```

It writes a tsconfig whose `paths` map each dsh package onto `<store>/lib/dsh-desktop/repo/packages/**`
and then runs the repo's own `tsc` over both halves. `missing: (none)` on both halves means every
mapped module was found (a silent gap in the mapping is the failure mode that would make the run
meaningless).

Logs: `logs/probe-022rc1.txt` (candidate), `logs/probe-021rc5.txt` (differential),
`logs/typecheck-control.log` (control).

## 2. B — proving the probe is not reading `node_modules`

`tsc --traceResolution` over the generated configs, counting where each `@deepseek-ai/*` /
`schemastery` module resolved:

| half | resolved modules | from the store tree | from `node_modules` |
|---|---|---|---|
| host | 21 | 21 | 0 |
| client | 94 | 94 | 0 |

`@deepseek-ai/cordis` was **not** remapped and resolves from the store's own `vendor/cordis/lib/types`
— remapping it is the known way to lose `Context` augmentation and get a wall of false errors.

Logs: `logs/trace-resolution-host.txt`, `logs/trace-resolution-client.txt`.

## 3. C — the sensitivity control

A green compile is only evidence if the same config can be made to fail. Rewriting one `paths` entry so
`@deepseek-ai/dsh-session` resolves to `dsh-llm`'s declarations turns the run red with 38 errors
(`Argument of type '"session/event"' is not assignable to parameter of type 'keyof Events'` and
friends) — the mapping is load-bearing, so the green in §1 is not vacuous.

Log: `logs/negative-control.log`.

## 4. D — differential against the previous line

The same probe against the `0.2.1-rc.5` store (that store is still present) is green on both halves
too. So this round's answer is not "we squeaked through a break": there is **no type-surface delta
between rc.5 and 0.2.2-rc.1 that any of our call paths can see**.

Log: `logs/probe-021rc5.txt`.

## 5. E — the peer gate, run as the host runs it

Rather than re-deriving semver by hand, the probe imports the running host's own
`evaluatePluginCompatibility` from `<nix-project>/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js`
and hands it our parsed `package.json`. That function is the same one `dsh-app-boot` uses at boot:

- `packages/boot/app-boot/src/plugin-compatibility.ts` → `semver.satisfies(runtimeVersion, range, { includePrerelease: true })`
- `engines.dsh` decides **alone** when present; ours is absent, so the `peerDependencies` path runs and
  every `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` peer must match.

Result: our manifest is `dsh-project-context@0.4.3`, `engines.dsh` absent, six dsh peers at
`>=0.1.7-rc.2`, runtime read from app-boot itself as `0.2.2-rc.1` → **`evaluatePluginCompatibility`
returns `undefined`**, i.e. every requirement met, so no bundle is collected into `skippedBundles` and
no include line gets `disabled: true`.

The negative control passes the same manifest with a fabricated runtime of `0.1.0`; it reports all six
peers unmet. Both branches are reachable.

Note `@deepseek-ai/cordis` (`^4.0.2`) and `schemastery` (`^3.18.2`) are peers but are **not** gated:
the runtime-version check only inspects names matching `@deepseek-ai/dsh` or `@deepseek-ai/dsh-*`.

Log: `logs/peer-gate.txt`.

## 6. F / G — composition and the live host

`dsh --profile web --dump-config` and `--profile ctxdev` both exit 0 and compose the four rows
(`project-context` / `project-memory` / `project-autolearn` / `project-handoff`) with no `disabled`
key on any of them. `desktop` cannot be dumped (it is managed exclusively by the Electron app), so its
gate is read from the running host: the live-inventory probe reports four `active` rows,
`enabled 但非 active: 0`, wrapper store == store, `RESULT: PASS`.

The probe's default port is the **web** host; a desktop restart lands on a different port each time, so
pass `--url` with the port read from `ss -ltnp` this round. `--expect` takes `moduleName` suffixes —
the profile's link alias — not package names.

Logs: `logs/dump-config.txt`, `logs/live-inventory.txt`.

## 7. Verdict per plugin

| plugin entry | peer satisfied | typecheck (both halves) | upstream surface it touches |
|---|---|---|---|
| `project-context` | yes | green | settings schema, `systemPrompt.context`, `tools/pre-execute` |
| `project-memory` | yes | green | `systemPrompt.context`, `refreshContext`, `GenerateOptions` |
| `project-autolearn` | yes | green | `session/event`, `systemPrompt.context`, skills dir |
| `project-handoff` | yes | green | `sessionProjections.snapshot`, `session/event`, `agents`/`subagents`, `GenerateOptions` |

## 8. Scope — what this pass does not conclude

- **Type surface only.** A field whose type is unchanged but whose *meaning* changed passes every leg
  above; behaviour is the sibling audit's job, and where it mattered it was settled by reading shipped
  source, not by `tsc`.
- **No behavioural probe beyond the peer gate.** Nothing here re-tests the handoff floor, the
  interpolation opt-out, or the consolidation tiers.
- **Not a full changelog sweep.** Surfaces were enumerated from our own call sites, not top-down.
- **The `0.2.2-rc.1` line has no upgrade-guide page** (latest page is still `v0.2.2-alpha.2`), so every
  claim above is anchored to shipped source or a live read, never to guide prose.

## 9. Re-check commands

```sh
# control: our own typecheck (pinned peer floor)
pnpm typecheck

# candidate: map onto the line that is running now
bash .agents/evidence/2026-10-03-dsh-020rc2-api-compat/run-probe.sh \
  "$(ls -d /nix/store/*-dsh-desktop-"$(dsh --version)")" /tmp/dsh-api-probe-now

# prove the mapping is load-bearing (must be >0 from the store, 0 from node_modules)
node_modules/.bin/tsc -p /tmp/dsh-api-probe-now/tsconfig.host.json --traceResolution \
  | grep "was successfully resolved to" | grep -c "^.*nix/store"

# live: read the desktop port first, then probe with it
ss -ltnp | grep LISTEN | grep MainThread
node /etc/nixos/scripts/dsh-live-inventory-probe.mjs --url "http://127.0.0.1:<port>" \
  --expect "$(basename "$(git rev-parse --show-toplevel)"),$(basename "$(git rev-parse --show-toplevel)")/memory,$(basename "$(git rev-parse --show-toplevel)")/autolearn,$(basename "$(git rev-parse --show-toplevel)")/handoff"
```
