---
name: dsh-project-memory-cap-guard
description: "Keep the tracked memory docs (.agents/memory/MEMORY.md, CONTEXT.md) under the memory cap: compress or rewrite them by whole-line replacement with read-back and survival checks, and verify cap state with the plugin API (loadMemory + isMemoryTruncated) instead of grepping for the truncation marker."
---

# Memory cap guard and consolidation (dsh-project-context)

`.agents/memory/MEMORY.md` is normally written through the plugin's `normalizeMemoryDocument`, which cuts a capped document on a **line boundary** (`clipToLineBoundary`, never a bare `.slice()`) and appends a marker `_[memory truncated at <limit> characters: <dropped> dropped]_`. Editing the file with the `edit` tool bypasses that write path, so the file can sit **above** the cap; the next plugin write (journal append or render write) then truncates it and the lines appended since the cut point are lost permanently. This has recurred repeatedly, so treat it as a standing check, not a one-off fix.

Use this skill whenever `.agents/memory/MEMORY.md` or `.agents/memory/CONTEXT.md` must be measured, shortened, or rewritten — headroom is gone, the user asks to trim memory, a narrative has to be reduced to a pointer, a stale claim has to be replaced, or the standing "watch cap headroom" task comes up. It owns both halves: **read-only cap verification** and the **edit mechanics** with their residual checks.

<!-- Absorbed 2026-10-03: the candidates `dsh-memory-context-consolidation` and `dsh-tracked-memory-consolidation-edit` were two names for this one workflow (candidate dedupe is exact-name only, so both survived). Their unique material — the allowed/never-touch cut list, whole-line replacement with anchor assertions, survival greps, the MEMORY.md↔CONTEXT.md duplication rule, and their trap list — now lives below, and both candidate files were deleted. Evidence: session `4cdeb0b9` (2026-10-02), which compressed MEMORY.md, hit the prefix-replace remnant incident, and added the read-back/duplicate-sentence check; plus the 2026-09-26 consolidation recorded in the same session family. -->

## Procedure

1. **Measure before and after any memory edit**
   - `wc -m .agents/memory/MEMORY.md` — **characters, which is the unit of the cap**. `wc -c` counts **bytes**, and this document is mostly CJK, so it overstates by roughly a third: a 26K-character file reads as ~34K bytes and looks over the cap when it is not. The authority is step 2's `loaded.text.length`, not either `wc`. Take the cap from config (`maxMemoryChars`) and from the call sites themselves (`git grep -n 'normalizeMemoryDocument(' -- src/ | grep -v 'export function' | wc -l`) — never from a number written in a doc or in a skill.
   - Read the cap instead of remembering it: `grep -n 'MAX_MEMORY_CHARS' src/shared/limits.ts` (re-exported through `src/shared/project-state.ts`). `MIN_MEMORY_CHARS` and `MAX_MEMORY_CHARS_LIMIT` live in the same file and the config field is `maxMemoryChars`.
   - Budget a margin below the cap: a session appends memory between checks, so a document sitting at the cap is already over it by the time you notice.
   - Headroom is per **section**, not only in total. The renderer drops whole entries over a single section's budget, so read the shares from `src/project-memory/memory-schema.ts` (`MEMORY_SECTIONS`) and check every section: a document that fits the cap as a whole can still have two sections at 96% and refuse the next pass.

2. **Verify truncation state with the API, never with text checks**
   - Run a throwaway probe under `/tmp` that imports host modules by **absolute path** (`/mnt/Data/Projects/dsh-project-context/lib/...`, because relative imports inside `/tmp` resolve against the probe).
   - Call `loadMemory(root, <the cap read in step 1>)` and require `isMemoryTruncated(doc) === false` (exported from `src/project-memory/document.ts`; `loadMemory` from `src/project-memory/load.ts`). Check `damaged` / `poisoned` and the section count in the same pass.
   - Do **not** verify by grepping for the marker string: legitimate prose can describe the marker, so a grep hit proves nothing, and a miss proves nothing either. Do **not** treat a passing `pnpm test` as evidence the file is untruncated. A `read`-then-`edit` round trip does not protect the file either — truncation happens on the plugin's next write.

3. **Do not trust the `/memory status` line alone**
   - A loaded document can carry the truncation marker while the status object reports `damaged: 0`, `unreadable: undefined`, `poisoned: false` and renders a plain healthy `Project memory: …/MEMORY.md`. The status text is not a cap check; step 2 is.

4. **Decide what may be cut — and what must never be**
   - **Allowed:** narrative that duplicates an authoritative copy this repo already points at (the delivery-line facts live in `/etc/nixos` `scripts/dsh-plugin-patches/PINNING-RISK.md` and the matching entry in `log.md`, found by entry-head content, not by number), superseded history such as detail about already-shipped fixes and closed batches, historical commit-hash chains, enumerations and counts a read-now command regenerates, and stale assertions a command can answer.
   - **Never touch:** conventions and invariants, the tracking boundary, accepted-residual lists (known accepted misclassifications), open-item pointers, decisions still in force, and anything a pinning test depends on.
   - Keep the document under ~6000 words; memory is for durable project truth, not narrative.

5. **Edit by whole-line replacement**
   - Choose a stable anchor inside the target line, replace the **entire** line, and assert that the anchor is present in the new line. Never drive a prefix- or anchor-relative partial replacement over a long prose line: the remainder after the anchor survives and the rewritten line ends in a duplicated remnant (this happened on `CONTEXT.md` and produced a repeated tail).

6. **Read back and prove survivals**
   - Read every rewritten line back and check that the same sentence does not appear twice. Do not treat "the replacement ran" as evidence.
   - For each symbol, rule, path, or config key named in the compressed passage, run `git grep -oF '<string>' -- .agents/` (and the matching `src/` grep for code symbols) and confirm it is still present. Verify the file **tail** — the last section and its pointer lines — not only the edited region.
   - Keep `MEMORY.md` and `CONTEXT.md` from restating the same fact: each duplicated copy diverges at the next edit. Keep the full statement in one file and a pointer in the other; when a passage is reduced to a pointer, verify the target still exists.

7. **Re-measure and re-probe, then report magnitudes**
   - After compressing: repeat the `loadMemory(root, <the cap>)` + `isMemoryTruncated()` probe plus the per-section headroom check (and `wc -m` if you want the raw count), and state the final **character** count plus the boolean.
   - Report magnitudes and round counts to the user; never write the measured totals or section numbers back into the documents — they change with every write.

8. **Confirm the tail survived**
   - If the write was meant to be permanent, check that the newest content is still present after the plugin's next write (e.g. locate the newest convention heading in the tail). Newly appended lines are exactly what a silent truncation drops.

9. **Stage only what this task changed**
   - Use the scoped commit: stage only this task's paths and never `git add -A` — the full rule (the exact add, `git commit -F <msg> -- <paths>`, and the `git diff --cached` check) lives in `dsh-project-context-concurrent-writer-guard` step 5. A second agent session is frequently editing this repo, and its untracked work must not be swept in.

## Traps this guard exists for
- Silent permanent loss of newly appended content: new lines land past the cut point and are dropped on write.
- The loaded-memory trap: marker present, status healthy, `/memory status` shows nothing wrong.
- Verifying the cap with `wc -c`: it is bytes, not characters, so a CJK-heavy document reads ~30% over the cap while `isMemoryTruncated()` is false — a false alarm that invites pointless compression.
- Verifying by grep for the marker or by a green test run instead of `isMemoryTruncated()`.
- A duplicate remnant after a partial replacement is silent: only reading the line back and looking for a repeated sentence catches it.
- An empty grep is evidence only of the revision you read; state the revision when reporting a survival check.
- Fixed counts, byte sizes, hashes, and section numbers written into these docs go stale immediately; replace them with the read-now command.
