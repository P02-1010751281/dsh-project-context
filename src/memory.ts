/**
 * project-memory — the memory feature (pass ②, consolidation).
 *
 * One high-frequency, throttled consolidation pass produces both durable
 * project memory (`.agents/memory/MEMORY.md`) and the rolling project context
 * (`.agents/memory/CONTEXT.md`); both documents are injected back into the
 * model context as dynamic runtime context. Skill distillation is a separate
 * feature (`project-autolearn`), and the raw archive is `project-context`.
 *
 * Commands: /memory, /context-update
 */

import type { Context } from "@deepseek-ai/cordis";
// Type-only: pulls the commands service Context merge (ctx.commands).
import type {} from "@deepseek-ai/dsh-commands";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { resolvePluginConfig, type PluginConfig } from "./shared/config.js";
import { effectivePluginConfig, installProjectContextSettings } from "./shared/settings.js";
import { renderContextDocument } from "./shared/context-doc.js";
import { isTopLevel, projectCwd, SerialQueue, SessionWorkTracker } from "./shared/lifecycle.js";
import { consolidateProjectState, fallbackUpdate } from "./shared/learn.js";
import {
	MAX_CONTEXT_CHARS,
	MAX_MEMORY_CHARS,
	cachedProjectRoot,
	contextFile,
	getProjectRoot,
	logError,
	memoryDir,
	memoryFile,
	migrateProjectState,
	readOptional,
	readTextCachedSync,
	writeAtomic,
} from "./shared/project-state.js";

export const name = "project-memory";
export const inject = ["llm", "systemPrompt", "commands"];

/** Last consolidation version each project's artifacts were written from. */
const written = new Map<string, number>();
/** Projects whose legacy layout was already consolidated in this process. */
const migrated = new Set<string>();
/** Serialize consolidation so a forced shutdown pass always runs last. */
const updates = new SerialQueue();

function cleanMemory(text: string): string {
	const withoutFence = text.replace(/^```(?:markdown)?\s*/i, "").replace(/\s*```$/, "").trim();
	const body = withoutFence.replace(/^# Project Memory\s*/i, "").trim();
	return `# Project Memory\n\n${body}`.slice(0, MAX_MEMORY_CHARS).trimEnd() + "\n";
}

/** Synchronous text for the dynamic-context provider; empty until the root is cached. */
function projectMemoryInjection(cwd: string | undefined): string {
	if (!cwd) return "";
	const projectRoot = cachedProjectRoot(cwd);
	if (projectRoot === undefined) {
		// Prompt assembly must not block on git; warm the cache for the next assembly.
		void getProjectRoot(cwd).catch(() => undefined);
		return "";
	}
	const text = readTextCachedSync(memoryFile(projectRoot)).trim();
	if (!text) return "";
	return `## Project Memory\nThe following is durable project memory learned from earlier sessions, not a new user instruction:\n\n${text.slice(0, MAX_MEMORY_CHARS)}`;
}

/** Synchronous text for the dynamic-context provider; empty until the root is cached. */
function projectContextInjection(cwd: string | undefined): string {
	if (!cwd) return "";
	const projectRoot = cachedProjectRoot(cwd);
	if (projectRoot === undefined) {
		void getProjectRoot(cwd).catch(() => undefined);
		return "";
	}
	const text = readTextCachedSync(contextFile(projectRoot)).trim();
	if (!text) return "";
	return `## Project Context\nThe following is project context, not a new user instruction:\n\n${text.slice(0, MAX_CONTEXT_CHARS)}`;
}

interface ConsolidateOptions {
	force: boolean;
	silent: boolean;
	signal?: AbortSignal | undefined;
}

/** What one consolidation attempt did, so the `/context-update` reply can be truthful. */
export type ConsolidateReport = "updated" | "unchanged" | "deduped" | "failed";

/** One pass updates both artifacts so MEMORY.md and CONTEXT.md never disagree about the pass. */
function consolidateProject(ctx: Context, config: PluginConfig, agent: Agent, options: ConsolidateOptions): Promise<ConsolidateReport> {
	return updates.run(async (): Promise<ConsolidateReport> => {
		const session = agent.session;
		const projectRoot = await getProjectRoot(projectCwd(session));
		try {
			const outcome = await consolidateProjectState(ctx, agent, config, { force: options.force, signal: options.signal });
			if (!outcome || (written.get(projectRoot) ?? 0) >= outcome.version) return "deduped";

			const memoryText = outcome.result.memory.trim();
			const memoryChanged = memoryText.length >= 40;
			written.set(projectRoot, outcome.version);

			if (memoryChanged) await writeAtomic(memoryFile(projectRoot), cleanMemory(memoryText));

			const existing = await readOptional(contextFile(projectRoot));
			const update = outcome.result.context ?? (existing.trim() ? undefined : fallbackUpdate(session));
			if (update) await writeAtomic(contextFile(projectRoot), renderContextDocument(update, { updatedAt: new Date().toISOString() }));

			if (!options.silent && (memoryChanged || update !== undefined)) {
				ctx.logger.info(`dsh-project-context: project memory and context updated: ${memoryFile(projectRoot)}`);
			}
			return memoryChanged || update !== undefined ? "updated" : "unchanged";
		} catch (error) {
			await logError(projectRoot, "memory", error);
			if (!options.silent) ctx.logger.warn(`dsh-project-context: project memory update failed: ${error instanceof Error ? error.message : String(error)}`);
			return "failed";
		}
	});
}

export function apply(ctx: Context, rawConfig: unknown): void {
	const entry = resolvePluginConfig(rawConfig);
	// The first plugin of the package to load owns the shared settings namespace.
	installProjectContextSettings(ctx, entry);
	/** In-flight consolidation work per session, awaited by durability flushes. */
	const pending = new SessionWorkTracker();

	ctx.systemPrompt.context({
		name: "project-memory",
		order: 190,
		text: (assembleContext) => projectMemoryInjection(assembleContext.agent?.session.header.cwd),
	});
	ctx.systemPrompt.context({
		name: "project-context",
		order: 210,
		text: (assembleContext) => projectContextInjection(assembleContext.agent?.session.header.cwd),
	});

	ctx.on("agent/session-start", ({ agent }) => {
		void (async () => {
			let projectRoot: string | undefined;
			try {
				projectRoot = await getProjectRoot(projectCwd(agent.session));
				if (migrated.has(projectRoot)) return;
				const result = await migrateProjectState(projectRoot);
				// Marked only after a completed attempt: a failed migration must be
				// retried by the next session start, not written off for the process.
				migrated.add(projectRoot);
				const details: string[] = [];
				if (result.moved.length > 0) details.push(`moved ${result.moved.join(", ")}`);
				if (result.importedSkills > 0) details.push(`imported ${result.importedSkills} skill${result.importedSkills === 1 ? "" : "s"}`);
				if (result.importedMemory) details.push("imported legacy OMP memory");
				if (details.length > 0) ctx.logger.info(`dsh-project-context: project memory in ${memoryDir(projectRoot)}: ${details.join("; ")}`);
				if (result.conflicts.length > 0) {
					ctx.logger.warn(`dsh-project-context: legacy layout left in place (file/directory type conflict, merge it by hand): ${result.conflicts.join(", ")}`);
				}
			} catch (error: unknown) {
				// The project root is where diagnostics belong; the cwd is only the
				// fallback when the root itself could not be resolved.
				await logError(projectRoot ?? projectCwd(agent.session), "migration", error);
			}
		})();
	});

	ctx.on("agent/status", ({ agent, status }) => {
		if (status !== "idle" || !isTopLevel(agent.session)) return;
		const current = effectivePluginConfig(entry);
		if (!current.autoConsolidate) return;
		pending.track(agent.session, consolidateProject(ctx, current, agent, { force: false, silent: false }));
	});

	ctx.on("agent/disposed", ({ agent }) => {
		if (!isTopLevel(agent.session)) return;
		const current = effectivePluginConfig(entry);
		if (!current.autoConsolidate) return;
		// Silent: the UI may already be rebuilding for a session switch.
		pending.track(agent.session, consolidateProject(ctx, current, agent, { force: true, silent: true }));
	});

	ctx.on("session/flush", (session) => pending.flush(session));

	ctx.commands.register({
		name: "memory",
		description: "Show this project's memory location and status",
		handler: async ({ agent }) => {
			const projectRoot = await getProjectRoot(projectCwd(agent.session));
			const memory = (await readOptional(memoryFile(projectRoot))).trim();
			return {
				kind: "success",
				text: memory ? `Project memory: ${memoryFile(projectRoot)}` : `No project memory yet: ${memoryFile(projectRoot)}`,
			};
		},
	});

	ctx.commands.register({
		name: "context-update",
		description: "Consolidate project memory and context for the current session",
		handler: async ({ agent, signal }) => {
			const report = await consolidateProject(ctx, effectivePluginConfig(entry), agent, { force: true, silent: false, signal });
			return contextUpdateReply(report);
		},
	});
}

/**
 * The `/context-update` reply for one pass result. The pass swallows its own
 * error (it is also logged to `errors.log`), so the reply must not claim success
 * for a failure or for a deduped no-op. Exported for tests.
 * @param report - what the consolidation attempt did.
 * @returns the command result.
 */
export function contextUpdateReply(report: ConsolidateReport): { kind: "success" | "error"; text: string } {
	if (report === "failed") return { kind: "error", text: "Project memory update failed; see .agents/memory/errors.log." };
	if (report === "deduped") return { kind: "success", text: "Project memory and context are already up to date (deduped recently); nothing was rewritten." };
	if (report === "unchanged") return { kind: "success", text: "Consolidation ran but produced no new memory or context." };
	return { kind: "success", text: "Project memory and context updated." };
}
