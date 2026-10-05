# DSH STORE eligibility (2026-10-05): why `lib/` had to be tracked, and what still blocks a listing

Trigger: [DSH-Store#1145](https://github.com/AI-Scarlett/DSH-Store/issues/1145), opened by the store's
bot on 2026-09-25 with `author-action-required` + `catalog-blocked`: *"runtime artifact is missing from
the fixed Git Commit: ./lib/project-context/index.js …"*. Its live record is
`registry/catalog/details/dsh-project-context.json` → `status: blocked`,
`updatePolicy: external-only`, and a `statusReason` listing the missing entry points.

## The rule, read as code

DSH STORE's verdict is a pure function of `(manifest, git tree, policy)`: the automation reads a fixed
Commit's tree and **never** runs install / prepare / build / test / runtime code. Read at revision
`77743a8` (2026-10-05 04:39 UTC):

| file | what it decides |
| --- | --- |
| `scripts/automate-catalog.mjs` | the manifest-level reasons (repository match, license match, explicit `files`, DSH/Node compatibility, lifecycle scripts, runtime dependencies) and `approved = reasons.length === 0`; the final reason list is capped and stored as `statusReason` |
| `src/package-source-surface.mjs` | the distributable surface: `files` selectors decide what is visible, then `main`/`module`/`exports`/`bin`/`types`/`dsh.bundle.patch` must each exist there as a **blob in the fixed tree** |
| `src/fixed-source-review.mjs` | bounds, symlinks, unsupported artifacts, scan completeness, and the capability signals |
| `registry/automation-policy.json` | `automaticApproval.permissionSignals` — **all six are `false`**, so any one of them blocks |

`reasons` for this repository, computed with the store's own module (see the probe below):

| | before (`lib/` ignored) | after (`lib/` tracked, `git` subprocess removed) |
| --- | --- | --- |
| runtime artifacts in the tree | 9 missing (`lib/**`, incl. `lib/client.js`) | present |
| local module references resolvable | 3 missing (`scripts/import-archives.mjs → ../lib/…`) | resolvable |
| scan complete | no | yes (`runtimeFiles 129`, `runtimeBytes 742719`; bounds allow 240 files / 2 MiB total / 256 KiB per file) |
| capability signals | `files` + `nativeOrExecutableArtifacts` | `files` + `nativeOrExecutableArtifacts` |
| **verdict** | **15 reasons** | **2 reasons** |

## The two remaining reasons are intrinsic

- `files`: the plugin's purpose is writing a project's `.agents/` state; its runtime imports `node:fs`
  (18 modules).
- `nativeOrExecutableArtifacts`: `scripts/import-archives.mjs` is declared in `bin` and carries a
  shebang, so its executable bit is required. Dropping the bit would break the installed CLI.

So the automatic `source-verified` path is unreachable for this plugin by policy, not by defect — a
plugin may have no file and no command capability at all to qualify. The entry is also
`external-only`, which by the registry's own wording refreshes metadata and *"不会因此获得安装资格"*.
The bot asks for no reply and contacts each author once.

## Reproduce

`eligibility-probe.mjs` in this directory calls the store's `reviewFixedSource` unchanged; it writes
nothing and imports no plugin code.

```bash
git clone --depth 1 --filter=blob:none --sparse \
  ssh://git@ssh.github.com:443/AI-Scarlett/DSH-Store.git /tmp/dsh-store
git -C /tmp/dsh-store sparse-checkout set src registry
node .agents/evidence/2026-10-05-dsh-store-eligibility/eligibility-probe.mjs
```

When `lib/` is not tracked the probe prints two variants (as published, and with the build output
added); once it is tracked, HEAD is the whole answer. It also lists which shipped files carry which
signal.

## The fix that did land

`lib/` (125 files, ~1.0 MB) is now tracked: `main`/`exports`/`files` point into it, so a clone without
a build runs and a fixed Commit carries what the catalog reads. `pnpm build` is deterministic —
rebuilding leaves the tracked artifacts byte-identical (`git diff --exit-code -- lib`). Recorded in
`CHANGELOG.md` under `未发布（v0.4.0 之后）`.

The `commands` signal was avoided by replacing one `git rev-parse --show-toplevel` per cwd with a walk
to the nearest `.git` **entry** (directory or file), covered by `test/project-root.test.mjs` and two
killed mutants: checking only the cwd fails the three walk cases, requiring `.git` to be a directory
fails the linked-worktree case.

## Load state

The running desktop host (`19387` holder `pid=243659`, started 13:57:02) predates the paths refactor
(`lib/shared/paths.js`, 15:36:39), so it still runs the pre-refactor lookup until the next restart.
Nothing here is needed for the store, which reads the repository rather than a running host.
