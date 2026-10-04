# ctxdev / headless: the `dsh-experimental-agent-team-profile@0.1.6-alpha.1` pin

**EXECUTED 2026-10-03 — see §7 for the log and for two facts this plan got wrong.** Originally written
2026-10-03 as a plan (nothing executed at the time) for the 0.2.0-rc.2 pre-switch review (`README.md`
in this directory, §3). Every fact below was read off disk or off the installed dsh source at the
revision named; the mechanism in §2 is quoted, not paraphrased. Read §7 before reusing §3.

## 1. What is on disk right now (verified)

| profile | `dependencies` pin | `dsh.profile.bundles` row | profile-local `node_modules` copy |
|---|---|---|---|
| `ctxdev` | `@deepseek-ai/dsh-experimental-agent-team-profile: "0.1.6-alpha.1"` | yes | **yes** — the profile, plus `…-agent-team@0.1.6-alpha.1` and `…-tool-agent-team@0.1.6-alpha.1` |
| `headless` | same pin | yes | **yes** — same three packages |
| `desktop` | *absent* | yes | none |
| `web` | *absent* | yes | none |

So the pin is not a property of the bundle system — it is a **profile-local installation** that two
profiles carry and two do not. `desktop` and `web` have always resolved the bundle without any local
copy, which is why they are unaffected.

The stale trio was pulled in by that one dependency: `dsh-experimental-agent-team-profile` depends on
`dsh-experimental-agent-team`, which needs `dsh-experimental-tool-agent-team`.

Relevant peer ranges (read from each `package.json`):

| package | version | peers that the gate looks at |
|---|---|---|
| profile (local, ctxdev/headless) | `0.1.6-alpha.1` | only `@deepseek-ai/cordis: ^4.0.2` — **no dsh peer** |
| `…-agent-team` (local) | `0.1.6-alpha.1` | `^0.1.6-alpha.1` on eight `dsh-*` packages |
| `…-tool-agent-team` (local) | `0.1.6-alpha.1` | `^0.1.6-alpha.1` on six `dsh-*` packages |
| profile (shipped in the running dist) | `0.1.7-rc.2` | only `@deepseek-ai/cordis: ~4.0.4` |
| `…-agent-team` (shipped in `dsh-0.2.0-rc.2`) | `0.2.0-rc.2` | **exactly `0.2.0-rc.2`** on eight `dsh-*` packages |

`^0.1.6-alpha.1` caps below `0.2.0`, so on a 0.2.0-rc.2 line those rows are unsatisfied. The exact
`0.2.0-rc.2` peers of the shipped copies are satisfied by definition.

Published versions on the registry (`npm view … versions`): `0.1.6-alpha.1`, `0.1.6-alpha.2`,
`0.1.7-alpha.{1,2}`, `0.1.7-rc.{1,2}`, `0.2.0-rc.{1,2}`, plus older ones.

## 2. Why the pin breaks agent-team on the new line (source-verified)

Two different resolvers are involved, and getting them backwards is what makes the fix look wrong.

1. **The bundle row resolves *installation-first*, not profile-first.** In
   `dsh-0.1.7-rc.2/…/@deepseek-ai/dsh-app-boot/lib/index.js`, `resolveBundleDir` iterates
   `[installAnchor, join(profileDir, "package.json")]` and returns the first hit, with the comment:
   *"The installation-first order is the contract that `@deepseek-ai/dsh-base` (and every other in-box
   bundle) always comes from the same installation as the running dsh, never from a profile-local
   copy."* Since `dsh-experimental-agent-team-profile` **is** shipped inside the dsh installation, the
   bundle layer itself already comes from the installation. The local profile copy never wins here.
2. **The rows the bundle inserts resolve local-first, then fall back to the installation.** The
   bundle's `cordis.patch.yml` does not reference files; it inserts rows **by bare package name**:
   `@deepseek-ai/dsh-experimental-agent-team`, `@deepseek-ai/dsh-experimental-tool-agent-team`, and
   (in the 0.1.7+ copy) `@deepseek-ai/dsh-experimental-client-ui-agent-team`. The Loader's
   `routeScoped` loops over `createRequire(parent).resolve.paths(name)`, keeps the search paths *inside
   the profile layer*, and prefers any `localPackageCandidate` it finds there; only when there is no
   local candidate does the route fall through to the installation entry (`kind: "interception"`,
   `entry: target`). That is why a profile-local copy is decisive for these rows and irrelevant for
   the bundle.

Consequence on 0.2.0-rc.2: ctxdev and headless insert the **local 0.1.6-alpha.1** rows, whose
`dsh-*` peers `^0.1.6-alpha.1` fail the compatibility preflight; the rows are denied
(`disabled: true`). Per `compatibility-preflight.ts` (as recorded in `README.md` §3), an incompatible
row reached this way takes its include with it, and that file is never rewritten — so the visible
result is that agent-team does not come up in those two profiles. The profile itself still boots: an
incompatible *bundle* is only collected into `skippedBundles`.

## 3. Recommended action — option A: drop the pin and let the installation's copy win

Rationale: removal is the only candidate that is correct on **both** lines. It makes ctxdev/headless
match desktop/web, which already work; and it removes the thing that is line-specific. Nothing about
the feature is lost — the rows still come from whatever dsh version is running.

```sh
# confirm nothing is serving those profiles first (only 19387 was listening when this was written)
ss -ltnp | grep -E '19387|3080'

dsh plugin --profile ctxdev   remove @deepseek-ai/dsh-experimental-agent-team-profile
dsh plugin --profile headless remove @deepseek-ai/dsh-experimental-agent-team-profile
```

`dsh plugin --profile <p>` forwards to **pnpm** inside that profile directory (verified: with
`--profile` the help text is pnpm's own command list), so `remove` edits `package.json` + `pnpm-lock.yaml`
and prunes `node_modules` in one step. The `dsh.profile.bundles` row must **stay** — desktop/web prove
that the row is enough once no local copy shadows the names.

Expected result, checkable before the switch:

- `grep agent-team ~/.dsh/profiles/{ctxdev,headless}/package.json` → only the `bundles` line, no
  `dependencies` line.
- `ls -d ~/.dsh/profiles/{ctxdev,headless}/node_modules/@deepseek-ai/*agent-team*` → nothing.
- Booting either profile on the running 0.1.7-rc.2 line prints no `skipping profile bundle` line and
  still exposes the agent-team tools (they now come from the installation's `0.1.7-rc.2` copies).

## 4. Rejected alternatives, and why each is worse

| option | why not |
|---|---|
| bump the pin to `0.2.0-rc.2` (it is published) | This is the mirror image of the current bug: the local rows would then declare exactly `0.2.0-rc.2` peers, so on the **running** 0.1.7-rc.2 line agent-team disappears from ctxdev/headless *until* the switch. It converts a post-switch breakage into a pre-switch one. |
| pin `0.1.7-rc.2` | Works today, breaks after the switch. Same trap, other direction. |
| do nothing | ctxdev/headless lose agent-team after the switch, and the blast radius through the denied include is not fully enumerated here. Acceptable only if those two profiles do not matter to you. |
| `dsh plugin allow-version` | Not applicable as a fix (nothing here needs an exemption to install; the pin is on an old version, not a too-new one), and version exemptions carry crash/data-loss risk — they require your explicit consent for one exact `name@version` pair. |
| hand-edit `package.json` + `pnpm install` | Same result as option A, but it leaves the lock and `node_modules` to be reconciled by hand. Use the CLI unless it surprises you. |

## 5. Verification after the switch

1. `dsh --version` and the profile that is actually serving both report the new line.
2. Boot `ctxdev` (and `headless` if you use it) and confirm on stderr that neither prints
   `skipping profile bundle "@deepseek-ai/dsh-experimental-agent-team-profile"`, and that the
   agent-team tools are present.
3. Re-run the peer sweep from `README.md` §3 with the new profile manifests — the expected result is
   `0 incompatible` for ctxdev and headless too.
4. If a row is still refused, read the refusal from the boot log rather than guessing: the mechanism
   in §2 makes it unambiguous which resolution won.

## 6. Honest limits of this plan

- **Executed 2026-10-03; the profiles were not booted.** See §7 for the actual log and for the two
  corrections to §1 and §3.
- The blast radius of a denied include ("the whole include is denied") is taken from
  `compatibility-preflight.ts` as recorded in `README.md` §3; it was **not** re-derived here, and the
  full row set of the include was not enumerated.
- The `routeScoped` local-first behaviour in §2 was read from the 0.1.7-rc.2 `dsh-app-boot` bundle.
  The 0.2.0-rc.2 tree is byte-identical for that file except one added
  `|| process.env.DSH_PROFILE_RESOLUTION === "off"` guard (`README.md` §2), so the reading is expected
  to hold — but it was not re-read in the candidate tree.
- Whether `headless` is used at all was not established. If it is not, the second command in §3 is
  hygiene, not a fix.
- This plan does not touch `/etc/nixos` and does not decide when the switch happens.

## 7. Executed 2026-10-03 — the log, and two corrections to this plan

Approved by the user in the session carrying this plan. Preconditions re-checked first:
`ss -ltnp | grep -E '19387|3080'` showed only the desktop host on 19387 (which serves that session),
so neither `ctxdev` nor `headless` was being served. Manifests and locks were backed up to
`/tmp/agent-team-pin-backup-20261003-113415/` before anything ran.

```sh
dsh plugin --profile ctxdev   remove @deepseek-ai/dsh-experimental-agent-team-profile  # exit 0, "Packages: -8"
dsh plugin --profile headless remove @deepseek-ai/dsh-experimental-agent-team-profile  # exit 0, "Packages: -8"
```

### Correction 1 — the CLI also removes the `bundles` row, so §3's "the row must stay" is wrong

`dsh plugin --profile <p>` does forward to pnpm, but the wrapper then runs `reconcile()` in
`dsh-plugin-manager/lib/index.js`, whose own doc comment is *"Reconcile package removals and newly
installed bundles without re-enabling retained dependencies."* Its filter drops every `bundles` entry
whose dependency row has just disappeared:

```js
const bundles = previous.filter((name) => {
  if (!beforeDeps.has(name) && !dependencies.includes(name)) return true;
  return dependencies.includes(name) && bundleManifest(name, dir, anchor) !== void 0;
});
```

`dsh-experimental-agent-team-profile` was a dependency before and is not one after, so its row is
removed too. Executing §3 literally therefore yields *agent-team gone from both profiles* — the
opposite of §3's stated rationale ("Nothing about the feature is lost"). The row was **restored by
hand** to reach the state §3 actually describes, which is also exactly the state `desktop` and `web`
are already in (row present, no dependency, no local copy). Verified after the restore: both manifests
are valid JSON, mode `600` kept, and `diff` against the backup shows only the removed dependency line.

The restored row is stable: `reconcile()` keeps a `bundles` entry that is not a dependency, so a later
`dsh plugin … install`/`add` will not strip it again.

### Correction 2 — the lockfiles carry an `overrides` block this plan never listed

Both `~/.dsh/profiles/{ctxdev,headless}/pnpm-lock.yaml` contain:

```yaml
overrides:
  '@deepseek-ai/dsh-experimental-agent-team': 0.1.6-alpha.1
  '@deepseek-ai/dsh-experimental-tool-agent-team': 0.1.6-alpha.1
  '@deepseek-ai/dsh-experimental-client-ui-agent-team': 0.1.6-alpha.1
  '@deepseek-ai/dsh-brand': 0.1.6-alpha.1
```

§1's inventory missed it, and §3's checks (`grep … package.json`, `ls … node_modules`) cannot see it.
It exists in exactly these two profiles — `desktop` and `web` carry no agent-team override — so it is
residue of the same local-install setup, not a global condition. It is **currently inert** (nothing
requests those packages, and no local copy shadows the names) and it was **not removed**: it lives in a
generated lockfile, `package.json` has no matching `pnpm.overrides`, and stripping it is a new decision
rather than part of the approved plan. Recorded here as an open item.

### What was verified, and the honest limit

- `dependencies` pin gone; `node_modules/@deepseek-ai/*agent-team*` gone in both profiles.
- `dsh.profile.bundles` row present in both (restored), matching `desktop`/`web`.
- **Static** resolution check: the running installation (`dsh --version` = `0.1.7-rc.2`; the store path
  is `readlink -f "$(command -v dsh)"`, not recorded here) ships all four agent-team packages at
  `0.1.7-rc.2`, and their dsh peers are exactly `0.1.7-rc.2` — so the restored rows now resolve from the
  installation and pass the peer gate on the running line. §1 records that the `0.2.0-rc.2` tree ships
  its own `0.2.0-rc.2` copies with exact `0.2.0-rc.2` peers, so the same holds after the switch.
- **Not done: neither profile was booted.** No `skipping profile bundle` line was observed and the
  agent-team tools were not exercised; §5 remains the post-switch checklist.

## 2026-10-04 note — two statements above are now out of date

Appended by a later session (2026-10-04); nothing above was rewritten.

- **§7 Correction 2 is wrong on both counts.** (1) Provenance: the `overrides:` block lived in
  **`pnpm-workspace.yaml`**, with the lockfile only mirroring it — not "lives in a generated lockfile"
  (the sibling mechanism is visible today in `~/.dsh/profiles/web/pnpm-workspace.yaml`). The pre-image
  **is** directly captured, not inferred: `/tmp/prof-backup-20261003-180508/{ctxdev,headless}/pnpm-workspace.yaml`
  (copied 2026-10-03 18:05, before the cleanup) still carries the block, and `diff` against today's
  61-byte file is exactly those seven lines — the four pins §7 quotes, plus the header comment
  `# 固定 experimental Agent Teams 传递依赖到与 dsh 核心一致的 0.1.6-alpha.1`. `/tmp` is volatile, so the
  comment is quoted here for durability. (2) "was **not removed**" no
  longer holds: the block was removed in the 2026-10-03 cleanup, and neither profile carries the key now.
  Re-check: `grep -n '^overrides:' ~/.dsh/profiles/*/pnpm-workspace.yaml ~/.dsh/profiles/*/pnpm-lock.yaml`
  (the surviving hits are web's cua-driver pair, which is **intentional**). The memory-side statement
  lives in `.agents/memory/CONTEXT.md` under the `0.2.0-rc.2` bullet.
- **The resolution conclusion no longer rests on a static check alone.** Both profiles'
  `dsh --profile <p> --dump-config` resolved all three agent-team packages with no
  `skip`/`incompatible` wording, measured on the switched `0.2.0-rc.2` line. This is composition
  resolution, not a boot: the bullet above stays literally true, and what is still unexercised is
  actually invoking the agent-team tools.
