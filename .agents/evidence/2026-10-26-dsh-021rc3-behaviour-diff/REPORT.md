# dsh 0.2.1-rc.2 → 0.2.1-rc.3: per-package behaviour/type diff for the four plugins

Read-only audit. Date 2026-10-26. No network, no git writes, no host restart, no `src/`/`lib/`/profile edits.

**Headline: the six packages this repo imports are byte-identical between 0.2.1-rc.2 and 0.2.1-rc.3** — every
file except `package.json`, whose only differences are `version` and the `@deepseek-ai/*` pins. There is
therefore **no public-API delta and no behaviour delta** in the host surface the four plugins touch. The one
real behaviour change in the rc.3 release that can reach these plugins is remote **model listing** in the
DeepSeek provider packages (`dsh-llm-deepseek*`), which are outside the imported six but feed two numbers the
handoff and memory paths consume.

## 1. Material and method

| Item | Path | What it is |
| --- | --- | --- |
| rc.3 npm packages | `/tmp/dsh-delta-2026-10-26/pkgs/0.2.1-rc.3/<pkg>/` (13) | tarballs from `registry.npmmirror.com`, unpacked; integrity-checked against the tarballs |
| rc.2 npm packages | `/tmp/dsh-delta-2026-10-26/pkgs/0.2.1-rc.2/<pkg>/` (13) | same |
| rc.3 full release | `/tmp/dsh-delta-2026-10-26/rc3-all/` (314) | every `@deepseek-ai/*` rc.3 package, extracted from the release's own npm dependency cache `/nix/store/3mgsfc7f8v3dxmhk5pbs6ijm466ki2cl-dsh-0.2.1-rc.3-npm-deps/_cacache` (629 cached URLs)  — extracted by this audit from the read-only store cache; `/tmp/dsh-delta-2026-10-26/name2dir.tsv` maps npm name → rc.2 source dir |
| rc.2 baseline (whole release) | `/tmp/dsh-delta-2026-10-26/dsh021/packages/**/lib` | rc.2 source-tree build, symlinked from the store |
| sweep output | `/tmp/dsh-delta-2026-10-26/delta2.tsv` (per-package: changed-file count, changed paths, only-in-each-side) | raw result of the 314-package sweep |
| rc.3 build identity | `rc3-all/dsh-client-modules/lib/index.js` | `const commit = "be72761"` (rc.2 is `687f282e8625c6b8d11ff58211a90524be2e4317`) |

Commands actually run (all reproducible, no network):

```bash
cd /tmp/dsh-delta-2026-10-26/pkgs
# 1. per-package file-level delta
for p in dsh-agent dsh-commands dsh-llm dsh-session dsh-settings dsh-system-prompt; do
  diff -rq 0.2.1-rc.2/$p 0.2.1-rc.3/$p; done
# 2. sha256 of every non-package.json file, both sides
(cd 0.2.1-rc.2/$p && find . -type f ! -name package.json | sort | xargs sha256sum)   # vs same for rc.3
# 3. only version/pin lines differ?
diff 0.2.1-rc.2/$p/package.json 0.2.1-rc.3/$p/package.json | grep -E '^[<>]' \
  | grep -vE '^[<>] *"(@deepseek-ai/[a-zA-Z0-9-]+|version)": "0\.2\.1-rc\.[23]",?$'
# 4. unpacked dirs really are those tarballs (both versions, all 13): extracted with tar and diff -rq → OK
# 5. whole-release sweep (314 rc.3 packages vs rc.2 source-tree lib, *.map/tsbuildinfo excluded, intersection only)
#    → /tmp/dsh-delta-2026-10-26/delta2.tsv
```

Method validation: the rc.2 source-tree `lib/` used as the sweep baseline is byte-identical to the rc.2 npm
`lib/` for `dsh-agent`, `dsh-commands`, `dsh-llm`, `dsh-session`, `dsh-settings`. `dsh-system-prompt` differs
only by `types/index.js`, a file the npm tarball does not publish — an npm packaging omission, not a change
(rc.2 npm vs rc.3 npm for that package is identical). Two npm-published deltas are build artifacts and were
verified as such: of the 50 changed packages, 47 differ in exactly one file, `lib/client.js`, and that delta
is `\0dsh-css:` region paths (`/build/source/...` → `/home/runner/work/...`) plus regenerated CSS-module class
hashes. The three other single-file deltas are `dsh-client-modules/lib/index.js` (commit banner only),
`dsh-api-session-controller/types/client/sessions/service.d.ts` (JSDoc wording only) and
`dsh-tool-cordis/types/api-catalog.js` (regenerated catalog, §4.3).

## 2. Public-API delta table — the imported packages

Delta is **nil** for all six: all `lib/**/*.d.ts` files are identical, so no exported symbol or type was
added, removed or changed. The table lists the surface each plugin actually uses, to show the call sites were
checked rather than assumed. Verdict for every row: **NO IMPACT**.

| Package | Surface used by `src/` | Call sites | Delta | Verdict |
| --- | --- | --- | --- | --- |
| `dsh-session` | `Session`, `snapshotEvents()`, `deriveMessages()` | [`session-log.ts:184`](src/project-context/session-log.ts), [`session-index.ts:141`](src/project-context/session-index.ts), [`conversation.ts:227`](src/project-handoff/conversation.ts) / `:346` / `:401` / `:414`, [`guard.ts:76`](src/project-handoff/guard.ts), [`shared/conversation.ts:167`](src/shared/conversation.ts) | none (whole package byte-identical) | NO IMPACT |
| `dsh-llm` | `LlmResolvedModelInfo`, `context.contextWindow`, `GenerateOptions`, `UserMessage`, `ContentBlock`/`ToolCallBlock` | [`model-call.ts:9,125`](src/shared/model-call.ts), [`command.ts:116`](src/project-handoff/command.ts) + 60 other `contextWindow` sites, [`archive.ts:19`](src/project-context/archive.ts), [`child.ts:9`](src/project-handoff/child.ts) | none | NO IMPACT |
| `dsh-settings` | settings-form projection, `describe()`/volatile mark | [`shared/settings.ts:42-43`](src/shared/settings.ts) (`.extra("volatile", true)` on every field), [`shared/config.ts:95`](src/shared/config.ts) (`Symbol.for("cosmokit.volatile.write")`), `ctx.get("settings")` | none | NO IMPACT |
| `dsh-system-prompt` | `ctx.systemPrompt.context(...)`, request-admission `refreshContext` | [`project-handoff/index.ts:189`](src/project-handoff/index.ts), [`project-memory/index.ts:449`](src/project-memory/index.ts), `inject = ["llm","systemPrompt","commands"]` (`index.ts:43`/`:93`) | none | NO IMPACT |
| `dsh-commands` | `ctx.commands.register(...)` | [`project-autolearn/index.ts:89`](src/project-autolearn/index.ts), [`project-context/index.ts:122,134`](src/project-context/index.ts), [`project-handoff/index.ts:243`](src/project-handoff/index.ts) | none | NO IMPACT |
| `dsh-agent` | `Agent`, `agents.get(id).status`, `agent/created|status|disposed`, `session/event|flush|disposed` | [`autolearn/index.ts:70,79,87`](src/project-autolearn/index.ts), [`context/index.ts:66,85,94,101,107,109`](src/project-context/index.ts), [`handoff/index.ts:200,226`](src/project-handoff/index.ts), [`memory/index.ts:468,502,511,519`](src/project-memory/index.ts), [`guard.ts:154,163`](src/project-handoff/guard.ts) | none | NO IMPACT |

The settings surface is exactly the mechanism the brief names: every field of `PluginSettingsSchema` carries
`.extra("volatile", true)` ([`shared/settings.ts:42-43`](src/shared/settings.ts) and the following rows), which
is the schemastery metadata mark `SettingsForms.describe()`'s `volatileForm()` keeps — it is **not** the
`.volatile()` modifier, whose live `Volatile<T>` wrapper would stop the schema from being exported (TS2742,
documented at [`settings.ts:35-40`](src/shared/settings.ts)). The owner then reads each field through the global
`Symbol.for("cosmokit.volatile.write")` ([`shared/config.ts:95-100`](src/shared/config.ts)) because the mark
makes schemastery hand those fields over as live references. Mark, `describe()` projection and symbol registry
are all unchanged in rc.3 (`dsh-settings` and `dsh-schemastery` both `changed=0`).

`tools/pre-execute`: **no call site exists in `src/`** (`grep -rn "pre-execute" src/` → 0), so the denial
surface is not exercised at all; all `dsh-tool-*` packages are unchanged except the generated
`dsh-tool-cordis` API catalog (see §4).

## 3. Public-API delta table — client packages

Our `client/` imports `dsh-client-ui-primitives`, `dsh-client-store`, `dsh-client-ui-slots`,
`dsh-client-ui-renderer`, and injects `dsh-client-locale`, `dsh-client-ui-settings`,
`dsh-client-ui-plugin-manager`.

| Package | Delta | Symbols | Call sites | Verdict |
| --- | --- | --- | --- | --- |
| `dsh-client-ui-settings`, `dsh-client-ui-renderer`, `dsh-client-store`, `dsh-client-ui-slots` | `package.json` only | — | `SnapshotStore` ([`settings-card.tsx:42`](client/settings-card.tsx)), `InjectFace`/`PropsLocale`/`PropsRuntime` (`:45`) | NO IMPACT |
| `dsh-client-locale` | `lib/client.js` differs by CSS-region path + class hash only (build artifact) | — | `import type {} from ".../locale/client"` ([`index.ts:10`](client/index.ts)) | NO IMPACT |
| `dsh-client-ui-plugin-manager` | **ADDITIVE**: `pluginNavigation.openList()` added next to `openBundle()`; `openBundle` body unchanged. Plus READMEs and one CSS-region/hash artifact | `openList(): void` | we consume only the type-only `plugins.bundle.config` SlotMap merge ([`index.ts:16`](client/index.ts), [`settings-card.tsx:44`](client/settings-card.tsx)); no `pluginNavigation` use | ADDITIVE |
| `dsh-client-ui-primitives` | **ADDITIVE**: `TooltipSide` widened `'right'|'bottom'|'top'` → `+ 'left'`, Tooltip placement moved to a new `types/tooltip-placement.ts` (`placeTooltip`), `Menu` gained `minWidthFromAnchor`, `MenuItemButton` gained `current` (renders `aria-current="page"`), new icons `IconAppsAddOutlineRegular/Medium`. `settings-form/form-model.d.ts` (`SettingsFieldSpec`) and `types/index.d.ts` are unchanged | see left | our card uses `SettingsFormModel`, `SettingsValueField`, `Switch`, `Tag`, `settingsNumberField`, `settingsTextField`, `SettingsFieldSpec`/`State`/`Actions`/`Scope`/`Shell` ([`settings-card.tsx:30-41`](client/settings-card.tsx), [`card-fields.ts:15`](client/card-fields.ts), [`locales.ts:3`](client/locales.ts)); **no** Tooltip/Menu/icon use (`grep` → 0) | ADDITIVE / NO IMPACT |

## 4. Behaviour deltas in shipped `lib/*.js`

### 4.1 The behaviour areas named in the brief

| Area | Owning package | rc.2→rc.3 | Evidence |
| --- | --- | --- | --- |
| session events / `deriveMessages` / `snapshotEvents` shapes | `dsh-session` | unchanged | `diff -rq` + sha256 → identical |
| `sessionProjections.snapshot()` wire views (`contextBreakdown` → `{systemTokens,toolsTokens,messageTokens}`) | `dsh-session-projection`, `dsh-session-projection-cache` | unchanged (`changed=0` in the 314-package sweep) | delta2.tsv |
| settings schema / `volatile` mark / `describe()` projection | `dsh-settings`, `dsh-schemastery` | unchanged | delta2.tsv |
| system-prompt context rendering + request-admission `refreshContext` | `dsh-system-prompt` (owner: `packages/core/system-prompt/src/index.ts`), `dsh-agent-loop` | unchanged | delta2.tsv |
| `LlmResolvedModelInfo` / `LlmModelContext` still `{contextWindow}` | `dsh-llm` | unchanged | byte-identical |
| `tools/pre-execute` denial | `dsh-tool-*` | unchanged (only `dsh-tool-cordis`'s generated catalog) | delta2.tsv |
| commands registration | `dsh-commands` | unchanged | byte-identical |
| agent `status`/`disposed` events | `dsh-agent`, `dsh-agent-loop` | unchanged | delta2.tsv |
| subagent activation surfaces (`subagents`, `listChildren`, `dsh-tool-subagent`, `dsh-subagent-*`) | `dsh-tool-subagent`, `dsh-subagent-*` | unchanged | delta2.tsv |

### 4.2 The one real rc.3 behaviour change that can reach us: DeepSeek route model listing

`dsh-llm-deepseek` grew a remote model-listing path (4 changed files + 4 new type modules); `-api-key` and
`-account` follow on the same config.

- `/models` at the origin of the Messages `baseURL`, 5 s deadline (`DEFAULT_MODELS_TIMEOUT_MS`), 10 min max age
  (`DEFAULT_MODELS_MAX_AGE_MS`), new route settings `modelsTimeoutMs` / `modelsMaxAgeMs` (both `volatile`).
- A listing entry declares, per model: `inputModalities`, **`contextWindow?`**, **`maxOutputTokens?`**,
  `systemPromptUpdate?` (`in-history` | `leading-only`), `toolUpdate?` (`in-history` | `addition-only` |
  `leading-only`), plus a client-version requirement.
- `resolveListedCatalog()` offers the listing's models (falling back to this build's catalog when no listing
  succeeded), applies `modelOverrides` per model id, and can refuse a model **before network I/O**
  (`CLIENT_UPGRADE_REQUIRED` / `MODEL_UNSUPPORTED`). `isBuiltInCatalog()` distinguishes an uncustomized `models`
  setting.

Why this is ours: `project-handoff` derives the auto threshold from
`resolved.context?.contextWindow` ([`command.ts:116`](src/project-handoff/command.ts)) and feeds it to
`knee(W)`; `project-memory`'s `adaptiveOutputTokens` clamps against the model's output cap. On rc.3 both inputs
can come from a **remote listing** rather than rc.2's built-in catalog — no type changed in `dsh-llm`, so
nothing would fail loudly; the threshold would simply move, or a `/memory update` would clamp differently.

Verdict: **NEEDS RE-PROBE** (no code change implied). The re-probe must be online (it is a network round trip
to the route) and must read the *effective* `contextWindow` and output cap the host reports for the routed
model after upgrade — not the built-in catalog values — before trusting any recorded threshold number.

### 4.3 Whole-release sweep (context, not required by the brief)

314 rc.3 packages vs the rc.2 source build: **230 unchanged**, 50 changed, 21 with no rc.2 counterpart
(`dsh-dsh` CLI, vendored `dsh-cordis*`/`dsh-schemastery`, `dsh-libreoffice-kit*`, `dsh-node-addon-system*`,
`dsh-web-frontend`, `dsh-client-ui-entry-customization` — these are published outside the rc.2 repo tree and
were **not** compared). Of the 50: 47 are the build-artifact `lib/client.js` bundles described in §1 (plus the JSDoc-only
`dsh-api-session-controller` d.ts and the `dsh-client-modules` commit banner); the substantive
ones are the six client contract packages we do not import (`dsh-client-ui-conversation` 9 files,
`-sidebar` 6, `-sidebar-right` 5, `-workspace` 2, `-agent-preset` 2, `-sidebar-terminal` 2 —
new `*-pins.d.ts` slot contracts), `dsh-client-product-analytics` (4), `dsh-experimental-inspector`
(devtools bundle), the three `dsh-llm-deepseek*` packages, and `dsh-tool-cordis` (regenerated API catalog, e.g.
a new `AnalyticsPreset` type — a tool catalog we never call).

## 5. Upgrade guides newer than v0.2.1-alpha.4

**rc.3 ships none.** Searching all 314 rc.3 packages for `docs/upgrade-guide`, any `upgrade*` path, or a
`CHANGELOG*` returns nothing but `dsh-libreoffice-kit-wasm/sources/docs` (vendored LibreOffice sources,
unrelated). No rc.3 source tree exists on this machine: the store has `dsh-lib-0.2.1-rc.3` (CLI bundles +
`lib/types`) and `dsh-0.2.1-rc.3-npm-deps` (the npm cache used here), but no `repo/docs`. The newest guide on
disk remains `/tmp/dsh-delta-2026-10-26/dsh021/docs/upgrade-guide/v0.2.1-alpha.4`, i.e. the previous audit's
ceiling. The delta above is therefore derived from the shipped `lib/` only, as the brief allows.

## 6. Bottom line

**Would the current `lib/` (compiled against 0.1.7-rc.2 types, running on 0.2.1-rc.2) keep working unchanged
on 0.2.1-rc.3? Yes.** Nothing needs a fix:

- All six peer-surface packages are byte-identical, so plugin `apply()`, service injection, command
  registration, event filters, projections, settings projection and prompt injection behave the same.
- No exported symbol or type was removed anywhere we import, so the 0.1.7-rc.2-compiled output cannot fail to
  resolve. The client deltas are additive only (`openList`, `Tooltip` `left`/flip, `Menu.current`/
  `minWidthFromAnchor`, two icons) and our card uses none of them.
- Peer line `>=0.1.7-rc.2` still admits rc.3, and no `engines.dsh` exists in our manifest to decide otherwise.

**Silent-misbehaviour candidates (re-probe after an upgrade, no code change):**

1. `contextWindow` now potentially listing-sourced → the auto-handoff knee/trigger shifts silently for a routed
   model. Re-derive the threshold from the *effective* resolved context, and re-read `/handoff status`'s
   `threshold auto` line before trusting any recorded ratio.
2. A listing-declared `maxOutputTokens` bounds the route cap → `adaptiveOutputTokens` and
   `RETRY_OUTPUT_HEADROOM_TOKENS` behave differently for `/memory update` (a longer or shorter consolidation
   reply) with no error.
3. A listed model's `systemPromptUpdate` / `toolUpdate` mode (`leading-only` vs `in-history`) decides how the
   system prompt is carried; our two sync context providers are re-evaluated at request admission, so their
   placement can differ per model even though `dsh-system-prompt` itself is unchanged.
4. A route configured with a listing that requires a newer client can now refuse a model outright
   (`CLIENT_UPGRADE_REQUIRED`) — an upgrade can change *which* models a route serves, which changes the
   denominator of every context ratio.

**Evidence limits (stated rather than papered over):**

- No rc.3 source tree or rc.3 upgrade guide on disk → rc.3 "declared intent" is unavailable; everything here
  is read from shipped `lib/`, and the guide ceiling stays at `v0.2.1-alpha.4`.
- The 21 no-baseline packages were not compared, so a change inside `dsh-dsh` (CLI), vendored `dsh-cordis*` or
  `dsh-schemastery` would not be visible here — `dsh-schemastery` matters most, since our `.extra("volatile", true)`
  mark is read by it.
- Three target client packages (`dsh-client-store`, `dsh-client-ui-slots`, `dsh-client-ui-primitives`) are
  absent from the rc.3 release npm cache; they are covered only by the direct npm tarball comparison
  (rc.2 vs rc.3), which is authoritative but not part of the 314-package sweep.
- The 47 build-artifact client bundles were judged noise by inspecting representatives
  (`dsh-client-ui-jobs`, `dsh-client-locale`, `dsh-client-modules`), not all individually.
- The rc.2 sweep baseline is a source-tree build; five of the six scoped packages matched the npm tarball
  exactly, which bounds (but does not eliminate) the risk of a packaging-only false diff.
- The listing behaviour could not be exercised offline: the re-probe must run against a live route.
- **Citation timing.** All `src/` and `client/` file:line references were read between 17:14 and 17:20 on
  2026-10-26. While this audit ran, another writer modified `src/project-handoff/{conversation,language,
  perform,summary}.ts` and `src/shared/conversation.ts` and rebuilt `lib/` (mtime 17:24:56), so those
  particular line numbers may have shifted since; the packages' delta conclusions do not depend on them.
  This audit made no write outside this report directory (`git status` shows this directory as the only
  untracked addition from it).
