# Pass-2 review: `~/.codex/config.toml` `[features]` fix (audit of the lead's self-verified RESULT.md)

Date: 2026-11-20, ~16:22-16:25 +08:00. Reviewer: `codex-review-pass2`. Read-only; every probe ran on a
copy of the config in a temp `CODEX_HOME` (`/tmp/codex-review-pass2-*`). The real file was not touched.

## Verdicts

| # | item | verdict | evidence |
|---|---|---|---|
| 1 | plugin spawns store `@openai/codex@0.153.4`, not PATH 0.169.0 | CONFIRMED | `packages/subagent/subagent-codex/src/run.ts:44` `createRequire(import.meta.url).resolve('@openai/codex/package.json')`, `:50-53` bin = `bin.codex` of that manifest. The store has `node_modules/.pnpm/@openai+codex@0.153.4/.../package.json` → `name @openai/codex version 0.153.4`. PATH `codex --version` → `codex-cli 0.169.0`. The init `userAgent` reads `pass2/0.153.4` for the store JS. |
| 2 | final config accepted by both versions | CONFIRMED | Python JSON-RPC handshake (initialize → `notifications/initialized` → `thread/start`) using the specified params: 0.153.4 returns `id=2 result.thread.id 01a1f80d-068f…`, 0.169.0 returns `01a1f80d-0725…`. stderr for both: no `invalid type`, no `unrecognized`. The only stderr lines are the `/tmp` PATH-alias warning and the bubblewrap notice. |
| 3 | feature ON after the final change | CONFIRMED, but not through the channel the lead names | `CODEX_HOME=<copy> timeout 20 codex exec --skip-git-repo-check -m invalid/no-such-model x` prints `warning: Under-development features enabled: async_compaction…`. Negative control: the same config with the two `[features]` lines removed prints nothing. **The app-server `thread/start` handshake does not print this warning** on 0.169.0, either with a valid model or with `INVALID_MODEL_ID_XXX` (stdout and stderr were both checked for `feature`/`async`). |
| 4 | live success at 16:20:01 is a plugin-path call; 16:11:31 was 402 | CONFIRMED (402); PARTIAL (attribution) | `usage.jsonl` route 1795101059503: `t 16:20:01.856 agent dsh provider wandapi model claude-opus-5-5 status 200 in 21637 out 3 ep "/v1/responses → /v1/messages" session 01a1f80a-85ae…`. 16:11:31.637: `agent dsh wandapi claude-opus-5-5 402 WandAPI: 账户余额不足…`. The 200 row has the shape of codex traffic: Responses wire, a `session`/`native_session` id, and `up_parts.system` ≈ 69k, close to the codex CLI row at 16:19:48 (64k). dsh's own turns in the same window all go to `commandcode-plan` over `/v1/chat/completions`, with no session field and a system part of ≈240k. So the row is a codex app-server spawned under the dsh client label, and the plugin is the only known dsh path that spawns one. The log alone cannot tie the row to *that* tool call, because it has no dsh session id. The proof would be the dsh session event for the 16:20 `subagent_codex` call returning `READY`, and this pass did not read it. |
| 5 | anything else in the config unusable for 0.153.4 | CONFIRMED none blocking, with a limit | `[desktop]`, `capabilities = {remote_compaction="v2"}`, `model_catalog_json`, `http_headers` and `[mcp_servers.magpie]` all pass a full 0.153.4 `thread/start` (thread created, `modelProvider magpie`). Limit: this shows the file parses and the thread starts. It does not show that 0.153.4 *honours* those keys. 0.153.4 printed no unrecognized-setting warning in any probe, including the earlier v2 probe where 0.169.0 did print one. So 0.153.4 may ignore unknown keys silently, and "no warning on 0.153.4" is weak evidence. |

## Overstatements in the lead's report (`2026-11-20-codex-config-compat-review/RESULT.md`)

1. **Line 67** "0.169.0 `thread/start`: ok; `Under-development features enabled: async_compaction` present." The app-server `thread/start` path does not emit that warning. It comes from `codex exec` startup. The fact is true; the cited observation channel is wrong.
2. **Lines 49-50 and the "feature on?" column (42-47).** No artifact in the evidence dir records the warning. `grep -r Under-development` there matches only RESULT.md itself, and `probe-0.169.0-new.txt` is the *v2* run, whose stderr shows the `mcp_servers.magpie.features` complaint. Two cells are also wrong in kind:
   - v1 "yes": 0.153.4 cannot load v1 at all, so the feature is on only for 0.169.0.
   - v4 "yes": there is no artifact for v4.
   The column's conclusion for v3 holds (item 3 above), but as written it is unsourced.
3. **Line 5** "Everything here is reproducible from the commands quoted." The matrix commands are not quoted, and the matrix runs are not in the directory.
4. **Line 24** "feature silently disabled" and **line 128** "silent feature loss" for edit #1. That loss is silent only on 0.153.4. 0.169.0 names it in stderr (`mcp_servers.magpie.features is ignored`, which line 33 of the same report quotes). The plugin runs 0.153.4, so "silent on the plugin path" would be accurate.
5. **Line 68** "the turn then fails only because the upstream account is dry" is stale. It contradicts C4 (line 59) and the "Final acceptance" section (lines 97-110). Delete it or date it to 16:11.
6. **C4 wording (line 59) and lines 104-110** "the second is the real `subagent_codex` tool call". The router log supports "a codex app-server call under the dsh client label". It does not identify the tool call. "End-to-end chain now proven" needs the dsh session event as its second leg.
7. **Residual risk 1 (lines 114-117)** "written by magpie and by the codex desktop app." The magpie half is supported by the file itself, whose `# magpie:` comments mark magpie-managed lines. No evidence is given for the codex desktop app, and no evidence shows that either writer emits the `[features.<name>] enabled = true` table form. The risk is plausible but not demonstrated. Name the writer that produced the original table form before calling the rewrite risk real. "Nothing warns" is fair as a statement about advance warning. The failure itself is loud (`-32600` at thread-start), which the same sentence concedes.
8. **Residual risk 3 (lines 120-121)** "a store upgrade to a version that accepts the table form". 0.169.0 accepts the table form (matrix v1), so this is plausible, but it is untested against any specific store version.

## Recommendation

The change stands. The final `[features]` + `async_compaction = true` parses on 0.153.4 and 0.169.0, starts a thread on both, and keeps the feature on (positive and negative control on 0.169.0). The lead's report needs amendment:
- fix the observation channel for the feature check (line 67, lines 49-50);
- correct the matrix column;
- drop stale line 68;
- soften C4 to the router-log claim, or add the session event;
- qualify the "silent" wording and residual risk 1.

Do not revert.
