---
name: dsh-command-receipt-localization
description: "Localize a dsh-project-context slash-command receipt (/memory, /session-log status, /autolearn status, /handoff status) into the session's own language: route every builder through one receiptLanguage entry point, keep Chinese/English punctuation apart, add a Chinese-plus-English assertion with a mutation round, and pay the dependency-whitelist and CHANGELOG bookkeeping that touching src/shared/ forces."
derived_from: autolearn
evidence: ["session-fd9c4cdb-c0e1-4a02-979a-df32feb82167", "session-a8e77e7b-383b-468f-9b36-0ba80ea15a5b"]
---

<!-- autolearn-generated: this skill may be superseded by a later autolearn pass -->

# Localize dsh-project-context command receipts

## When to use

Any change that makes a dsh-project-context command receipt follow the session's language
(`/memory`, `/memory update|prune|reconcile`, `/session-log status`, `/autolearn status`,
`/handoff status`), or adds a receipt line that has to be rendered in two languages.

Layout is a different concern and is owned by `dsh-command-receipt-render-verify`
(payload on line 1, first line ≤ 80 display columns, CJK counts as 2). Do not re-derive it here;
just keep every line you localize inside that shape.

## 1. One language entry point

- `src/shared/receipt-language.ts` exports `receiptLanguage(session, config)` and is the only
  place that decides what language a session is in. It must reuse handoff's `auto` resolution:
  sample the user's messages, and let an explicit `handoffLang` win over the sample.
- `src/shared/language.ts` holds the primitives: `pick(language, zh, en)` for plain
  alternatives and `counted(...)` for plural-sensitive English (Chinese does not inflect).
- Receipt builders take the language as an argument. Never read config inside a builder and
  never write a second "how much Chinese counts as Chinese" heuristic in a plugin.
- Setting names are quoted from `src/shared/setting-labels.ts`
  (e.g. `「保留最近对话（token）」`) so a knob stays visually distinct from prose.
- State vocabularies are translated once per vocabulary: the eight session states, the six
  skill states, and `resolveThreshold`'s labels (`自动 379616（95%）`, `窗口的 40%`, `N token`)
  each need their Chinese names in the same pass, or the receipt turns half-translated.

## 1b. Surface list

Every command surface that emits a receipt, with the module that owns it — a new receipt has to
join this list and get the Chinese-plus-English assertion in the same pass:

| Surface | Owner |
|---|---|
| `/context`, `task`, `export` | `src/project-context/start.ts` |
| `/memory` status, `update`, `prune`, `reconcile`, `--accept` (all branches and refusal lines) | `src/project-memory/{report,start}.ts` |
| `/autolearn` status and candidates | `src/project-autolearn/{start,candidate}.ts` |
| `/handoff` `now` (seven branches) and `settingPatch` refusals | `src/project-handoff/command.ts` |

Two deliberately stay English: the consolidate prompt and `purge.log`.

## 2. Punctuation rule

Chinese receipts use full-width `（）「」`; English receipts use ASCII `()` and straight quotes.
` · ` is shared by both languages. Never mix the two styles inside one receipt.

## 3. Tests and mutation round

- Extend `test/receipt-layout.test.mjs` (one Chinese case and one English case per receipt).
  The Chinese case must also assert the *absence* of every English fragment the old text used:
  `Auto handoff`, `context `, `threshold `, `pending question`, `harness envelope`,
  `adaptive target`. Presence of Chinese alone does not prove the whole receipt is localized.
- Mutation round: drop the language argument from one builder, or move a localized clause back
  onto line 1, rebuild, and confirm exactly the new Chinese case turns red; then restore and
  rebuild. A mutant that does not compile, or whose two branches print the same text, is not
  evidence.
- If a localized clause still shows its English label while the rest is Chinese, the language
  argument never reached that builder — fix the wiring, do not loosen the assertion. Assert the
  label at line start (`/^段落：/`), because a mid-line Chinese string will pass a loose match.

## 4. Bookkeeping the gates force

- A new module under `src/shared/` changes the dependency whitelist. Update the table in
  `docs/architecture.md` §2 (edges, distinct specifiers, occurrence count) **and** the matching
  counts in `RULES.md` 4.2 in the same commit, or `pnpm docs:check` fails on the edges check.
  Read the old numbers from that table; never restate them from memory.
- Register the batch in `CHANGELOG.md` under `## 未发布（…）` with real, greppable English test
  names, and point at the new shared module.
- To find the receipts still not localized, grep the receipt builders in `src/project-*/`
  (e.g. `src/project-memory/report.ts`) for hardcoded English literals. The CHANGELOG residual
  list is a hint, not the authority.

## 5. Gates

Run, in this order, and keep each one's exit code:

```bash
pnpm typecheck        # tsc --noEmit && tsc -p tsconfig.client.json --noEmit
pnpm boundary:check   # scripts/check-boundary.mjs
pnpm docs:check       # scripts/check-docs.mjs — prints item counts, cite only the exit code 0
pnpm test             # tsc && node --test
```

Then `pnpm build` twice and compare a recursive sha256 of `lib/` plus `git ls-files lib | wc -l`
between the two runs; they must be identical and the working tree must keep no unstaged
`lib/` difference beyond what you are about to commit. Quote the hash you just read, not an
earlier one. `lib/` is tracked, so a change under `src/` or `client/` must ship its rebuild.

## 6. Commit, push, and reach the profiles

- Split the batch: `feat(receipts): …` for `src/`, `lib/`, `test/`; then
  `docs(rules): register … in the unreleased changelog` for `CHANGELOG.md` (and
  `RULES.md` / `docs/architecture.md` if their counts moved).
- Stage explicit paths (`git add <paths>`), never `git add -A`; a second agent session may be
  working in the same tree.
- Push, then confirm `git rev-parse HEAD` equals `git rev-parse origin/main`.
- The desktop and web profiles pin this package as `git+ssh://…#<sha>` in
  `~/.dsh/profiles/{desktop,web}/package.json`, so nothing is live until that pin is raised:
  edit the pin line, install with the pnpm that the profile store pins, and prove per-file
  sha256 parity between the installed `lib/` and `git show <sha>:lib/…`
  (`checked N, mismatches 0`). Full procedure: `dsh-profile-sha-pin-lib-parity-verify`.
- Never restart the user's host yourself. Hand over
  `bash /etc/nixos/scripts/dsh-desktop-restart.sh` followed by
  `bash /etc/nixos/scripts/dsh-desktop-restart.sh --verify-only`, and name the receipt the user
  should read back afterwards (all-Chinese or all-English, never mixed).
