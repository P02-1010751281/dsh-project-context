---
name: dsh-project-memory-cap-guard
description: "Keep .agents/memory/MEMORY.md under the 32000-char cap and verify it with the plugin API (loadMemory + isMemoryTruncated) instead of grepping for the truncation marker, so newly appended memory is not silently dropped."
---

# Project memory cap guard (dsh-project-context)

`.agents/memory/MEMORY.md` is normally written through the plugin's `normalizeMemoryDocument`, which cuts a capped document on a **line boundary** (`clipToLineBoundary`, never a bare `.slice()`) and appends a marker `_[memory truncated at <limit> characters: <dropped> dropped]_`. Editing the file with the `edit` tool bypasses that write path, so the file can sit **above** the cap; the next plugin write (journal append or render write) then truncates it and the lines appended since the cut point are lost permanently. This has recurred repeatedly, so treat it as a standing check, not a one-off fix.

## Procedure

1. **Measure before and after any memory edit**
   - `wc -c .agents/memory/MEMORY.md`
   - `MAX_MEMORY_CHARS` is **32000**; `MIN_MEMORY_CHARS` 4000; `MAX_MEMORY_CHARS_LIMIT` 200000 (configurable via `maxMemoryChars`).
   - Budget **~31,500 chars**, not 32000: a session appends memory between checks, so 32000 is already over the cap by the time you notice.

2. **Verify truncation state with the API, never with text checks**
   - Run a throwaway probe under `/tmp` that imports host modules by **absolute path** (`/mnt/Data/Projects/dsh-project-context/lib/...`, because relative imports inside `/tmp` resolve against the probe).
   - Call `loadMemory(root, 32000)` and require `isMemoryTruncated(doc) === false` (exported from `src/shared/memory-store.ts`).
   - Do **not** verify by grepping for the marker string: legitimate prose can describe the marker, so a grep hit proves nothing, and a miss proves nothing either. Do **not** treat a passing `pnpm test` as evidence the file is untruncated. A `read`-then-`edit` round trip does not protect the file either — truncation happens on the plugin's next write.

3. **Do not trust the `/memory status` line alone**
   - A loaded document can carry the truncation marker while the status object reports `damaged: 0`, `unreadable: undefined`, `poisoned: false` and renders a plain healthy `Project memory: …/MEMORY.md`. The status text is not a cap check; step 2 is.

4. **Compress, do not discard**
   - When over the cap, compress **superseded history** — detail about already-shipped fixes and closed batches — rather than deleting conventions, invariants, accepted-residual lists (known accepted misclassifications), or open-task pointers.
   - Keep the document under ~6000 words; memory is for durable project truth, not narrative.

5. **Re-measure and re-probe, then report the numbers**
   - After compressing: repeat `wc -c` and the `loadMemory(root, 32000)` + `isMemoryTruncated()` probe, and state the final char count plus the boolean (e.g. "31,683 chars, untruncated").

6. **Confirm the tail survived**
   - If the write was meant to be permanent, check that the newest content is still present after the plugin's next write (e.g. locate the newest convention heading in the tail). Newly appended lines are exactly what a silent truncation drops.

## Traps this guard exists for
- Silent permanent loss of newly appended content: new lines land past the cut point and are dropped on write.
- The loaded-memory trap: marker present, status healthy, `/memory status` shows nothing wrong.
- Verifying by grep for the marker or by a green test run instead of `isMemoryTruncated()`.
