# `~/.codex/config.toml` fix for `subagent-codex` — evidence, audit trail, corrections

Date: 2026-11-20. One config change, one collateral side effect, and the corrections four review rounds
forced on earlier versions of this text. Each correction is marked where it applies; the audit trail at
the end says which round produced it.

## What was wrong

`~/.codex/config.toml` ended with:

```toml
[features.async_compaction]
enabled = true
```

The dsh plugin `subagent-codex` spawns the codex build bundled in the dsh store
(`packages/subagent/subagent-codex/src/run.ts:44` resolves `@openai/codex/package.json`, `:50-53`
derives the bin from `bin.codex`, `:136` spawns `[process.execPath, CODEX_PACKAGE_BIN, 'app-server',
'--stdio']`). That build is **0.153.4**; the `codex` on PATH is **0.169.0**. 0.153.4 rejects the table
above with `failed to load configuration: …:26:1: invalid type: map, expected a boolean`, so
`thread/start` returns `-32600` and the call dies **before any model turn** — tested with four model
values (the pinned id, luna, the config default, and omitted), same error each time.

## What was changed

```toml
[features]
async_compaction = true
```

Current file: **27 lines, 1225 bytes**; `diff` against the pre-change backup shows only those two lines
differing.

**Collateral, caused by the author's probes:** codex persisted a project-trust stanza for its working
directory — `[projects."/tmp"]` + `trust_level = "trusted"` — into the same file. Evidence: it is absent
from the 15:44 backup; it was present at 15:54 after probes ran threads with `cwd = "/tmp"`; after the
author removed it, one more such probe brought it back (two sightings, one documented
removal-and-reappearance). The original writer is not identified by any witness. The stanza declares
trust for a world-writable directory (`stat -c %a /tmp` = 1777) to consumers of this file; whether every
codex build honours it was not tested. It was removed, and verification probes now run with
`cwd = "/etc/nixos"` (already trusted), followed by a `sha256sum` check that the file was untouched.

## What the two builds do with that flag

- **0.169.0** supports it: with the edit, `features list` shows the row as `true`, and `codex exec`
  prints `warning: Under-development features enabled: async_compaction`; the control copy with the
  block removed prints no such warning and lists the row `false`.
- **0.153.4 does not have it.** On configs it can load, `features list` prints **135** rows and none is
  `async_compaction` (0 matches); asking it to enable the flag explicitly returns
  `Unknown feature flag: async_compaction` (exit 1); with the flag ON vs OFF, `exec` stderr differs only
  by session id **after timestamp normalization**; and it accepts a made-up `[bogus_section_xyz]`
  silently, so the absence of a warning from this build proves nothing about which keys it honours.
  With the original table form it cannot list features at all — exit 1, `failed to load bootstrap
  configuration` — so the 135-row observation applies only to configs that load.

What this establishes about the flag: the named registry flag is absent from 0.153.4. It is **not** a
test of every possible async-compaction behaviour in that build, and none was run.

Consequence: for the plugin, the fix's effect is that **the config loads again**; the flag is inert
there. Deleting the block would fix 0.153.4 equally. The boolean spelling was chosen because dropping
the user's 0.169.0 opt-in was not acceptable — that is a requirement, not a proof of minimality; no
minimality search was done, and shorter spellings exist.

## Matrix

Handshake: `<binary> app-server --stdio` (the bare word `app-server` is not the executable), then
`initialize` with clientInfo `{name,title,version}` and capabilities
`{experimentalApi:false, requestAttestation:false}`, then the `initialized` notification, then
`thread/start` with
`{cwd, ephemeral:true, model:"opendesign/deepseek-v4.1-flash", approvalPolicy:"on-request",
approvalsReviewer:"auto_review", sandbox:"workspace-write"}`. Historical runs used `cwd = "/tmp"` (which
is what wrote the trust stanza); the final verification used `cwd = "/etc/nixos"`. Both were against
`CODEX_HOME` copies, never the live file.

The feature column is a separate probe, and its full form matters:

```bash
CODEX_HOME=<copy> timeout 8 codex exec --sandbox read-only --skip-git-repo-check \
  -C /tmp -m invalid/no-such-model "hi"
```

Raw outputs: `exec-feature-probes/<variant>.txt`. The handshake did not print the feature warning in
these runs.

| variant | 0.153.4 `thread/start` | 0.169.0 `thread/start` | 0.169.0 setting complaint | feature, 0.169.0 | feature, 0.153.4 |
|---|---|---|---|---|---|
| v1 original table form | **`-32600 invalid type`** | ok | — | ON | n/a (file cannot load) |
| v2 inline at end | ok | ok | `mcp_servers.magpie.features` ignored | OFF | does not exist |
| **v3 `[features]` + boolean (applied)** | ok | ok | none | **ON** | does not exist (`Unknown feature flag`) |
| v4 inline before first table | ok | ok | none | ON | does not exist |

## Verdicts

| claim | verdict | evidence |
|---|---|---|
| C1: the plugin spawns the store's 0.153.4, not PATH's 0.169.0 | CONFIRMED | `run.ts:44/50-53/136`; resolved `…/.pnpm/@openai+codex@0.153.4/…`; `--version` on both |
| C2: the old config fails `thread/start` | CONFIRMED for the four model values tested | same `-32600 … invalid type: map, expected a boolean` each time |
| C3: the new config is accepted by both builds; the 0.169.0 feature survives | CONFIRMED | matrix + `features list` |
| C4: the plugin path completed a live turn | CONFIRMED for the `READY`; the routed 200 is **attributed** by time and route shape, not by a shared id | "Live acceptance" |
| C5: pin is `auto/claude-opus-5-5`, present in the catalog | CONFIRMED | `cordis.patch.yml:1170`; catalog key `slug`, 108 entries, no `gpt-5.6*`. Cite the key, not a line: the line number drifted from 1155 to 1170 and no write event was witnessed for the drift. |

## Post-fix state

- 0.153.4 `thread/start` on the real `CODEX_HOME`, trusted cwd: thread ok; the stderr filter for
  `/invalid|unrecognized/` matched nothing (that is a filtered view, not a clean-stderr assertion).
- 0.169.0 `thread/start`: ok, no unrecognized-setting complaint; feature row `true`.
- Within the behaviours measured here (parse, thread start, feature listing, startup warning), the edit
  changes nothing for the 0.169.0 CLI — the backup already parsed there with the feature ON. The
  practical effect is on 0.153.4.
- `subagent_codex`: thread starts, and a turn completed with `READY` at 16:20. The flag is inert on that
  build (see above).

## A later live run failed at the turn stage

At 16:11 the plugin's turn failed with `stage: turn, category: product-error`. Router row:

```
16:11:31.637  agent=dsh  provider=wandapi  model=claude-opus-5-5  req=group/auto-claude-opus-5-5  status=402  in=0 out=0
```

A direct `codex exec` at 16:12 returned the application error
`402 Payment Required: WandAPI: 账户余额不足以支付本次请求` (that text is the gateway's message, not a shell
exit status).

Availability probes were issued between 16:11:40 and about 16:15:03, with per-command timeouts of 70-90 s
(those are the caps that were set, not measured completion windows for each model):

| model | result |
|---|---|
| `auto/deepseek-v4.1-flash` | answered `READY` |
| `commandcode-plan/deepseek/deepseek-v4.1-flash` | answered `READY` |
| `auto/claude-opus-5-5`, `auto/gpt-6.2-astra` | 402, WandAPI balance |
| `fastai/gpt-6-astra`, `apikeyfan/gpt-6.2-sol`, `auto/claude-sonnet-5-5` | 403, insufficient balance |
| `auto/glm-5.3` | 401 (after earlier 403/429 attempts; retries ran to 16:15:11) |
| `codearts/kimi-k3.1-pro`, `workbuddy/kimi-k3.1-pro` | no answer within the cap; one was cancelled |

At 16:19 a request on the same route succeeded again. That is **route recovery, not a measured account
balance**: no balance API was read. Route recovery alone could explain the change of status; it cannot
explain the reproduced parser error, which stands on its own evidence.

## Live acceptance (16:19-16:20)

```
16:19:48  agent=codex  wandapi  claude-opus-5-5  req=group/auto-claude-opus-5-5  200  in=21022  out=3
16:20:01  agent=dsh    wandapi  claude-opus-5-5  req=group/auto-claude-opus-5-5  200  in=21637  out=3
```

Row 1 is a direct `codex exec`. Row 2 is a codex app-server that sends `clientInfo.name =
"deepseek-harness"` (`wire.ts:270-274` — what the plugin sends; the usage log does not record that
field, so its identity is an inference from shape). It differs from the host's own turns in the same
window, which went to `commandcode-plan` over `/v1/chat/completions`, with no session id and a
240,052-byte system part (237,539 tokens for the whole prompt), while row 2 used `/v1/responses`, a
codex session id, a 68,938-byte system part and 61,680 prompt tokens.

The dsh session event log fixes the second the call happened in:

```
16:20:01.375  tool/call         name=subagent_codex  callId=call_00_h0l8ofrdjgwwf85sxqujn61j
16:20:01.659  subagent/catalog  childId=1aadd8d9-3b19-4c60-89f7-8e146ec66651  name=agent-3
16:20:01.661  tool/result       "started subagent agent-3"
16:20:01.856  usage.jsonl       agent=dsh wandapi claude-opus-5-5 200  (197 ms after the child was created)
16:20:04.737  subagent settled  notice carrying the closing message "READY"
```

No common identifier was found between the router row and the child (searched `~/.dsh/sessions` and
`~/.codex/sessions`); the 16:20:04.737 entry is the notice's own time, not an independently measured
completion time. Quote this as: `READY` confirmed; route attribution inferred.

## Post-audit re-verification (19:15) — added after round 4, not covered by it

After the `/tmp` trust stanza was removed, the tool was run once more with `cwd = "/etc/nixos"` (already
trusted, so no new stanza could be written). The child again returned `READY`, and the config file was
byte-identical before and after (`sha256 6975be27…3b0d`, 27 lines, 1225 bytes, only the
`[projects."/etc/nixos"]` entry present).

The router row for that call:

```
19:15:15.916  agent=dsh  provider=apikeyfan  model=claude-opus-5-5  status=200
              in=4  out=4  cache_write=38236  effort=medium  ms=5808
              ep="/v1/responses → /v1/messages"  session=01a1f8aa-…
              up_bytes=100587  up_parts={system: 87922, tools: 12555}
```

Two things this row teaches that the earlier rows did not:

- `in` counts only uncached input (here 4); the prompt itself is `up_bytes 100,587` with 38,236 tokens
  cache-written. So `in`/`out` are not prompt sizes — the earlier 16:20 row's `in=21637` happened to carry
  no cache write.
- the `auto/` group is not pinned to one upstream: the same `claude-opus-5-5` request went to `wandapi`
  at 16:20 and to `apikeyfan` at 19:15.

Route attribution for this run is stronger than for 16:20: the row carries a codex session id, the
Responses endpoint, and a codex-shaped prompt (system + tools), which the host's own DeepSeek turns do
not produce.

## The two open questions, tested

**Q1 — would some writer put the table form back?**

Writers were exercised, not guessed:

| writer | action | result |
|---|---|---|
| codex 0.164.0 / 0.167.0 / 0.169.0 | `features enable async_compaction` on a copy | rewrites the block as `[features]` + `async_compaction= true` (boolean) |
| codex 0.153.4 (store build) | same | `Unknown feature flag`, file unchanged — this command did not write the key |
| magpie 0.1.4570 | `magpie codex effort high` then `default` | wrote `model_reasoning_effort`; the `[features]` block was left byte-identical, and the file returned to the same sha256 (`6975be27…3b0d`) |

The magpie binary contains four literal occurrences of `async_compaction`: the bare key and three dotted
forms (`features.async_compaction`, `features.async_compaction.enabled`, and
`features.async_compaction.model_async_compact_threshold_percent`). These bytes do not show whether the
key is read or written or whether both shapes are accepted. Its CLI exposes no async field (`fields:
model, effort, subagent, subagent_model, compact_model, subagent_effort, memories, login, scope,
statusline`), and the effort-setting test did not produce the table form.

Conclusion: **none of the tested actions emitted the nested table** — the three newer Codex feature
commands wrote a boolean, 0.153.4 rejected the flag without changing the copy, and the magpie effort
change preserved the block. The original writer is unknown; an untested writer or code path, including
one already installed, could restore it.

**Q2 — would a future store accept the table form?**

All nine dsh-desktop store generations present on this machine — 0.2.2-rc.1, 0.2.1-alpha.2 and seven
0.2.2-rc.3 outputs — bundle codex **0.153.4**, so switching among these nine installed outputs does not change the
bundled Codex version. What changes is the codex version itself; the ladder:

| codex build | table form (`[features.async_compaction]`) | boolean form (`[features]`) |
|---|---|---|
| 0.153.4 (every dsh store here) | **`-32600 invalid type`** | ok |
| 0.164.0 | ok | ok |
| 0.167.0 | ok | ok |
| 0.169.0 (PATH CLI) | ok | ok |

0.153.4 rejected the table. 0.164.0, 0.167.0 and 0.169.0 accepted it; the first compatible release was
not established. Use the boolean, which passed on all four tested builds, and rerun the handshake when a
different Codex build is bundled.

## Failure modes if the table form returns

- **Plugin (0.153.4):** fails at thread start as `stage: thread-start; category: unknown`; the message
  does not name the cause. The parser error reaches the **dsh host's** stderr via `run.ts:261`
  (`writeFileSync(process.stderr.fd, …)`), not a per-child log; where the desktop host's stderr lands was
  not established.
- **CLI (0.169.0):** accepts the table form; no misconfiguration signal.
- **The v2 shape instead:** the CLI warns at every startup; the plugin is silent and unaffected.

## Residual risks

1. `~/.codex/config.toml` is shared. In the tested actions, codex 0.164/0.167/0.169 rewrote the flag as
   the boolean form, 0.153.4 rejected it without touching the copy, and the magpie effort change left the
   block alone. None of those actions emitted the nested table; the original writer is unknown, and an
   untested writer or code path — including one already installed — could restore it.
2. Backout: `~/.codex/config.toml.bak-20261120-154416-dsh-async-compaction-compat`
   (sha256 `81d8210e…37b7`) restores the pre-change bytes. Restoring it brings back the `-32600` failure
   on 0.153.4 and, within the behaviours measured, changes nothing on 0.169.0. The `/tmp` trust stanza
   is on neither side.
3. Deleting the `[features]` block fixes 0.153.4 equally and drops the 0.169.0 opt-in.
4. Store upgrades: all nine installed outputs bundle 0.153.4. 0.153.4 rejected the table form;
   0.164.0, 0.167.0 and 0.169.0 accepted it, and the first compatible release was not established. The
   boolean passed on all four tested builds — rerun the handshake whenever a different build is bundled.
5. Surfacing the JSON-RPC failure code instead of `category: unknown` is a code change and needs its own
   reviewed batch.

## Recommendation

Keep the applied edit: both builds accept it, and it retains the 0.169.0 opt-in. Do not return to the
inline-map form (`mcp_servers.magpie.features`): in the startup paths measured, that leaves the CLI
feature off and warns each time, while gaining nothing for the plugin.

## Audit trail

| round | who | scope | outcome | artifact |
|---|---|---|---|---|
| pass 1 | `codex-config-review` | adversarial review | died mid-run; lead finished the matrix himself (self-verified) | `2026-11-20-codex-config-compat-review/probe-*.mjs` |
| pass 2 | `codex-review-pass2` | audit of the self-verified report | eight observations listed, several evidentiary qualifications; corrections applied | `2026-11-20-codex-config-review-pass2/RESULT.md` |
| round 1 | `audit-r1-factcheck` | fact-check the ledger F1-F14 | `13 PASS, 1 REFUTED, 0 UNVERIFIABLE` (F6's 0.153.4 half) | `…-three-round-audit/round1-factcheck/RESULT.md` |
| round 2 | `audit-r2-adversarial` | alternative causes | `async_compaction` absent from 0.153.4; deletion equivalent for that build; 402/200 confounded | `…/round2-adversarial/RESULT.md` |
| round 3 | `audit-r3-final` | new claims, regression, backout, failure modes | `AMEND`: six defects (trust stanza, 127→135, wording, anchor, CLI equivalence, unverified claims) | `…/round3-final/RESULT.md` |
| round 4 | `audit-r4-proofread` | sentence-by-sentence proofread | 76 claim groups: 43 OK / 29 weak / 4 unsupported → 10 grouped fixes, applied here | `…/round4-proofread/RESULT.md` |
| round 5 | `audit-r5-closure` | the two sections added after round 4 (writer test, version ladder) | `CLOSURE: 4 fixes` — reproduced 8 handshakes and the 9-store inventory; narrowed four claims, applied here | `…/closure/RESULT.md` |

What the rounds changed in this document, in order: the feature warning's observation channel; the
matrix's evidence basis; the `/tmp` trust stanza; the feature count and its scope; the "minimal" claim;
the settings-page attribution for line drift; the sweep window and its interpretation; "allowance
recovered" → route recovery; and the status of the routed 200 (confirmed `READY`, inferred route).