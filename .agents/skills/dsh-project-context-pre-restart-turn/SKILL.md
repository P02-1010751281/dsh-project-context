---
name: dsh-project-context-pre-restart-turn
description: "Run the last agent turn before a user-only dsh desktop restart of dsh-project-context: pin the loaded-vs-not criterion, keep it stable with docs-only commits, use the window for offline lib/ evidence, persist the round into CONTEXT.md, screen the skills boundary, and hand the user the exact restart and acceptance commands."
---

<!-- autolearn-generated: this skill may be superseded by a later autolearn pass -->

# Pre-restart turn (dsh-project-context)

Use when a landed `src/` or `client/` change can only become live through the user's desktop restart and your turn is the last one before it. The goal is that the restart loses nothing, that the acceptance check you hand over stays valid, and that a killed session leaves recoverable state.

## 1. Pin the load criterion before touching anything

```bash
git rev-parse HEAD origin/main
git log -1 --format='%H %cI' -- src/     # last src-touching commit = the criterion
git diff --exit-code -- lib
ss -ltnp | grep 19387                    # socket holder pid (electron's node child)
ps -o lstart= -p <pid>
```

Holder start **earlier** than the last `src/` commit ⇒ not loaded. `lib/` must diff clean against a fresh `tsc` compile (`lib/client.js` is the one expected extra, it is the esbuild bundle); if a `src`/`client` change was not rebuilt into `lib/`, rebuild and commit `lib/` together with the source change, then re-derive the criterion time. Re-read the criterion in this turn — never quote a time or pid from an earlier turn or from memory.

## 2. Do not restart, and never over-claim what a probe proved

The desktop restart is user-only: `/etc/nixos/scripts/dsh-desktop-restart.sh` exits 3 when invoked from a dsh session or one of its children (it would kill the process group carrying the session), and only `--dry-run` / `--verify-only` are safe in-session. `--verify-only` PASS covers store/wrapper match, **not** load — never present it as "the change is live".

## 3. Keep the criterion stable for the rest of the turn

Anything still landing after step 1 should be docs / evidence / skills only. A docs-only commit does not move the criterion (the last `src/` commit time), so the acceptance commands you hand over stay valid. If a real `src`/`client` change is unavoidable, rebuild `lib/`, commit both, re-derive the criterion time, and state the new time to the user.

## 4. Spend the window on offline evidence

Probe the built `lib/` (the code the host actually loads) against the real tracked documents and session data, never against docs or prose. Record it under `.agents/evidence/<date>-<topic>/{README.md,*.mjs}` so it is runnable later. Make the probe print its own inputs (e.g. both document lengths) so a re-run shows which input moved; a claim the script cannot re-derive is not verifiable.

## 5. Persist the round for a successor session

Refresh `.agents/memory/CONTEXT.md` with HEAD, the criterion time, what is still pending on the user, and the deliberately unhandled residuals — then check it through the plugin's own renderer (total within budget, `isContextTruncated false`, every section inside its share) and commit it separately (`docs(memory): …`). The restart kills this session, so nothing may live only in the conversation.

## 6. Screen the tracking boundary, then stage narrowly

```bash
ls -d .agents/skills/*/ ; git ls-files '.agents/skills/**/SKILL.md' ; git status --short
```

Autolearn writes new skills straight into `.agents/skills/` and nothing errors — an unstaged skill dir is the boundary's silent failure mode (cloners cannot regenerate it, the evidence source is gitignored). Stage it with this batch; this is step 6 of `dsh-project-context-concurrent-writer-guard`. Then `git add <paths>` (never `add -A`), `git commit -F <msg> -- <paths>`, push, and confirm `git rev-parse HEAD origin/main`.

## 7. Hand over exactly

Give the user, in this order: the restart command; the post-restart acceptance commands (`ss -ltnp | grep 19387` → `ps -o lstart= -p <pid>` must be later than the stated last `src/` commit time, and `git diff --exit-code -- lib` empty); their user-only follow-up (`/memory update`, then the tag when a release is due).

Separate three things in the report: what a probe proved offline, what only a post-restart run can prove, and the residuals you chose not to handle. Leave the full gate run in the record (`pnpm typecheck` / `pnpm build` / `pnpm test`, read pass and case counts fresh, expect 0 mutant markers in `lib/`).
