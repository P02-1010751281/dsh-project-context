/**
 * Where a project's `.agents` state lives, and the project root itself: the `.git`-entry lookup
 * (async and sync) with its cache, every path helper, and the two name validators.
 */
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import path from "node:path";
export const AGENTS_DIR = ".agents";
export const LEGACY_DIR = ".pi";
export const MEMORY_SUBDIR = "memory";
export const SKILLS_SUBDIR = "skills";
export const SESSION_LOGS_SUBDIR = "session-logs";
const projectRootCache = new Map();
function cacheProjectRoot(cwd, root) {
    projectRootCache.set(path.resolve(cwd), root);
    return root;
}
/** Cache-only lookup for prompt assembly; a miss warms the cache instead of blocking. */
export function cachedProjectRoot(cwd) {
    return projectRootCache.get(path.resolve(cwd));
}
/**
 * The nearest ancestor holding a `.git` entry — a directory for a normal clone, a *file* for a linked
 * worktree or a submodule — or `undefined` when no ancestor does. The plugin needs the directory its
 * `.agents/` state belongs to, not git's environment handling (`GIT_DIR`, `GIT_WORK_TREE`, ceiling
 * directories), so this reads the filesystem directly: no subprocess per cwd, nothing to fail when
 * git is not installed, and no command capability in the shipped source.
 */
function nearestProjectRoot(cwd) {
    for (let dir = cwd;;) {
        if (existsSync(path.join(dir, ".git")))
            return dir;
        const parent = path.dirname(dir);
        if (parent === dir)
            return undefined;
        dir = parent;
    }
}
/** The root for `key`, through `nearestProjectRoot` and falling back to `key` itself. */
function resolveProjectRoot(key) {
    const found = nearestProjectRoot(key);
    if (found === undefined)
        return key;
    // `git rev-parse --show-toplevel` reported a symlink-resolved path and `.agents/` must keep landing
    // in the same place, so resolve the discovered root the same way.
    try {
        return realpathSync(found);
    }
    catch {
        return found;
    }
}
/** Resolve the project root for a cwd through its `.git` entry, falling back to the cwd itself. */
export async function getProjectRoot(cwd) {
    const key = path.resolve(cwd);
    const cached = projectRootCache.get(key);
    if (cached !== undefined)
        return cached;
    return cacheProjectRoot(key, resolveProjectRoot(key));
}
/**
 * Synchronous variant for prompt-assembly providers. Both variants share one cache and one lookup,
 * so a cwd is walked at most once per process.
 */
export function getProjectRootSync(cwd) {
    const key = path.resolve(cwd);
    const cached = projectRootCache.get(key);
    if (cached !== undefined)
        return cached;
    return cacheProjectRoot(key, resolveProjectRoot(key));
}
export function memoryDir(projectRoot) {
    return path.join(projectRoot, AGENTS_DIR, MEMORY_SUBDIR);
}
/** Standard project skills directory, also discovered natively by dsh and pi. */
export function skillsDir(projectRoot) {
    return path.join(projectRoot, AGENTS_DIR, SKILLS_SUBDIR);
}
export function memoryFile(projectRoot) {
    return path.join(memoryDir(projectRoot), "MEMORY.md");
}
export function contextFile(projectRoot) {
    return path.join(memoryDir(projectRoot), "CONTEXT.md");
}
export function logsDir(projectRoot) {
    return path.join(memoryDir(projectRoot), SESSION_LOGS_SUBDIR);
}
/** Mechanical per-session index maintained by the archive step, next to the logs it points at. */
export function sessionIndexFile(projectRoot) {
    return path.join(logsDir(projectRoot), "INDEX.md");
}
/** Pre-move index location (`<memory>/session-index.md`), merged into the new index whenever it holds one. */
export function legacySessionIndexFile(projectRoot) {
    return path.join(memoryDir(projectRoot), "session-index.md");
}
export function legacyPiDir(projectRoot) {
    return path.join(projectRoot, LEGACY_DIR);
}
export function legacyOmpDir(projectRoot) {
    const encoded = `--${projectRoot.replaceAll(path.sep, "-")}--`;
    return path.join(homedir(), ".omp", "agent", "memories", encoded);
}
export function safeSessionId(sessionId) {
    const cleaned = sessionId.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 128);
    if (!cleaned)
        return "ephemeral";
    // Only an id that is already its own safe name is unambiguous: a sanitized or truncated one can
    // collide with a *different* session, and the two would then share one archive directory (the
    // second write overwriting the first). Suffix a short digest of the full id so the mapping stays
    // injective; a normal `session-<uuid>` is untouched.
    if (cleaned === sessionId)
        return cleaned;
    return `${cleaned.slice(0, 119)}-${createHash("sha256").update(sessionId).digest("hex").slice(0, 8)}`;
}
export function validSkillName(name) {
    return /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(name);
}
