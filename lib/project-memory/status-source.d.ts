/**
 * The filesystem **adapter** behind the `/memory` status receipt: the `.agents/memory` layout → the
 * core's measured facts.
 *
 * This is the only file in the status path that opens anything, and the only one that knows where the
 * layout puts a file (`shared/paths.ts` owns the names; this file only counts what is there).
 * `status-report.ts` renders the DTO and stays disk-free, so every "what does the store look like now"
 * question changes here and every "what does the user read" question changes there.
 *
 * The pair next door — `project-handoff/compaction.ts` (core) and `compaction-events.ts` (shim) — splits
 * for the same reason, but that shim mirrors a **dsh** event shape and is registered in
 * `docs/harness/integration.md`. This one mirrors **our own** storage layout, so it is an internal
 * adapter, not a host shim, and it does not belong in that registry.
 *
 * Removal condition: when the memory store grows a typed reader that already returns these counts (the
 * way `loadMemory` returns the document), this file collapses into that reader and the layout knowledge
 * moves with it — no caller of `formatMemoryStatus` would have to change.
 *
 * Every "I could not read it" is a named absence (`undefined` / `unreadable`), never `0`: reporting
 * "0 backups" for a directory we failed to list is a wrong cause, and a wrong cause is worse than a
 * named gap.
 */
import { type MemoryFileFacts } from "./status-report.js";
/**
 * Measure the store around one memory document.
 *
 * @param projectRoot - the project whose `.agents/memory` is being reported on.
 * @returns the facts `formatMemoryStatus` renders; unmeasurable values stay `undefined`.
 */
export declare function readMemoryFileFacts(projectRoot: string): Promise<MemoryFileFacts>;
