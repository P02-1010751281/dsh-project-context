---
name: dsh-docs-source-semantic-audit
description: "Sweep every current dsh-project-context doc (README.md, AGENTS.md, RULES.md, docs/*.md) for claims that contradict the source instead of fixing only the page the user pointed at: enumerate each doc's checkable assertions, write one read-now command per assertion, run a global grep sweep for the same error class, re-verify with HEAD content, and commit docs-only in two commits while stating honestly what was not audited."
derived_from: autolearn
evidence: ["session-1ae81f13-28a7-41e2-90d3-254a48ba35b5", "session-2f004655-840e-4a21-9af3-59ed4057361d", "session-17f125e2-f157-4ce9-9fe1-6a9d4f815020"]
---

<!-- autolearn-generated: this skill may be superseded by a later autolearn pass -->

# Audit current dsh-project-context docs against source, all of them

Use when the user says the docs are wrong / stale / contradictory, or after a batch (settings split, state-machine core, receipt change) shipped and the manual may lag. The user's complaint names one page; the durable fix is a sweep across every living doc plus a global grep for the same error class. Do **not** stop at the page the user pointed at.

## 0. Read the board

```bash
git log --oneline -3 && git status --short
git rev-parse HEAD origin/main   # do not push until ahead/behind is known
```

## 1. Scope: which docs are living

Living = `README.md`, `AGENTS.md`, `RULES.md`, `docs/README.md` (the doc index) and the `docs/*.md` pages it lists (`architecture.md`, `settings.md`, `behavior.md`, `development.md`, `GLOSSARY.md`, `harness/*.md`, batch specs still cited by code/tests, research pages under `docs/research/` if not frozen).

Frozen / out of scope by existing exemption: `docs/archive/`, `docs/changelog/`, `.agents/evidence/**`, dated frozen specs. Say so out loud in the report; do not silently drop them.

`docs/README.md` is the only index — use it to enumerate, and confirm the file list on disk (`ls docs/*.md docs/*/*.md`).

## 2. Why the gate is not evidence

`node scripts/check-docs.mjs` (or `pnpm docs:check`) checks only relative links, `path:line` anchor bounds, the symbol sitting in that line window, the RULES 3.2 file-size baseline and the 4.2 dependency whitelist. It returns 0 failures on a page that says "the four plugins share one config" while four `Config` schemas exist. A green gate proves the docs are *linked*, never *true*. State this in the report.

Typical false claim classes that pass the gate:
- a count that drifted (`63 events` vs 67, `nine shared keys` vs ten, `四条规则` vs five checks)
- a status line that never got updated (`状态：规格，src/ 未改` while the module is landed and wired)
- a since-deleted API still recommended (`effectivePluginConfig`, `ctx.on` where registration moved to `host.on`)
- behaviour stated backwards (child sessions archived vs the `isTopLevel` gate refusing them)
- a path literal that no longer exists (`docs/changelog/<version>.md` where the file is `v<version>.md`)
- a page contradicting itself a few lines later (`docs/development.md` said in one paragraph that the desktop host listens on `19387` and a few lines below that `19387` is never listened on — cite the contradiction by sentence, not by line number, because the anchors move as soon as it is fixed)

## 3. Per-doc assertion table

For each doc: list its checkable assertions (every number, name, path, port, event/method count, "only"/"unique"/"never" claim, status line), and give **each** one a read-now command. Run it, compare the literal.

Recipes that worked:

```bash
# a tool/module the doc says does not exist yet
ls src/project-memory/staleness-source.ts src/project-memory/missing-literals.ts src/project-handoff/relabel.ts
grep -rn 'measureStalenessDetail\|firstHandoffInput' src/ | head

# a key count: read the array definition, do not regex over a range
sed -n '/export const SHARED_KEYS = \[/,/as const;/p' src/shared/config.ts
grep -n 'export const \(MEMORY\|AUTOLEARN\|HANDOFF\)_KEYS' src/shared/config.ts
# then assert the total equals the schema count (10+3+4+6 = 23)

# a per-plugin Config / gate claim
grep -c 'export const Config' src/project-*/index.ts
grep -rn 'isTopLevel' src/project-*/start.ts
grep -n 'delegated session is not archived' test/*.mjs

# an upstream count (events, methods, hooks): read the declared source, not our prose
```

If a doc ships its own verification commands, run them — a stale command is a defect too.

## 4. Global sweep for the same class

After the per-doc pass, grep the whole living set for each error class found, so one user complaint cleans the class rather than one instance:

```bash
grep -rn '九键\|九键\|页签\|共享一份配置\|同样留档' README.md AGENTS.md RULES.md docs/*.md
grep -rn 'src/ 未改\|尚未动 src\|只读分析' README.md AGENTS.md RULES.md docs/*.md
grep -rn 'changelog/<version>' README.md AGENTS.md RULES.md docs/*.md
grep -rn 'effectivePluginConfig\|ctx\.on' README.md AGENTS.md RULES.md docs/*.md
```

Hits that are deliberate history (evidence quotes, `## 补充证据（…只读复核，未动 src/）`) or your own new changelog entry are kept; state which hits you kept and why.

## 5. Read definitions by line, not by regex range

A range regex such as `SHARED_KEYS = \[.*\]` over-captured and reported 29 keys when the array has 10. Count by printing the definition lines (`sed -n '/export const X = \[/,/\] as const;/p'`) or read them out, then assert the sum against the independent total (four schemas' `Config` key count). A count you produced with a loose regex is not evidence.

Watch for self-contradiction inside your own edit: no sentence should say "ten shared keys" and "nine keys" in the same paragraph. Re-read the hunk after each edit.

## 6. Correct, then re-verify against HEAD

Fix the claim in place (keep the file's line-wrap habit — README wraps near 100 columns; table rows may be long, that is fine and not a defect). Then:

```bash
node scripts/check-docs.mjs      # expect rc=0, read the item count line
git show HEAD:docs/harness/dsh.md | grep -c '63'   # confirm the swept literal is gone in the committed text
```

Counts printed by the gate drift on their own; quote the exit code, not the item number, in memory/claims.

## 7. Commit docs-only, split by class

```bash
git add <specific paths>            # never `git add -A`
git commit -F <msgfile> -- <paths>
git show --stat <commit>           # stat must not contain src/ client/ test/ lib/ .agents/skills
```

Two commits when governance is involved: `docs(rules)` for `RULES.md` / `AGENTS.md` / `docs/architecture.md` / `docs/GLOSSARY.md` / `docs/README.md` (+ the `CHANGELOG.md` 未发布 line), then a second `docs:` commit for the remaining pages (specs, harness, development, README). Keep the two from mixing; that split is what makes the governance-only claim checkable.

## 8. Report coverage honestly

End with an explicit list of what was **not** audited: `.agents/skills/*` swept only at grep level, `docs/archive/` / `docs/changelog/` / `docs/research/` / `.agents/evidence/` untouched by the freeze exemption, and whether any independent reader reviewed it. Never say "全项目覆盖" unless every living doc was assertion-by-assertion verified; "25 份现行文档逐条对过" with the skipped set named is the correct form.

## Pitfalls

- Do not conclude "the gate would have caught it" — the gate has never verified semantics, and `/gated-review` counts must be checked for real skill-call form before saying it was or was not run (skill-catalog `description` text in `session.jsonl` matches a search but is not an invocation).
- A claim of form "共享一份配置" / "唯一" / "只发生在" needs per-point grep before it is written; a previous pass wrote "two places for automatic rewriting" and missed the `agent/created` startup reconcile.
- Line numbers in docs and prose drift: replace `path:line` with `path:line` + symbol name, and prefer symbol greps in the fix.
- `git diff --numstat` only compares index↔worktree; use `git show --stat`/`--numstat` for what a commit changed.
