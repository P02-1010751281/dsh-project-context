---
name: dsh-readme-doc-split-loss-proof
description: "Split dsh-project-context's README manual from the mechanism docs (and add AGENTS.md/RULES.md when asked) so that no content, config key, link, or path:line anchor is lost — every deleted README line is proved present verbatim in the new union, schema keys are covered key-by-key, fences are even, links and anchors resolve, and the memory docs still round-trip byte-identically before the docs-only commit."
---

<!-- autolearn-generated: this skill may be superseded by a later autolearn pass -->

# Split README into manual + docs/ with mechanical loss proof

Use when asked to restructure this repo's prose: shrink a bloated README ("说明" once reached 101 lines, single bullets 20+ lines, 260-char table cells), move mechanism/rationale into `docs/`, or add `AGENTS.md` (repo fact guide) and `RULES.md` (rules with criteria). Audience split that held: README = what to install / how to use / what to configure (conclusions + pointers only); `docs/architecture.md`, `docs/behavior.md`, `docs/settings.md`, `docs/development.md` = mechanism and why; `docs/batch-*.md` = historical decisions; `CHANGELOG.md` = per-batch changes with evidence.

## 0. Inventory before planning (never plan from an out-of-date count)

```bash
wc -l README.md docs/*.md; grep -n '^#' README.md
grep -n '^###' CHANGELOG.md          # untouched, but know the section offsets
ls -d .agents/skills/*/ | wc -l      # current skill count, read fresh
```

Report per-heading line counts so the split targets the fat sections rather than guessing.

## 1. Move whole sections, do not rewrite

Cut a section from README and paste it into the target doc unchanged, adjusting only what breaks (a heading that no longer names its new home). Rewriting while moving is what makes loss unprovable in step 2.

## 2. Prove no prose was lost (the load-bearing check)

Collect every line `git diff` says was removed from README and require it verbatim somewhere in the new union:

```bash
git diff -U0 -- README.md | grep '^-' | grep -v '^---' | sed 's/^-//' > /tmp/removed.txt
# for each line, -F -x against README.md plus every new/moved doc:
#   grep -Fqx -- "$line" README.md docs/*.md docs/archive/*.md
```

Print `removed lines: N  not found verbatim: M` and list each miss with its justification. Real result: 393 removed, 1 missing, and the single miss was a renamed heading (`## 命令（web/交互 profile）` → `## 命令`). A miss you cannot explain is unfinished work, not a rounding error. Skip blank lines and table separators from the diff or they dominate the report.

## 3. Config-key coverage, key by key

Derive the key list mechanically from the settings schema (only the `project-context` entry exports `PluginSettingsSchema`; the source of truth is `src/shared/config.ts` / that schema) — do not type the list from the README. Then check each key appears both in the README config table and in `docs/settings.md`:

```
schema keys: 21   README 缺: 无   settings.md 缺: ['maxMemoryChars']
```

A miss is a genuine documentation gap (that is how `maxMemoryChars`, previously only mentioned in prose, got its table row). Also validate every table row starts and ends with `|` after editing.

## 4. Structural checks that catch sloppy edits

- Code fences even per file: `grep -c '^```' <file>` must be even (README 4, architecture 6, behavior 2, settings 0, development 2 is normal).
- Relative links resolve: extract `](./…)` targets and test each path exists; report `OK <path>` per line.
- `README.md` refuses to carry long prose: check for lines over ~110 columns (`>110 chars at line N`), and never split an inline code span across lines when wrapping.

## 5. `AGENTS.md`: verify every path:line anchor

Write a small resolver that extracts every `path:line` and `path:start-end` mention, checks the file exists at that path (relative to the repo root) and the line numbers are inside it, and prints `anchors=N problems=0`. First runs are dirty by construction — a bare `consolidate.ts` written without its `src/project-memory/` prefix shows as `MISSING FILE` — so fix the anchor text, not the checker. Build the facts from read-only scouts if you delegate, but personally re-verify the load-bearing files (entry points, the write path, the schema) before committing; the deliverable table should state which claims came from the user's judgement rather than the code.

## 6. `RULES.md`: every rule carries a criterion

Keep it ≤150 lines (74 and 75 in practice) with a fixed section order (scope → meta rules → files/dirs → subpackage boundaries → style → gates → security/perf/logging → prohibitions). Each rule states its 判据 (a runnable check); run every command-class criterion before committing (line-count ceiling, `shared` reverse-dependency count, single `Config` export, relative imports must end in `.js`). Mark non-mechanical rules as soft explicitly, and say in the report which numbers you chose rather than inherited.

## 7. Memory docs still round-trip

After recording the round in `.agents/memory/CONTEXT.md`, run the round-trip probe and require a byte-identical result with no entry at the 800-char cap:

```bash
node .agents/evidence/2026-10-06-context-doc-roundtrip/roundtrip.mjs
# items: N; over the 800-char cap: 0
# byte-identical round trip: true
```

Write one `- ` bullet per statement; appending plain text splices into the last bullet and swallows a heading.

## 8. Gate, commit docs paths only, push

```bash
pnpm typecheck && pnpm build && pnpm test      # read exit code; TAP off a TTY
ℹ tests 492 / pass 492 / fail 0                # read the fresh numbers, never reuse old ones
git diff --exit-code -- lib                     # empty: a docs-only change needs no restart
git add README.md CHANGELOG.md AGENTS.md RULES.md docs .agents/memory/CONTEXT.md
git commit -F <msg> -- <those paths>            # never add -A: another session may be writing
```

Then prove the push landed: `git rev-parse HEAD origin/main` prints the same hash. State plainly in the report that `src/`, `client/` and `lib/` were untouched, so no host restart applies.

## 9. Report the residuals honestly

List what is not code-verified: a missing `CLAUDE.md`, judgement-based scope statements, newly invented ceilings (e.g. a 900-line file limit against today's largest 809-line file), soft rules, and any number you sampled once (session count, port, test count) instead of pinning into a tracked doc.
