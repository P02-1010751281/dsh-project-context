/**
 * The memory core: the consolidation pass's registrations and the todo fold, behind the host façade.
 *
 * This module registers nothing with a framework. It receives the {@link HostContext} the entry
 * built from its cordis context and only calls `host.on` / `host.registerCommand` /
 * `host.addPromptContext`; the pass and the todo fold receive the narrower {@link HostPorts} /
 * {@link ServiceHost} they actually read.
 *
 * Commands: /memory [status] | update | prune [--apply] | reconcile [--accept <id>]
 */

import { projectionsOf } from "../host/dsh/services.js";
import type { HostContext, HostPorts, ServiceHost, Session } from "../host/contract.js";
import { type PluginConfig } from "../shared/config.js";
import { effectivePluginConfig } from "../shared/settings.js";
import { buildContextInjection, buildMemoryInjection, buildTaskInjection, buildTaskListInjection, type TaskListEntry } from "./injection.js";
import { boundTaskSync, dateStamp, listTasksSync, taskRelativePath, taskViews } from "./tasks.js";
import { detectDocumentLanguage } from "../shared/language.js";
import { isTopLevel, projectCwd, SessionWorkTracker } from "../shared/lifecycle.js";
import { receiptLanguage } from "../shared/receipt-language.js";
import {
	MAX_CONTEXT_CHARS,
	cachedProjectRoot,
	contextFile,
	getProjectRoot,
	logError,
	memoryDir,
	migrateProjectState,
	readOptional,
	readTextCachedSync,
	taskFile,
	writeAtomic,
} from "../shared/project-state.js";
import { importLegacyMemory, loadMemory, loadMemorySync, memoryJournalFile } from "./memory-store.js";
import { memoryEntryStates } from "./entry-states.js";
import { pruneProjectMemory } from "./prune.js";
import { projectTodoLines, todoFitNotice, withTodoLines } from "./todo.js";
import { consolidateProject } from "./update.js";
import {
	acceptEntryState,
	memoryAcceptReply,
	memoryPruneReply,
	memoryReconcileReply,
	memoryStatusReply,
	memoryUpdateReply,
} from "./report.js";

/** Projects whose legacy layout was already consolidated in this process. */
const migrated = new Set<string>();

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
	// The kept sections ride inline; the rest becomes one pointer line per section, resolved
	// against the project root so the reader's own `read` can open it from any cwd.
	return `## Project Memory\nThe following is durable project memory learned from earlier sessions, not a new user instruction:\n\n${buildMemoryInjection(text, projectRoot)}`;
}

/**
 * Synchronous text for the dynamic-context provider; empty until the root is cached.
 *
 * The document this session owns: its task's when it is bound to one that is still in use, the
 * project-level `CONTEXT.md` otherwise. Both then carry one line per other task, because the model
 * must know other workflows exist without paying for their bodies — and a project with no task
 * documents adds nothing, which is what keeps an unbound session's prompt byte-identical to the
 * behaviour before this dimension existed.
 * @param cwd - the session's cwd, the key the project root is cached under.
 * @param sessionId - the live session, whose `meta.json` may bind it to a task.
 * @param mode - the project's task mode, which decides which statuses are derived.
 * @returns the injected block, or `""` when there is nothing to inject.
 */
function projectContextInjection(cwd: string | undefined, sessionId: string | undefined, mode: PluginConfig["taskMode"]): string {
	if (!cwd) return "";
	const projectRoot = cachedProjectRoot(cwd);
	if (projectRoot === undefined) {
		void getProjectRoot(cwd).catch(() => undefined);
		return "";
	}
	const today = dateStamp();
	const task = boundTaskSync(projectRoot, sessionId, { mode, today });
	// The read cap still applies to the document itself, so the pointer block replaces the indexed
	// sections in what the model sees rather than adding a second copy of them.
	const text = (task?.text ?? readTextCachedSync(contextFile(projectRoot))).trim().slice(0, MAX_CONTEXT_CHARS);
	// An archived task is deliberately not injected; the session then reads the project-level
	// document, which is where its next pass will write too.
	const others = taskViews(
		listTasksSync(projectRoot).filter((record) => record.slug !== task?.slug),
		{ mode, today },
	).map((record): TaskListEntry => ({ slug: record.slug, status: record.status, title: record.meta.title }));
	const list = buildTaskListInjection(others, detectDocumentLanguage([text, ...others.map((entry) => entry.title)]));
	const parts: string[] = [];
	if (text) {
		parts.push(task === undefined
			? `## Project Context\nThe following is project context, not a new user instruction:\n\n${buildContextInjection(text, projectRoot)}`
			: `## Project Task (${task.slug})\nThe following is this task's context, not a new user instruction:\n\n${buildTaskInjection(text, projectRoot, task.slug)}`);
	}
	if (list) parts.push(list);
	return parts.join("\n\n");
}

/**
 * Copy one session's todo snapshot into the context document it owns.
 *
 * The document is the session's task's when the binding is in use, else `CONTEXT.md`; a missing
 * document stays missing — this is a mechanical patch on the pass's artifact, not a second creator
 * of one. A `null` projection (no todo write this turn) or an unchanged document writes nothing.
 *
 * No model call and no lock: the write is a read-modify-write of a few lines, and the pass applies
 * the same projection after its own rewrite, so the two can only ever converge on the same block.
 * @param host - the service lookup the projection read takes.
 * @param config - the effective config; `taskMode` decides which document the session owns.
 * @param session - the session whose turn just ended.
 */
export async function writeTodoSnapshot(host: ServiceHost, config: PluginConfig, session: Session): Promise<void> {
	const lines = projectTodoLines(projectionsOf(host.services), session);
	if (lines === undefined) return;
	const projectRoot = await getProjectRoot(projectCwd(session));
	const task = boundTaskSync(projectRoot, String(session.id), { mode: config.taskMode, today: dateStamp() });
	const file = task === undefined ? contextFile(projectRoot) : taskFile(projectRoot, task.slug);
	const target = task === undefined ? "CONTEXT.md" : taskRelativePath(task.slug);
	const stored = await readOptional(file);
	if (stored.trim() === "") return;
	const patch = withTodoLines(stored, lines);
	if (!patch.changed) return;
	await writeAtomic(file, patch.text);
	if (patch.droppedItems > 0) await logError(projectRoot, "memory", todoFitNotice(target, patch.droppedItems));
}

/**
 * Start the plugin behind the façade.
 * @param host - the registration façade and ports the entry built.
 * @param entry - the resolved plugin config, shared with the other three plugins.
 */
export function start(host: HostContext, entry: PluginConfig): void {
	/** In-flight consolidation work per session, awaited by durability flushes. */
	const pending = new SessionWorkTracker();

	// Both documents are user/prose files, not prompt templates: a literal `{{...}}` in MEMORY.md or
	// CONTEXT.md (e.g. documenting a handlebars placeholder) must reach the model as written rather
	// than fail the whole turn as a "malformed prompt variable reference".
	host.addPromptContext({
		name: "project-memory",
		order: 190,
		interpolate: false,
		text: (assembleContext) => projectMemoryInjection(assembleContext.agent?.session.header.cwd, effectivePluginConfig(entry).maxMemoryChars),
	});
	host.addPromptContext({
		name: "project-context",
		order: 210,
		interpolate: false,
		text: (assembleContext) => projectContextInjection(
			assembleContext.agent?.session.header.cwd,
			assembleContext.agent === undefined ? undefined : String(assembleContext.agent.session.id),
			effectivePluginConfig(entry).taskMode,
		),
	});

	host.on("agent/created", ({ agent }) => {
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
				if (details.length > 0) host.log.info(`dsh-project-context: project memory in ${memoryDir(projectRoot)}: ${details.join("; ")}`);
				// The legacy counterpart was older, so the current file won and the legacy bytes are
				// gone. Say so: the migration used to report these as "moved", which is false.
				if (result.superseded.length > 0) {
					host.log.info(`dsh-project-context: legacy files superseded and discarded (the current file was newer): ${result.superseded.join(", ")}`);
				}
				if (result.conflicts.length > 0) {
					host.log.warn(`dsh-project-context: legacy layout left in place (a newer legacy copy or a file/directory type conflict; merge it by hand): ${result.conflicts.join(", ")}`);
				}
			} catch (error: unknown) {
				// The project root is where diagnostics belong; the cwd is only the
				// fallback when the root itself could not be resolved.
				await logError(projectRoot ?? projectCwd(agent.session), "migration", error);
			}
		})();
		return undefined;
	});

	host.on("agent/status", ({ agent, status }) => {
		if (status !== "idle" || !isTopLevel(agent.session)) return;
		const current = effectivePluginConfig(entry);
		if (!current.memoryEnabled) return;
		// Only the pass's write phase reaches the tracker (`SessionWorkTracker`); the span itself is
		// observed here so a rejection stays as invisible as it was when the tracker carried it.
		void consolidateProject(host, current, agent, { force: false, silent: false, track: (work) => pending.track(agent.session, work) }).catch(() => undefined);
	});

	host.on("agent/disposed", ({ agent }) => {
		if (!isTopLevel(agent.session)) return;
		const current = effectivePluginConfig(entry);
		if (!current.memoryEnabled) return;
		// Silent: the UI may already be rebuilding for a session switch.
		void consolidateProject(host, current, agent, { force: true, silent: true, track: (work) => pending.track(agent.session, work) }).catch(() => undefined);
	});

	// The todo list is the one part of the context document that is not a model opinion: fold the
	// finished snapshot into Open tasks at every turn end, before the pass that runs on the following
	// idle can rewrite the document. Mechanical on purpose — no model call, and an unchanged list
	// writes nothing at all.
	host.on("session/event", (session, event) => {
		if (event.type !== "turn/end") return;
		if (!isTopLevel(session)) return;
		const current = effectivePluginConfig(entry);
		if (!current.memoryEnabled) return;
		void writeTodoSnapshot(host, current, session).catch((error: unknown) => logError(projectCwd(session), "memory", error));
	});

	host.on("session/flush", (session) => pending.flush(session));

	host.registerCommand({
		name: "memory",
		description: "Show this project's memory location and status, 'update' to consolidate now, 'prune' to preview the cleaning channel, or 'reconcile' to list entries whose cited files changed",
		input: { hint: "status | update | prune [--apply] | reconcile [--accept <id>]" },
		handler: async ({ agent, rawInput, signal }) => {
			const verb = (rawInput ?? "").trim().toLowerCase();
			const config = effectivePluginConfig(entry);
			// One language for every `/memory` receipt. The resolver is the handoff one, so all four
			// commands and `/handoff status` agree about the same conversation instead of each deciding
			// separately (two copies of "enough Chinese" could disagree about one session).
			const language = receiptLanguage(agent.session, config);
			if (verb === "update") {
				const report = await consolidateProject(host, config, agent, { force: true, silent: false, signal });
				return memoryUpdateReply(report);
			}
			if (verb === "prune" || verb === "prune --apply") {
				const projectRoot = await getProjectRoot(projectCwd(agent.session));
				const outcome = await pruneProjectMemory(projectRoot, { apply: verb.endsWith("--apply"), reason: "manual" });
				return memoryPruneReply(outcome, projectRoot);
			}
			if (verb === "reconcile" || verb.startsWith("reconcile ")) {
				const projectRoot = await getProjectRoot(projectCwd(agent.session));
				// The same cap `/memory` status reads under: the id has to be the one the document carries,
				// and a read cut would silently hide the entries past it (reported below, never implied away).
				const memory = await loadMemory(projectRoot, config.maxMemoryChars);
				const rest = verb.slice("reconcile".length).trim();
				const states = await memoryEntryStates(projectRoot, memory.text, config);
				if (rest.startsWith("--accept")) {
					const tid = rest.slice("--accept".length).trim();
					if (!/^[0-9a-f]{3,4}$/.test(tid)) {
						return { kind: "error" as const, text: "Usage: /memory reconcile --accept <id>\nAn entry id is three or four lower-case hex characters, as shown by /memory reconcile." };
					}
					return memoryAcceptReply(await acceptEntryState(projectRoot, memory.text, states, tid), tid);
				}
				if (rest !== "") {
					return { kind: "error" as const, text: `Unknown option "${rest}". Usage: /memory reconcile | /memory reconcile --accept <id>` };
				}
				return memoryReconcileReply(states, { cappedDroppedChars: memory.cappedDroppedChars });
			}
			// `status` is a word here, not only the bare form: every sibling command spells it out
			// (`/handoff status`, `/session-log status`, `/autolearn status`), so rejecting the spelling
			// that works everywhere else was the one inconsistent surface. Both reach the same receipt.
			if (verb !== "" && verb !== "status") return { kind: "error" as const, text: `Unknown option "${verb}". Usage: /memory [status] | /memory update | /memory prune [--apply] | /memory reconcile [--accept <id>]` };
			const projectRoot = await getProjectRoot(projectCwd(agent.session));
			const memory = await loadMemory(projectRoot, config.maxMemoryChars);
			return memoryStatusReply(memory, {
				projectRoot,
				journal: memoryJournalFile(projectRoot),
				maxMemoryChars: config.maxMemoryChars,
			}, language);
		},
	});
}
