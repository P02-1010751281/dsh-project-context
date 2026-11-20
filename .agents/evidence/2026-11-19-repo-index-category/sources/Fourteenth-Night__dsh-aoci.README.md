# dsh-aoci

[![npm version](https://img.shields.io/npm/v/dsh-aoci?color=cb3837&logo=npm)](https://www.npmjs.com/package/dsh-aoci)
[![license](https://img.shields.io/github/license/Fourteenth-Night/dsh-aoci)](LICENSE)
[![latest release](https://img.shields.io/github/v/release/Fourteenth-Night/dsh-aoci?label=release)](https://github.com/Fourteenth-Night/dsh-aoci/releases/latest)
[![tests](https://img.shields.io/badge/tests-36%20passed-brightgreen)](https://github.com/Fourteenth-Night/dsh-aoci/actions)

**AOCI-CODE cognition layer for DeepSeek Harness: one slash command gives agents governed, Git-versioned repository and database cognition.**

**Latest release: [v0.3.6](https://github.com/Fourteenth-Night/dsh-aoci/releases/latest)** (aggregates v0.2.2 → v0.3.6) · **npm: [dsh-aoci@0.3.6](https://www.npmjs.com/package/dsh-aoci)**

**简体中文版见 [README.zh-CN.md](README.zh-CN.md).**

---

## Abstract

`dsh-aoci` integrates [AOCI-CODE](https://github.com/aoci-spec/aoci-code) — a local-first stdio MCP server and Go CLI implementing the AOCI (AI-Oriented Cognition Infrastructure) paradigm — into the DeepSeek Harness (DSH) plugin ecosystem. It separates **deterministic governance** (initialisation, baseline establishment, verification) from **semantic authorship** (FRAS entries authored by the model under AOCI's governance protocol), and exposes cognition through three complementary surfaces:

- **Nine MCP tools** (`aoci_rules` / `aoci_overview` / `aoci_get_entries` / `aoci_search` / `aoci_maintain` / `aoci_update_entry` / `aoci_remove_entry` / `aoci_header` / `aoci_report`), registered **on demand** by a dynamic MCP bridge instead of static per-repository configuration. With `toolSurface: compact` (default) the model sees only `aoci_overview` plus one aggregate entry `aoci_call { tool, args }` — cutting the tool schema surface by roughly half; `full` exposes all nine directly;
- **Deterministic tools** for governance, refresh, audit, and queries: `aoci_status`, `aoci_verify`, `aoci_check`, `aoci_use`, `aoci_unbind`, `aoci_refresh`, `aoci_audit`, `aoci_build_status`, plus `aoci_query` (compact: relations/impact/lineage/db merged) or the granular `aoci_scan` / `aoci_panel` / `aoci_relations` / `aoci_impact` / `aoci_lineage` / `aoci_db` (full);
- **One-shot slash command** `/aoci [path]`: with a path, resolves it (absolute, or relative to `defaultRoot`); **without a path, auto-locates the current session's workspace repository**; runs conditional initialisation/baseline, verifies the binary, binds the MCP bridge, and submits the index-build instruction to the current agent via `agent.steer`. Optional flags: `--locale`, `--scope`, `--agent`, `--skip-scan`, `--db`.

AOCI-CODE is licensed FSL-1.1-MIT (source-available); this plugin **does not bundle** its binary — it verifies a user-provided binary (SHA-256, minimum version) against the official release channel.

## Scope and Compatibility

- **Tested runtime**: DSH 0.2.0-rc.2 (harness runtime `^0.2.0-rc.2`, cordis `^4.0.4`); web profile. Compatibility metadata declares `^0.2.0-rc.2`.
- **Peer dependencies** (provided by the host at boot): `@deepseek-ai/cordis`, `dsh-settings`, `dsh-system-prompt`, `dsh-tools`, `dsh-jobs`, `dsh-llm`, `react`, `react-dom`.
- **Runtime dependencies**: `schemastery` only — the MCP stdio client is bundled in the plugin (zero SDK dependency).
- **Prerequisite binary**: `aoci` from the official AOCI-CODE Release (default `C:/aoci/bin/aoci.exe`), verified by SHA-256 and a configurable minimum version (`minAociVersion`, default `0.1.0-rc21`; Volumes v1 requires rc21+).

## Model-Facing Surface

| Surface | Names | Purpose |
|---|---|---|
| Cognition reads | `mcp__aoci-<slug>__aoci_overview` (always) · `aoci_call {tool: aoci_rules/aoci_get_entries/aoci_search, args}` (compact) · all nine direct (full) | Load and query the governed cognition map |
| Cognition maintenance | `aoci_call {tool: aoci_maintain/aoci_update_entry/aoci_remove_entry, args}` (compact) · direct (full) | Incremental, protocol-governed updates |
| Cognition evidence | `aoci_call {tool: aoci_header/aoci_report, args}` (compact) · direct (full) | Index identity and attestation |
| Deterministic governance | `aoci_status`, `aoci_verify`, `aoci_check`, `aoci_scan` (full), `aoci_panel` (full) | Health, verification, baseline, panel; status reports binary verification, git head/working-dirty drift, and the active tool surface |
| Refresh | `aoci_refresh` | Computes the git change set since the last maintained HEAD and returns a batched, incremental maintenance instruction (no full rebuild) |
| Audit | `aoci_audit` | Runs verify/check, reports HEAD vs maintained-baseline drift and the structured audit-event timeline |
| Build status | `aoci_build_status` | Recent build/maintain/verify runs and current bindings |
| System Cognition | `aoci_query {kind: relations\|impact\|lineage\|db}` (compact) · `aoci_relations`, `aoci_impact <object>`, `aoci_lineage`, `aoci_db <source>` (full) | Dependency projection, impact analysis, lineage, database preflight |
| Static cognition entry | `aoci_cognition { action, project?, path?, args? }` | Works in **both PTC and native tool modes** (registered at plugin load, lazy-binds the repo): rules/overview/maintain/update_entry/search/header/report, plus `validate` (entry pre-check), `attest` (attestation field pre-check) and `optimize` actions (F≤160, R≤360/8, A≤400/6, S by importance band). |
| Agent-driven binding | `aoci_use <path>`, `aoci_unbind <slug>` | Autonomous repository selection |
| Quality optimization | `aoci_cognition { action: "optimize" }` | Runs `maintain` with `intent=cognition_optimization`; returns the review-required quality batch (E-scale / R-S token targets) |
| Fallback driver | `scripts/aoci-mcp-driver.mjs` | Zero-dependency JSON-RPC driver shipped with the package; runs one tool, a step sequence or a preset (`read` / `overview` / `maintain` / `optimize`) in a single MCP process (keep overview + attestation together). Supports `--args-file` and `--clean`; outputs go to `state/aoci/tmp/<slug>/` |
| Slash command | `/aoci [path]` | One-shot onboarding (verify + bind + instruct agent to build) |

## Architecture

```
DSH Host half (this plugin)
  · ctx.tools dynamic registration (compact or full surface)
  · deterministic CLI calls via ctx.subprocess (managed: env scrub, timeout, cancel, bounded output)
  · /aoci command (ctx.commands) + 11-ish deterministic tools
  · runtime state under state/aoci/ (tmp/<slug>/, evidence/, locks/, cache/, audit/)
  · compaction bridge (fold AOCI results into receipts, budget-aware recovery hint)
        │
        ▼ stdio MCP
  aoci mcp (per-project, spawned on demand; auto-reconnect on exit/tool failure)
        │
        ▼
  repository cognition assets (aoci.txt et al., Git-versioned, governed)
```

1. **Dual-face plugin**: package root is the host (Node) half; `./client` is the browser half registered via DSH's `__ModuleLoader__.load` protocol.
2. **Dynamic MCP bridge** (`AociBridge`): spawns `aoci --repo <root> mcp` with a **sanitized environment**, connects over stdio, and registers the tool surface; unbinding unregisters tools and terminates the process; process exit or a failed tool call triggers a 2s-backoff reconnect.
3. **Deterministic execution** goes through `ctx.subprocess` when the host mounts it (scrubbed env, grace-based termination, bounded collected output with spill), falling back to `node:child_process` only when absent.
4. **AOCI governance semantics** (empirically fixed): `init` only for uninitialised repositories (probe `aoci.txt`); `scan` only when no Baseline exists (probe `.aoci/baseline.json`); maintenance via argument-less `aoci_maintain` + batch `aoci_update_entry`, proven by `verify`/`check`. A successful `verify` records the maintained HEAD, which drives `aoci_refresh` drift detection.
5. **Token/budget engineering**: compact tool surface; tool results are shaped, and oversized results are persisted to `state/aoci/tmp/<slug>/` with `body_file` / `body_sha256` / `body_bytes` / `end_marker` metadata instead of blind truncation; the compaction hook folds AOCI bodies into a single receipt and escalates recovery guidance under `ctx.tokenMeter` pressure (`fold` → `fold+compact`).
6. **Binary security**: SHA-256 + minimum-version verification with a cached verification record; mismatches block binding with an actionable message.
7. **Least privilege**: child environments are whitelisted (system vars + `AOCI_DB_*` + explicit `envPassthrough`); `readOnly` mode disables init/scan/maintain; `/aoci/api` routes are off unless `httpRoutes` is enabled.

## Installation

### Prerequisites

- A DeepSeek Harness 0.2.0-rc.2 profile (desktop or web).
- The `aoci` binary from the [official AOCI-CODE Release](https://github.com/aoci-spec/aoci-code/releases) (e.g. `aoci_0.1.0-rc21_windows_amd64.zip`), verified against the published `SHA256SUMS` and placed at a stable absolute path (default `C:/aoci/bin/aoci.exe`).

### From npm (recommended)

```powershell
dsh plugin --profile <name> add dsh-aoci
# restart DSH Desktop
```

### From source

```powershell
cd <plugin-checkout>
pnpm install
pnpm check            # typecheck + unit tests + build
pnpm pack             # dsh-aoci-<version>.tgz

dsh plugin --profile <name> add ./dsh-aoci-<version>.tgz
# restart DSH Desktop, then in the input box:
#   /aoci D:\path\to\repo        (absolute path)
#   /aoci                          (auto-locates the session workspace)
```

After `/aoci`, the agent builds the index (overview → batched maintain → verify/check → aligned). Subsequent sessions reuse the Git-versioned cognition; `aoci_refresh` maintains incrementally after changes.

## Runtime Layout

All plugin runtime state lives under `<DSH_HOME>/state/aoci/` (profile-aware):

- `tmp/<slug>/` — persisted oversized tool results and debug output; 7-day TTL + 200 MB quota, cleared by `/aoci --clean`;
- `evidence/` — `projects.json` / `runs.jsonl`;
- `locks/` — per-repository write locks;
- `cache/` — binary verification cache;
- `audit/` — `aoci-events.jsonl`.

Managed cognition assets (`aoci.txt`, `aoci.*.txt`, `.aoci/`) stay in the repository and are Git-versioned. Do not write runtime files into the workspace or the repository.

## Configuration Reference

| Key | Default | Description |
|---|---|---|
| `binaryPath` | `C:/aoci/bin/aoci.exe` | Stable path to the verified `aoci` binary (auto-detected when empty). |
| `binarySha256` | `` | Expected SHA-256; mismatch blocks binding. |
| `minAociVersion` | `0.1.0-rc21` | Minimum accepted `aoci` version; Volumes v1 repositories require rc21+. |
| `envPassthrough` | `[]` | Extra environment variable names forwarded to `aoci` (whitelist always keeps system vars + `AOCI_DB_*`). |
| `toolSurface` | `compact` | `compact` (aggregate entry, fewer schemas) or `full` (all nine MCP tools). |
| `autoRefresh` | `status` | `off` / `status` (drift reported) / `nightly` (runs nightly verify). |
| `governance` | `standard` | `strict` requires verify+check after maintenance; `relaxed` recommends only. |
| `readOnly` | `false` | Disables init/scan/maintain writes. |
| `httpRoutes` | `false` | Mounts the read-only `/aoci/api` routes. |
| `budget.warn\|fold\|compact` | `0.6\|0.75\|0.9` | Context-pressure thresholds for fold/compact guidance. |
| `defaultRoot` | `` | Base directory for relative paths in `/aoci` and `aoci_use`. |
| `mcp.serverNamePrefix` | `aoci` | Namespace prefix for dynamically registered MCP tools. |
| `mcp.toolCallTimeoutMs` | `120000` | Per-call timeout for bridged MCP tools. |
| `projects[]` | `[]` | Optional static projects (`root`, `slug`, `dbSources`, `schedule`). Dynamic binding needs none. |

## Verification Methodology

1. **Unit tests** (36 tests across 5 files): slug/credential derivation, cron matching, compaction folding and budget policy, audit report formatting, refresh plan, env whitelist, tool-surface estimation, config defaults, and oversized-result persistence regressions (sweep execution + throttling, full-body persistence, small-result pass-through).
2. **End-to-end chain** (real `aoci` 0.1.0-rc21 binary + real Git repository + bundled MCP client): init/scan/verify, all nine MCP tools discovered, `aoci_header` over MCP, overview → delivery confirmation → attestation 10/10.
3. **Integration self-test** (real Cordis context): `/aoci` (with path and no-arg auto-location), compact surface bound 2/2 tools, status reports binary verification (SHA-256 + version), `aoci_query` relations/db, `aoci_refresh` drift plan, `aoci_audit` report, `aoci_build_status`, unbind.
4. **Loader composition**: `dsh --profile web --dump-config` resolves the plugin entry without errors.

## Known Limitations

- Background scheduling (including `autoRefresh: nightly`) is not guaranteed after the host application fully exits.
- Initial index construction grows with repository size (≈1 hour per 200K lines) and consumes model quota; use `aoci_refresh` for incremental maintenance.
- `ctx.subprocess` availability depends on the host composition; the fallback path is less protected.
- Database cognition covers schema metadata only (no business-data access).

## Security Considerations

- Credentials are referenced exclusively through environment-variable names (`AOCI_DB_<ID>_DSN`); the plugin never stores or embeds secrets.
- Child environments are whitelisted; credential-shaped variables are not forwarded implicitly.
- The `aoci` binary is never bundled or redistributed (FSL-1.1-MIT); it is verified by SHA-256 and a minimum version before use.
- `/aoci/api` routes are disabled by default and remain loopback-only when enabled.

## Acknowledgments

The authors wish to thank:

- The **AOCI-CODE team** and the authors of *AOCI: Symbolic-Semantic Indexing for Practical Repository-Scale Code Understanding with LLMs* (arXiv:2605.02421), whose governed cognition paradigm and local-first MCP server make this plugin possible.
- The **DeepSeek Harness SDK team** for the plugin protocols this work builds upon — sandbox context and injection declarations, `ctx.tools`/`ctx.commands`/`ctx.subprocess`/`ctx.tokenMeter` seams, compaction contract, and the `__ModuleLoader__.load` frontend contract.
- The maintainers of `dsh-task-board` (@linxin666/dsh-web-ui) and `dsh-better-sidebar` (omdsh-dev/DSH-better-sidebar), whose dual-face plugin architecture and manifest protocols were direct references.
- `dsh-plan-mode` (@deepseek-ai/dsh-plan-mode) for the `ctx.inject(['commands'], …)` registration and `agent.steer` submission patterns.
- Early adopters and reviewers whose real-environment feedback drove the fix cycles.

See [RELEASE.md](RELEASE.md) for the full version history and acknowledgements.

## License and Attribution

MIT License (see [LICENSE](LICENSE)). AOCI-CODE is licensed FSL-1.1-MIT (source-available, [github.com/aoci-spec/aoci-code](https://github.com/aoci-spec/aoci-code)); this project holds no AOCI-CODE binaries and distributes none. The design rationale is documented in [docs/DESIGN.md](docs/DESIGN.md).