# Batch H — deployment and load verification (2026-10-05)

The record of the one-time deployment batch H needs (seven config-key renames with **no compatibility
reader**) and of the two post-restart reads that say the new keys are actually live. The ruling and its
deployment block are `docs/batch-h-vocabulary-keys-ruling.md` §6–§7; this file is the observed outcome.

## What was deployed

The four-line block (backup, backup, `sed`, restart) was the **user's** to run: the restart script refuses
inside a dsh session and it ends the session that runs it. Run at 13:55–13:57 in the owner's terminal; the
script reported `旧实例已完全退出（13:57:00）`, `host 已就绪（13:57:06）`, `RESULT: PASS`, and
`electron:242727, host:243659`.

The `sed` was dry-run beforehand on **copies** (`cp` + `sed` into `/tmp`, never the live files): 4 lines
changed, 0 retired spellings left, line counts unchanged (desktop 1171, web 48). The web profile carries
only `handoffKeepTokens` (one code line, one comment line); the desktop profile carries both keys.

## The reads (read-now, after the restart)

| # | check | command | observed |
| --- | --- | --- | --- |
| 1 | backups exist | `ls ~/.dsh/profiles/*/cordis.patch.yml.bak-*-batchh` | `bak-20261005-1355-batchh` in both profiles |
| 2 | retired names gone | `grep -c 'handoffKeepTokens\|handoffAdaptive' …` | **0** in both profiles |
| 3 | profile values present | `grep -n 'handoffBudgetRecentTokens\|handoffThresholdAuto' …` | desktop `handoffThresholdAuto: true`, `handoffBudgetRecentTokens: 0` (with `handoffPendingQuestion: wait`); web `handoffBudgetRecentTokens: 0` |
| 4 | loaded code is later than the code | `ss -ltnp \| grep 19387` then `ps -o lstart= -p 243659` | holder `pid=243659`, start **13:57:02**, later than the last `src/` commit `d0d9dcd` (11:35:56) |
| 5 | `lib/` matches a fresh compile | `npx tsc --outDir /tmp/libcheck` then `diff -rq lib /tmp/libcheck` | only `client.js` extra (the esbuild bundle); 0 mutant markers under `lib/` |
| 6 | the settings-namespace owner applied | `cordis_inspect_query` host/`Config` `listConfigs` `name=dsh-project-context` | entry `include:project-context`, status **`schema`**, `packageDir …/desktop/node_modules/dsh-project-context`, schema carries all **seven new names** and **no retired name**, every one of its 21 fields `volatile: true` (the card-servable condition) |
| 7 | the other three entries are live | same call, `name=dsh-project-context/memory` `/autolearn` `/handoff` | all three status **`absent`** — they export no `PluginSettingsSchema`, so no Config is projected; `absent` is not `inactive` (compare `include:tool-plugin-manager`, which is `inactive`) |
| 8 | the client half knows the new names | `grep -o` over `lib/client.js` | `handoffThresholdAuto` / `handoffBudgetRecentTokens` / `handoffBudgetSummaryTokens` / `handoffThinking` / `handoffPendingQuestion` / `handoffLang` present (5 each), **0** retired spellings |

Reads 3 + 6 together are the two halves of the **card** read in §7: the card's owner is live and its fields
are projectable, and the values the profile persists are the profile's own (`true` / `0` / `wait`) rather
than `DEFAULT_CONFIG`'s (`true` / `20000` / `defer`). A missing card (apply threw on an unknown key) or the
`20000` / `defer` pair would have failed these two.

## Residual, stated rather than glossed

- **Not observable through the inspect surface**: the *effective merged* config the three config-less
  entries read (`effectivePluginConfig(entry)`). What is observable is the discriminator that silent
  fallback depends on — a live settings-namespace publication — plus the profile's persisted values. The
  three entries read that publication, so the fallback is excluded structurally, not by a second read.
- **Not observed in this round**: the batch G observable that only a real pass produces — a marked skill
  name whose body the round did not render being refused with `body not shown this pass`. No autolearn pass
  ran here; it needs one, or `/autolearn approve` on an unshown body.
- The desktop renderer was replaced by the restart, so the client bundle is fresh in that window; a second
  browser tab open on 127.0.0.1:19387 would still need a hard reload.

## The release that followed

`v0.4.0` = commit `a679709`, annotated tag object `b0eda37` (peeled `a679709`), pushed and verified on
origin. Pre-tag gate, read-now: `pnpm typecheck` 0, `pnpm test` **347 pass / 0 fail**,
`pnpm build` 0 with `lib/client.js` 28605 B. Release commit changed only `CHANGELOG.md` (the heading moves
under `v0.4.0` and a fresh `未发布` section opens above it), `README.md` (version line) and `package.json`
(`0.4.0`) — no code, so it needs no restart.
