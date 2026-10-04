# Probe: does a plugin-sourced call with `tools` really deliver tool calls? (batch B, step 1)

2026-10-04. Read-only w.r.t. profiles: run as `dsh --profile headless --patch probe.yml "…"`, where
`probe.yml` inserts a throwaway plugin from `/tmp`. No profile on disk was modified, the desktop host
was not restarted, `/etc/nixos` was not touched.

## Question

Through the plugin's own request path — a plugin-sourced, **sessionless** `ctx.llm.stream()` call
carrying `tools`, i.e. exactly what `src/shared/model-call.ts` would have to grow — does a real
provider call deliver `tool-call-delta` chunks, a `block-end` carrying the assembled call, and which
finish reason?

## Answer: yes, on the exact route this project uses

Route `deepseek-account`, model `deepseek-flash` — the desktop profile's `agent-default-model`
(`~/.dsh/profiles/desktop/cordis.patch.yml`, `- id: agent-default-model`). Raw transcript is
`out.json` (the successful attempt); decisive lines:

| chunk | what it carried |
|---|---|
| 10 × `tool-call-delta`, all `index: 1`, one `id` | the **first** carries `name: "probe_echo"` with `argumentsDelta: ""`; the other nine carry `name: null` and one JSON fragment each (`{`, `"`, `value`, `"`, `: `, `"`, `ok`, `"`, `}`) |
| 1 × `block-end` (`index: 1`) | the **assembled** `{type:"tool-call", id, name:"probe_echo", arguments:'{"value": "ok"}'}` |
| 1 × `finish` | `{kind: "tool-calls"}` |
| 1 × `usage` | `{inputTokens: 320, outputTokens: 68, totalTokens: 388}` |

Consequences for the implementation, all read off that transcript rather than assumed:

- Prefer the `block-end` block's assembled `arguments`; if accumulating deltas instead, key them by
  `index` and remember `name` from the first delta, because later deltas report `name: null`.
- The finish kind is `tool-calls`. Copying pi's `length` string would silently disable dsh's retry path.
- `toolHistory` can be omitted for a one-shot call: the declaration reaches the provider (the model
  did call the tool).
- A sessionless, plugin-sourced call is routed and streamed normally; no session id is needed.

## Two startup races were paid for — both are false negatives

1. A call fired inside `apply()` returned `NO_ADAPTER` **28 ms** after boot: `llm` being injectable
   proves the *service* exists, not that the route's adapter is registered. (`out.race.json`)
2. Even once the route is registered, its **auth** services may still be missing, which surfaces as
   `MISSING_CREDENTIAL` / `ACCOUNT_SIGN_IN_REQUIRED` — locally, before any HTTP. One second later the
   same call succeeded. (`out.account.json` = the account route after waiting for registration but
   before retrying; `out.json` = attempt 2 of the retry loop)

The probe therefore waits for the route and retries past those two codes; a genuine auth failure
would just keep returning them.

## One artifact is kept on purpose as a self-inflicted counterexample

`out.account-mislabeled.json` records `provider: "deepseek-official"` while the stream call still used
the hardcoded `deepseek-account` — the probe fixed its own reported metadata but not its behaviour.
Every claim above is therefore read from the chunk transcript, never from the fields the probe wrote
about itself.

## Which code this verifies against

- The tool plumbing lives in `@deepseek-ai/dsh-llm-deepseek`: `options.tools` → Anthropic Messages
  `tools:[{name,description,input_schema}]`; `content_block_start` (tool_use) and `input_json_delta`
  → `tool-call-delta`; `content_block_stop` → `block-end`; `stop_reason: "tool_use"` →
  `{kind: "tool-calls"}`.
- The account route reaches it through `@deepseek-ai/dsh-llm-deepseek-account` (62 lines: provider
  registration + auth), which imports `registerDeepSeekProvider` from the same
  `@deepseek-ai/dsh-llm-deepseek` package that `@deepseek-ai/dsh-llm-deepseek-api-key` imports for
  `deepseek-official`. Same adapter, different auth.
- The file read is the file the live desktop host loads: `dsh-llm-deepseek/lib/index.js` has the same
  sha256 (`226e2047…5484`) in the `dsh` CLI store and inside the desktop store. A read-only live
  `Config` list on the running host also shows `include:llm-deepseek-account` and
  `include:llm-deepseek` mounted.

## Boundaries — what this does NOT show

- One route, one model, one tool schema, **one call**. It does not show that the model calls the tool
  for the real `record_memory`/`record_skill` schema; that belongs to the implementation's own tests.
- `/tmp/record-memory-tool-probe/` holds the runnable copy and is volatile; `probe.mjs` + `probe.yml`
  here are the same files.
- Cost: the successful call was 388 tokens (`usage` in `out.json`). Each attempt also ran the
  headless profile's own trivial agent turn for "Reply with the single word ok".

## Re-run

```sh
PROBE_PROVIDER=deepseek-account timeout 260 dsh --profile headless \
  --patch .agents/evidence/2026-10-04-record-memory-tool-probe/probe.yml \
  "Reply with the single word ok"
cat /tmp/record-memory-tool-probe/out.json
```

`probe.mjs` writes to the absolute path `/tmp/record-memory-tool-probe/out.json`; create that
directory first.
