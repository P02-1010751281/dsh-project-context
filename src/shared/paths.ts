/**
 * Where a project's `.agents` state lives, and the project root itself: the git-based lookup
 * (async and sync) with its cache, every path helper, and the two name validators.
 */

import { execFile, execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const AGENTS_DIR = ".agents";

export const LEGACY_DIR = ".pi";

export const MEMORY_SUBDIR = "memory";

export const SKILLS_SUBDIR = "skills";

export const SESSION_LOGS_SUBDIR = "session-logs";

const projectRootCache = new Map<string, string>();

function cacheProjectRoot(cwd: string, root: string): string {
	projectRootCache.set(path.resolve(cwd), root);
	return root;
}

/** Cache-only lookup for prompt assembly; a miss warms the cache instead of blocking. */
export function cachedProjectRoot(cwd: string): string | undefined {
	return projectRootCache.get(path.resolve(cwd));
}

/** Resolve the project root for a cwd through git, falling back to the cwd itself. */
export async function getProjectRoot(cwd: string): Promise<string> {
	const key = path.resolve(cwd);
	const cached = projectRootCache.get(key);
	if (cached !== undefined) return cached;

	try {
		const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: key, timeout: 3000, windowsHide: true });
		const root = stdout.trim();
		return cacheProjectRoot(key, root ? path.resolve(root) : key);
	} catch {
		return cacheProjectRoot(key, key);
	}
}

/**
 * Synchronous variant for prompt-assembly providers. `git` runs at most once
 * per cwd; later calls read the cache.
 */
export function getProjectRootSync(cwd: string): string {
	const key = path.resolve(cwd);
	const cached = projectRootCache.get(key);
	if (cached !== undefined) return cached;

	try {
		const stdout = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: key, timeout: 3000, windowsHide: true, encoding: "utf8" });
		const root = stdout.trim();
		return cacheProjectRoot(key, root ? path.resolve(root) : key);
	} catch {
		return cacheProjectRoot(key, key);
	}
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

/** Mechanical per-session index maintained by the archive step, next to the logs it points at. */
export function sessionIndexFile(projectRoot: string): string {
	return path.join(logsDir(projectRoot), "INDEX.md");
}

/** Pre-move index location (`<memory>/session-index.md`), merged into the new index whenever it holds one. */
export function legacySessionIndexFile(projectRoot: string): string {
	return path.join(memoryDir(projectRoot), "session-index.md");
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
