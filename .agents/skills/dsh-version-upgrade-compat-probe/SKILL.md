---
name: dsh-version-upgrade-compat-probe
description: "Pre-flight a dsh runtime-line upgrade for the project-context plugins: run the per-profile peer gate and the type-level API-compat probe (with a control line) before and after switching profiles."
---

# dsh version-upgrade API-compat probe

Use before committing a profile to a new dsh runtime line for the plugins in this repo, and again after the switch when a plugin fails to load or the desktop host dies at startup.

## 1. Fix the two revisions
- `dsh --version` -> the line that is running now. Never reuse a remembered version.
- Identify the candidate install tree you intend to switch to; the probe needs its path so module resolution can be pointed at its `lib/types`.

## 2. Peer gate, per profile
The boot gate lives in `dsh-app-boot`: it calls `semver.satisfies(runtime, range, { includePrerelease: true })` and only inspects names matching `@deepseek-ai/dsh` or `dsh-*`. `includePrerelease` is exactly why a `>=x.y.z-rc.n` range accepts a release; if that flag were dropped, prerelease-pinned plugins would be rejected wholesale.
- For every profile carrying these plugins run `dsh --profile <p> --dump-config`, require rc=0, and read the resolved bundles for skip / incompatible wording.
- Expected failure shapes, which are not one class: an incompatible *declared bundle* is only collected into the profile's `skippedBundles` (no loud error), while a plugin reached through a native Include instead gets `disabled: true` on its include line -- and because that include file is never rewritten, one bad entry kills the whole include.
- Before blaming the new line for a plugin that is present or absent, check whether an external manager (e.g. a home-manager module that ensures plugins on every switch) put it there. Compare file mtimes with `home-manager generations`; do not infer from the plugin's version range. That comparison has a false negative: an activation can re-ensure a plugin **without creating a new generation** (2026-10-04: a reinstall while the generation link stayed on 284), so confirm from the user journal (`sd-switch`) before concluding.

## 3. Type-level probe
- Point module resolution for the dsh packages at the candidate tree's `lib/types`, then run `tsc` over both halves of this repo (`src/` and `client/`). Both must be errors=0.
- Run the control line first: the identical probe aimed at the line that is running now. A red control means the probe is broken, not the candidate.
- Never remap `@deepseek-ai/cordis`: it must resolve to the copy inside the dsh package's own `node_modules`, otherwise `Context` augmentations disappear and the run reports a wall of false errors. This has been hit in practice once already.
- Keep the mapping script and the per-item verdicts under `.agents/evidence/<date>-dsh-<version>-api-compat/`, so the next upgrade re-runs the probe instead of re-deriving it.

## 4. Verdict per plugin
For each of the four plugins record: peer satisfied, typecheck verdict, and the upstream API surface it actually touches. A red item must be attributed either to the plugin's use of a changed API or to the probe's resolution before any source edit; a claim about an upstream field, formula, or event shape still has to be confirmed by reading upstream source at a stated revision.

## 5. After the switch
Re-run step 2 against the live profiles and confirm the plugins resolve with no skip/incompatible lines. Restarting the desktop host is the user's call: prove loaded / not-loaded first, then ask.

## Traps
- Do not hard-code the runtime version, store paths, or counts; read them each round.
- A skipped declared bundle and a disabled include entry look nothing alike in the output -- do not collapse them into one failure class or one cause.
- A green peer gate says nothing about the API surface. The two gates are independent and both must be run.
