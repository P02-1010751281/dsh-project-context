# dsh 0.2.1-rc.3 model listing — does it move the two numbers our plugins consume?

Read-only probe, 2026-10-28. Host: `dsh 0.2.1-rc.3` (`n03wa62v81r54b4sx9cygy88fqjhg1cm`), pid 5265 on
`:43071`. Nothing was restarted, no `src/` entry was touched, no network credential was read out.

## The question

The rc.2→rc.3 audit (`.agents/evidence/2026-10-26-dsh-021rc3-behaviour-diff/REPORT.md`) recorded one
downstream delta outside the six packages we import: `dsh-llm-deepseek*` gained remote model listing
(`GET {base}/models`, `modelsTimeoutMs` / `modelsMaxAgeMs`), whose entries may declare
`context_window` and `max_output_tokens`. Two numbers our plugins consume could therefore move with
no type change anywhere:

- handoff's knee reads `LlmResolvedModelInfo.context.contextWindow`;
- memory's `adaptiveOutputTokens` clamps against the model's own output cap.

The audit's verdict was `NEEDS RE-PROBE`, online, reading effective values rather than catalog values.

## What rc.3 actually wires (source at the running store)

| Fact | Where |
| --- | --- |
| listing is implemented only in `llm-deepseek`, `llm-deepseek-account`, `llm-deepseek-api-key` | `grep -rl modelsMaxAgeMs $R/packages --include=*.ts` → those three packages only |
| a listed entry may declare `context_window` / `max_output_tokens` | `packages/llm/llm-deepseek/src/listing.ts:106-119` |
| the listing becomes **the connection's model list** on the account route | `dsh-llm-deepseek-account/lib/index.js:132` — `models: result.resolution` |
| resolution entries = listed models, then built-in models the listing does not offer | `packages/llm/llm-deepseek/src/listed-catalog.ts:35, 116-125` |
| `modelInfo` prefers the entry's own capacity over the route default | `dsh-llm-deepseek/lib/index.js:525` — `configured?.contextWindow ?? connection.defaultContextWindow` |
| our own route does **not** get this | `packages/llm/llm-pi-ai/src/discovery.ts` header: "Neither path is a catalog refresh. Nothing here is stored … `cordis.patch.yml` remains the only thing that decides what a route serves." |

So the delta is real **for the `llm-deepseek*` routes** and cannot reach a `llm-pi-ai` route.

## Which route we are on

Two different answers, and they must not be conflated:

1. **This session** — `command-code` / `deepseek/deepseek-v4.1-flash` (`api: openai-responses`, served by
   `llm-pi-ai`). Configured in `~/.dsh/profiles/desktop/cordis.patch.yml:860ff`:
   `contextWindow: 1000000` on that model, route defaults `defaultContextWindow: 262144` /
   `defaultMaxTokens: 32768`. The rc.3 listing cannot touch these — pi-ai's discovery is a settings
   surface only. Live corroboration: the host-injected handoff status for this session reports
   `窗口 1000000`, i.e. the plugin's resolved window equals the configured value on rc.3.
2. **The profile default** — `id: agent-default-model` → `provider: deepseek-account`, `model:
   deepseek-flash`; `id: llm-deepseek` declares that model with `contextWindow: 1000000`
   (`cordis.patch.yml:1128-1138`). This route **is** an `llm-deepseek-account` route, so its
   `connection.models` is the listing resolution: a listing entry that declares `context_window` for
   `deepseek-flash` would be the value `modelInfo` hands to us, ahead of the `1000000` in the profile.

## Can the effective value be read offline? No.

`ModelListingCache` holds the last successful listing for `modelsMaxAgeMs` (default 10 min) with no
on-disk artefact — `find ~/.dsh -maxdepth 3 -name '*listing*'` and `-name '*models*.json'` both return
nothing, and the cache module carries no persistence call. The listing is fetched over the wire with the
account's own auth, so reading it from here would mean using the user's credentials.

## Verdict

- **`command-code` route (what this session runs): `NO IMPACT`.** pi-ai's discovery never feeds
  resolution, and the configured `contextWindow: 1000000` is what the handoff knee sees (live evidence
  above).
- **`deepseek-account` route (the profile default): `STILL NEEDS AN ONLINE RE-PROBE`**, but it is now a
  *one-line live read rather than an audit*: run `/handoff status` in a session whose route is
  `deepseek-account / deepseek-flash` and read its `context` value. `1000000` ⇒ nothing moved;
  anything else ⇒ the recorded knee/threshold numbers were being derived from a listing entry and must
  be re-derived from the effective value.
- Do not generalize the first verdict to the second: they are different provider packages, and the
  rc.3 delta exists in only one of them.

## Reproducible commands

```sh
R=/nix/store/n03wa62v81r54b4sx9cygy88fqjhg1cm-dsh-desktop-0.2.1-rc.3/lib/dsh-desktop/repo
grep -rl modelsMaxAgeMs $R/packages --include=*.ts | head            # the three llm-deepseek packages
sed -n '100,125p' $R/packages/llm/llm-deepseek/src/listing.ts        # context_window / max_output_tokens
grep -n 'models: result.resolution' $R/node_modules/@deepseek-ai/dsh-llm-deepseek-account/lib/index.js
sed -n '520,535p' $R/node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js   # configured wins, then default
sed -n '1,20p' $R/packages/llm/llm-pi-ai/src/discovery.ts            # settings-only, nothing stored
grep -n 'command-code:' -A 12 ~/.dsh/profiles/desktop/cordis.patch.yml | head -20
sed -n '1124,1140p' ~/.dsh/profiles/desktop/cordis.patch.yml         # the deepseek-account default route
```

## The honest boundary

This is a source read of rc.3 at the running store plus one live observation of the route this session
uses. It does **not** call the listing endpoint, so the one sentence it cannot answer is what
DeepSeek's live listing declares for `deepseek-flash` — that is exactly the line `/handoff status` on
that route answers. `src/` was untouched by this probe; no gate was run because nothing in `src/`
changed.
