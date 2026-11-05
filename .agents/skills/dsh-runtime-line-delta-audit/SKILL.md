---
name: dsh-runtime-line-delta-audit
description: "Audit a dsh runtime-line change (rc-to-rc, alpha, or a new minor) against the store checkout the running host actually loaded, per API surface the four plugins touch, and record it as an evidence doc with apply / adjust / not-applicable verdicts."
---

<!-- autolearn-generated: this skill may be superseded by a later autolearn pass -->

# dsh runtime-line delta audit

Use when the dsh host has been moved onto a different runtime line (`0.2.1-rc.5` → `0.2.2-rc.1`, `0.1.7-rc.2` → `0.2.1-rc.2`, an alpha bump) and a tracked claim, a receipt, or a user question depends on what changed for **these four plugins**. The output is a per-surface verdict table in `.agents/evidence/`, not a prose summary.

Complements, does not replace: `dsh-version-upgrade-compat-probe` (peer gate + type-level `tsc` mapping, a *separate* pre-flight batch), `dsh-host-build-restart-verify` (is our own code live), `dsh-core-mechanism-liveness-verify` (is a mechanism live at all), `upstream-source-ground-truth-verify` (how to obtain upstream source).

## 0. Pin what is running now — read, never carry forward

A restarted host changes pid, port, and store path. Do not reuse any of them from memory or from the previous turn.

```bash
ss -ltnp | grep -E 'LISTEN'        # find the socket holder pid
ps -o lstart= -p <pid>             # host start time
readlink -f "$(command -v dsh)"    # wrapper store path
dsh --version                      # fresh, every time
```

Store path and version go into the reply, never into a tracked doc (Nix store paths rotate). If a live-inventory probe is used, pass the port read above explicitly — the probe's default `19387` is the **web** host; a desktop restart lands elsewhere (32891, 42841 seen). `fetch failed ×5` then means *wrong port*, not "host not ready".

## 1. Prove our code is the code that runs

```bash
git log -1 --format='%cI %h' -- src/     # must predate the socket holder start
pnpm build
tsc --outDir /tmp/libcheck && diff -rq lib/ /tmp/libcheck
```

Expected diff output: only `只在 lib/ 中存在：client.js` (the esbuild client bundle is not a tsc artifact). Anything else means `lib/` is stale. Three-way acceptance for a landed batch: host start later than the last `src/` commit, `lib/` clean against a fresh compile, and the four plugin rows `enabled=true` in the live inventory.

## 2. Read the shipped source, not the guide

- Guides live in the store repo at `<store>/lib/dsh-desktop/repo/docs/upgrade-guide/`, one directory per version. List them, read only the pages inside the delta.
- **If the pair has no page** (latest page may still be an older alpha), say so in the doc and fall back to source for every line of the table.
- Behaviour is read from shipped `src/`/`lib/` in the store checkout the host loaded, e.g. `packages/core/system-prompt/src/index.ts`, `packages/core/session-projection-*`, `packages/*/src/types.ts`.
- A guide states declared intent; a fact asserted from it must be confirmed in the shipped code before it goes in the table.

## 3. Enumerate surfaces from *our* call path, then verify each

Do not audit the changelog top-down. For every dsh API this repo calls, find the call site in our `src/` and classify it:

| verdict | meaning | evidence needed |
|---|---|---|
| **apply as-is** | ours matches the new semantics by construction | cite shipped code + our call site |
| **adjust** | our code must change | the exact behaviour change, then a scoped fix |
| **not applicable** | our call path never passes/reaches the field | the construction site proving it (e.g. `src/shared/model-call.ts`'s `requestOptions` has no `purpose`, so dsh's declarative `purpose` change cannot touch us) |

Surfaces that recur on this project: `sessionProjections.snapshot(session, ['contextBreakdown'])` (the handoff floor; "with keys" semantics only narrows to the selected cell, so our usage is unbroken), `Session.list` summary `projections`, `SessionSummary.origin` / `.cwd`, `LlmResolvedModelInfo.context` (`{contextWindow}` only, unchanged for lines), `GenerateOptions` field set, `./invariant` subpath exports, `engines.dsh` versus the peer range, `systemPrompt` context interpolation and `refreshContext` at request admission, `subagent-*` config keys.

Config-key trap: a key dsh's schemastery no longer declares is accepted silently and does nothing, so a key visible in a profile's `cordis.patch.yml` is **not** evidence it is read. Check the shipped schema; a row already marked `disabled: true` (e.g. `subagent-codex-tool`) makes a dead `backgroundMode` cosmetic only.

## 4. Prefer a mechanical type diff over prose

```bash
npm pack @deepseek-ai/dsh@<from> @deepseek-ai/dsh@<to>   # in /tmp
tar xf …   # then diff lib/types of the symbols we import
```

List the dsh symbols our `src/` imports (`Session`, `Agent`, `Context`, `GenerateOptions`, `LlmResolvedModelInfo`, `SettingsFieldSpec`, …), diff their declarations across the two lines, and report unchanged / changed / additive-only. Additive exports we never import are never a break.

## 5. State what the audit cannot conclude

`pnpm typecheck` compiles against `node_modules`, which is pinned at the declared peer floor, so it can never go red for a newer line's type surface. Say plainly that the type-level answer requires the `lib/types` mapping probe from `dsh-version-upgrade-compat-probe`, as its own batch — never let the green suite stand in for it.

## 6. Record and land

Write `.agents/evidence/<YYYY-MM-DD>-<from>-to-<to>-compat-audit/README.md` with: the criterion table (surface / live value / verdict), the open tasks this closes, an explicit **scope** section naming what was not audited, and copy-pasteable re-check commands. Do not enumerate commit hashes inside prose — cite `git rev-parse` calls that re-derive them.

Then update `.agents/memory/CONTEXT.md` (one `- ` bullet per statement; never append plain text at the end of a section) and verify it through the built renderer before staging:

```bash
node .agents/evidence/2026-10-06-context-doc-roundtrip/roundtrip.mjs   # byte-identical, 0 items over the 800 cap
```

Commit only the paths this task touched (`git add <paths>`, `git commit -F <msg> -- <paths>`); a concurrent session may be editing the same tree. Push, then confirm `git rev-parse HEAD origin/main` matches.

## 7. Hand-off boundary

A version change is observed only after the user restarts the host — never restart it to make the audit "truer". Leave the restart and `/memory update` to the user; end the turn with the verdict table, the closed tasks, the one thing still unproven, and the exact commands the user would run.
