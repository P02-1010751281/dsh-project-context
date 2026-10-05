/**
 * Where a project's `.agents` state lives, and the project root itself: the `.git`-entry lookup
 * (async and sync) with its cache, every path helper, and the two name validators.
 */
export declare const AGENTS_DIR = ".agents";
export declare const LEGACY_DIR = ".pi";
export declare const MEMORY_SUBDIR = "memory";
export declare const SKILLS_SUBDIR = "skills";
export declare const SESSION_LOGS_SUBDIR = "session-logs";
/** Cache-only lookup for prompt assembly; a miss warms the cache instead of blocking. */
export declare function cachedProjectRoot(cwd: string): string | undefined;
/** Resolve the project root for a cwd through its `.git` entry, falling back to the cwd itself. */
export declare function getProjectRoot(cwd: string): Promise<string>;
/**
 * Synchronous variant for prompt-assembly providers. Both variants share one cache and one lookup,
 * so a cwd is walked at most once per process.
 */
export declare function getProjectRootSync(cwd: string): string;
export declare function memoryDir(projectRoot: string): string;
/** Standard project skills directory, also discovered natively by dsh and pi. */
export declare function skillsDir(projectRoot: string): string;
export declare function memoryFile(projectRoot: string): string;
export declare function contextFile(projectRoot: string): string;
export declare function logsDir(projectRoot: string): string;
/** Mechanical per-session index maintained by the archive step, next to the logs it points at. */
export declare function sessionIndexFile(projectRoot: string): string;
/** Pre-move index location (`<memory>/session-index.md`), merged into the new index whenever it holds one. */
export declare function legacySessionIndexFile(projectRoot: string): string;
export declare function legacyPiDir(projectRoot: string): string;
export declare function legacyOmpDir(projectRoot: string): string;
export declare function safeSessionId(sessionId: string): string;
export declare function validSkillName(name: string): boolean;
