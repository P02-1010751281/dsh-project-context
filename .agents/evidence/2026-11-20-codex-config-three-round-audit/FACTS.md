# Fact ledger — `~/.codex/config.toml` / `subagent-codex` fix

Every load-bearing statement in `.agents/evidence/2026-11-20-codex-config-compat-review/RESULT.md`
is reduced here to one numbered fact with the command that decides it. Reviewers verify against this
ledger; the proofreader checks the document against it; anything not in the ledger is not evidence.

Status column is filled by the fact-check round, not by the author.

| id | claim | how to decide it |
|---|---|---|
| F1 | The `subagent-codex` plugin spawns the store-bundled `@openai/codex`, not the PATH `codex`. | `packages/subagent/subagent-codex/src/run.ts:44` resolves `@openai/codex/package.json`; `:50-53` derives the bin; `:135-137` returns `[process.execPath, CODEX_PACKAGE_BIN, 'app-server', '--stdio']`. Resolve the same package from the store and read `version`. |
| F2 | PATH `codex` is a different build: 0.169.0. | `codex --version` |
| F3 | The original config (`[features.async_compaction]` + `enabled = true`) makes 0.153.4 fail `thread/start` with `-32600 failed to load configuration: …:26:1: invalid type: map, expected a boolean`, for every model id. | Copy the backup to a temp `CODEX_HOME`; handshake 0.153.4 with four model values (pinned / another / config default / omitted); all four must return the same `error.code` and message. |
| F4 | The final config (`[features]` + `async_compaction = true`) is accepted by 0.153.4 AND 0.169.0; neither prints `invalid type` nor `unrecognized configuration setting`. | Same handshake against a copy of the live file with both binaries; capture stderr. |
| F5 | After the final config the feature is actually ON, and the discriminator is the `codex exec` startup warning — not the handshake. Negative control: the same file with the two `[features]` lines removed prints nothing. | `CODEX_HOME=<copy> timeout 8 codex exec --sandbox read-only --skip-git-repo-check -C /tmp -m invalid/no-such-model x`; grep `Under-development features enabled`; repeat on the control copy. |
| F6 | Edit #1 (`features = { … }` written after `[mcp_servers.magpie]`) parsed but silently lost the feature on 0.153.4, and 0.169.0 reported `` `mcp_servers.magpie.features` is ignored ``. | Same copy trick with that variant; grep `unrecognized configuration setting` and the feature warning. |
| F7 | At 16:11:31.637 the plugin's turn failed with upstream 402 (wandapi / claude-opus-5-5). | `/home/user/.config/magpie/usage.jsonl` row for that timestamp; status 402, in 0 out 0. |
| F8 | At 16:20:01.856 a routed call succeeded: wandapi / claude-opus-5-5 / 200, on `/v1/responses`, with a codex session id and ~69k system prompt. | Same file; also compare against the host's own rows in the window (commandcode-plan, `/v1/chat/completions`, no session id, ~240k system prompt). |
| F9 | That 200 belongs to the specific `subagent_codex` invocation, proven by the session event chain, not by the router row alone. | Decompress `/home/user/.dsh/sessions/--mnt-Data-Projects-dsh-project-context--/session-a43aa39f-…/session.v4.jsonl.zstd`: `tool/call` at 16:20:01.375 (`callId` call_00_h0l8ofrdjgwwf85sxqujn61j), `subagent/catalog` at .659 (`childId` 1aadd8d9-…, name `agent-3`), `tool/result` "started subagent agent-3", settled notice "READY" at 16:20:04.737. |
| F10 | The profile pin is `subagent-codex.config.model = auto/claude-opus-5-5`; that id exists in the gateway catalog whose key is `slug` (108 entries); no `gpt-5.6*` id exists. | `grep -n -A4 'id: subagent-codex$' ~/.dsh/profiles/desktop/cordis.patch.yml`; python over `~/.codex/magpie-models.json` reading `models[*].slug`. |
| F11 | Nothing else in that config blocks 0.153.4 — but that only proves the file parses and a thread starts, not that 0.153.4 honours those keys. | A successful handshake with the live file; plus the observation that 0.153.4 prints no unknown-key warning in any probe (F13). |
| F12 | Current file state: 30 lines, 1268 bytes, `[features]` at the end; backup exists and restores the pre-change bytes. | `wc -l`, `wc -c`, `tail -2`; `sha256sum` of the backup (`81d8210e…37b7`). |
| F13 | 0.153.4 never prints an unknown-key warning, so "no warning on 0.153.4" is weak evidence. | Any probe of a deliberately bogus key on 0.153.4: if it also prints nothing, the claim holds. |
| F14 | The 16:12 availability sweep (deepseek-flash usable; opus/astra 402; fastai/apikeyfan/sonnet 403; glm 401) was true at that minute and is time-bound, not a standing fact. | Re-run only to show the values are volatile; a mismatch today does not refute the 16:12 observation. |

## Proofreading checklist (三校)

| id | check |
|---|---|
| P1 | Every claim sentence in RESULT.md maps to F1-F14 plus an artifact file in the directory; no orphan claims. |
| P2 | Volatile numbers re-measured now: file lines/bytes, catalog count, sha256 of backup, `[features]` position, router timestamps. |
| P3 | The matrix commands are quoted and executable as written; handshake params match what the plugin actually sends. |
| P4 | Internal consistency: C4 verdict vs "Live acceptance"; "silent" wording vs F6; residual risk 1 vs what any writer actually emits. |
| P5 | No sentence claims reproducibility for a step that is not in the document. |