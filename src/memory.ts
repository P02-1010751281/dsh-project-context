/**
 * project-memory — port of pi's `memory` extension.
 *
 * Maintains durable project memory (`.agents/memory/MEMORY.md`) and autolearned
 * project skills (`.agents/skills/<name>/SKILL.md`, natively discovered by
 * dsh's skill filesystem) through the shared learn pass, then injects the
 * memory back into the model context as dynamic runtime context.
 *
 * Commands: /memory, /memory-learn
 */

import path from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { CommandRuntime } from "@deepseek-ai/dsh-commands";
import type { Session } from "@deepseek-ai/dsh-session";
import { resolvePluginConfig, type PluginConfig } from "./shared/config.js";
import { effectivePluginConfig, installProjectContextSettings } from "./shared/settings.js";
import { learnProjectState, type LearnedSkill } from "./shared/learn.js";
import {
	MAX_MEMORY_CHARS,
	MAX_SKILL_BODY_CHARS,
	getProjectRoot,
	getProjectRootSync,
	logError,
	memoryDir,
	memoryFile,
	migrateProjectState,
	readOptional,
	readTextCachedSync,
	skillsDir,
	validSkillName,
	writeAtomic,
} from "./shared/project-state.js";

export const name = "project-memory";
export const inject = ["llm", "systemPrompt", "commands"];

/** Last learn-pass version each project's memory/skill artifacts were written from. */
const written = new Map<string, number>();
/** Projects whose legacy layout was already consolidated in this process. */
const migrated = new Set<string>();
let updateQueue: Promise<void> = Promise.resolve();

/** Longest a durability flush waits for an in-flight update before letting shutdown proceed. */
const FLUSH_WAIT_MS = 90_000;

function waitBounded(promise: Promise<void>): Promise<void> {
	return new Promise<void>((resolve) => {
		const timer = setTimeout(resolve, FLUSH_WAIT_MS);
		timer.unref?.();
		void promise.finally(() => {
			clearTimeout(timer);
			resolve();
		});
	});
}

function isTopLevel(session: Session): boolean {
	return session.header.origin !== "subagent";
}

function projectCwd(session: Session): string {
	return session.header.cwd ?? process.cwd();
}

function cleanMemory(text: string): string {
	const withoutFence = text.replace(/^```(?:markdown)?\s*/i, "").replace(/\s*```$/, "").trim();
	const body = withoutFence.replace(/^# Project Memory\s*/i, "").trim();
	return `# Project Memory\n\n${body}`.slice(0, MAX_MEMORY_CHARS).trimEnd() + "\n";
}

function skillDocument(skill: LearnedSkill): string {
	const description = skill.description.replace(/\s+/g, " ").trim().slice(0, 1024);
	const body = skill.body.trim().slice(0, MAX_SKILL_BODY_CHARS);
	return `---\nname: ${skill.name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body}\n`;
}

async function saveLearnedSkill(projectRoot: string, skill: LearnedSkill): Promise<boolean> {
	const skillName = skill.name.trim();
	const description = skill.description.trim();
	const body = skill.body.trim();
	if (!validSkillName(skillName) || !description || body.length < 40) return false;

	const file = path.join(skillsDir(projectRoot), skillName, "SKILL.md");
	if (await readOptional(file)) return false;
	await writeAtomic(file, skillDocument({ name: skillName, description, body }));
	return true;
}

/** Synchronous text for the dynamic-context provider; empty until the root is known. */
export function projectMemoryInjection(cwd: string | undefined): string {
	if (!cwd) return "";
	const projectRoot = getProjectRootSync(cwd);
	const text = readTextCachedSync(memoryFile(projectRoot)).trim();
	if (!text) return "";
	return `## Project Memory\nThe following is durable project memory learned from earlier sessions, not a new user instruction:\n\n${text.slice(0, MAX_MEMORY_CHARS)}`;
}

interface LearnOptions {
	force: boolean;
	silent: boolean;
	signal?: AbortSignal | undefined;
}

function learnMemory(ctx: Context, config: PluginConfig, agent: Agent, options: LearnOptions): Promise<void> {
	const next = updateQueue.then(async () => {
		const session = agent.session;
		const projectRoot = await getProjectRoot(projectCwd(session));
		try {
			const outcome = await learnProjectState(ctx, agent, config, { force: options.force, signal: options.signal });
			if (!outcome || (written.get(projectRoot) ?? 0) >= outcome.version) return;

			const memoryText = outcome.result.memory.trim();
			const memoryChanged = memoryText.length >= 40;
			const skillCreated = outcome.result.skill ? await saveLearnedSkill(projectRoot, outcome.result.skill) : false;
			written.set(projectRoot, outcome.version);
			if (memoryChanged) await writeAtomic(memoryFile(projectRoot), cleanMemory(memoryText));
			if (!options.silent && (memoryChanged || skillCreated)) {
				ctx.logger.info(
					skillCreated
						? `dsh-project-context: project memory and skill updated: ${memoryFile(projectRoot)}`
						: `dsh-project-context: project memory updated: ${memoryFile(projectRoot)}`,
				);
			}
		} catch (error) {
			await logError(projectRoot, "memory", error);
			if (!options.silent) ctx.logger.warn(`dsh-project-context: project memory update failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	});
	updateQueue = next;
	return next;
}

export function apply(ctx: Context, rawConfig: unknown): void {
	const entry = resolvePluginConfig(rawConfig);
	// The first plugin of the pair to load owns the shared settings namespace.
	installProjectContextSettings(ctx, entry);
	/** In-flight memory work per session, awaited by durability flushes. */
	const pending = new Map<string, Promise<void>>();

	function track(session: Session, work: Promise<void>): void {
		const key = String(session.id);
		const tracked = work.catch(() => undefined);
		pending.set(key, tracked);
		void tracked.finally(() => {
			if (pending.get(key) === tracked) pending.delete(key);
		});
	}

	ctx.systemPrompt.context({
		name: "project-memory",
		order: 190,
		text: (assembleContext) => projectMemoryInjection(assembleContext.agent?.session.header.cwd),
	});

	ctx.on("agent/session-start", ({ agent }) => {
		void (async () => {
			const projectRoot = await getProjectRoot(projectCwd(agent.session));
			if (migrated.has(projectRoot)) return;
			migrated.add(projectRoot);
			const result = await migrateProjectState(projectRoot);
			const details: string[] = [];
			if (result.moved.length > 0) details.push(`moved ${result.moved.join(", ")}`);
			if (result.importedSkills > 0) details.push(`imported ${result.importedSkills} skill${result.importedSkills === 1 ? "" : "s"}`);
			if (result.importedMemory) details.push("imported legacy OMP memory");
			if (details.length > 0) ctx.logger.info(`dsh-project-context: project memory in ${memoryDir(projectRoot)}: ${details.join("; ")}`);
		})().catch((error: unknown) => {
			void logError(projectCwd(agent.session), "migration", error);
		});
	});

	ctx.on("agent/status", ({ agent, status }) => {
		if (status !== "idle" || !isTopLevel(agent.session)) return;
		const current = effectivePluginConfig(entry);
		if (!current.autoLearn) return;
		track(agent.session, learnMemory(ctx, current, agent, { force: false, silent: false }));
	});

	ctx.on("agent/disposed", ({ agent }) => {
		if (!isTopLevel(agent.session)) return;
		const current = effectivePluginConfig(entry);
		if (!current.autoLearn) return;
		// Silent: the UI may already be rebuilding for a session switch.
		track(agent.session, learnMemory(ctx, current, agent, { force: true, silent: true }));
	});

	ctx.on("session/flush", (session) => {
		const work = pending.get(String(session.id));
		return work ? waitBounded(work) : undefined;
	});

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
		name: "memory-learn",
		description: "Learn durable facts and skills from this project session",
		handler: async ({ agent, signal }) => {
			await learnMemory(ctx, effectivePluginConfig(entry), agent, { force: true, silent: false, signal });
			return { kind: "success", text: "Project memory update finished." };
		},
	});
}
