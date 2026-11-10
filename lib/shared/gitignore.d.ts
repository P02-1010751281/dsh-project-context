/**
 * The managed `.agents/.gitignore` block, written at most once per process per directory.
 */
/**
 * The artifacts this plugin creates locally and the project's `.gitignore` keeps out of git.
 *
 * Exported because batch Z2's anchor-drift check has to know that a missing file here is not drift: a
 * fresh clone has no `errors.log` and no journal, and an entry pointing at one is describing the
 * plugin's own outputs, not a path somebody deleted.
 */
export declare const MEMORY_GITIGNORE_LINES: string[];
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
export declare function ensureMemoryGitignore(memoryDirectory: string): Promise<void>;
