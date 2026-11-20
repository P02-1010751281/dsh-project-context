# Adversarial review: `~/.codex/config.toml` compatibility fix for `subagent-codex`

Date: 2026-11-20. Reviewer subagent (`codex-config-review`, `magpie/auto/claude-opus-5-5`) died mid-run
after writing its probe artifacts; the verdicts below were completed by the lead from that partial
evidence plus an independent matrix run. Everything here is reproducible from the commands quoted.

## The change under review

`~/.codex/config.toml` (machine-global, magpie-managed) had:

```toml
[features.async_compaction]
enabled = true
```

codex **0.153.4** — the `@openai/codex` the dsh store bundles and `subagent-codex` actually spawns —
rejects that shape: `failed to load configuration: …:26:1: invalid type: map, expected a boolean`,
so `thread/start` returns JSON-RPC `-32600` and `subagent_codex` fails before model resolution.

Two edits were made, the first one wrong:

| # | edit | outcome |
|---|---|---|
| 1 | `features = { async_compaction = true }` at the end of the file | parse error gone, **feature silently disabled** |
| 2 | `[features]` + `async_compaction = true` (final) | accepted by both versions, feature genuinely enabled |

## Defect the review caught (edit #1)

Written after `[mcp_servers.magpie]`, a bare key belongs to that table: the file actually defined
`mcp_servers.magpie.features`, and top-level `features` stayed unset. 0.169.0 says so itself:

```
warning: Codex is ignoring 1 unrecognized configuration setting. Check for typos or deprecated settings.
  user (…/config.toml): `mcp_servers.magpie.features` is ignored.
```

The lead's original verification missed it because it only checked that a call returned READY — a
successful call proves the file parses, never that the setting still means what it said.

## Matrix (handshake only, no model call; `CODEX_HOME` copies)

| variant | 0.153.4 `thread/start` | 0.169.0 `thread/start` | 0.169.0 setting complaint | feature on? |
|---|---|---|---|---|
| v1 original table form | **error `-32600`** | ok | — | yes |
| v2 inline at end (edit #1) | ok | ok | `mcp_servers.magpie.features` ignored | **no** |
| v3 `[features]` + boolean (final) | ok | ok | none | yes |
| v4 inline before first table | ok | ok | none | yes |

"feature on?" is judged by the observable `warning: Under-development features enabled:
async_compaction`, which 0.169.0 prints only when the feature is actually registered.

## Verdicts on the lead's claims

| claim | verdict | evidence |
|---|---|---|
| C1: plugin spawns store-bundled `@openai/codex` 0.153.4, not PATH's 0.169.0 | CONFIRMED | `createRequire(import.meta.url).resolve('@openai/codex/package.json')` in `packages/subagent/subagent-codex/src/run.ts:44`; resolved `…/.pnpm/@openai+codex@0.153.4/…`; `codex --version` on PATH is 0.169.0 |
| C2: old config fails `thread/start` for every model | CONFIRMED | `-32600 invalid type: map, expected a boolean` with four model ids (pinned / control / config default / omitted) |
| C3: new config is backward compatible, feature preserved | **CONFIRMED ONLY AFTER EDIT #2**; edit #1 kept parsing but dropped the feature | matrix above + `Under-development features enabled` probe |
| C4: live `subagent_codex` works after the change | PARTIAL — true at 15:44 (200, `claude-opus-5-5`, in 21637 / out 2); the 16:11 rerun failed at `turn` with upstream **402**, not a config fault | `usage.jsonl` rows quoted below |
| C5: pin is `auto/claude-opus-5-5`, present in the catalog | CONFIRMED | `cordis.patch.yml:1155-1158`; catalog key is `slug`, 108 entries, `gpt-5.6*` absent |

## Post-fix state

Final file: 30 lines, 1268 bytes; `[features]` block at 29-30.

- 0.153.4 `thread/start` on the real `CODEX_HOME`: ok, no `invalid type`, no unrecognized-setting warning.
- 0.169.0 `thread/start`: ok; `Under-development features enabled: async_compaction` present.
- `subagent_codex` live: thread starts; the turn then fails only because the upstream account is dry.

## Why the second live run failed (not a regression)

`/home/user/.config/magpie/usage.jsonl`:

```
16:11:31.637  agent=dsh  provider=wandapi  model=claude-opus-5-5  req=group/auto-claude-opus-5-5  status=402  in=0 out=0
```

and a direct `codex exec` at 16:12 returns:

```
unexpected status 402 Payment Required: WandAPI: 账户余额不足以支付本次请求，请充值后重试
```

Availability sweep the same minute (short timeout, real model ids):

| model | result |
|---|---|
| `auto/deepseek-v4.1-flash` | USABLE |
| `commandcode-plan/deepseek/deepseek-v4.1-flash` | USABLE |
| `auto/claude-opus-5-5`, `auto/gpt-6.2-astra` | 402 WandAPI out of balance |
| `fastai/gpt-6-astra`, `apikeyfan/gpt-6.2-sol`, `auto/claude-sonnet-5-5` | 403 insufficient balance |
| `auto/glm-5.3` | 401 unauthorized |
| `codearts/kimi-k3.1-pro`, `workbuddy/kimi-k3.1-pro` | no usable answer within 70-90 s |

So the pin is correct and the transport is fixed; the strong-model fleet is unfunded right now.

## Residual risks

1. `~/.codex/config.toml` is written by magpie and by the codex desktop app. Either can rewrite the
   `features` block; a rewrite back to `[features.async_compaction] enabled = true` re-breaks 0.153.4
   with the same `-32600`. Nothing warns; the failure surfaces only as
   `subagent-codex: … stage: thread-start`.
2. Backout: `config.toml.bak-20261120-154416-dsh-async-compaction-compat`
   (sha256 `81d8210e…37b7`) restores the pre-change file, at the cost of reintroducing the failure.
3. The dsh store itself remains on codex 0.153.4; a store upgrade to a version that accepts the table
   form would make this edit unnecessary (not wrong).
4. The plugin's error surface folds the real cause into `category: unknown`; the actual JSON-RPC error
   is only visible in the child's stderr. Better attribution would name the failure code.

## Recommendation

The applied change (edit #2) should stand. It is the minimal spelling accepted by both binaries.
Do not revert to edit #1: it trades a loud failure for a silent feature loss.
