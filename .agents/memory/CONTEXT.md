# Project Context

Last updated: 2026-10-05T10:43:27.164Z

## Summary

This session continued from handoff session-0a1fb10f and again re-derived the disk state instead of trusting it: HEAD == origin/main == 953be85, version 0.4.1, tag v0.4.1, clean tree, last `src/` commit f38a0ba (2026-10-05T18:14:04+08:00), and `git diff --exit-code -- lib` empty (still empty after a `tsc` run). The 19387 socket holder was still the pre-fix process — `ps -o lstart=` gives 17:17:29, earlier than f38a0ba — so the section-share rebalance is committed, built and shipped in `lib/` but NOT loaded; `errors.log` carried no pass after 18:04:16Z, so `/memory update` had not been re-run either. The fix was re-verified from `lib/` alone, i.e. the bytes a fixed Commit ships: MEMORY.md 34078 characters, `sectionsFromMarkdown` → `renderMemoryDocument` byte-identical with `sectionDropped / droppedItems / itemTruncated` all 0, `memorySectionOverage` empty, `loadMemory(root, 40000)` truncated false / damaged 0 / poisoned false; per-section headroom Project 894 / Invariants 2698 / Pitfalls 1885 / Index 526 (84–87% used), prompt targets at 0.9 of each hard budget, longest entry 670 (< 800). `pnpm test` was re-read fresh: 353 pass / 0 fail. One handoff claim was corrected: the live `include:project-context` Config schema is not "7 keys" but 21 fields, all batch-H new spellings with no retired name — the original wording meant "only the seven new key names". The user then chose to restart the desktop host, so the post-restart load check is the open task.

## Key points

- Disk re-derived this round: `HEAD == origin/main == 953be85`, version 0.4.1, tag v0.4.1, clean tree; `git log f38a0ba..HEAD` is three docs commits (ad55a65, 39c2fec, 953be85), and f38a0ba is the only `src/` change and already carries the rebuilt `lib/`.
- Load state: NOT loaded. 19387 holder start 17:17:29 < f38a0ba 18:14:04+08:00. `git diff --exit-code -- lib` is empty, so `lib/` matches `src/`; only the host restart is missing.
- Fix re-verified from `lib/`: byte-identical round trip, `sectionDropped 0 / droppedItems 0 / itemTruncated 0`, `overage []`, max entry 670 chars, `loadMemory(root, 40000)` clean, document 34078 chars, natural body shape 17.4 / 45 / 28.6 / 9.0 against the shares 0.17 / 0.45 / 0.29 / 0.09.
- Headroom now Project 894 / Invariants 2698 / Pitfalls 1885 / Index 526; the handoff's 879 / 2656 / 1860 / 516 was the pre-953be85 snapshot, so the drift is a few characters, not a defect.
- Gate re-read: `pnpm test` 353 pass / 0 fail, exit 0; node v24.21.0; `git diff --exit-code -- lib` empty after that compile.
- Handoff correction: the live `include:project-context` Config schema has 21 fields at status `schema`, all batch-H new spellings and no retired name. "Still 7 keys" was a compression of "only the seven new key names" — never use a key count as the acceptance test.
- MEMORY.md deliberately carries no share numbers (its own invariant forbids copying them); those numbers live only in `src/project-memory/memory-schema.ts`.
- `errors.log` is unchanged since 18:04:16Z: no `/memory update` since the compression, the last lines being the 09:20:54 output-limit cut, the 09:36:31 and 10:01:35 `lossy-refused` refusals, then the 10:04:16 landing.
- The verification probe is throwaway: /tmp/verify-memory-shares.mjs imports `lib/` read-only and prints round trip, per-section headroom, natural shape and `loadMemory`; it is not part of the repo.

## Open tasks

- After the user's restart, verify the load: `ss -ltnp | grep 19387` then `ps -o lstart= -p <pid>` must be later than f38a0ba (2026-10-05T18:14:04+08:00); `git diff --exit-code -- lib` empty; optionally `/etc/nixos/scripts/dsh-desktop-restart.sh --verify-only` = RESULT: PASS; the live Config schema still carries only batch-H spellings at status `schema`.
- Then the user runs `/memory update`; branch on the result: success → re-verify the round trip plus `loadMemory`/`isMemoryTruncated` and the per-section headroom, then commit and push the written artifacts; `lossy-refused` again → deep compression toward ~26–27k characters; another output-limit cut → the output side binds and only shrinking the document fixes it without touching the profile. Acceptance for every branch is a byte-identical round trip with 0 dropped entries.
- Release next, per the user's ordering — after a successful `/memory update`: `### 未发布（v0.4.1 之后）` already carries content, the release commit moves it under the new version heading and opens a fresh empty 未发布 section, and because the span changed `src/` it must carry the rebuilt `lib/` (f38a0ba already committed it, so the tree is consistent).
- Two pi-side rulings remain with the user, and the out-of-repo residuals are unchanged: dsh core splitting `discovery.ts`'s `capacity()` into declared window plus usable input, and pi's `resolveThreshold` `!model || usage.tokens === null` plus its truncated-retry guard coverage.
- Standing guard: no profile edits, no host restarts and no /etc/nixos changes unless the user names them; the desktop restart script and `/memory update` are user-only.

<!-- latest-session-title: Share rebalance verified in lib/; desktop host restart pending -->
