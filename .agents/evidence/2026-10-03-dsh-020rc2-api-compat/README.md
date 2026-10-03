# dsh 0.1.7-rc.2 → 0.2.0-rc.2: do these four plugins (and their profiles) still fit?

Read-only, pre-boot verification, 2026-10-03. The candidate line was **never booted**; everything here
is static evidence. Two independent legs, each with its own control:

| leg | what it answers | control (0.1.7-rc.2) | candidate (0.2.0-rc.2) |
|---|---|---|---|
| A. compile probe (`run-probe.sh`) | does our host half / client half still **typecheck** against the new line's shipped `.d.ts`? | host `exit=0 errors=0`, client `exit=0 errors=0` | host `exit=0 errors=0`, client `exit=0 errors=0` |
| B. source diff (see `README` §2) | is any surface we use removed or re-shaped? | — | no removal, no shape change; 283 → 288 `@deepseek-ai/dsh*` packages, additions only |
| C. peer-gate sweep (`README` §3) | would `dsh-app-boot` refuse a declared bundle at boot? | desktop/web clean | desktop 0 incompatible of 11, web 0 incompatible of 14 |

## 1. The compile probe, and why the control is not optional

`run-probe.sh <dsh-desktop-store-path>` builds two temporary tsconfigs that map every dsh module this
repo imports to the **candidate tree's own** `lib/types/*.d.ts`, then runs the repo's `tsc` over
`src/` (host half) and `client/` (client half). Run:

```sh
./run-probe.sh /nix/store/<hash>-dsh-desktop-0.1.7-rc.2   # CONTROL: must be green
./run-probe.sh /nix/store/<hash>-dsh-desktop-0.2.0-rc.2   # candidate
```

**The first version of this probe produced a red control and a meaningless red candidate.** Two traps,
both reproduced here:

1. Mapping the dsh packages without mapping `@deepseek-ai/cordis` **loses cordis's `Context`
   augmentation** — every `ctx.commands` / `ctx.systemPrompt` / `ctx.llm` in `src/` then reads as
   "Property does not exist on type 'Context'". The probe must resolve cordis (and schemastery) to the
   *same* copy the dsh `.d.ts` files resolve, which in these trees is
   `<repo>/packages/<group>/<name>/node_modules/@deepseek-ai/cordis`.
2. A red control means the probe is broken, not the API. Never read a candidate result without it.

Honest limit: `tsc` proves the *type* surface, not runtime behaviour. A field that changed meaning
without changing type would pass. Leg B (byte-level `lib/` diffs) covers that gap for the surfaces used.

## 2. Leg B — source diff summary (performed 2026-10-03, both 0.2.0-rc.2 store paths)

- Both `…-dsh-0.2.0-rc.2` store paths are **complete trees**, not a wrapper and a twin: 25,930 files
  each; `diff -rq` differs in exactly two files — `bin/dsh` (each hardcodes its own store path) and
  `dsh-app-boot/lib/index.js` (one extra `|| process.env.DSH_PROFILE_RESOLUTION === "off"` guard).
  Packages live under `<root>/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`.
- **Byte-identical** `lib/` trees for the packages this repo leans on: `dsh-agent`,
  `dsh-session-projection`, `dsh-token-meter`, `dsh-settings`, `dsh-tools`, `dsh-system-prompt`,
  `dsh-workspace`, `dsh-client-ui-slots`, `dsh-client-locale`, `dsh-client-ui-settings`,
  `dsh-client-store`, `dsh-client-modules`, `cordis`, `dsh-llm/lib/types`.
- Differing, all **additive or cosmetic**: `dsh-session` (adds a `ToolCallRecovery` export), the
  `typert.host.js` schema artifacts (`MessageSourceMap` gains `'user-question-reply'`; the
  `SessionEventMap` member list is reordered, nothing added or removed), `dsh-client-ui-primitives`
  (adds `MenuGroup`/`observeStickyMenuGroups`), `dsh-client-ui-renderer` (a `useMemo` move),
  `dsh-api-session-controller` client (one optional param).
- Surfaces we actually read, all unchanged: `sessionProjections.snapshot` + the `contextBreakdown`
  wire view (`{systemTokens,toolsTokens,messageTokens}`), `SessionHeader.origin?: 'subagent'`,
  `LlmResolvedModelInfo.context` (still only `{ contextWindow }`, so the open upstream seam stays
  open, unchanged), `agents.get(id).followup`, `commands.register`, the `session/*` + `agent/*`
  lifecycle events, `SessionStore.get`, `subagents.listChildren`, `ctx.configForms.{get,whileServed}`,
  the client `slots`/`locale` services and the `dsh.client` static-`inject` manifest fields.
- `settings.register` and `settingsScope` are **absent in both** lines — not a 0.2.0 regression, and
  this repo calls neither. The only `@deprecated` marker on anything we use is the synchronous
  `SessionStore.snapshotEvents()` family (`src/project-context/session-log.ts`,
  `session-index.ts`) and it is byte-identical in both lines: a **standing** deprecation, not a new
  one. No CHANGELOG or migration note ships in either tree, so removal timing is UNVERIFIED.

## 3. Leg C — the peer gate, and what it actually does

`dsh-app-boot` decides bundle compatibility with
`semver.satisfies(runtimeVersion, requirement, { includePrerelease: true })` and only inspects peers
named `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*`. Two consequences that shape any upgrade:

- `includePrerelease: true` is what makes `>=0.1.7-rc.2` (this repo's peer line) accept `0.2.0-rc.2`;
  without the flag it would reject it and every bundle declaring it would be dropped.
- An incompatible **declared bundle** is *skipped*, not fatal (`profile.ts` collects it into
  `skippedBundles`); an incompatible **plugin row** reached through a native `Include` is denied with
  `row.disabled = true`, and because that file is never rewritten the whole include is denied
  (`compatibility-preflight.ts`).

Sweep of the four profiles against `0.2.0-rc.2` (`build/v1`, mirrored in the report):

- `desktop`: 11 bundles declare dsh peers, **0 incompatible** → nothing skipped.
- `web`: 14 bundles with dsh peers, **0 incompatible**.
- `ctxdev` / `headless`: each pins `@deepseek-ai/dsh-experimental-agent-team-profile@0.1.6-alpha.1`,
  whose rows `@deepseek-ai/dsh-experimental-agent-team` and
  `…-tool-agent-team` declare `^0.1.6-alpha.1` → **unsatisfied** on 0.2.0-rc.2 (the range caps at
  `<0.2.0`). Those rows get disabled, so agent-team silently disappears in those two profiles unless
  the pin is bumped to a 0.2.0-compatible version.
- The reverse direction is the sharper fact: under the **running** 0.1.7-rc.2 line the **web** profile
  already has plugins pinned to exactly `0.2.0-rc.2` (`dsh-computer-use`, its cua-driver twin, and
  `dsh-mcp-client`) — i.e. web is already only valid on the new line, and the upgrade is what
  un-breaks it.

## 4. Not covered here

- Runtime behaviour of 0.2.0-rc.2 (it has not been booted).
- Whether the launcher/HM side is ready: that belongs to the `/etc/nixos` line
  (`dsh-nix-desktop-launcher-artifact-verify`); a desktop restart alone does not change the wrapper.
- `dsh-rewind-plugin@0.15.0`'s peer line: recorded in the 2026-10-02 crash log, but the package is no
  longer on disk, so it could not be re-read here.
