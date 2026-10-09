---
name: dsh-post-restart-acceptance-probe
description: "Build a tri-state host-side acceptance probe for a landed dsh-project-context fix whose only observable surface is the running dsh host (an event the host writes, a session title, a card cell): derive the rule from the built lib/, discriminate on the exact timestamp the fix gates, read only the highest-version session log, count with a self-excluding anchored grep, and prove PASS/FAIL/UNOBSERVABLE are all reachable before handing the restart to the user."
---

<!-- autolearn-generated: this skill may be superseded by a later autolearn pass -->

## When to use
A `src/` fix has landed and been committed, but nothing offline can prove the running host performs the behaviour (an event the host writes, a `session/title` rename, a card cell). Unit tests pass, yet the observable surface belongs to the host. You need the user to restart, and you need a probe that reports "loaded and worked" / "loaded and broken" / "cannot tell yet" without producing false reds. Complements `dsh-host-build-restart-verify` (which proves loaded-vs-not) and `dsh-pre-restart-turn` (which only hands over the commands).

## Procedure
1. **Re-derive the load criterion first; never quote it.** `ss -ltnp | grep 19387` -> `ps -o lstart= -p <pid>` for the desktop holder, and `git log -1 --format=%cI -- src/` for the last code commit. If the holder started before that commit the fix is NOT loaded and the probe must return UNOBSERVABLE, not FAIL. The second half is `git diff --exit-code -- lib` empty and `lib/` identical to a fresh `tsc --outDir $TMP` compile (only `lib/client.js` extra).
2. **Locate the exact artifact the behaviour writes and reuse its own helpers from `lib/`** (built output, not `src/`), so the probe's judgement matches production. Example: `firstHandoffInput(...)` from `lib/project-handoff/...` yields the seq and time of a continuation's first real human input. Never re-implement the rule and never identify a seed or a turn by wording or length.
3. **Discriminate on the timestamp the fix actually gates.** For the handoff retitle the gate is the seq of the first human input, so the probe uses that input's time — not the session-directory mtime (moves only on create/delete) and not the session creation time. A session whose first human input already happened before the fix landed can never self-heal (the gate opens once per session lifetime), so such sessions must be reported as notes, never as red.
4. **Read only the highest-version log per session directory.** Migrated dirs hold `session.v3` and `session.v4` side by side; reading both double-counts events. This bug bit the first draft of the probe.
5. **Count live events with a self-excluding, line-anchored grep.** e.g. `zstd -dc ~/.dsh/sessions/--<slug>--/$s/session*.jsonl* | grep -c '^{"type":"session/titl[e]"'`. The `[e]` stops the grep matching its own command line; the `^` anchor stops injected MEMORY/CONTEXT text (which is echoed into the log) from inflating the count. A naive `grep -c session/title` measured 97 where the truth was 1.
6. **Exit-code contract, stated in the README:** `0` = the behaviour fired (e.g. a second `session/title` with the expected value); `1` = it should have fired and did not (true red); `2` = not observable yet (criterion negative, or no eligible target). Never let `2` read as green. Under `set -euo pipefail`, guard every `var="$(...)"` so the branch that reads it stays reachable.
7. **Ship a `--selftest`** that synthesizes session directories under `/tmp` and asserts all three outcomes and their exit codes. Without it the UNOBSERVABLE branch is silently dead. Print the self-test verdict before the live verdict.
8. **Place the probe under `.agents/evidence/<YYYY-MM-DD>-<name>/` with a `README.md`** (project convention), stating the criterion, the discriminators and the eligibility rule. Commit `git add <paths>` + `git commit -F <msg> -- <paths>` + push; keep `src/` untouched so the load criterion does not move.
9. **Hand over exactly one restart command plus the acceptance command**, and list the eligible targets (sessions with zero human input so far) and the permanently ineligible ones. If the fix is docs-only the criterion is unchanged and the same commands still hold.

## Pitfalls
- Reporting FAIL when the criterion is merely negative trains the user to ignore red. Encode "cannot tell yet" as its own exit code.
- Session logs echo the agent's own commands and the injected documents, so any string count needs the `titl[e]`-style self-exclusion and the `^` anchor; verify the count against a known-good session.
- Do not identify an eligible continuation by wording, length or mtime; use the same structural helper the product uses.
- A probe that reads `src/` instead of `lib/` can disagree with the running host, which loaded `lib/`.
