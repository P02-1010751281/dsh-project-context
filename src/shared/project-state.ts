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

export { diagnosticMessage, logError } from "./error-log.js";
export { fileMtimeMs, invalidateTextCache, pathExists, readOptional, readTextCachedSync, writeAtomic } from "./files.js";
export { ensureMemoryGitignore } from "./gitignore.js";
export { MAX_CONTEXT_CHARS, MAX_CONVERSATION_CHARS, MAX_LIST_ITEM_CHARS, MAX_MEMORY_CHARS, MAX_MEMORY_CHARS_LIMIT, MAX_SKILL_BODY_CHARS, MAX_SUMMARY_CHARS, MIN_MEMORY_CHARS } from "./limits.js";
export { migrateProjectState } from "./migrate.js";
export type { MigrationResult } from "./migrate.js";
export { AGENTS_DIR, LEGACY_DIR, MEMORY_SUBDIR, SESSION_LOGS_SUBDIR, SKILLS_SUBDIR, cachedProjectRoot, contextFile, getProjectRoot, getProjectRootSync, legacyOmpDir, legacyPiDir, legacySessionIndexFile, logsDir, memoryDir, memoryFile, safeSessionId, sessionIndexFile, skillsDir, validSkillName } from "./paths.js";
export { redactSecrets } from "./redact.js";
