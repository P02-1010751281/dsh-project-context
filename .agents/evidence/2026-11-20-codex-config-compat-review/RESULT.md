# `~/.codex/config.toml` compatibility fix for `subagent-codex` — evidence and review history

Date: 2026-11-20. This document lists what was changed, what the probes show, and — important — which
claims were corrected by review. It is not a self-certified "all green" report: review pass 2 refuted
seven of the lead's earlier statements, and the corrections are marked.

Review history:

1. Pass 1 (`codex-config-review`) died mid-run after writing probe artifacts.
2. The lead then finished the verification **himself** — self-verified, not a review.
3. Pass 2 (`codex-review-pass2`, independent context) re-derived the facts and audited this document.
   Its report lives in `.agents/evidence/2026-11-20-codex-config-review-pass2/RESULT.md`; every
   correction it demanded is applied below.

## The change under review

`~/.codex/config.toml` (machine-global, magpie-managed) had:

```toml
[features.async_compaction]
enabled = true
```

codex **0.153.4** — the `@openai/codex` the dsh store bundles and `subagent-codex` actually spawns
(`run.ts:44` resolves it; PATH `codex` is 0.169.0) — rejects that shape:
`failed to load configuration: …:26:1: invalid type: map, expected a boolean`, so `thread/start`
returns JSON-RPC `-32600` and `subagent_codex` fails before model resolution.

Two edits were made, the first one wrong:

| # | edit | outcome |
|---|---|---|
| 1 | `features = { async_compaction = true }` at the end of the file | parse error gone, **feature disabled**; 0.169.0 reports the misplaced key |
| 2 | `[features]` + `async_compaction = true` (final) | accepted by both versions, feature genuinely enabled |

## Defect in edit #1

Written after `[mcp_servers.magpie]`, a bare key belongs to that table: the file defined
`mcp_servers.magpie.features`, and top-level `features` stayed unset. 0.169.0 says so:

```
warning: Codex is ignoring 1 unrecognized configuration setting. Check for typos or deprecated settings.
  user (…/config.toml): `mcp_servers.magpie.features` is ignored.
```

So the loss was **silent on 0.153.4 only** (it accepts the file and simply sees no feature); 0.169.0
reports it. The lead's original verification missed it because it only checked that a call returned
READY — a successful call proves the file parses, never that the setting still means what it said.

## Matrix

Handshake = `app-server --stdio`, `initialize`, `initialized`, `thread/start`
(`{cwd:"/tmp", ephemeral:true, model:"opendesign/deepseek-v4.1-flash", approvalPolicy:"on-request",
approvalsReviewer:"auto_review", sandbox:"workspace-write"}`), each binary against a `CODEX_HOME` copy:
`node <store>/.pnpm/@openai+codex@0.153.4/node_modules/@openai/codex/bin/codex.js …` for 0.153.4 and
`/home/user/.nix-profile/bin/codex …` for 0.169.0.

Feature state is a **separate** probe: `codex exec … -m invalid/no-such-model` with an 8 s timeout —
0.169.0 prints `warning: Under-development features enabled: async_compaction` at startup only when the
feature is registered, and the invalid model keeps the call from reaching an upstream. Raw outputs:
`exec-feature-probes/<variant>.txt`. The handshake itself never prints that line.

| variant | 0.153.4 `thread/start` | 0.169.0 `thread/start` | 0.169.0 setting complaint | feature (exec probe) |
|---|---|---|---|---|
| v1 original table form | **error `-32600`** | ok | — | ON for 0.169.0; not evaluable on 0.153.4, which cannot load the file |
| v2 inline at end (edit #1) | ok | ok | `mcp_servers.magpie.features` ignored | OFF |
| v3 `[features]` + boolean (final) | ok | ok | none | ON (`exec-feature-probes/v3-features-table.txt`) |
| v4 inline before first table | ok | ok | none | ON (`exec-feature-probes/v4-inline-top.txt`) |

## Verdicts

| claim | verdict | evidence |
|---|---|---|
| C1: plugin spawns store-bundled `@openai/codex` 0.153.4, not PATH's 0.169.0 | CONFIRMED | `packages/subagent/subagent-codex/src/run.ts:44`; resolved `…/.pnpm/@openai+codex@0.153.4/…`; PATH `codex --version` is 0.169.0 |
| C2: old config fails `thread/start` for every model | CONFIRMED | `-32600 invalid type: map, expected a boolean` with four model ids (pinned / control / config default / omitted) |
| C3: new config is backward compatible, feature preserved | CONFIRMED ONLY AFTER EDIT #2; edit #1 kept parsing but dropped the feature | matrix above |
| C4: the plugin path completes a live turn after the change | CONFIRMED via the session event chain (see "Live acceptance"): the dsh event log pins the `subagent_codex` call and the child's creation to 16:20:01.375/.659, and the router row is 197 ms later | `session-a43aa39f-…/session.v4.jsonl.zstd` events quoted below + `usage.jsonl` |
| C5: pin is `auto/claude-opus-5-5`, present in the catalog | CONFIRMED | `cordis.patch.yml:1155-1158`; catalog key is `slug`, 108 entries, `gpt-5.6*` absent |

## Post-fix state

Final file: 30 lines, 1268 bytes; `[features]` block at 29-30.

- 0.153.4 `thread/start` on the real `CODEX_HOME`: ok, no `invalid type`.
- 0.169.0 `thread/start`: ok, no unrecognized-setting complaint.
- Feature state: ON, proven by the `codex exec` startup warning (not by the handshake).
- `subagent_codex`: thread starts; a turn completed and returned `READY` at 16:20 (see below).

## A later live run failed on balance, not on config

At 16:11 the plugin's turn failed with `stage: turn, category: product-error`. The router log shows why:

```
16:11:31.637  agent=dsh  provider=wandapi  model=claude-opus-5-5  req=group/auto-claude-opus-5-5  status=402  in=0 out=0
```

and a direct `codex exec` at 16:12 returned
`402 Payment Required: WandAPI: 账户余额不足以支付本次请求，请充值后重试`.

Availability sweep that minute (short timeout, real model ids):

| model | result |
|---|---|
| `auto/deepseek-v4.1-flash` | USABLE |
| `commandcode-plan/deepseek/deepseek-v4.1-flash` | USABLE |
| `auto/claude-opus-5-5`, `auto/gpt-6.2-astra` | 402 WandAPI out of balance |
| `fastai/gpt-6-astra`, `apikeyfan/gpt-6.2-sol`, `auto/claude-sonnet-5-5` | 403 insufficient balance |
| `auto/glm-5.3` | 401 unauthorized |
| `codearts/kimi-k3.1-pro`, `workbuddy/kimi-k3.1-pro` | no usable answer within 70-90 s |

The allowance recovered by 16:19; the transport was never the problem in this second failure.

## Live acceptance (16:19-16:20)

```
16:19:48  agent=codex  provider=wandapi  model=claude-opus-5-5  req=group/auto-claude-opus-5-5  200  in=21022  out=3
16:20:01  agent=dsh    provider=wandapi  model=claude-opus-5-5  req=group/auto-claude-opus-5-5  200  in=21637  out=3
```

Row 1 is a direct `codex exec`. Row 2 is a codex app-server reporting `clientInfo.name =
"deepseek-harness"`, i.e. the plugin path in practice; it is distinguishable from the host's own turns,
which in the same window went to `commandcode-plan` over `/v1/chat/completions` with no session id and
a ~240k system prompt, whereas row 2 used `/v1/responses`, a codex session id and ~69k of prompt.

What ties row 2 to that specific invocation is the dsh session event log
(`/home/user/.dsh/sessions/--mnt-Data-Projects-dsh-project-context--/session-a43aa39f-…/session.v4.jsonl.zstd`,
decompressed with `zstd -dc`):

```
16:20:01.375  tool/call         name=subagent_codex  callId=call_00_h0l8ofrdjgwwf85sxqujn61j
16:20:01.659  subagent/catalog  childId=1aadd8d9-3b19-4c60-89f7-8e146ec66651  name=agent-3  mode=external
16:20:01.661  tool/result       "started subagent agent-3"
16:20:01.856  usage.jsonl       agent=dsh wandapi claude-opus-5-5 200  (197 ms after the child was created)
16:20:04.737  subagent settled  closing message "READY"
```

So the tool call, the child's creation and the routed 200 are one causal chain within half a second; the
router row still carries no dsh session id, which is why the identity argument rests on these event
timestamps rather than on the row itself.

## Residual risks

1. `~/.codex/config.toml` is a shared file that magpie and the codex desktop app both touch. Nothing in
   this evidence shows which writer would produce the table form again, so the rewrite risk is plausible
   but **not demonstrated**. If it happens, `subagent_codex` fails at thread start (`-32600`), and the
   tool error folds the cause into `category: unknown` — the JSON-RPC message is only in child stderr.
2. Backout: `~/.codex/config.toml.bak-20261120-154416-dsh-async-compaction-compat`
   (sha256 `81d8210e…37b7`) restores the pre-change file, at the cost of reintroducing the failure.
3. The dsh store stays on codex 0.153.4. Whether a store upgrade would accept the table form is
   **untested**; if it did, this edit would become unnecessary but still harmless.
4. Better attribution is a code change (surface the JSON-RPC failure code instead of
   `category: unknown`); it needs its own reviewed batch and is not part of this fix.

## Recommendation

The applied change (edit #2) should stand. It is the minimal spelling both binaries accept.
Do not revert to edit #1: it trades a loud failure for a feature that silently disappears on the
plugin's codex build.
