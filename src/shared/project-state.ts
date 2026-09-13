/**
 * Shared project-state infrastructure for the dsh-project-context plugins.
 *
 * Ported from pi's `agent/extensions/_shared/project-state.ts`. Storage layout
 * (shared with pi and any other harness speaking the `.agents` convention):
 *
 *   <project>/.agents/skills/<name>/SKILL.md              learned project skills
 *   <project>/.agents/memory/MEMORY.md                    durable project memory
 *   <project>/.agents/memory/CONTEXT.md                   rolling session summary + open tasks
 *   <project>/.agents/memory/session-logs/<session-id>/   session.jsonl + session.md
 *   <project>/.agents/memory/session-logs/INDEX.md        mechanical session index (no model call)
 *   <project>/.agents/memory/errors.log                   swallowed failures
 *
 * Legacy layouts are migrated on session start:
 *   <project>/.pi/{MEMORY.md,CONTEXT.md,session-logs,skills}
 *   <project>/.agents/memory/skills
 *   ~/.omp/agent/memories/<encoded-project>/ (read-only import)
 */

import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, cp, mkdir, readFile, readdir, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { readFileSync, statSync } from "node:fs";
import type { Dirent } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const AGENTS_DIR = ".agents";
export const LEGACY_DIR = ".pi";
export const MEMORY_SUBDIR = "memory";
export const SKILLS_SUBDIR = "skills";
export const SESSION_LOGS_SUBDIR = "session-logs";

export const MAX_MEMORY_CHARS = 24000;
export const MAX_CONTEXT_CHARS = 32000;
export const MAX_CONVERSATION_CHARS = 50000;
export const MAX_SKILL_BODY_CHARS = 20000;
export const MAX_SUMMARY_CHARS = 6000;
export const MAX_LIST_ITEM_CHARS = 800;

const projectRootCache = new Map<string, string>();
const textCache = new Map<string, { mtimeMs: number; size: number; text: string }>();

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

export function legacyPiDir(projectRoot: string): string {
	return path.join(projectRoot, LEGACY_DIR);
}

export function legacyOmpDir(projectRoot: string): string {
	const encoded = `--${projectRoot.replaceAll(path.sep, "-")}--`;
	return path.join(homedir(), ".omp", "agent", "memories", encoded);
}

export function safeSessionId(sessionId: string): string {
	return sessionId.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 128) || "ephemeral";
}

export function validSkillName(name: string): boolean {
	return /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(name);
}

/** Rotate `errors.log` once its on-disk size passes this many bytes. */
const MAX_ERROR_LOG_BYTES = 1_000_000;
/** How many characters of the newest tail survive a rotation. */
const KEEP_ERROR_LOG_CHARS = 64_000;
/** Cap one appended record so a huge stack cannot dominate the (bounded) log. */
const MAX_ERROR_DETAIL_CHARS = 8_000;

/**
 * Keep the diagnostic file bounded. It is append-only and lives inside the
 * user's repository, so an unrotated file would grow without limit there.
 * The size threshold is real bytes (from `stat`); the kept tail and the record
 * cap are character counts, which is what the rendering costs.
 * @param file - the `errors.log` path.
 */
async function rotateErrorLog(file: string): Promise<void> {
	try {
		if ((await stat(file)).size <= MAX_ERROR_LOG_BYTES) return;
		const tail = (await readFile(file, "utf8")).slice(-KEEP_ERROR_LOG_CHARS);
		// Drop the partial first line so the kept text starts on a record.
		const boundary = tail.indexOf("\n");
		await writeAtomic(file, `[...truncated; newest entries kept...]\n${boundary < 0 ? tail : tail.slice(boundary + 1)}`);
	} catch {
		// A missing file or a failed rotation must not block the append.
	}
}

export async function logError(projectRoot: string, scope: string, error: unknown): Promise<void> {
	try {
		const file = path.join(memoryDir(projectRoot), "errors.log");
		await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
		await rotateErrorLog(file);
		const full = error instanceof Error ? (error.stack ?? error.message) : String(error);
		const detail = full.length > MAX_ERROR_DETAIL_CHARS ? `${full.slice(0, MAX_ERROR_DETAIL_CHARS)}\n[...detail truncated...]` : full;
		await appendFile(file, `${new Date().toISOString()} [${scope}] ${detail}\n`, { encoding: "utf8", mode: 0o600 });
	} catch {
		// Diagnostics must never throw.
	}
}

export async function readOptional(file: string): Promise<string> {
	try {
		return await readFile(file, "utf8");
	} catch {
		return "";
	}
}

/**
 * Synchronous cached read for prompt providers. Re-reads only when the file
 * mtime or size changed, so an assembly stays cheap.
 */
export function readTextCachedSync(file: string): string {
	try {
		const info = statSync(file);
		const cached = textCache.get(file);
		if (cached !== undefined && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached.text;
		const text = readFileSync(file, "utf8");
		textCache.set(file, { mtimeMs: info.mtimeMs, size: info.size, text });
		return text;
	} catch {
		textCache.delete(file);
		return "";
	}
}

export function invalidateTextCache(file: string): void {
	textCache.delete(file);
}

export async function pathExists(target: string): Promise<boolean> {
	try {
		await stat(target);
		return true;
	} catch {
		return false;
	}
}

/** Modification time in milliseconds, or 0 when the file does not exist. */
export async function fileMtimeMs(file: string): Promise<number> {
	try {
		return (await stat(file)).mtimeMs;
	} catch {
		return 0;
	}
}

export async function writeAtomic(file: string, content: string): Promise<void> {
	await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
	// The UUID keeps two concurrent writers of the same file from sharing a temp path.
	const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
		await rename(temporary, file);
	} catch (error) {
		await rm(temporary, { force: true }).catch(() => undefined);
		throw error;
	}
	invalidateTextCache(file);
}

async function movePath(source: string, destination: string): Promise<void> {
	await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
	try {
		await rename(source, destination);
	} catch {
		await cp(source, destination, { recursive: true, force: false, errorOnExist: false });
		await rm(source, { recursive: true, force: true });
	}
}

/**
 * Merge one legacy artifact into the new location; newest content wins, then the
 * legacy path is removed.
 *
 * A file/directory type conflict cannot be merged automatically. Deleting the
 * legacy side would destroy the user's data, and `cp` would throw
 * `ERR_FS_CP_NON_DIR_TO_DIR` and abort the whole migration, so both sides stay
 * where they are and the caller reports the conflict.
 *
 * @param source - the legacy path to consume.
 * @param destination - the new location.
 * @returns `absent` when there is nothing to move, `conflict` when the two paths
 *   have incompatible types, `merged` when the source was consumed.
 */
async function mergePath(source: string, destination: string): Promise<"merged" | "absent" | "conflict"> {
	if (!await pathExists(source)) return "absent";
	if (!await pathExists(destination)) {
		await movePath(source, destination);
		return "merged";
	}

	const sourceStat = await stat(source);
	const destinationStat = await stat(destination);
	if (sourceStat.isDirectory() && destinationStat.isDirectory()) {
		let conflicted = false;
		for (const entry of await readdir(source, { withFileTypes: true })) {
			if (await mergePath(path.join(source, entry.name), path.join(destination, entry.name)) === "conflict") conflicted = true;
		}
		// Keep the source directory when it still holds an unmergeable child.
		if (conflicted) return "conflict";
		await rm(source, { recursive: true, force: true });
		return "merged";
	}

	if (sourceStat.isDirectory() || destinationStat.isDirectory()) return "conflict";

	if (sourceStat.mtimeMs > destinationStat.mtimeMs) {
		await cp(source, destination, { force: true });
	}
	await rm(source, { force: true });
	return "merged";
}

/** Remove leftover `<name>.<pid>.tmp` files from interrupted atomic writes. */
async function cleanStaleTemps(directory: string): Promise<void> {
	let entries: Dirent<string>[];
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch {
		return;
	}
	const cutoff = Date.now() - 60 * 60 * 1000;
	for (const entry of entries) {
		if (!entry.isFile() || !/\.\d+(?:\.[0-9a-f-]{36})?\.tmp$/.test(entry.name)) continue;
		const file = path.join(directory, entry.name);
		try {
			if ((await stat(file)).mtimeMs < cutoff) await rm(file, { force: true });
		} catch {
			// Best effort.
		}
	}
}

function normalizeSkillDocument(name: string, raw: string): string {
	if (raw.startsWith("---")) return `${raw.trimEnd()}\n`;
	const description = raw.split("\n")[0]!.trim().slice(0, 1024);
	return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${raw.trim()}\n`;
}

async function importSkillDirs(sourceDir: string, targetDir: string, options: { remove?: boolean } = {}): Promise<number> {
	let entries: Dirent<string>[];
	try {
		entries = await readdir(sourceDir, { withFileTypes: true });
	} catch {
		return 0;
	}

	let imported = 0;
	for (const entry of entries) {
		if (!entry.isDirectory() || !validSkillName(entry.name)) continue;
		const source = path.join(sourceDir, entry.name);
		const raw = (await readOptional(path.join(source, "SKILL.md"))).trim();
		if (!raw) continue;
		const destination = path.join(targetDir, entry.name, "SKILL.md");
		if (await readOptional(destination)) {
			if (options.remove) await rm(source, { recursive: true, force: true });
			continue;
		}
		await writeAtomic(destination, normalizeSkillDocument(entry.name, raw));
		if (options.remove) await rm(source, { recursive: true, force: true });
		imported += 1;
	}
	if (options.remove) await rmdir(sourceDir).catch(() => undefined);
	return imported;
}

export type MigrationResult = {
	moved: string[];
	importedSkills: number;
	importedMemory: boolean;
	/** Destination paths whose legacy counterpart could not be merged and was left in place. */
	conflicts: string[];
};

/** Consolidate legacy memory, context, logs and skills into the `.agents/` layout. */
export async function migrateProjectState(projectRoot: string): Promise<MigrationResult> {
	const moved: string[] = [];
	const conflicts: string[] = [];
	const legacyPi = legacyPiDir(projectRoot);
	const moves: Array<[string, string]> = [
		[path.join(legacyPi, "MEMORY.md"), memoryFile(projectRoot)],
		[path.join(legacyPi, "CONTEXT.md"), contextFile(projectRoot)],
		[path.join(legacyPi, SESSION_LOGS_SUBDIR), logsDir(projectRoot)],
	];
	for (const [source, destination] of moves) {
		const label = path.relative(projectRoot, destination) || destination;
		const outcome = await mergePath(source, destination);
		if (outcome === "merged") moved.push(label);
		if (outcome === "conflict") conflicts.push(label);
	}

	const importedSkills =
		await importSkillDirs(path.join(legacyPi, SKILLS_SUBDIR), skillsDir(projectRoot), { remove: true }) +
		await importSkillDirs(path.join(memoryDir(projectRoot), SKILLS_SUBDIR), skillsDir(projectRoot), { remove: true }) +
		await importSkillDirs(path.join(legacyOmpDir(projectRoot), SKILLS_SUBDIR), skillsDir(projectRoot));

	let importedMemory = false;
	if (!await pathExists(memoryFile(projectRoot))) {
		for (const name of ["MEMORY.md", "memory_summary.md", "learned.md"]) {
			const source = path.join(legacyOmpDir(projectRoot), name);
			const text = (await readOptional(source)).trim();
			if (!text) continue;
			await writeAtomic(memoryFile(projectRoot), text.endsWith("\n") ? text : `${text}\n`);
			importedMemory = true;
			break;
		}
	}

	await cleanStaleTemps(legacyPi);
	await cleanStaleTemps(memoryDir(projectRoot));
	// Drop the legacy directory when migration emptied it.
	await rmdir(legacyPi).catch(() => undefined);

	return { moved, importedSkills, importedMemory, conflicts };
}

export async function loadMemory(projectRoot: string): Promise<{ text: string; source: string }> {
	const target = memoryFile(projectRoot);
	const current = (await readOptional(target)).trim();
	if (current) return { text: current.slice(0, MAX_MEMORY_CHARS), source: target };

	const legacyPi = path.join(legacyPiDir(projectRoot), "MEMORY.md");
	const fromPi = (await readOptional(legacyPi)).trim();
	if (fromPi) return { text: fromPi.slice(0, MAX_MEMORY_CHARS), source: legacyPi };

	for (const name of ["MEMORY.md", "memory_summary.md", "learned.md"]) {
		const fallback = path.join(legacyOmpDir(projectRoot), name);
		const text = (await readOptional(fallback)).trim();
		if (text) return { text: text.slice(0, MAX_MEMORY_CHARS), source: fallback };
	}

	return { text: "", source: target };
}
