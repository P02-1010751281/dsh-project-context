---
name: dsh-plugin-settings-card-key-wiring
description: "Add, move, or split a configuration key across dsh-project-context's four dsh plugin settings cards (shared / memory / autolearn / handoff): pick the owning entry, wire the schema + resolver on all four surfaces, keep publish narrow, update client rows and both test faces, pass the gates, and hand the profile/restart migration to the user."
derived_from: autolearn
evidence: ["session-278cee57-20db-456c-b873-6a81d174a359", "session-95ba96da-d9db-4904-bc83-220ec0f133a4", "session-574c148f-4117-4268-abe8-85ce5b0cb739"]
---

<!-- autolearn-generated: this skill may be superseded by a later autolearn pass -->

# Wire a config key into the four-card settings split

Use when adding a new setting to a dsh-project-context plugin, moving an existing key between cards, or splitting/merging setting cards. Four dsh plugins share one settings namespace; `project-context` is the only publisher, and each of the four builds its own `currentConfig()` closure from `withShared(livePluginConfig(host, entry, resolve<Card>Config), effectiveSharedSettings(entry))`.

## 1. Read before deciding
- Spec: `docs/batch-ac-settings-split-spec.md` (§2.2 key-ownership rules, §8.3 decisions, §8.4 profile/restart coordination).
- Current wiring, by symbol rather than by remembered path: `src/shared/config.ts`'s exported `resolveSharedConfig` / `resolveMemoryConfig` / `resolveHandoffConfig` / `resolveAutolearnConfig` (the private `resolveCard` behind them is not exported), `src/shared/settings.ts`'s exported `publishProjectContextSettings` / `effectiveSharedSettings` (the private `readLiveSettings` behind them is not exported), the four `src/<plugin>/index.ts` entries, `client/card-fields.ts` (`ProjectContextSettings`, `ROWS`, `SECTIONS`).
- Which entry calls `apply()` with that key today: `grep -rn 'currentConfig()' src/`.

## 2. Pick the owning card
- A key read by more than one entry belongs to the **shared** card (precedent: `handoffLang`, because `receiptLanguage` from `src/shared/receipt-language.ts` is read by all four).
- Current shared ten: `archiveEnabled`, `forceDedupeMs`, `handoffLang`, `maxMemoryChars`, `maxOutputTokens`, `maxTokens`, `model`, `provider`, `sessionSettledDays`, `taskMode`; memory 3, autolearn 4, handoff 6 (23 total).
- Functional entries must read shared values merged through `currentConfig()`, never re-declare them; a key declared on the wrong card must be rejected, not ignored.

## 3. Server side (four surfaces)
1. `src/shared/config.ts`: add the field to the right card schema + resolver; a key present on the wrong card throws `config key "X" belongs to <entry> (<card> card)` (agent-visible, matched by tests).
2. Decide membership with `schema.dict` (the declared set), **not** the projected object — schemastery passes undeclared keys through, so `SharedSettingsSchema({handoffEnabled:false})` still contains it while `dict` does not.
3. `src/shared/settings.ts`: only `project-context` exports `PluginSettingsSchema` and publishes. Fields need `volatile` where the card shows them, otherwise `describe()` skips the whole schema and the card silently disappears.
4. Publisher must **narrow the published value to the shared keys before parsing**: the fiber config carries every key that entry declares, so feeding the whole object to a card resolver always throws and pins the plugin silently at apply-time defaults (seen: `maxTokens: 8000` read back as 8192). The narrowing lives in `src/shared/settings.ts` as `sharedKeysOf(raw)` (private, called from the live-read path) and its exported sibling `sharedOf(config)`; there is no `publishedSharedOf`.
5. A missing publisher degrades to `DEFAULT_CONFIG` shared values by name.

## 4. Client side
- `client/card-fields.ts`: add the key to the `ProjectContextSettings` interface (an independent copy — omitting it makes `tsc -p tsconfig.client.json` fail), plus `ROWS` and `SECTIONS`, plus `client/locales.ts` label strings.
- One component serves four cards: rows/sections are passed in, so a new row table must not reintroduce `SegmentedTabs` (removed in Batch AC; it only exists in 0.2.x `ui-primitives` and rejects `size`).
- Geometry lives in `client/styles.ts` (`dshPcRow`). Upstream settings form is one field per row with no hint slot; every extra row costs a hint line.

## 5. Tests (all three faces)
- `test/settings-form.test.mjs`: one assertion line per key (count of ROWS vs schema fields).
- `test/card-config.mjs`: `cardConfig`, `publishSharedFor`, `cardApplied(apply, card)` — suites that drive a real `apply()` go through it so shared keys still get published. A suite with its own wrapper must call the entry directly; going through `cardApplied` a second time drops shared keys.
- `test/client-styles.test.mjs` asserts the parameterised table shape (`rows.map((row) => SPEC_BUILDERS[row.kind](row))`, `sections.map(`) — update it if row tables change.
- Mutation round per `dsh-plugin-mutation-round`: an `unmanaged`/denominator-style counter needs the denormal assertion to turn red.

## 6. Gates and commit
```
pnpm typecheck      # 0
pnpm boundary:check # 0 failed
pnpm docs:check     # exit 0
pnpm test           # all pass (non-TTY: read the exit code, not TAP)
pnpm build          # reproducible
```
- `lib/**` is tracked, so a change touching `src/` or `client/` commits the rebuilt `lib/`.
- New dependency edge? Update the whitelist table in `docs/architecture.md` §2 and the count in `RULES.md` 4.2 in the same commit.
- `CHANGELOG.md` `未发布` entry with the real English test names (Chinese paraphrase gives an empty `grep` later).
- Stage only your own paths (`git add <paths>`); another agent may share the tree.

## 7. Hand the profile migration to the user
- Values live in `~/.dsh/profiles/{desktop,web}/cordis.patch.yml` on the owning `project-context` entry — the repo cannot rename or move them. Back up as `.bak-<date>-<purpose>` before editing, grep the key (line numbers drift).
- A key rename is breaking with no compatibility reader: fix both profiles before restarting, and a stale install fails only half-loudly (`project-context` throws and loses its card; the other three fall back to `DEFAULT_CONFIG`).
- Repin/install with `dsh-profile-sha-pin-lib-parity-verify`; host code loads only after a host restart, client code after `pnpm build` + tab hard reload.
- After restart, prove it live from the running host (Inspector on 9230 / resident module), not from `--verify-only` output.
