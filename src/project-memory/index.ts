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
import { resolvePluginConfig, type PluginConfig } from "../shared/config.js";
import { effectivePluginConfig, installProjectContextSettings } from "../shared/settings.js";
import { renderContextDocument } from "./context-doc.js";
import { isTopLevel, projectCwd, SerialQueue, SessionWorkTracker } from "../shared/lifecycle.js";
import { consolidateProjectState, fallbackUpdate } from "../shared/llm.js";
import {
	MAX_CONTEXT_CHARS,
	cachedProjectRoot,
	contextFile,
	diagnosticMessage,
	getProjectRoot,
	logError,
	memoryDir,
	memoryFile,
	migrateProjectState,
	readOptional,
	readTextCachedSync,
	writeAtomic,
} from "../shared/project-state.js";
import { backupMemoryBeforeWrite, importLegacyMemory, isMemoryTruncated, loadMemory, loadMemorySync, memoryJournalFile, readMemoryDamage, recordMemoryDocument } from "./memory-store.js";
import { withMemoryLock } from "../shared/lock.js";

export const name = "project-memory";
export const inject = ["llm", "systemPrompt", "commands"];

/** Last consolidation version each project's artifacts were written from. */
const written = new Map<string, number>();
/** Projects whose legacy layout was already consolidated in this process. */
const migrated = new Set<string>();
/** Serialize consolidation so a forced shutdown pass always runs last. */
const updates = new SerialQueue();

/** Synchronous text for the dynamic-context provider; empty until the root is cached. */
function projectMemoryInjection(cwd: string | undefined, limit: number): string {
	if (!cwd) return "";
	const projectRoot = cachedProjectRoot(cwd);
	if (projectRoot === undefined) {
		// Prompt assembly must not block on git; warm the cache for the next assembly.
		void getProjectRoot(cwd).catch(() => undefined);
		return "";
	}
	// Folds the append-only journal synchronously: the render can lag a crash between the
	// journal append and the render, and dsh's prompt assembly cannot await.
	const text = loadMemorySync(projectRoot, limit).trim();
	if (!text) return "";
	return `## Project Memory\nThe following is durable project memory learned from earlier sessions, not a new user instruction:\n\n${text}`;
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
export type ConsolidateReport = "updated" | "clipped" | "unchanged" | "deduped" | "failed";

/** One pass updates both artifacts so MEMORY.md and CONTEXT.md never disagree about the pass. */
/** One consolidation pass. Exported so the version-claim/backoff behaviour is testable. */
export function consolidateProject(ctx: Context, config: PluginConfig, agent: Agent, options: ConsolidateOptions): Promise<ConsolidateReport> {
	return updates.run(async (): Promise<ConsolidateReport> => {
		const session = agent.session;
		const projectRoot = await getProjectRoot(projectCwd(session));
		let wroteMemory = false;
		try {
			const outcome = await consolidateProjectState(ctx, agent, config, { force: options.force, signal: options.signal });			if (!outcome || (written.get(projectRoot) ?? 0) >= outcome.version) return "deduped";

			const memoryText = outcome.result.memory.trim();
			const memoryChanged = memoryText.length >= 40;
			// Claim the version before the first await: another pass reaching this point while the
			// writes below are in flight must see it as done, not run a second time.
			written.set(projectRoot, outcome.version);

			if (memoryChanged) {
				// Always keep the bytes on disk right now, whatever this pass believed earlier; the
				// lock keeps another process from replacing them mid-write, and the journal is the
				// source of truth (this pass appends its document, then MEMORY.md is rendered).
				const kept = await withMemoryLock(memoryFile(projectRoot), async () => {
					const backup = await backupMemoryBeforeWrite(memoryFile(projectRoot));
					await recordMemoryDocument(projectRoot, memoryText, config.maxMemoryChars);
					return backup;
				});
				wroteMemory = true;
				if (kept.poisoned) {
					await logError(projectRoot, "memory", `replaced a stored JSON reply with markdown; original kept at ${kept.path ?? "(none)"}`);
				}
			}

			const existing = await readOptional(contextFile(projectRoot));
			const update = outcome.result.context ?? (existing.trim() ? undefined : fallbackUpdate(session));
			if (update) await writeAtomic(contextFile(projectRoot), renderContextDocument(update, { updatedAt: new Date().toISOString() }));

			// A torn journal tail is skipped at read time; record it so a silent loss of history is
			// diagnosable. This is the only place the damage counter is reported.
			const damage = await readMemoryDamage(projectRoot);
			if (damage.unreadable || damage.damaged > 0) {
				await logError(projectRoot, "memory", damage.unreadable
					? `memory journal exists but cannot be read: ${memoryJournalFile(projectRoot)}`
					: `memory journal has ${damage.damaged} unusable line(s); they were skipped`);
			}

			const wrote = memoryChanged || update !== undefined;
			if (wrote && outcome.clipped) {
				// Always leave a trace: the log line below is hidden by `silent`, and a shortened
				// rewrite is the symptom that used to precede a truncated, unparseable memory.
				await logError(projectRoot, "memory", "consolidation shortened the existing memory or context to fit the model output budget");
			}
			if (!options.silent && wrote) {
				const note = outcome.clipped ? " (the rewrite also shortened the content to fit the output budget)" : "";
				ctx.logger.info(`dsh-project-context: project memory and context updated: ${memoryFile(projectRoot)}${note}`);
			}
			return wrote ? (outcome.clipped ? "clipped" : "updated") : "unchanged";
		} catch (error) {
			// Release the claimed version when nothing was written: otherwise the next forced pass
			// inside `forceDedupeMs` would answer "already up to date" for a write that never landed.
			if (!wroteMemory) written.delete(projectRoot);
			await logError(projectRoot, "memory", error);
			if (!options.silent) ctx.logger.warn(`dsh-project-context: project memory update failed: ${diagnosticMessage(error)}`);
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
		text: (assembleContext) => projectMemoryInjection(assembleContext.agent?.session.header.cwd, effectivePluginConfig(entry).maxMemoryChars),
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
				// The legacy `.omp` import holds the memory lock and refuses to run beside an
				// existing journal, so it is its own step rather than part of the layout migration.
				if (await importLegacyMemory(projectRoot, effectivePluginConfig(entry).maxMemoryChars)) details.push("imported legacy OMP memory");
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
			const config = effectivePluginConfig(entry);
			const memory = await loadMemory(projectRoot, config.maxMemoryChars);
			return memoryStatusReply(memory, {
				projectRoot,
				journal: memoryJournalFile(projectRoot),
				maxMemoryChars: config.maxMemoryChars,
			});
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
 * The `/memory` status reply for one loaded memory. Exported for tests.
 *
 * The reply distinguishes the states a silent fold would otherwise hide: a torn journal line, a
 * source that exists but cannot be read, and a stored reply from the old bug. It also reports the
 * character cap, which is the one degraded state the document itself cannot surface to the user:
 * the truncation marker is written into MEMORY.md, but nothing reads it back. Measured on this
 * repo at 41733 characters, the loaded document is capped at 31888 with 9621 dropped while every
 * other flag stays clean — so without the note the receipt calls a memory that lost a third of
 * itself perfectly healthy, and every later append lands past the cap and is dropped on write.
 * @param memory - the loaded memory document and its status flags.
 * @param context - the paths and the cap this project is configured with.
 * @returns the command result.
 */
export function memoryStatusReply(
	memory: Awaited<ReturnType<typeof loadMemory>>,
	context: { projectRoot: string; journal: string; maxMemoryChars: number },
): { kind: "success" | "error"; text: string } {
	const capped = isMemoryTruncated(memory.text)
		? ` Warning: MEMORY.md is at the ${context.maxMemoryChars}-character cap, so it is cut and new memory is dropped on write; raise maxMemoryChars or consolidate to shorten it.`
		: "";
	if (memory.unreadable) {
		const hint = memory.source.endsWith("memory.jsonl")
			? `Delete it to rebuild from MEMORY.md, or restore from memory-log-*.jsonl`
			: `check its permissions`;
		return { kind: "error", text: `Project memory exists but cannot be read: ${memory.source}; ${hint}.` };
	}
	if (memory.damaged) {
		return { kind: "success", text: `Project memory: ${context.journal} (${memory.damaged} unusable line(s) skipped; see .agents/memory/errors.log).${capped}` };
	}
	if (memory.poisoned) {
		return { kind: "success", text: `Project memory: ${memory.source} (stored as raw JSON from the old bug; the next consolidation backs it up and rewrites it as Markdown).${capped}` };
	}
	return {
		kind: "success",
		text: memory.text.trim() ? `Project memory: ${memory.source}${capped}` : `No project memory yet: ${memoryFile(context.projectRoot)}`,
	};
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
	if (report === "clipped") return { kind: "success", text: "Project memory and context updated, but the existing content was shortened to fit the model output budget." };
	return { kind: "success", text: "Project memory and context updated." };
}
