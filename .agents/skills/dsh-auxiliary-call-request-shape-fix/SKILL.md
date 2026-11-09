---
name: dsh-auxiliary-call-request-shape-fix
description: "Fix or prove live a dsh-project-context plugin auxiliary model call whose gateway rejects the request shape (400 thinking.type=disabled, 400 MissingSessionID): gate the change on the shipped dsh declaration plus the store adapter source, fix only in src/shared/model-call.ts reusing the existing metadata resolve, mutation-check, then prove an auxiliary call actually left on the target route."
---

<!-- autolearn-generated: this skill may be superseded by a later autolearn pass -->

# Auxiliary-call request-shape fix and verification (dsh-project-context)

## When to use
An auxiliary (non-main-turn) model call of these plugins fails at the gateway with a *request-shape* error — `400 SCNet: thinking.type=disabled cannot be translated`, `400 MissingSessionID` — or a landed fix to such a call has to be proved live on the running host. Not for main-turn traffic, not for threshold/receipt bugs, not for a section-budget refusal.

## Procedure
1. **Classify from the named line, not from our call path.** Read `.agents/memory/errors.log`: the request-shape failure logs `[memory] Error: plugin model call failed (INVALID_REQUEST): 400 {…}` and names the rejected field and route. A different line, `LlmError: provider "…" has no configured model "…"`, is a stale provider/model pair out of the request-header fallback (`resolveTarget`) during a model switch — a transient, not a request-shape defect.
2. **Gate on declarations and on the store's own adapter before writing code.**
   - Advertised surface: `grep -n 'LlmModelInfo\|ReasoningEffortId\|reasoning' node_modules/@deepseek-ai/dsh-llm/lib/types/types.d.ts`. `LlmModelInfo` carries no effort list, so an effort can only come from the *resolved* info, never from a model entry.
   - Shipped behaviour: read the adapter in the store checkout the running host actually loaded (per `dsh-core-mechanism-liveness-verify`), e.g. `llm-pi-ai/src/adapter.ts`. It rewrites `reasoning === 'off' ? undefined : reasoning`, so naming `off` is byte-identical to naming nothing — any "take the first effort" picker must skip `off` or it buys nothing.
3. **Fix in the single entry point.** All auxiliary calls go through `src/shared/model-call.ts` (`requestPluginTextWithMeta`, `auxiliaryReasoningEffort`), consumed by `src/project-memory/consolidate.ts` and `src/project-autolearn/pass.ts`. Stamp the session id / enabled effort there and reuse the call site's existing `resolveModelMetadata` so no extra RPC is added; keep the field-free request byte-identical for off-only or reasoning-less routes.
4. **Pin the fallback in tests** with a negative assertion (`doesNotMatch` on the field) for the off-only and reasoning-less cases, not only the happy path.
5. **Gate the build and mutation-check.** `pnpm typecheck`, `pnpm test`, `pnpm build`, and prove `lib/` deterministic against a fresh `tsc --outDir $TMP` (only `lib/client.js` extra, it is the esbuild bundle). Run the mutation round per `dsh-plugin-mutation-round`; an unreferenced symbol makes `tsc` report `TS6133`, which is an invalid mutant, not a red.
6. **Independent adversarial review before commit, and re-derive rather than adopt.** Expect the review to attack the *evidence*, not just the code. A router-log `effort` field is magpie's own post-resolution value and cannot prove the client named it — check a known-200 row against what the code at that time could emit before building a 2×2 from it. Never fix from review prose (`dsh-artifact-claim-verification`).
7. **Commit and push scoped.** `git add <paths>` and `git commit -F <msg> -- <paths>` (a second session may be editing: `dsh-project-context-concurrent-writer-guard`). If direct SSH is broken by the fake-ip proxy, push through the tunnel with a temp `known_hosts`, re-check its fingerprint against `known_hosts` first, and verify from the remote itself with `git ls-remote`.
8. **Hand over honestly, and state what is not yet proven.** The change needs the user-only restart; the criterion is `git log -1 --format='%H %cI' -- src/` versus `ps -o lstart= -p <pid>` for the socket holder (`dsh-host-build-restart-verify`). The fix is *behaviourally* verified only when `~/.config/magpie/*.jsonl` shows an **auxiliary** call issued by the plugin path on the target route, and the session's latest `request/header` rows fold to that provider/model — main-turn traffic also carries `tools: []` and looks identical from outside.

## Pitfalls
- A green acceptance probe plus no new error signature does not prove a model-call fix: without an auxiliary call in the router log the fix is loaded but behaviourally unverified.
- `off` is stripped by the adapter and the SCNet gateway rejects the resulting `thinking.type=disabled`; naming `off` is not an escape hatch, and the user selecting Off in the UI still fails — that half is gateway `model_info.thinking_disable_mode`, out of the plugin's reach.
- Naming an effort makes every reasoning-capable route think at that floor, including routes that never broke; declare that cost instead of claiming no regression.
- An error-free run whose last dispatch sits on another provider is a false green (`dsh-post-restart-acceptance-probe`).
- One extra observation is not a second half: prove the stale-pair transient heals by folding the session's latest request headers, not by the absence of further errors.
