---
name: dsh-declared-type-shim-removal
description: "Remove a hand-written structural type shim (an `export interface XLike {…}` mirror in src/project-*/runtime.ts) from dsh-project-context by importing the upstream package's declared types, with the devDependency-not-peer decision, a two-sided tsc discriminator, a zero-runtime-import proof and a mutation round."
---

<!-- autolearn-generated: this skill may be superseded by a later autolearn pass -->

# Remove a declared-type shim in dsh-project-context

Use when a registered shim (`SH-<n>` in `docs/harness-state-machines-spec.md` / `docs/harness/integration.md`) exists only because a plugin mirrors an upstream service by hand (`export interface SessionProjectionsLike {…}` in `src/project-*/runtime.ts`) plus an `as` assertion at `ctx.get(...)`, instead of importing the package's declared types. Prerequisite: `cross-harness-interface-shim-registry` has cleared the shim's removal blockers; this skill executes the removal. Restart/loaded-state verification belongs to `dsh-host-build-restart-verify`, the mutation procedure to `dsh-plugin-mutation-round`.

## 1. Pin the source that owns the shape
- `dsh --version`; the loaded tree is `/nix/store/<…>-dsh-desktop-<version>/lib/dsh-desktop/repo` — confirm the version matches the running host (see `dsh-core-mechanism-liveness-verify` for the pin).
- Find the registrar: `grep -rn "<projectionName>" <repo>/packages --include='*.ts'` (e.g. `contextBreakdown` is registered by `packages/llm/token-meter/src/breakdown-projection.ts`).
- Read the declaring module and the registry type (`@deepseek-ai/dsh-session-projection`) to get the real field shape; a projection cache row (`{nodes, breakdown}`) and the `snapshot()` wire view (`{systemTokens, toolsTokens, messageTokens}`) differ, so take the shape from source, not from our call path.

## 2. Swap the interface for the declared type
- In `src/project-*/runtime.ts` delete `export interface …Like` and `import { type X } from "@deepseek-ai/…"`.
- `verbatimModuleSyntax` still emits `import {} from "…"` for a type-only import, which is a real module load. If the importer must stay host-free (a pure decision core reaches it), move the pure types into their own module first — that is why `src/project-handoff/measure.ts` exists separately from `runtime.ts`, which imports `dsh-session`.
- Drop the `as …Like` assertions at call sites (`src/project-handoff/gate.ts`, `command.ts`): `ctx.get("sessionProjections")` now returns the declared type.

## 3. Put the packages in devDependencies, not peerDependencies
Optional services (absent → `projectionEnvelope` returns `undefined`, the receipt reads `harness envelope unavailable`) do not belong in `peerDependencies`: peer is the "host must provide" contract and would add failure rows to the boot peer gate for hosts that legally omit the service. Type imports erase at compile time, so runtime has no dependency. Pin to the declared line (`.agents/memory` policy). Install with the store-pinned pnpm — PATH's pnpm is another major and rewrites `pnpm-lock.yaml`; read `command -v pnpm` fresh.

## 4. Build a two-sided discriminator, never a tautology
`test/fixtures/<name>/{positive.ts,negative.ts,tsconfig.json}` driven by `test/<name>-typing.test.mjs`, both fixtures compiled with `tsc` and their exit codes asserted:
- positive: reads the declared key; with the owning package's import removed the key type collapses (to `never`) and the read stops compiling → the control must go red.
- negative: an annotated `: any` read of a one-character-wrong key must COMPILE; the test fails when it does. This is what proves the check is not satisfied by `any`.
- If a failure message reports "fixtures were not compiled", make the failing assertion speak first instead — a wrong cause is the defect class here.

## 5. Mutation round
At least three mutants on the changed logic (e.g. return only `systemTokens` and drop `toolsTokens`; delete the "both fields non-numeric → `undefined`" guard; mislabel the source enum `"projection"` as `"meter"`). Each: compile to `lib/`, confirm the marker is in place (`grep -n "<NAME> = " lib/…`, not `grep -F` of a template — `tsc` emits `String.raw` plus a space), named test red, restore from a hash-verified `/tmp` copy (never `git checkout --`), rebuild to 0 markers.

## 6. Gate, evidence, docs
- `pnpm typecheck` 0; `pnpm test` read pass/case counts; `pnpm build` 0; `git diff --exit-code -- lib` clean (only expected extra: `lib/client.js`); `grep -c "<removedInterfaceName>" src/` = 0.
- Prove the host-free claim by counting transitive `@deepseek-ai/*` imports in the compiled `lib/<plugin>/<file>.js` — expect 0 for the pure core.
- Evidence pack `.agents/evidence/<date>-<shim>-removal/`: `README.md`, the probe scripts, `probe-output.txt`.
- Update `docs/harness/integration.md` / the spec: mark the shim removed and list the residuals that survive (e.g. "`ctx.get` for undeclared services is `SH-2`, unchanged").
- Commit code + deps + discriminator + evidence together, tracked docs (`CONTEXT.md`, `CHANGELOG.md`) in a second commit, `git add <paths>` and `git commit -F <msg> -- <paths>`; push, then hand the restart to the user.

## Pitfalls
- A clean `/tmp` sandbox peer check lies: pnpm self-resolves a newer cordis than the real lockfile pins, so `peers check` prints `No peer dependency issues found` while the repo has two. Copy `HEAD`'s `package.json` + `pnpm-lock.yaml` + `.npmrc` into `/tmp` and run the same pnpm as the control; report "0 new unmet peer names", not "0 issues" — the pre-existing rows belong to their own batch.
- Many test files failing at import right after `pnpm install` is an install-layer fault, not the lockfile (the dependency version is unchanged before and after). Prove a missing-file package with `npm view <pkg>@<ver> dist.tarball`, extract, `diff -rq`; the store can sit on NTFS (`stat -f -c %t` on the store root prints `0x7366746e`). Repair only the observed files and record the un-audited remainder as an open task.
- A dangling-relative-specifier scan false-positives on `exports` wildcards (`./src/*`) and on huge single-file bundles (typescript's `./a` / `./b` string literals): classify and filter before reporting counts.
- Do not keep a mechanism sentence you could not read: an unverifiable claim about dsh event dispatch serialization was deleted from the spec rather than left in.
