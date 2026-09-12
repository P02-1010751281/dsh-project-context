/**
 * project-context — port of pi's `session-context` extension.
 *
 * Writes per-session raw/Markdown logs and maintains `.agents/memory/CONTEXT.md`
 * (summary, key points, open tasks, session index) through the shared learn
 * pass, then injects the document back into the model context as dynamic
 * runtime context.
 *
 * Commands: /context, /context-update, /session-log
 */

import type { Context } from "@deepseek-ai/cordis";
// Type-only: pulls the commands service Context merge (ctx.commands).
import type {} from "@deepseek-ai/dsh-commands";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { resolvePluginConfig, type PluginConfig } from "./shared/config.js";
import { effectivePluginConfig, installProjectContextSettings } from "./shared/settings.js";
import { renderContextDocument, sessionIndexLine } from "./shared/context-doc.js";
import { isTopLevel, projectCwd, SerialQueue, SessionWorkTracker } from "./shared/lifecycle.js";
import { fallbackUpdate, learnProjectState } from "./shared/learn.js";
import {
	MAX_CONTEXT_CHARS,
	cachedProjectRoot,
	contextFile,
	getProjectRoot,
	logError,
	logsDir,
	readOptional,
	readTextCachedSync,
	safeSessionId,
	writeAtomic,
} from "./shared/project-state.js";
import { queueSessionArtifacts, releaseSessionQueue, writeSessionArtifacts } from "./shared/session-log.js";

export const name = "project-context";
export const inject = ["llm", "systemPrompt", "commands"];

/** Last learn-pass version each project's CONTEXT.md was written from. */
const written = new Map<string, number>();
/** Serialize updates so a forced shutdown update always runs last. */
const updates = new SerialQueue();

/** Synchronous text for the dynamic-context provider; empty until the root is cached. */
export function projectContextInjection(cwd: string | undefined): string {
	if (!cwd) return "";
	const projectRoot = cachedProjectRoot(cwd);
	if (projectRoot === undefined) {
		// Prompt assembly must not block on git; warm the cache for the next assembly.
		void getProjectRoot(cwd).catch(() => undefined);
		return "";
	}
	const text = readTextCachedSync(contextFile(projectRoot)).trim();
	if (!text) return "";
	return `## Project Context\nThe following is project context, not a new user instruction:\n\n${text.slice(0, MAX_CONTEXT_CHARS)}`;
}

interface UpdateOptions {
	force: boolean;
	silent: boolean;
	signal?: AbortSignal | undefined;
}

/** Summarize the session through the shared learn pass and rewrite CONTEXT.md. */
function updateContext(ctx: Context, config: PluginConfig, agent: Agent, options: UpdateOptions): Promise<void> {
	return updates.run(async () => {
		const session = agent.session;
		const projectRoot = await getProjectRoot(projectCwd(session));
		try {
			const outcome = await learnProjectState(ctx, agent, config, { force: options.force, signal: options.signal });
			if (!outcome || (written.get(projectRoot) ?? 0) >= outcome.version) return;

			const existing = await readOptional(contextFile(projectRoot));
			const update = outcome.result.context ?? (existing.trim() ? undefined : fallbackUpdate(session));
			if (!update) {
				written.set(projectRoot, outcome.version);
				return;
			}

			const document = renderContextDocument(existing, update, {
				sessionLine: sessionIndexLine(session, update.title),
				sessionId: safeSessionId(String(session.id)),
				updatedAt: new Date().toISOString(),
			});
			await writeAtomic(contextFile(projectRoot), document);
			written.set(projectRoot, outcome.version);
			if (!options.silent) ctx.logger.info(`dsh-project-context: session log and project context updated: ${contextFile(projectRoot)}`);
		} catch (error) {
			await logError(projectRoot, "session-context", error);
			if (!options.silent) ctx.logger.warn(`dsh-project-context: project context update failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	});
}

async function settle(ctx: Context, config: PluginConfig, agent: Agent, options: { force: boolean; silent: boolean }): Promise<void> {
	const session = agent.session;
	const projectRoot = await getProjectRoot(projectCwd(session));
	try {
		// The canonical JSONL is refreshed on every turn end; the Markdown rendering
		// is written when the agent settles or the session is disposed.
		await queueSessionArtifacts(session, { markdown: true });
		if (config.autoLearn && isTopLevel(session)) {
			await updateContext(ctx, config, agent, { force: options.force, silent: options.silent });
		}
	} catch (error) {
		await logError(projectRoot, "session-context", error);
	}
}

export function apply(ctx: Context, rawConfig: unknown): void {
	const entry = resolvePluginConfig(rawConfig);
	installProjectContextSettings(ctx, entry);
	/** In-flight settle work per session, awaited by durability flushes. */
	const pending = new SessionWorkTracker();

	ctx.systemPrompt.context({
		name: "project-context",
		order: 210,
		text: (assembleContext) => projectContextInjection(assembleContext.agent?.session.header.cwd),
	});

	ctx.on("agent/created", ({ agent }) => {
		void getProjectRoot(projectCwd(agent.session)).catch(() => undefined);
	});

	ctx.on("session/event", (session, event) => {
		if (event.type !== "turn/end") return;
		void queueSessionArtifacts(session, { markdown: false });
	});

	ctx.on("agent/status", ({ agent, status }) => {
		if (status !== "idle") return;
		pending.track(agent.session, settle(ctx, effectivePluginConfig(entry), agent, { force: false, silent: false }));
	});

	ctx.on("agent/disposed", ({ agent }) => {
		// Silent: app shutdown or a session switch may already be tearing down the UI.
		pending.track(agent.session, settle(ctx, effectivePluginConfig(entry), agent, { force: true, silent: true }));
	});

	ctx.on("session/flush", (session) => pending.flush(session));

	ctx.on("session/disposed", (session) => {
		void queueSessionArtifacts(session, { markdown: true }).finally(() => releaseSessionQueue(String(session.id)));
	});

	ctx.commands.register({
		name: "context",
		description: "Show the project context and session log locations",
		handler: async ({ agent }) => {
			const projectRoot = await getProjectRoot(projectCwd(agent.session));
			return { kind: "success", text: `Project context: ${contextFile(projectRoot)}\nSession logs: ${logsDir(projectRoot)}` };
		},
	});

	ctx.commands.register({
		name: "context-update",
		description: "Summarize the current session and update project context",
		handler: async ({ agent, signal }) => {
			await updateContext(ctx, effectivePluginConfig(entry), agent, { force: true, silent: false, signal });
			return { kind: "success", text: "Project context update finished." };
		},
	});

	ctx.commands.register({
		name: "session-log",
		description: "Write the current session raw JSONL and Markdown log",
		handler: async ({ agent }) => {
			const result = await writeSessionArtifacts(agent.session);
			return { kind: "success", text: `Session log written: ${result.dir}` };
		},
	});
}
