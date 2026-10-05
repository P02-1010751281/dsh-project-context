/**
 * The managed `.agents/.gitignore` block, written at most once per process per directory.
 */
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
