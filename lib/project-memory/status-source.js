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
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { errorLogFile, logsDir, memoryDir } from "../shared/paths.js";
import { memoryJournalFile } from "./journal.js";
import {} from "./status-report.js";
/** The name prefix `backupMemoryBeforeWrite` gives every backup it writes next to the render. */
const BACKUP_PREFIX = "MEMORY.md.memory-backup-";
/** One archived session is a directory under `session-logs/` carrying a `meta.json`. */
const SESSION_META = "meta.json";
/** The `<n>` of a file's `code` when the failure has one (`ENOENT`, `EACCES`, …). */
function codeOf(error) {
    return error?.code;
}
/**
 * Count the lines in one text file, counting a torn final line as a line.
 *
 * The journal repairs a torn tail on the next append and reports it as damage on read, so the count has
 * to include it — dropping it would make the number disagree with the file the user can open.
 */
function countLines(text) {
    if (text === "")
        return 0;
    const breaks = text.split("\n").length - 1;
    return text.endsWith("\n") ? breaks : breaks + 1;
}
/** The journal's size and line count; absent and unreadable are distinct facts. */
async function readJournalFacts(file) {
    let bytes;
    try {
        bytes = (await stat(file)).size;
    }
    catch (error) {
        if (codeOf(error) === "ENOENT")
            return { kind: "absent" };
        return { kind: "unreadable" };
    }
    try {
        return { kind: "present", lines: countLines(await readFile(file, "utf8")), bytes };
    }
    catch {
        return { kind: "unreadable" };
    }
}
/** Backups this plugin wrote, by the prefix its generator uses; a user's similarly named file is not one. */
async function countBackups(directory) {
    try {
        const entries = await readdir(directory, { withFileTypes: true });
        return entries.filter((entry) => entry.isFile() && entry.name.startsWith(BACKUP_PREFIX)).length;
    }
    catch (error) {
        return codeOf(error) === "ENOENT" ? 0 : undefined;
    }
}
/** Archived sessions: directories that carry a `meta.json`, never a bare directory count. */
async function countArchivedSessions(directory) {
    let entries;
    try {
        entries = await readdir(directory, { withFileTypes: true });
    }
    catch (error) {
        return codeOf(error) === "ENOENT" ? 0 : undefined;
    }
    const meta = await Promise.all(entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
        try {
            await stat(path.join(directory, entry.name, SESSION_META));
            return 1;
        }
        catch {
            return 0;
        }
    }));
    return meta.reduce((sum, found) => sum + found, 0);
}
/** Lines in `errors.log`; the file's content is never parsed here, only counted. */
async function countLogLines(file) {
    try {
        return countLines(await readFile(file, "utf8"));
    }
    catch (error) {
        return codeOf(error) === "ENOENT" ? 0 : undefined;
    }
}
/**
 * Measure the store around one memory document.
 *
 * @param projectRoot - the project whose `.agents/memory` is being reported on.
 * @returns the facts `formatMemoryStatus` renders; unmeasurable values stay `undefined`.
 */
export async function readMemoryFileFacts(projectRoot) {
    return {
        journal: await readJournalFacts(memoryJournalFile(projectRoot)),
        backups: await countBackups(memoryDir(projectRoot)),
        archivedSessions: await countArchivedSessions(logsDir(projectRoot)),
        errorLogLines: await countLogLines(errorLogFile(projectRoot)),
    };
}
