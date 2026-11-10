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

export const TASKS_SUBDIR = "tasks";

const projectRootCache = new Map<string, string>();

function cacheProjectRoot(cwd: string, root: string): string {
	projectRootCache.set(path.resolve(cwd), root);
	return root;
}

/** Cache-only lookup for prompt assembly; a miss warms the cache instead of blocking. */
export function cachedProjectRoot(cwd: string): string | undefined {
	return projectRootCache.get(path.resolve(cwd));
}

/**
 * The nearest ancestor holding a `.git` entry — a directory for a normal clone, a *file* for a linked
 * worktree or a submodule — or `undefined` when no ancestor does. The plugin needs the directory its
 * `.agents/` state belongs to, not git's environment handling (`GIT_DIR`, `GIT_WORK_TREE`, ceiling
 * directories), so this reads the filesystem directly: no subprocess per cwd, nothing to fail when
 * git is not installed, and no command capability in the shipped source.
 */
function nearestProjectRoot(cwd: string): string | undefined {
	for (let dir = cwd; ; ) {
		if (existsSync(path.join(dir, ".git"))) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

/** The root for `key`, through `nearestProjectRoot` and falling back to `key` itself. */
function resolveProjectRoot(key: string): string {
	const found = nearestProjectRoot(key);
	if (found === undefined) return key;
	// `git rev-parse --show-toplevel` reported a symlink-resolved path and `.agents/` must keep landing
	// in the same place, so resolve the discovered root the same way.
	try {
		return realpathSync(found);
	} catch {
		return found;
	}
}

/** Resolve the project root for a cwd through its `.git` entry, falling back to the cwd itself. */
export async function getProjectRoot(cwd: string): Promise<string> {
	const key = path.resolve(cwd);
	const cached = projectRootCache.get(key);
	if (cached !== undefined) return cached;

	return cacheProjectRoot(key, resolveProjectRoot(key));
}

/**
 * Synchronous variant for prompt-assembly providers. Both variants share one cache and one lookup,
 * so a cwd is walked at most once per process.
 */
export function getProjectRootSync(cwd: string): string {
	const key = path.resolve(cwd);
	const cached = projectRootCache.get(key);
	if (cached !== undefined) return cached;

	return cacheProjectRoot(key, resolveProjectRoot(key));
}

export function memoryDir(projectRoot: string): string {
	return path.join(projectRoot, AGENTS_DIR, MEMORY_SUBDIR);
}

/** Standard project skills directory, also discovered natively by dsh and pi. */
export function skillsDir(projectRoot: string): string {
	return path.join(projectRoot, AGENTS_DIR, SKILLS_SUBDIR);
}

export function memoryFile(projectRoot: string): string {
	return path.join(memoryDir(projectRoot), "MEMORY.md");
}

export function contextFile(projectRoot: string): string {
	return path.join(memoryDir(projectRoot), "CONTEXT.md");
}

export function logsDir(projectRoot: string): string {
	return path.join(memoryDir(projectRoot), SESSION_LOGS_SUBDIR);
}

/**
 * One file per task (`<memory>/tasks/<slug>.md`), each a context-shaped document.
 *
 * A task is the unit a session can be bound to, so the context of two unrelated workflows stops
 * sharing one `CONTEXT.md`: the file is the task's own state, and a session with no task keeps using
 * the project-level document unchanged. Slugs are file names, so `validTaskSlug` (the skill-name
 * rule, one kebab-case token) is the only accepted shape.
 */
export function tasksDir(projectRoot: string): string {
	return path.join(memoryDir(projectRoot), TASKS_SUBDIR);
}

/** The task document for one slug. */
export function taskFile(projectRoot: string, slug: string): string {
	return path.join(tasksDir(projectRoot), `${slug}.md`);
}

/** The per-session binding written by `/context task <slug>` and read by the injection and the pass. */
export function sessionMetaFileFor(projectRoot: string, sessionId: string): string {
	return path.join(logsDir(projectRoot), safeSessionId(sessionId), "meta.json");
}

/** Mechanical per-session index maintained by the archive step, next to the logs it points at. */
export function sessionIndexFile(projectRoot: string): string {
	return path.join(logsDir(projectRoot), "INDEX.md");
}

/** Pre-move index location (`<memory>/session-index.md`), merged into the new index whenever it holds one. */
export function legacySessionIndexFile(projectRoot: string): string {
	return path.join(memoryDir(projectRoot), "session-index.md");
}

/**
 * Tombstones for retired memory entries: one line per fact that left `MEMORY.md`.
 *
 * Deliberately a sibling document rather than a section of `MEMORY.md`: a tombstone is injected into
 * the consolidation prompt as a one-line "do not write this back" hint, and `sectionsFromMarkdown`
 * accepts only the four policy sections — a fifth one would turn the whole memory opaque.
 */
export function retiredFile(projectRoot: string): string {
	return path.join(memoryDir(projectRoot), "retired.md");
}

/** Older half of the tombstone file once it passes its line budget (moved, never deleted). */
export function retiredArchiveFile(projectRoot: string): string {
	return path.join(memoryDir(projectRoot), "retired-archive.md");
}

/**
 * Plugin-owned dates for the entry ids in `MEMORY.md`: when each id was first seen.
 *
 * The id itself rides inside the bullet (six characters per entry), because the model has to copy it
 * for a `supersedes:` reference to mean anything. The *date* is what the 180-day expiry needs, and it
 * costs eleven characters per entry on a document that has no room for it — measured 2026-11-10:
 * stamping `（tid:4f2a · 2026-11-10）` on this project's 134 entries added 3082 characters and made
 * the renderer drop 7 whole entries, while the bare id costs 804 and drops none.
 */
export function entryDatesFile(projectRoot: string): string {
	return path.join(memoryDir(projectRoot), "entries.json");
}

/**
 * Where the cleaning channel parks what it is about to delete (`<memory>/trash/<date>.tar`).
 *
 * Inside the memory directory on purpose: the tarball is evidence for a forgotten artifact, and it
 * outlives the process that removed it. It is a local artifact, never committed (see
 * `MEMORY_GITIGNORE_LINES`) and itself bounded by the same cleanup — a tar is only ever appended to
 * on the day it is written.
 */
export function trashDir(projectRoot: string): string {
	return path.join(memoryDir(projectRoot), "trash");
}

/**
 * The cleaning channel's own append-only log (`<memory>/purge.log`): one line per applied run.
 *
 * Separate from `errors.log` (batch Z4, user ruling 丙) because the two answer different questions:
 * `errors.log` records failures, this records deletions. It also keeps the index from carrying
 * unverifiable comments — the timeline stays the audit trail.
 */
export function purgeLogFile(projectRoot: string): string {
	return path.join(memoryDir(projectRoot), "purge.log");
}

/** One rotated append-only diagnostic log per project. */
export function errorLogFile(projectRoot: string): string {
	return path.join(memoryDir(projectRoot), "errors.log");
}

export function legacyPiDir(projectRoot: string): string {
	return path.join(projectRoot, LEGACY_DIR);
}

export function legacyOmpDir(projectRoot: string): string {
	const encoded = `--${projectRoot.replaceAll(path.sep, "-")}--`;
	return path.join(homedir(), ".omp", "agent", "memories", encoded);
}

export function safeSessionId(sessionId: string): string {
	const cleaned = sessionId.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 128);
	if (!cleaned) return "ephemeral";
	// Only an id that is already its own safe name is unambiguous: a sanitized or truncated one can
	// collide with a *different* session, and the two would then share one archive directory (the
	// second write overwriting the first). Suffix a short digest of the full id so the mapping stays
	// injective; a normal `session-<uuid>` is untouched.
	if (cleaned === sessionId) return cleaned;
	return `${cleaned.slice(0, 119)}-${createHash("sha256").update(sessionId).digest("hex").slice(0, 8)}`;
}

export function validSkillName(name: string): boolean {
	return /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(name);
}
