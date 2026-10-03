# Third-party skill corpus audit — `~/.agents/skills` (read-only)

Scope: the 51 skill directories under `/home/user/.agents/skills`, a **separate git repo** from this
project (`origin` = `ssh://forgejo@git.lentech.site/C02-1010751281/.agents.git`, branch `master`).
Nothing in that repo and nothing in this repo was modified by the audit; `HEAD == origin/master ==
17a419c` before and after.

Method: the 51 `SKILL.md` files (476 KB total) were read against one checklist — frontmatter sanity,
**verified** dead references (a reference is "dead" only when a command showed it absent), volatile
values presented as current fact, secret material, and overlap (within the corpus and against this
repo's own tracked skills). 43 vendored skills were split across four delegated read-only auditors
(details at `/tmp/skill-audit/{A-cs,B-tavily,C-caveman,D-compose}.md`, transient); the 8 locally
authored skills and every structural number below were checked here. **The support trees were not
read** (950 files, ~24 MB, including `llm-wiki-skill`'s 15 MB `deps/`), except where a `SKILL.md`
finding depended on one file.

## 1. Structure (all verified here)

| fact | value |
|---|---|
| skill directories on disk | 51 |
| tracked in `~/.agents` | 43 |
| **untracked** | **8** (listed in §2) |
| entries in `.skill-lock.json` | 41, from 16 upstream GitHub repos |
| tracked but absent from the lock | `academic-paper-writing`, `llm-wiki-skill` |
| in the lock but absent from disk | none |
| corpora-wide secrets found | **0** |
| dead absolute paths found (all 51 `SKILL.md`) | **1** (§5.3) |
| frontmatter `name` ≠ directory name | 1 (`llm-wiki-skill` → `name: llm-wiki`) |
| missing/empty `description` | 0 |
| only file with `disable-model-invocation: true` | `wait-what` |

Two ecosystems share one directory. `desktop`/`web`-style bundles are irrelevant here; the vendored
majority is installed by a CLI (`skills`, lock format v3) from upstream repos: `codestable/CodeStable`
(9 `cs*` skills), `tavily-ai/skills` (8), `mattpocock/skills` (6), `juliusbrussee/caveman` (5),
`chrisbanes/skills` (2), and eleven single-skill sources.

`wait-what` is the only skill that never appears in a session's skill catalogue, and that is correct
rather than broken: it sets `disable-model-invocation: true`, so it is user-invocable only. 50 of 51
are listed here.

## 2. The 8 untracked skills are one clone away from loss

`git -C ~/.agents status --porcelain` shows exactly eight entries, all untracked skill directories:

`dsh-command-code-empty-output-text-400`, `dsh-pi-ai-guard-nix-patch`,
`dsh-plugin-settingsscope-compat-patching`, `easytier-relay-moonlight-udp-diagnosis`,
`multi-host-proxy-quota-attribution`, `pi-computer-use-nixos-wayland-driver`,
`proxy-node-multiplier-quota-audit`, `proxy-traffic-attribution-forensics`

They are not ignored: that repo's `.gitignore` lists `memory/`, `skills-optional-archive/` and
`.skill-lock-bak-*.json` only. This is the same failure class this project already has a guard for
(`dsh-project-context-concurrent-writer-guard` step 6): a skill written straight into the skills
directory shows up as `??`, never errors, and is exposed only at clone time. These eight are also
absent from `.skill-lock.json`, so the vendoring CLI does not know about them either.

They are the only locally authored skills in the corpus — the other 43 are third-party installs.

## 3. What `.skill-lock.json` is, and is not

Read from the manager's own shipped code (`skills@1.7.0`, `dist/cli.mjs`, fetched to `/tmp` by the
slice that audited the CLI): `skillFolderHash` comes from `getSkillFolderHashFromTree(...)` over the
**upstream** repo tree, or `computeSkillFolderHash(...)` over the temp clone; an empty value is
rendered to the user as `"Private or deleted repo"`. It therefore identifies *which upstream folder
the skill came from* — it is **not** a check of the installed files. Local edits to a vendored skill
are invisible to the lock.

Consequence to respect before ever running the manager's `update`/`check`: they re-install from
upstream, and nothing in the lock would warn about local drift. **That overwrite behaviour was not
exercised**, so treat it as a reason to read the diff first, not as a confirmed data-loss report.

## 4. Per-slice results

| slice | skills | with ≥1 finding |
|---|---|---|
| A — `cs*`, `find-skills`, `writing-for-agents` | 11 | 11 |
| B — `tavily-*`, `drawio`, `pdf` | 10 | 5 |
| C — `caveman*`, `cavecrew`, `grilling`, `karpathy-guidelines`, `ponytail`, `prototype`, `resolving-merge-conflicts`, `tdd`, `wait-what` | 13 | 13 |
| D — `academic-paper{,-writing}`, `compose-*`, `kotlin-*`, `llm-wiki-skill`, `word-document` | 9 | 8 |
| E — the 8 locally authored skills (§2) | 8 | 1 |

Headline findings, with the ones reproduced here marked **(verified here)**:

**A — the `cs*` family is one document wearing nine names.** The reviewer-protocol block is
byte-identical in `cs-feat:110-124`, `cs-issue:122-136`, `cs-refactor:104-118` and near-identical in
`cs-epic:138-152` (`diff` silent; 26 lines appear 4× across the family). The lesson
`validated`/`retired` bar and the `经验命中：` template live in `cs-keep` plus all four task skills,
so one rule change needs five edits. Volatile numbers are used as a quality gate rather than as
illustration: `find-skills:49,50,70,72,88` (`100K+`, `185K`, `1K+`, `<100 stars`), `cs-keep:27,40,72`
(≤25 / ≤30 / ~50 budgets), and `cs/SKILL.md:56` claims "24 个旧入口" while naming six. No dead
references, no secrets; all 11 frontmatters are sound.

**B — a stale CLI transcript and a family that contradicts itself.** `tavily-cli:20,22` teaches the
expected `tvly --status` output as `tavily v0.1.0` / "Authenticated via OAuth"; observed
`tavily v0.1.8` / "Authenticated via API key" **(verified here)** — a stale version *and* the wrong
auth mode, both taught as current. `tavily-dynamic-search:32` says "**NEVER** run `tvly` as a bare
command" **(verified here)** while `tavily-cli` and all five verb skills teach exactly that, and three
of them claim the same trigger. `pdf` is inert on this host: `pdftoppm` absent, `pip` absent
(`uv` present), and `reportlab`/`pdfplumber`/`pypdf` all `ModuleNotFoundError` **(all verified
here)**. `drawio`'s Desktop-export path is likewise inert (`drawio` absent; `~/.drawio-skill/`
absent **(verified here)**), and its reference still says "2.7.0 base skill" against a 2.8.0
frontmatter. Clean: `tavily-crawl`, `tavily-extract`, `tavily-map`, `tavily-search`,
`tavily-research`; every `tvly` option table matches the real `--help`.

**C — vendored snapshots that describe a world that is gone.** `caveman-stats:8,10` documents delivery
through `hooks/caveman-stats.js` (that path no longer exists upstream — it moved under `src/`) and
mandates `Est. rule overhead` / `Est. net` from a hard-coded 1,250 tokens/turn, which upstream HEAD
now explicitly forbids; its input log is never named, and the host's real logs are zstd under
`~/.dsh/sessions/`, not the Claude Code JSONL it assumes. `cavecrew:9,15,18,20` names three
`cavecrew-*` presets that exist nowhere on this machine, plus Claude-Code-only alternatives.
`tdd:26,38` names two skills that were never vendored. Inside the `caveman` family, `caveman:15` and
`caveman-help:20` disagree about the wenyan-full trigger, `caveman:19` forbids decorative tables while
`caveman-help:18` prescribes "Tables over prose", and `caveman-help:31` advertises an uninstalled
`caveman-compress` while omitting the installed `caveman-stats`. `caveman-review` comes from a
different upstream than the rest of the family. Minor: `prototype:22` names `bun` (**absent**
**(verified here)**), `caveman-review:23` has a truncated quote, and `wait-what`'s two target files
(`CONTEXT-MAP.md`, a per-repo `CONTEXT.md`) are absent at this project root. No secrets.

**D — vendored copies whose own instructions point outside the vendored copy.** `academic-paper`
tells agents to read `shared/` (13 references), `scripts/` (4 Python verifiers), `docs/` (3 design
specs) and `.claude/CLAUDE.md`; **none of those four roots was vendored** — only `agents/`,
`examples/`, `references/`, `templates/` exist **(verified here)** — including the skill's only
citation-integrity pointer at `SKILL.md:461`. Its version is asserted three ways in one file:
frontmatter `3.3.1`, `SKILL.md:20` "**v2.5**", body "v3.9.2" and "v3.6.6" **(verified here)**.
`word-document` depends on a "Word Document MCP" server that is not configured (`~/.dsh` has no
`mcpServers`) and on `python-docx`, which is not importable **(both verified here)**; its documented
fallback (`pip install`) cannot run because `pip` is absent. `llm-wiki-skill` declares
`name: llm-wiki`, which does not match its directory **(verified here)**, uses bare `scripts/…`
against its own `SKILL_DIR` rule, and carries macOS-only `open`/`brew`. Every `compose-*`/`kotlin-*`
delegation target is missing and `kotlinc`/`java`/`javac`/`gradle`/`mvn` are all absent **(verified
here)**, so `kotlin-tooling-java-to-kotlin`'s "compile and run the tests" step is unreachable here.
`compose-ui-testing-patterns:93,105` asserts the same call before and after emitting the hover
interaction while the comment at :103 claims that line proves the change **(verified here)**.
`academic-paper-writing` is clean.

**E — the eight locally authored skills.** Frontmatter names all match their directories, none
contains a Nix store path or credential material, and the only dead reference is in
`dsh-pi-ai-guard-nix-patch` (§5.3). The three proxy skills (`multi-host-proxy-quota-attribution`,
`proxy-node-multiplier-quota-audit`, `proxy-traffic-attribution-forensics`) share **no** identical
long sentence — they divide the work rather than restate it **(verified here)**.

## 5. Cross-cutting

### 5.1 Overlap inside the corpus

The duplication is concentrated in families, which is where a rule change costs the most edits:
the `cs*` reviewer protocol (4 copies, §4 A); the `caveman` family's conflicting table/trigger rules
(§4 C); `karpathy-guidelines:28` ↔ `ponytail:58` near-verbatim; `prototype:24` ↔ `ponytail:107`;
`cavecrew:15` ↔ `grilling:26`. The eight `tavily-*` skills split cleanly by verb — the single defect
is the bare-`tvly` contradiction, not redundant content.

### 5.2 Overlap with this repo's tracked skills

`caveman-commit` mandates Conventional Commits too, so it does **not** conflict with
`dsh-project-context-concurrent-writer-guard` step 5 — but it adds two rules this repo does not state
(a 72-char subject cap and a ban on AI-attribution trailers). Adjacent, additive: keep both, and do
not treat `caveman-commit` as authoritative for this repo's commit policy.

### 5.3 The one dead absolute path, and a skill whose work is already done

`dsh-pi-ai-guard-nix-patch:14` tells the reader to patch `/etc/nixos/pkgs/dsh/default.nix`
**and** `/etc/nixos/pkgs/dsh-desktop/default.nix`. The first does not exist: `pkgs/dsh/` now holds
`dsh.nix`, `dsh-lib.nix`, `package-lock.json` (the desktop one is still `default.nix`). Both files
already carry the guard the skill describes — `dsh.nix:84` substitutes into
`…/@earendil-works/pi-ai/dist/api/openai-responses-shared.js`, and `dsh-desktop/default.nix:460`
calls itself "the same change as `pkgs/dsh/dsh.nix`". So the skill is now a maintenance record with a
stale target, not a procedure to run. This is skill rot of the same class the 2026-10-03 corpus round
fixed in this repo, caught here because the audit checked paths instead of trusting the prose.

## 6. Recommended actions (nothing executed)

1. **The eight untracked skills in `~/.agents` are the one item with real loss risk.** Staging and
   committing them is a write to another repo, so it needs your go-ahead; it is otherwise mechanical
   (`git -C ~/.agents add skills/<name>/SKILL.md`, then a scoped commit — that repo has no
   concurrent-writer guard of its own).
2. **The 8 local skills: one edit is worth making** — fix `dsh-pi-ai-guard-nix-patch`'s dead path and
   mark the guard as already applied in both packages (§5.3). The rest of that group is clean.
3. **Do not hand-edit the 43 vendored skills.** Their defects are upstream defects; the manager
   re-installs from source and the lock cannot detect local drift (§3). Treat `skills update` as
   something to review, not to run blind.
4. **If the corpus should get leaner,** the families are the place to start: the `cs*` reviewer
   protocol has 4 copies, and the `caveman` family contradicts itself on two rules. Both are upstream
   fixes, not local ones.
5. Nothing here changes this repo's own skills except the one path in §5.3, which lives in the other
   repo.

## 7. Honest limits

- **Support trees were not audited.** 950 files (~24 MB) outside the `SKILL.md` files were not read;
  per-file rot inside `references/`, `agents/`, `deps/`, `platforms/` is out of scope except where one
  was needed to confirm a `SKILL.md` finding. Relative paths are only checked where a slice followed
  them; the corpus-wide scan in §1 covers absolute paths in `SKILL.md` text only.
- **"Dead" means absent on this host / in this corpus.** No upstream freshness comparison was made,
  so a reference that is missing here may still exist upstream — that is exactly what §4 C found for
  several skills, and the distinction is stated per finding rather than generalised.
- **Nothing was executed** in either repo: no `skills` command, no installer, no `pip`, no JDK, no
  Kotlin, no drawio export, no live Tavily call, no MCP fetch. Runtime behaviour of the vendored
  skills is therefore untested, and magnitudes they quote (char caps, timeouts, star counts) are
  reported as *stale-looking*, not as disproven.
- The four slice detail files are in `/tmp/skill-audit/` and do **not** survive a reboot; everything
  load-bearing is restated above.
- Findings that the slice authors could not reproduce were withdrawn by them and are not repeated
  here (one such withdrawal is recorded in `C-caveman.md`).
