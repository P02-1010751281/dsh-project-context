/**
 * Durable project memory: an append-only journal plus a rendered `MEMORY.md`.
 *
 * Ported from the pi sibling (`extensions/project-context/project-state.ts`), which
 * unified the memory write path with the session archive: `session.jsonl` is
 * append-only truth and `session.md` is its rendering, so `memory.jsonl` is the
 * append-only truth and `MEMORY.md` is the rendering a human reads, the prompts
 * inject, and external editors touch.
 *
 * Layout (`<project>/.agents/memory/`):
 *   memory.jsonl                     one record per write: {"ts","op":"replace"|"append","text"}
 *   MEMORY.md                        rendered document, always rebuildable from the journal
 *   MEMORY.md.memory-backup-<stamp>  byte-level copy of the render before it is replaced
 *   MEMORY.md.lock / .steal          cross-process write serialization
 *   memory-log-<stamp>-<hex>.jsonl   archived journals from a rotation
 *
 * Invariants (a port keeps every one of them):
 *   1. The read path has no side effects: no writes, no backups, no log entries.
 *   2. The journal is append-only; only a rotation replaces the file, and it archives
 *      the previous bytes instead of deleting them.
 *   3. A byte-level backup is taken before the render is replaced, inside the same lock.
 *   4. A failed write never leaves "render newer than journal": the append lands first.
 */

/**
 * The memory subsystem's public surface. The implementation lives in the sibling modules
 * (`journal` / `record` / `load` / `document` / `poison` / `backup`); this module exists so
 * the other three plugins and the tests have one stable import, and so the invariants above
 * stay next to the API they constrain. The cross-process lock is in `shared/lock.ts`.
 */

export { backupMemoryBeforeWrite } from "./backup.js";
export { isMemoryTruncated, memoryTruncationMarker, normalizeMemoryDocument } from "./document.js";
export { appendMemoryOp, foldMemoryJournal, memoryJournalFile, readMemoryJournal } from "./journal.js";
export { loadMemory, loadMemorySync, readMemoryDamage, type LoadedMemory } from "./load.js";
export { importLegacyMemory, recordMemoryDocument } from "./record.js";
