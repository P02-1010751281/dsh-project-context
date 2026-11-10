/**
 * The managed `.agents/.gitignore` block, written at most once per process per directory.
 */
import path from "node:path";
import { readOptional, writeAtomic } from "./files.js";
/**
 * Header and entry list for the memory directory's local-artifact ignore file.
 *
 * `entries.json` (batch Z2) is here rather than tracked because it is a clock, not a fact: it records
 * when each entry id was first seen, so a fresh clone simply has no ages and nothing is ever called
 * unconfirmed until the project has been used for the horizon. Committing it would buy that horizon at
 * the price of a merge conflict between two hosts every time they both learn an id.
 */
const MEMORY_GITIGNORE_HEADER = "# project-context: local artifacts, do not commit";
/**
 * The artifacts this plugin creates locally and the project's `.gitignore` keeps out of git.
 *
 * Exported because batch Z2's anchor-drift check has to know that a missing file here is not drift: a
 * fresh clone has no `errors.log` and no journal, and an entry pointing at one is describing the
 * plugin's own outputs, not a path somebody deleted.
 */
export const MEMORY_GITIGNORE_LINES = ["*.memory-backup-*", "errors.log", "purge.log", "trash/", "*.lock", "*.steal", "*.broken-*", "memory.jsonl", "memory-log-*.jsonl", "memory.jsonl.*.tmp", "autolearn-state.json", "entries.json"];
const gitignoreEnsured = new Set();
/**
 * Keep local artifacts (journal, backups, locks, the error log) out of the project's commits,
 * once per process. Best effort: a failure is not retried so a write is never blocked by it.
 *
 * The header is written only when the file does not already carry it: `MEMORY_GITIGNORE_LINES`
 * grows as the plugin adds artifacts, and emitting the header unconditionally with every batch
 * that adds a line left a second copy of the comment in the middle of the file (upstream hit
 * exactly this when its own line list grew). Accepted residual: the presence check folds case, so
 * a header written in different capitalisation still earns one more comment line — gitignore
 * comments carry no semantics, and a full fix would need a second case-folded line set.
 * @param memoryDirectory - the `.agents/memory` directory.
 */
export async function ensureMemoryGitignore(memoryDirectory) {
    const file = path.join(memoryDirectory, ".gitignore");
    if (gitignoreEnsured.has(file))
        return;
    gitignoreEnsured.add(file);
    try {
        const existing = await readOptional(file);
        const lines = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
        const missing = MEMORY_GITIGNORE_LINES.filter((line) => !lines.has(line));
        if (missing.length === 0)
            return;
        const hasHeader = existing
            .split(/\r?\n/)
            .some((line) => line.trim().toLowerCase() === MEMORY_GITIGNORE_HEADER.toLowerCase());
        const header = hasHeader ? "" : `${MEMORY_GITIGNORE_HEADER}\n`;
        const head = existing && !existing.endsWith("\n") ? `${existing}\n` : existing;
        await writeAtomic(file, `${head}${header}${missing.join("\n")}\n`);
    }
    catch {
        // Ignoring local artifacts is best-effort; a failure must not block the write.
    }
}
