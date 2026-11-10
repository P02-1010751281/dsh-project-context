/**
 * Where a project's `.agents` state lives, and the project root itself: the `.git`-entry lookup
 * (async and sync) with its cache, every path helper, and the two name validators.
 */
export declare const AGENTS_DIR = ".agents";
export declare const LEGACY_DIR = ".pi";
export declare const MEMORY_SUBDIR = "memory";
export declare const SKILLS_SUBDIR = "skills";
export declare const SESSION_LOGS_SUBDIR = "session-logs";
export declare const TASKS_SUBDIR = "tasks";
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
/**
 * One file per task (`<memory>/tasks/<slug>.md`), each a context-shaped document.
 *
 * A task is the unit a session can be bound to, so the context of two unrelated workflows stops
 * sharing one `CONTEXT.md`: the file is the task's own state, and a session with no task keeps using
 * the project-level document unchanged. Slugs are file names, so `validTaskSlug` (the skill-name
 * rule, one kebab-case token) is the only accepted shape.
 */
export declare function tasksDir(projectRoot: string): string;
/** The task document for one slug. */
export declare function taskFile(projectRoot: string, slug: string): string;
/** The per-session binding written by `/context task <slug>` and read by the injection and the pass. */
export declare function sessionMetaFileFor(projectRoot: string, sessionId: string): string;
/** Mechanical per-session index maintained by the archive step, next to the logs it points at. */
export declare function sessionIndexFile(projectRoot: string): string;
/** Pre-move index location (`<memory>/session-index.md`), merged into the new index whenever it holds one. */
export declare function legacySessionIndexFile(projectRoot: string): string;
/**
 * Tombstones for retired memory entries: one line per fact that left `MEMORY.md`.
 *
 * Deliberately a sibling document rather than a section of `MEMORY.md`: a tombstone is injected into
 * the consolidation prompt as a one-line "do not write this back" hint, and `sectionsFromMarkdown`
 * accepts only the four policy sections — a fifth one would turn the whole memory opaque.
 */
export declare function retiredFile(projectRoot: string): string;
/** Older half of the tombstone file once it passes its line budget (moved, never deleted). */
export declare function retiredArchiveFile(projectRoot: string): string;
/**
 * Plugin-owned dates for the entry ids in `MEMORY.md`: when each id was first seen.
 *
 * The id itself rides inside the bullet (six characters per entry), because the model has to copy it
 * for a `supersedes:` reference to mean anything. The *date* is what the 180-day expiry needs, and it
 * costs eleven characters per entry on a document that has no room for it — measured 2026-11-10:
 * stamping `（tid:4f2a · 2026-11-10）` on this project's 134 entries added 3082 characters and made
 * the renderer drop 7 whole entries, while the bare id costs 804 and drops none.
 */
export declare function entryDatesFile(projectRoot: string): string;
/**
 * Where the cleaning channel parks what it is about to delete (`<memory>/trash/<date>.tar`).
 *
 * Inside the memory directory on purpose: the tarball is evidence for a forgotten artifact, and it
 * outlives the process that removed it. It is a local artifact, never committed (see
 * `MEMORY_GITIGNORE_LINES`) and itself bounded by the same cleanup — a tar is only ever appended to
 * on the day it is written.
 */
export declare function trashDir(projectRoot: string): string;
/**
 * The cleaning channel's own append-only log (`<memory>/purge.log`): one line per applied run.
 *
 * Separate from `errors.log` (batch Z4, user ruling 丙) because the two answer different questions:
 * `errors.log` records failures, this records deletions. It also keeps the index from carrying
 * unverifiable comments — the timeline stays the audit trail.
 */
export declare function purgeLogFile(projectRoot: string): string;
/** One rotated append-only diagnostic log per project. */
export declare function errorLogFile(projectRoot: string): string;
export declare function legacyPiDir(projectRoot: string): string;
export declare function legacyOmpDir(projectRoot: string): string;
export declare function safeSessionId(sessionId: string): string;
export declare function validSkillName(name: string): boolean;
