/**
 * project-autolearn — the skill-distillation feature (pass ③).
 *
 * Low-frequency pass over `.agents/memory/CONTEXT.md` + `MEMORY.md` plus the
 * mechanical session index; when those documents lack the concrete steps it
 * backtracks into the archived `session.md` files named by the index. Output is
 * `.agents/skills/<name>/SKILL.md`; dsh discovers skills natively, so only the
 * description enters the prompt while the body loads on demand.
 *
 * Commands: /autolearn
 */

import path from "node:path";
import type { Context } from "@deepseek-ai/cordis";
// Type-only: pulls the commands service Context merge (ctx.commands).
import type {} from "@deepseek-ai/dsh-commands";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { resolvePluginConfig, type PluginConfig } from "./shared/config.js";
import { effectivePluginConfig, installProjectContextSettings } from "./shared/settings.js";
import { isTopLevel, projectCwd, SerialQueue, SessionWorkTracker } from "./shared/lifecycle.js";
import { autolearnProjectSkills, type AutolearnOutcome } from "./shared/autolearn.js";
import { getProjectRoot, logError, skillsDir } from "./shared/project-state.js";

export const name = "project-autolearn";
export const inject = ["llm", "commands"];

/** Serialize passes so a forced command waits for an in-flight automatic one. */
const updates = new SerialQueue();

interface RunOptions {
	force: boolean;
	silent: boolean;
	signal?: AbortSignal | undefined;
}

/** Run one pass; the outcome is kept for command reporting while the queue only sees void. */
function runAutolearn(ctx: Context, config: PluginConfig, agent: Agent, options: RunOptions): Promise<AutolearnOutcome | undefined> {
	let outcome: AutolearnOutcome | undefined;
	return updates.run(async () => {
		const projectRoot = await getProjectRoot(projectCwd(agent.session));
		try {
			outcome = await autolearnProjectSkills(ctx, agent, config, { force: options.force, signal: options.signal });
			if (outcome?.skill && !options.silent) {
				ctx.logger.info(`dsh-project-context: project skill created: ${path.join(skillsDir(projectRoot), outcome.skill.name, "SKILL.md")}`);
			}
		} catch (error) {
			await logError(projectRoot, "autolearn", error);
			if (!options.silent) ctx.logger.warn(`dsh-project-context: autolearn failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}).then(() => outcome);
}

export function apply(ctx: Context, rawConfig: unknown): void {
	const entry = resolvePluginConfig(rawConfig);
	// The first plugin of the package to load owns the shared settings namespace.
	installProjectContextSettings(ctx, entry);
	/** In-flight autolearn work per session, awaited by durability flushes. */
	const pending = new SessionWorkTracker();

	ctx.on("agent/status", ({ agent, status }) => {
		if (status !== "idle" || !isTopLevel(agent.session)) return;
		const current = effectivePluginConfig(entry);
		if (!current.autoLearn) return;
		pending.track(agent.session, runAutolearn(ctx, current, agent, { force: false, silent: false }).then(() => undefined));
	});

	ctx.on("agent/disposed", ({ agent }) => {
		if (!isTopLevel(agent.session)) return;
		const current = effectivePluginConfig(entry);
		if (!current.autoLearn) return;
		// Silent: the UI may already be rebuilding for a session switch.
		pending.track(agent.session, runAutolearn(ctx, current, agent, { force: false, silent: true }).then(() => undefined));
	});

	ctx.on("session/flush", (session) => pending.flush(session));

	ctx.commands.register({
		name: "autolearn",
		description: "Distill a project skill from memory, context, and archived sessions",
		handler: async ({ agent, signal }) => {
			const outcome = await runAutolearn(ctx, effectivePluginConfig(entry), agent, { force: true, silent: false, signal });
			if (outcome === undefined) return { kind: "error", text: "Autolearn did not run (no provider/model, or the pass failed; see errors.log)." };
			return outcome.skill
				? { kind: "success", text: `Skill created: ${outcome.skill.name}` }
				: { kind: "success", text: "No new skill was warranted." };
		},
	});
}
