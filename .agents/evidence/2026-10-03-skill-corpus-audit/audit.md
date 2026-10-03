# Agent-skill corpus audit — dsh-project-context (read-only)

Revision read: `652907c` = `origin/main`, tree clean at start. Paths relative to
`/mnt/Data/Projects/dsh-project-context`; `§n` = numbered step/bullet. **The corpus moved during
this audit**: a concurrent session rewrote three skills and deleted two candidates between `10:06`
and `10:08` — `[HEAD]` = committed blob, `[WT]` = that working tree. It fixed several dead
references listed in §3; each is labelled. I modified no repo file; I ran only `node --test`
(243/243; `git status` clean apart from that other session's edits).

## 1. Purpose table

| skill | governs | trigger |
|---|---|---|
| `dsh-artifact-claim-verification` | Checking load-bearing claims in a report/handoff/memory entry before fixing or committing | A report states a finding, cause, count, revision, or necessity claim that changes your next action |
| `dsh-doc-claim-closure-review` | Closure review + mechanical residual check after correcting false/volatile claims in tracked docs | After a review-driven batch edited `MEMORY.md`, `CONTEXT.md`, `CHANGELOG.md`, or a `SKILL.md` |
| `dsh-host-build-restart-verify` | Making a repo plugin change effective in the *serving* host: build → which host → restart → prove loaded *and* effective | Change touches `src/**`, `lib/*.js`, or the client bundle |
| `dsh-nix-desktop-launcher-artifact-verify` | Verifying a Nix launcher change against the real store artifact in `env -i` | Editing `/etc/nixos/pkgs/dsh-desktop/`; "does a restart pick this up" / 需要重启桌面端吗 |
| `dsh-plugin-mutation-round` | Proving a behaviour is pinned by a test via one *valid* mutant, then restore + rebuild to 0 markers | Need to prove a test pins a behaviour, or validate a new regression test |
| `dsh-plugin-review-fix-batch` | The umbrella cycle: review → reproduce → fix → mutation-check → verify → commit/push → closure review | A batch of plugin changes must be independently scrutinized before landing on `main` |
| `dsh-project-context-concurrent-writer-guard` | Safe staged editing/committing when a second *session* shares the tree, incl. the unstaged-skill check | Before any edit/commit when >1 dsh session is known or suspected |
| `dsh-project-context-release` | Cutting a version: version+CHANGELOG, gate, annotated tag, verify on origin | Publishing a release |
| `dsh-project-memory-cap-guard` | Measuring **and** compressing/rewriting `MEMORY.md`+`CONTEXT.md`: API cap check, edit mechanics, residual checks | Cap headroom gone; user asks to trim memory; a narrative must shrink to a pointer |
| `dsh-session-index-adoption-audit` | Auditing/repairing the project archive index `session-logs/INDEX.md` (stranded legacy `<memory>/session-index.md`) | `INDEX.md` may silently disagree with disk; autolearn can't see an archived session |
| `dsh-session-store-maintenance` | Inspecting/probing/repairing the local `~/.dsh` store (RPC probes, log reads, workspace grouping, unloadable-log repair) | Task needs to read, probe, repair, or tidy local dsh sessions |
| `dsh-teammate-run-guard` | Delegating to *in-process* teammates without losing in-flight work or leaving `src/` mutated | Delegating to in-process teammates, esp. audits/mutations touching `src/` |
| `pi-to-dsh-feature-port` | Porting a feature from `pi-project-context` into the dsh plugin under a strict write scope | A port brief names pi functions/lines and dsh call sites |
| `upstream-source-ground-truth-verify` | Verifying an external API/field/formula claim by sparse-cloning upstream source at a stated revision | A change depends on how dsh core / pi / codex-rs actually behaves |

## 2. Overlap matrix

**(a) verbatim / near-verbatim duplication**
1. `artifact-claim-verification` §9 `A report whose metadata is wrong must not be cited as-is.` ≡
   `upstream-source-ground-truth-verify` §6 `Re-verify the file path and line of any finding before
   acting on it; a report whose metadata is wrong must not be cited as-is.`
2. `mutation-round` §5 `Validity trio … (a) it compiles, tsc 0 errors … (b) its marker is present in
   lib/ after the build; (c) it demonstrably changes behaviour on a probe input.` ≡
   `teammate-run-guard` §11 `A mutant is valid only if it compiles with 0 errors, its marker is
   present in lib/ after the build, and it demonstrably changes behaviour on a probe input.`
3. `mutation-round` §7 `Restore src/ from a hash-verified /tmp copy (sha256sum -c), never via git
   checkout -- or git stash. Restoring src/ does NOT restore lib/.` ≡ `teammate-run-guard` §12
   `Restore mutated sources from the hash-verified /tmp copy; do not use git checkout -- or git
   stash.` + §9 `Restoring src/ does not restore lib/.`
4. **The scoped-commit rule is written 7× with drift**: `concurrent-writer-guard` §5 `Commit with a
   scoped add: git add <exact paths>, never git add -A or git add .` · `release` §1 `Never run git
   add -A. Stage only the release paths (git add <paths>)` · `doc-claim-closure-review` §7 · `[WT]`
   `cap-guard` §9 · `session-store-maintenance` Ground rules `never add -A` · `review-fix-batch` §8
   · `pi-to-dsh-feature-port` §3. Drift: only `concurrent-writer-guard`, `cap-guard[WT]` and the
   launcher skill add `git commit -F <msg> -- <paths>` (options before `--`).
5. `cap-guard[WT]` §5 `Never drive a prefix- or anchor-relative partial replacement over a long
   prose line: the remainder after the anchor survives and the rewritten line ends in a duplicated
   remnant` ≡ `doc-claim-closure-review` §4 `Do not use prefix-based replace scripts; they can
   leave a duplicated half-sentence.`; `cap-guard[WT]` §6 ≡ `doc-claim-closure-review` §4 `After
   editing, read back the line and check that the same sentence does not appear twice.`
6. **Never append a custom session event type** — `review-fix-batch` §2 `plugins must never append a
   custom session event type (dsh-session rejects unknown types unless ignorable: true; write
   .agents/memory/ files instead)` ≡ `pi-to-dsh-feature-port` §4 `a plugin must never append a
   custom session event type (append project-side files under .agents/memory/ instead; a
   source-scan test enforces this)` ≡ `session-store-maintenance` `Plugins must not append custom
   session event types at all; write project-side files instead.`
7. **"generic edit tool bypasses the plugin write path"** in `cap-guard[WT]` intro,
   `artifact-claim-verification` §8 `the loaded memory size via the plugin API (edits made with the
   edit tool bypass the write path and make the recorded size stale)`, `doc-claim-closure-review` §2.

**(b) one skill's step is a special case of the other**
8. `review-fix-batch` §5 `Add a regression test for each fix and mutation-check it: temporarily
   break or revert the production change, confirm the new test fails, restore the fix and confirm
   it passes` — mutation-check as one batch step, order inverted (test→mutant) from `mutation-round`
   (mutant→test). `[WT]` adds `use the dsh-plugin-mutation-round skill — do not restate them here`;
   the *rule* is still stated in both, only the procedures differ.
9. `artifact-claim-verification` §8 (`git rev-parse HEAD origin/main` … the gate … marker count in
   `lib/`) is general; `doc-claim-closure-review` §6 is that list restricted to docs work.
10. `cap-guard[WT]` §2 `Call loadMemory(root, 32000) and require isMemoryTruncated(doc) === false`
    vs `doc-claim-closure-review` §6 `Memory: loadMemory(root, 32000); check truncated, damaged,
    poisoned.`

**(c) merely adjacent — do NOT merge**
11. `host-build-restart-verify` §1 `A commit is never enough. The host loads plugin code from the
    repo's built lib/*.js through the profile link: dependency` vs
    `nix-desktop-launcher-artifact-verify` 铁律 `launch.sh 会被 makeWrapper 内联进 wrapper，产物里
    可能根本不存在 <out>/lib/dsh-desktop/launch.sh`. Same class ("source ≠ what runs"), different
    artifact and fix: restart the host vs `重启桌面端 / 再点一次图标不会换 wrapper` ⇒
    `home-manager switch`. Only the shared "do not restart unprompted" rule needs one owner.
12. `session-store-maintenance` (`~/.dsh`, another process's store) vs
    `session-index-adoption-audit` (project-side `session-logs/INDEX.md`, adoption under
    `withMemoryLock`): same data, opposite direction.
13. `teammate-run-guard` §5 `Never hand off, compact, or end the turn while any teammate is running`
    vs `concurrent-writer-guard` (a second *session*) — in-process vs cross-process; failure modes
    do not transfer.
14. `project-context-release` (tag semantics: peeled `^{}`, no GitHub Releases) vs the doc/memory
    editing skills — distinct outcome, distinct failure modes.

## 3. Staleness check (read-only commands unless noted)

| claim | found |
|---|---|
| `review-fix-batch` §4 `[HEAD]` `inside the module that owns the invariant (e.g. src/handoff.ts, src/learn-state.ts, src/memory.ts)` | **All three dead.** `src/` holds only `project-autolearn/ project-context/ project-handoff/ project-memory/ shared/`; real owners are `src/project-handoff/*`, `src/project-autolearn/learn-state.ts`, `src/project-memory/*`. **Fixed in `[WT]` 10:07** (names the four plugin roots; says the old paths "are gone"). |
| `review-fix-batch` §6 `[HEAD]` `pnpm test (baseline currently 132/132)` | **Stale: `node --test` prints `tests 243 / pass 243 / fail 0`.** **Fixed in `[WT]`** → `report the counts this run printed — never a baseline recorded in a skill or a doc`. |
| `review-fix-batch` §3 `[HEAD]` + `session-store-maintenance` `session.v3.jsonl.zstd (current) or legacy session.jsonl.zstd (v0)` | **v3 is not current**: store-wide 283 v4 vs 93 v3; in this repo's cwd dir 79 v4 vs 54 v3 (129 dirs) — a v3-only glob misses the majority. `review-fix-batch` **fixed in `[WT]`** (`session.v*.jsonl.zstd`); `session-store-maintenance` **still stale** (unmodified, mtime 09-13). `host-build-restart-verify` §5 already used `session.v4.jsonl.zstd`. |
| `review-fix-batch` §3 `[HEAD]` `/tmp/rpc.sh <method> '<json args>' 3080`; `session-store-maintenance` Probe the running server | **`/tmp/rpc.sh` does not exist** and no skill records how to recreate it; **nothing listens on 3080** now (`ss -ltnp` → only `127.0.0.1:19387`). A `/tmp`-resident helper assumed by two skills with no recipe. `review-fix-batch` **fixed in `[WT]`** (`<port>` + `ss -ltnp \| grep -E '19387\|3080'`); `session-store-maintenance` still hardcodes 3080. |
| `cap-guard` `[HEAD]` §2 `isMemoryTruncated(doc) === false (exported from src/shared/memory-store.ts)` | **Dead path.** No `src/shared/memory-store.ts`; defined at `src/project-memory/document.ts:21`, re-exported by `src/project-memory/memory-store.ts`. **Fixed in `[WT]` 10:06.** |
| `pi-to-dsh-feature-port` §3/§5 `If a needed file is out of scope (e.g. src/shared/learn.ts, src/shared/config.ts)`; `adaptiveOutputTokens ported into src/shared/autolearn.ts` | **Both dead**: no `src/shared/learn.ts`, no `src/shared/autolearn.ts`. Real: `src/project-autolearn/learn-state.ts`; `adaptiveOutputTokens` is at **`src/shared/output-budget.ts:77`**. `src/shared/config.ts` survives. **Unmodified (mtime 09-27) — still teaches dead paths.** |
| `pi-to-dsh-feature-port` §6 `extensions/project-context/*.ts`; `handoff.ts helpers, autolearn.ts …, config.ts keys, consolidate.ts` — and §7 `Temporarily mutate the gitignored built output (lib/)` | **pi is no longer flat**: `extensions/project-context/{archive,autolearn,handoff,memory,shared}/…`; no `autolearn.ts`, no `consolidate.ts`; `handoff/handoff.ts` + `shared/config.ts` exist; pi HEAD == `origin/master` == `8b300dc7`. §7 **directly contradicts** `mutation-round` §3 `Edit src/ only. Never edit lib/*.js: the build overwrites it and the mutation yields a false SURVIVED.` — mutation-round is correct. |
| `artifact-claim-verification` §2 `a report cited src/autolearn.ts:449 while that file is 111 lines (the code lived in src/shared/autolearn.ts)` | Both named files are **gone**; the illustrative witness cannot be re-checked. The lesson stands. |
| `artifact-claim-verification` §5 `the const model = resolveAuxModel(...) binding is never reassigned before use` | `resolveAuxModel` has **0 hits in `src/`**; the named rebuttal example no longer resolves. |
| `nix-desktop-launcher-artifact-verify` 铁律 3 `本仓实测：live wrapper 指向 0rr2jfp6…-launch.sh，而本地构建产物是 gwzaa2mj…` | **Both store paths are GC'd.** Live exec target is now `exec "/nix/store/id0icc462bh3rcvp4falfm2f58z37x96-launch.sh" "$@"`. Technique valid, hashes dead. |
| `host-build-restart-verify` §4 `expect only the extra lib/client.js, which is the client bundle`; §2 `ls -d /nix/store/*nodejs-*/bin` | **`lib/` is not flat** (`lib/client.js` plus `lib/{project-autolearn,project-context,project-handoff,project-memory,shared}/*.js`; no `lib/index.js`) — the `diff -rq <tmp> lib/` check still works, the gloss does not. The nodejs glob also matches `-dev/-npm/-corepack/-source`: usable but ambiguous. |
| candidate `dsh-session-log-user-correction-recovery` merged-note `candidate dedupe is exact-name only, see src/project-autolearn/candidate.ts:66,76` | **Lines have drifted.** L66 is now `return skill.candidate ? "needs at least one verified session id" : …`; L76 is inside the `saveProposedSkill` doc comment. The cited predicates moved to **L68/L69**. |
| `dsh-memory-context-consolidation` (candidate, deleted 10:06) §1 `Use when .agents/memory/MEMORY.md or .agents/context/CONTEXT.md approaches the memory cap` | **Dead path**: the file is `.agents/memory/CONTEXT.md`. |

**Verified alive:** `SAFETY_MARGIN_TOKENS = 4_000` (`src/project-handoff/threshold.ts:19`); caps
`32_000/4_000/200_000` (`src/shared/limits.ts`); `MAX_INDEX_LINES = 200`
(`src/project-context/session-index.ts:34`); `clipToLineBoundary`, `normalizeMemoryDocument`
(6 non-export call sites), `queueIndexLine`+`withMemoryLock`, `qualityLimit`/`handoffRoom`/
`capacityLimit`, `SessionWorkTracker`+`session/flush`, `cachedProjectRoot(cwd) ??
getProjectRootSync(cwd)`, `continuationPreamble`+`- 生成时间：` (`language.ts:203,215,220`);
`~/.dsh/storages/workspace.json` (`tables.workspaces`+`global.archivedSessionIds`);
`~/.dsh/.credentials.yaml` holds `client-connection/browser-session`; profiles
`ctxdev`(2)/`desktop`(2)/`web`(2) mount the plugin, `headless`(0) does not; `gh` absent; remote
`ssh://git@ssh.github.com:443/…`; tags `v0.2.1/v0.2.0/v0.1.0`, no Releases;
`/etc/nixos/pkgs/dsh-desktop/{launch.sh,default.nix}` present; no chromium/playwright. Upstream
(dsh 0.1.7-rc.2): `LlmModelContext = { contextWindow: number }` and first-match-wins `capacity()`
at `packages/llm/llm-pi-ai/src/discovery.ts:91` keep `upstream-source-ground-truth-verify`'s seam
claim valid; `Session.append`'s conditional `sourceEventSeqs`/`surfaceOp`
(`core/session/src/types.ts:486-490`) and `session/list`'s `_request`
(`api/session-controller/src/index.ts:247`) stand.

## 4. Merge proposal

**M1 — `dsh-project-memory-cap-guard` ⊇ both consolidation candidates: ALREADY EXECUTED** (10:06,
uncommitted; candidates deleted). Survives from `dsh-memory-context-consolidation`: its cut list, now
`[WT]` §4 `Allowed: narrative that duplicates an authoritative copy … Never touch: conventions and
invariants, the tracking boundary, accepted-residual lists, open-item pointers, decisions still in
force`. Survives from `dsh-tracked-memory-consolidation-edit`: `[WT]` §5 whole-line replacement +
anchor assertion, §6 `git grep -oF '<string>' -- .agents/` survival proof and tail check, §6 the
`MEMORY.md`↔`CONTEXT.md` one-statement-one-pointer rule. **No rule dropped.** Residual for a human:
the deletion is invisible to git (`skill-candidates/` is gitignored), so its only records are the
uncommitted diff and this report.
**M2 — mutation validity: one owner.** Move `teammate-run-guard` §8/§9/§11/§12 into
`mutation-round`; keep `teammate-run-guard` for delegation lifecycle (§1–7, §10). A concurrent edit
already added the pointer in `review-fix-batch` §5 but did not touch `teammate-run-guard`. **Rule to
carry, not drop** — §8's `Treat any unrestored mutation as unverified work and restore it before
continuing` must land in `mutation-round`, whose §7 says only `Restore src/ from a hash-verified
/tmp copy`.
**M3 — scoped commit: one owner** (overlap 4). Canonical = `concurrent-writer-guard` §5+§6 (already
most complete). Six copies become one-line pointers. **No rule dropped** — all seven carry both
operative clauses.
**M4 — memory-edit mechanics: one owner** (overlaps 5, 7, 10). Canonical after M1 = `cap-guard[WT]`
§4/§5/§6; `doc-claim-closure-review` §4/§6 become pointers. **Rule that must be MOVED, not deleted**
— `doc-claim-closure-review` §5 `Run a mechanical residual check. Grep for the exact strings from
the previous false claims (old counts, stale anchors, removed claims) and assert they are 0` and its
trap `A sentence that lists the strings it claims are absent is self-contradicting; do not write
zero hits and then list them` exist nowhere else.
**M5 / M6 — one owner for the shared verify sentence** (overlap 1) and for the session-event
invariant (overlap 6; canonical `session-store-maintenance`, which names `Session.append` and the
`ignorable` literal). Neither loses a rule.
**Must stay separate:** `host-build-restart-verify` / `nix-desktop-launcher-artifact-verify`
(overlap 11 — different artifact and authority; the launcher facts live in `/etc/nixos`);
`session-store-maintenance` / `session-index-adoption-audit` (12); `teammate-run-guard` /
`concurrent-writer-guard` (13); `project-context-release` (14); `pi-to-dsh-feature-port` — which must
be **corrected, not merged** (dead `src/shared/{learn,autolearn}.ts`, dead pi layout, and the direct
`lib/`-mutation contradiction).

## 5. Candidate verdicts

1. **`dsh-memory-context-consolidation`** — deleted at 10:06 (was 3911 B, mtime 10-02 20:20).
   Verdict: **merge into `dsh-project-memory-cap-guard`** — which happened; `[WT]` carries its cut
   list. Promoting it separately would have re-created the duplication it was written to prevent.
   No rule dropped.
2. **`dsh-tracked-memory-consolidation-edit`** — deleted at 10:06 (was 4454 B). Verdict: **merge
   into `dsh-project-memory-cap-guard`** (same execution); its unique material landed in `[WT]`
   §5/§6. No rule dropped.
3. **`dsh-session-log-user-correction-recovery`** — **still on disk** (8588 B, `candidate: true`).
   **Not subsumed by any tracked skill.** The nearest tracked text is `artifact-claim-verification`
   §5 `When a reviewer rebuts a hypothesis, read the cited code and confirm the identity claim
   yourself` — about a *reviewer's* rebuttal, not a *user's* prior correction, and lacking the three
   discriminators this candidate owns: the `source.kind == "user"` filter, the handoff-banner
   exclusion by opener and size, and `Do not gate this read on correction vocabulary`. Verdict:
   **promote as its own skill**. Its own note already claims the bar is met — `The bar — "a second
   independent incident" — is therefore met on the merits; status stays candidate: true only because
   promotion writes a tracked skill and is the user's call.` Before promotion, fix its stale
   citation `src/project-autolearn/candidate.ts:66,76`, since promotion moves the text into a
   tracked file.

## 6. Honest limits

- **A concurrent session is editing this corpus right now** (10:06–10:08: 3 skills modified, 2
  candidates deleted). My §2/§3 quotes are HEAD + that working tree, and may already have changed.
  My merges M2–M6 overlap work it has begun as cross-references — coordinate, don't redo.
- **RPC argument shapes unverified**: `/tmp/rpc.sh` is gone and 3080 is not listening, so
  `session-store-maintenance`'s `{"args":{"_request":{}}}` / `{"args":{"request":{…}}}` shapes and
  its `session/create` RSS caution were not exercised. I checked the `_request` param name only, and
  against the 0.1.7-rc.2 checkout — a different running line would invalidate it.
- **`pnpm typecheck` / `pnpm build` were not run** (they write into `lib/`, a repo file). The
  243/243 is a pass count for the *existing built* tree, not for current `src/`.
- `node --test <bare dir>` failing (asserted by `mutation-round` §2) was not re-run — it would have
  executed the suite again for a tangential claim. `.credentials.yaml` was read for key names only.
- Scope = the 14 tracked skills + 3 candidates. No other repo's or `~/.dsh`-level skill corpus was
  examined.

## 7. Post-audit status (added 2026-10-03, after the consolidation round)

This report was written against `652907c`; the consolidation commit `3cd2cba` landed afterwards. Read
§3 and §5 as statements about that revision, and this section as the current status.

**Fixed in `3cd2cba`** — every §3 row that still read "still stale" or "Unmodified":

- `pi-to-dsh-feature-port` — dead `src/shared/{learn,autolearn}.ts` and the dead pi layout replaced;
  §7 now reads "Edit **`src/` only** — never `lib/*.js`", so it no longer contradicts `mutation-round`.
- `session-store-maintenance` — v4 named as current, v3/v0 as legacy, with the v3-only-glob warning.
- `review-fix-batch` — the dead `src/handoff.ts`/`src/learn-state.ts`/`src/memory.ts` citations are
  gone; no recorded baseline survives (the remaining `132/132` and `145/145` are labelled as examples
  that went stale).
- `cap-guard`, `artifact-claim-verification`, `nix-desktop-launcher-artifact-verify`,
  `host-build-restart-verify` — fixed as marked in §3.
- §5 verdict 3 — `dsh-session-log-user-correction-recovery` was **promoted** to a tracked skill, so
  §5 no longer describes the on-disk state.

**Already executed inside `3cd2cba`** (the audit proposed them; the concurrent round did them):

- **M2** (mutation validity, one owner): `teammate-run-guard` §9/§11 point at `mutation-round` and
  carry no restatement.
- **M4** (memory-edit mechanics, one owner): `doc-claim-closure-review` §4 is a pointer; its unique §5
  mechanical residual check was kept.

**Executed in the follow-up round (this commit):**

- **M3** (scoped commit, one owner): **now executed.** `concurrent-writer-guard` §5 is the single
  definition and says so; `release` §1, `doc-claim-closure-review` §7, `cap-guard` §9,
  `session-store-maintenance` ground rules, `review-fix-batch` §8 and `pi-to-dsh-feature-port` §3 now
  carry the identical one-line pointer. That is **2 wordings across those 7 sites instead of 7
  diverging ones**, and the safety token `never git add -A` is deliberately kept inline at every site:
  a bare pointer fails when it is not followed.
- **Deliberately not converted:** `dsh-nix-desktop-launcher-artifact-verify` keeps its own phrasing —
  its instance governs `/etc/nixos` (another repo, another concurrent session), so
  `concurrent-writer-guard` is the wrong pointer target there. The corpus therefore holds 8 sites
  carrying the rule, not 1.
- **Found and fixed while executing M3** (none of these were in §3): the dead `src/handoff.ts` example
  in `concurrent-writer-guard` §2; `/tmp/rpc.sh` presented as an existing helper in
  `review-fix-batch` §3 while `session-store-maintenance` §15 already recorded that it is gone; and
  `pi-to-dsh-feature-port`'s frontmatter, which promised "the baseline test count" while its §6
  rejects comparing against a baseline number.

**§6's limits are now closed by a read-only pass** (2026-10-03): `pnpm typecheck` exits 0 (both
tsconfigs); `node --test` prints `tests 243 / pass 243 / fail 0` and exits 0 — run without the `tsc`
half of `pnpm test` so that nothing writes into `lib/`; a recompile into a temp dir followed by
`diff -rq <tmp> lib/` reports the single extra entry `lib/client.js`, which is the byte-exact test that
`lib/` still mirrors this `src/`. The `243/243` in §1/§6 is therefore no longer only a count for a
pre-existing build.

**Still open** (unchanged): M5 (one owner for the shared verify sentence) and M6 (one owner for the
session-event invariant). Neither would lose a rule by being moved; both were left for a round that
does not touch the same files.

**Not covered here:** the ~51 skills under `~/.agents/skills` — a separate repo, vendored from 16
upstream GitHub sources — audited in
`.agents/evidence/2026-10-03-third-party-skill-corpus-audit/audit.md`.
