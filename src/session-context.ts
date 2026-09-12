/**
 * project-context — the session archive (pass ①, no model calls).
 *
 * Writes the per-session raw JSONL and Markdown rendering plus the mechanical
 * session index under `.agents/memory/session-logs/`. Distilling the archive
 * into CONTEXT.md/MEMORY.md is the memory feature (`project-memory`); reading
 * it back for skills is autolearn (`project-autolearn`); pointing a fresh
 * session at it is handoff (`project-handoff`).
 *
 * Commands: /context, /session-log
 */

import type { Context } from "@deepseek-ai/cordis";
// Type-only: pulls the commands service Context merge (ctx.commands).
import type {} from "@deepseek-ai/dsh-commands";
import { resolvePluginConfig } from "./shared/config.js";
import { installProjectContextSettings } from "./shared/settings.js";
import { projectCwd, SessionWorkTracker } from "./shared/lifecycle.js";
import { contextFile, getProjectRoot, logsDir, sessionIndexFile } from "./shared/project-state.js";
import { queueSessionArtifacts, releaseSessionQueue, writeSessionArtifacts } from "./shared/session-log.js";

export const name = "project-context";
export const inject = ["commands"];

export function apply(ctx: Context, rawConfig: unknown): void {
	const entry = resolvePluginConfig(rawConfig);
	installProjectContextSettings(ctx, entry);
	/** In-flight archive work per session, awaited by durability flushes. */
	const pending = new SessionWorkTracker();

	ctx.on("agent/created", ({ agent }) => {
		void getProjectRoot(projectCwd(agent.session)).catch(() => undefined);
	});

	ctx.on("session/event", (session, event) => {
		if (event.type !== "turn/end") return;
		void queueSessionArtifacts(session, { markdown: false });
	});

	// The canonical JSONL is refreshed on every turn end; the Markdown rendering
	// and the session index are written when the agent settles or is disposed.
	ctx.on("agent/status", ({ agent, status }) => {
		if (status !== "idle") return;
		pending.track(agent.session, queueSessionArtifacts(agent.session, { markdown: true }));
	});

	ctx.on("agent/disposed", ({ agent }) => {
		pending.track(agent.session, queueSessionArtifacts(agent.session, { markdown: true }));
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
			return {
				kind: "success",
				text: `Project context: ${contextFile(projectRoot)}\nSession logs: ${logsDir(projectRoot)}\nSession index: ${sessionIndexFile(projectRoot)}`,
			};
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
