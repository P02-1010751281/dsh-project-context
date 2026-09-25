/**
 * project-context — the session archive (pass ①, no model calls).
 *
 * Writes the per-session raw JSONL and Markdown rendering plus the mechanical
 * session index under `.agents/memory/session-logs/`. Distilling the archive
 * into CONTEXT.md/MEMORY.md is the memory feature (`project-memory`); reading
 * it back for skills is autolearn (`project-autolearn`); pointing a fresh
 * session at it is handoff (`project-handoff`).
 *
 * Commands: /context, /session-log (with `import <archive…>` for backfill)
 */

import type { Context } from "@deepseek-ai/cordis";
// Type-only: pulls the commands service Context merge (ctx.commands).
import type {} from "@deepseek-ai/dsh-commands";
import { resolvePluginConfig } from "../shared/config.js";
import { PluginSettingsSchema, effectivePluginConfig, publishProjectContextSettings } from "../shared/settings.js";
import { projectCwd, SessionWorkTracker } from "../shared/lifecycle.js";
import { contextFile, getProjectRoot, logsDir, sessionIndexFile } from "../shared/project-state.js";
import { importArchiveFiles } from "./import.js";
import { queueSessionArtifacts, releaseSessionQueue, writeSessionArtifacts } from "./session-log.js";

/**
 * Expand `/session-log import` arguments: directories contribute their
 * `*.jsonl` and `*.zip` entries (non-recursive), files are taken as given.
 */
async function resolveImportTargets(args: string, cwd: string): Promise<string[]> {
	const { readdir, stat } = await import("node:fs/promises");
	const path = await import("node:path");
	const files: string[] = [];
	for (const token of args.split(/\s+/).filter(Boolean)) {
		const target = path.resolve(cwd, token);
		let info;
		try {
			info = await stat(target);
		} catch {
			continue;
		}
		if (info.isDirectory()) {
			for (const entry of await readdir(target)) {
				if (/\.(jsonl|zip)$/i.test(entry)) files.push(path.join(target, entry));
			}
		} else {
			files.push(target);
		}
	}
	return files.sort();
}

export const name = "project-context";
export const inject = ["commands"];

/**
 * The settings schema the Host projects into the Plugins page, and the one namespace all four
 * plugins share: the entry id below (`project-context`) is what the web card edits, and
 * {@link publishProjectContextSettings} republishes the value this entry was applied with.
 */
export const Config = PluginSettingsSchema;

export function apply(ctx: Context, rawConfig: unknown): void {
	const entry = resolvePluginConfig(rawConfig);
	publishProjectContextSettings(ctx, entry);
	/** In-flight archive work per session, awaited by durability flushes. */
	const pending = new SessionWorkTracker();

	ctx.on("agent/created", ({ agent }) => {
		void getProjectRoot(projectCwd(agent.session)).catch(() => undefined);
		return undefined;
	});

	ctx.on("session/event", (session, event) => {
		if (event.type !== "turn/end") return;
		if (!effectivePluginConfig(entry).archiveEnabled) return;
		void queueSessionArtifacts(session, { markdown: false });
	});

	// The canonical JSONL is refreshed on every turn end; the Markdown rendering
	// and the session index are written when the agent settles or is disposed.
	ctx.on("agent/status", ({ agent, status }) => {
		if (status !== "idle") return;
		if (!effectivePluginConfig(entry).archiveEnabled) return;
		pending.track(agent.session, queueSessionArtifacts(agent.session, { markdown: true }));
	});

	ctx.on("agent/disposed", ({ agent }) => {
		if (!effectivePluginConfig(entry).archiveEnabled) return;
		pending.track(agent.session, queueSessionArtifacts(agent.session, { markdown: true }));
	});

	ctx.on("session/flush", (session) => pending.flush(session));

	ctx.on("session/disposed", (session) => {
		void queueSessionArtifacts(session, { markdown: true }).finally(() => releaseSessionQueue(session));
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
		description: "Write the current session log, or backfill ended sessions from archives (import <path…>)",
		input: { hint: "import <session.jsonl|archive.zip|dir>…" },
		handler: async ({ agent, rawInput }) => {
			const args = rawInput.trim();
			if (args === "" || args === "now") {
				const result = await writeSessionArtifacts(agent.session);
				return { kind: "success", text: `Session log written: ${result.dir}` };
			}
			const files = await resolveImportTargets(args.replace(/^import\s+/, "").trim(), projectCwd(agent.session));
			if (files.length === 0) return { kind: "error", text: "No archives found. Usage: /session-log import <session.jsonl|archive.zip|dir>…" };
			const projectRoot = await getProjectRoot(projectCwd(agent.session));
			const outcomes = await importArchiveFiles(files, { projectRoot });
			const created = outcomes.filter((outcome) => outcome.status === "created");
			const skipped = outcomes.filter((outcome) => outcome.status === "skipped");
			const failed = outcomes.filter((outcome) => outcome.status === "failed");
			const head = `Imported ${created.length} archive(s) into ${logsDir(projectRoot)}`;
			const detail = [
				skipped.length > 0 ? `skipped ${skipped.length} existing` : "",
				failed.length > 0 ? `failed ${failed.length}: ${failed.map((outcome) => `${outcome.source ?? outcome.id} (${outcome.error})`).join("; ")}` : "",
			].filter(Boolean).join("; ");
			const summary = detail ? `${head} (${detail})` : head;
			return failed.length > 0 ? { kind: "error", text: summary } : { kind: "success", text: summary };
		},
	});
}
