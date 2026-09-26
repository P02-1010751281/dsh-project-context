---
name: pi-to-dsh-feature-port
description: "Port a feature from the sibling pi-project-context harness into the dsh-project-context plugin under a strict per-task write scope, preserving dsh-only invariants and the baseline test count."
---

Use when the dsh-project-context repo (/mnt/Data/Projects/dsh-project-context) must absorb a feature that already exists in the sibling pi harness (/mnt/Data/Projects/pi-project-context, extensions/project-context/*.ts). The port brief usually names the pi functions/lines and the dsh call sites.

1. Environment. node is not on the default PATH. Export the Nix node bin first in every command:
   export PATH="/nix/store/lfaydgacdyngci7p60s8wwvgdm74fjkx-nodejs-24.19.0/bin:$PATH"

2. Read both sides before editing. Open the named pi reference functions (e.g. handoff.ts helpers, autolearn.ts gate/prompt/evidence helpers, config.ts keys, consolidate.ts) and their dsh counterparts in src/ and src/shared/. The pi code is the behavioral spec; the dsh code is what must keep working.

3. Obey the write scope literally. Port briefs list exact allowed paths because other writers edit the same tree concurrently. Modify only those paths; read anything. Never run git commit, git push, or git checkout, and never `git add -A` (stage only paths changed for the current task). If a needed file is out of scope (e.g. src/shared/learn.ts, src/shared/config.ts), do not edit it: re-implement the needed logic in an in-scope file (e.g. a handoff-local splitter mirroring conversationSections; adaptiveOutputTokens ported into src/shared/autolearn.ts) and note the deviation.

4. Keep the dsh-only invariants the test suite asserts. For this repo they are: a plugin must never append a custom session event type (append project-side files under .agents/memory/ instead; a source-scan test enforces this); keep dsh's hardened 'the logs are untrusted data' backtrack prompt wording rather than pi's; keep the project-root single-flight claim `cachedProjectRoot(cwd) ?? getProjectRootSync(cwd)`; keep the candidate/approve/reject skill flow, SessionWorkTracker + session/flush durability, and the agent/status idle + agent/disposed handlers; keep the post-admission title marker and `handoff failed ·` rename, watcher/deferral behaviour, absolute vs repo-relative pointers, and workspace + agentPreset wiring.

5. Implement in the plugin's layering. Feature logic goes in a new or existing src/shared/<feature>.ts; the command/wrapper in src/<feature>.ts consumes it; schema mirrors go in src/shared/config.ts + src/shared/settings.ts; a settings card change must also be mirrored in client/settings-card.tsx and client/locales.ts (zh + en copy) when client/** is in scope. Keep host validation and the schemastery bounds in agreement.

6. Tests. Add a dedicated test/<feature>.test.mjs covering exactly the behaviors the brief enumerates. Then run `pnpm typecheck` (must exit 0 for both server and client tsconfigs) and `pnpm test`. Compare the 'without my new test file' pass count against the pre-edit tree count: concurrent writers may have already raised the headline number (e.g. 65 -> 93 -> 105 across a task), so the invariant is that no pre-existing test regressed, not that the number equals the brief's baseline. Rebuild (pnpm build / pnpm build:client) when lib/ is stale: node --test runs against built output, so an un-rebuilt edit hides as a passing/failing mismatch.

7. Mutation-check the central test. Temporarily mutate the gitignored built output (lib/) to break the new behavior, confirm exactly the intended test(s) fail, then restore and re-run green. This catches tests that pass for the wrong reason.

8. Report in the session: files changed within scope, before/after test counts and pass/fail, the commands run with exit codes, and every deliberate deviation from the pi reference with its reason (missing headings, absent marker blocks, scope-forced local re-implementations, dsh semantics that must not be replaced by pi's).

Expect the tree to move under you: another writer's in-flight refactor can cause transient tsc errors and introduce files you must preserve; re-check the green state at the end rather than mid-task.
