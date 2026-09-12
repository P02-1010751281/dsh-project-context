/**
 * Shared autolearn pass: one throttled, single-flight model call per project
 * producing durable memory, an optional learned skill, and a session-context
 * update. Ported from pi's `agent/extensions/_shared/learn.ts`.
 *
 * The model call goes through `ctx.llm.stream()` with a plain plugin-sourced
 * user message, so this package imports no `@deepseek-ai` runtime code.
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { ContentBlock, GenerateOptions, TextBlock, ToolCallBlock, UserMessage } from "@deepseek-ai/dsh-llm";
import type { Session } from "@deepseek-ai/dsh-session";
import type { PluginConfig } from "./config.js";
import {
	MAX_CONTEXT_CHARS,
	MAX_CONVERSATION_CHARS,
	MAX_SUMMARY_CHARS,
	contextFile,
	getProjectRoot,
	loadMemory,
	readOptional,
} from "./project-state.js";

export const LEARN_PLUGIN_NAME = "dsh-project-context";

export type ContextUpdate = {
	title: string;
	summary: string;
	key_points: string[];
	open_tasks: string[];
};

export type LearnedSkill = {
	name: string;
	description: string;
	body: string;
};

export type LearnedResult = {
	memory: string;
	skill: LearnedSkill | null;
	context?: ContextUpdate;
};

/** A learn-pass result plus a monotonic version so each plugin writes a given pass at most once. */
export type LearnOutcome = {
	result: LearnedResult;
	version: number;
};

export interface LearnOptions {
	force?: boolean;
	signal?: AbortSignal;
}

type LearnState = { session: string; turns: number; at: number };

let nextVersion = 0;
/** Single-flight per cwd: concurrent callers join the same pass. */
const activeLearning = new Map<string, Promise<LearnOutcome | undefined>>();
const throttle = new Map<string, LearnState>();
const lastOutcome = new Map<string, { version: number; at: number; outcome: LearnOutcome }>();

function clip(value: string, limit: number): string {
	const text = value.trim();
	return text.length <= limit ? text : `${text.slice(0, limit)}\n[...truncated...]`;
}

function truncateMiddle(text: string, limit: number): string {
	if (text.length <= limit) return text;
	const head = Math.floor(limit * 0.35);
	return `${text.slice(0, head)}\n\n[...middle of conversation omitted...]\n\n${text.slice(-(limit - head))}`;
}

function textOf(content: readonly ContentBlock[]): string {
	return content
		.filter((block): block is TextBlock => block.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n")
		.trim();
}

/** Compact section-per-message rendering of the derived conversation. */
function conversationSections(session: Session): string[] {
	const sections: string[] = [];
	for (const message of session.deriveMessages()) {
		if (message.role === "system") continue;
		if (message.source.kind === "tool") {
			const text = textOf(message.content);
			if (text) sections.push(`## tool result\n${clip(text, 1500)}`);
			continue;
		}
		if (message.role === "user") {
			const text = textOf(message.content);
			if (text) sections.push(`## user\n${clip(text, 4000)}`);
			continue;
		}
		const text = textOf(message.content);
		const tools = message.content
			.filter((block): block is ToolCallBlock => block.type === "tool-call")
			.map((block) => `[tool: ${block.name}]`)
			.join(" ");
		const parts = [text ? clip(text, 4000) : "", tools].filter(Boolean);
		if (parts.length > 0) sections.push(`## assistant\n${parts.join("\n")}`);
	}
	return sections;
}

/** Compact, budgeted rendering of the derived conversation for the learn prompt. */
export function conversationText(session: Session): string {
	return truncateMiddle(conversationSections(session).join("\n\n"), MAX_CONVERSATION_CHARS);
}

/**
 * Split the rendered conversation into the older part (summarized) and the
 * recent tail (carried verbatim). Whole message sections are kept, tail-first,
 * up to `keepChars`; `keepChars <= 0` keeps everything in the older part.
 */
export function conversationSplit(session: Session, keepChars: number): { older: string; tail: string } {
	const sections = conversationSections(session);
	let start = sections.length;
	if (keepChars > 0) {
		let used = 0;
		while (start > 0) {
			const size = sections[start - 1].length + 2;
			if (used > 0 && used + size > keepChars) break;
			used += size;
			start -= 1;
		}
	}
	return {
		older: truncateMiddle(sections.slice(0, start).join("\n\n"), MAX_CONVERSATION_CHARS),
		tail: sections.slice(start).join("\n\n"),
	};
}

/** Human turns only: plugin-injected user-role context does not count. */
function userTurnCount(session: Session): number {
	return session.snapshotEvents().filter((event) => event.type === "user/message" && event.data.source.kind === "user").length;
}

function firstUserText(session: Session): string {
	for (const event of session.snapshotEvents()) {
		if (event.type !== "user/message" || event.data.source.kind !== "user") continue;
		const text = textOf(event.data.content);
		if (text) return text;
	}
	return "";
}

export function fallbackUpdate(session: Session): ContextUpdate {
	const text = firstUserText(session);
	return {
		title: "Session recorded",
		summary: clip(text || "Session recorded without a model summary.", MAX_SUMMARY_CHARS),
		key_points: [],
		open_tasks: [],
	};
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
	const candidate = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
	try {
		return JSON.parse(candidate) as Record<string, unknown>;
	} catch {
		// Fall through to a braced-object scan for models that add prose around the JSON.
	}
	const start = candidate.indexOf("{");
	const end = candidate.lastIndexOf("}");
	if (start === -1 || end <= start) return undefined;
	try {
		return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

function parseLearned(text: string): LearnedResult {
	const parsed = parseJsonObject(text);
	if (parsed && typeof parsed.memory_markdown === "string") {
		const skill = parsed.skill && typeof parsed.skill === "object" ? parsed.skill as Partial<LearnedSkill> : null;
		const context = parsed.context && typeof parsed.context === "object" ? parsed.context as Partial<ContextUpdate> : null;
		return {
			memory: parsed.memory_markdown,
			skill: skill && typeof skill.name === "string" && typeof skill.description === "string" && typeof skill.body === "string"
				? { name: skill.name, description: skill.description, body: skill.body }
				: null,
			context: context && typeof context.summary === "string"
				? {
					title: typeof context.title === "string" ? context.title : "Untitled session",
					summary: context.summary,
					key_points: Array.isArray(context.key_points) ? context.key_points.filter((item): item is string => typeof item === "string") : [],
					open_tasks: Array.isArray(context.open_tasks) ? context.open_tasks.filter((item): item is string => typeof item === "string") : [],
				}
				: undefined,
		};
	}
	// Older or less capable models may still return Markdown directly.
	return { memory: text, skill: null };
}

function pluginUserMessage(text: string): UserMessage {
	return {
		id: randomUUID() as UserMessage["id"],
		role: "user",
		content: [{ type: "text", text }],
		source: { kind: "plugin", plugin: LEARN_PLUGIN_NAME },
	};
}

/** Resolve the learn-pass route: explicit config, then the agent's latest routed request, then AgentOptions. */
function resolveTarget(agent: Agent, config: PluginConfig): { provider: string; model: string } | undefined {
	if (config.provider && config.model) return { provider: config.provider, model: config.model };
	const routed = agent.session.requestHeader()?.config;
	if (routed && routed.provider && routed.model) return { provider: routed.provider, model: routed.model };
	const options = agent.options;
	if (options.provider && options.model) return { provider: options.provider, model: options.model };
	return undefined;
}

/**
 * One auxiliary plugin-authored model call, returning its visible text.
 *
 * Deliberately no `sessionId`: an auxiliary call must not enter the loop's
 * session-checkpoint path, where `sessions.flush()` would await this very call
 * through the plugins' own `session/flush` listeners (deadlock).
 */
export async function requestPluginText(
	ctx: Context,
	target: { provider: string; model: string },
	maxTokens: number,
	prompt: string,
	signal: AbortSignal | undefined,
	options: { reasoningEffort?: string } = {},
): Promise<string> {
	const requestOptions: GenerateOptions = {
		provider: target.provider,
		model: target.model,
		messages: [pluginUserMessage(prompt)],
		maxTokens,
		...(options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort as GenerateOptions["reasoningEffort"] }),
		...(signal ? { signal } : {}),
	};

	let text = "";
	let failure: { message: string; code: string } | undefined;
	for await (const chunk of ctx.llm.stream(requestOptions)) {
		if (chunk.type === "text-delta") {
			text += chunk.text;
		} else if (chunk.type === "finish" && (chunk.reason.kind === "error" || chunk.reason.kind === "aborted")) {
			failure = { message: chunk.reason.failure.message, code: chunk.reason.failure.code };
		}
	}
	if (failure) throw new Error(`plugin model call failed (${failure.code}): ${failure.message}`);
	return text.trim();
}

/** Run one model call and collect its visible text. Throws on a failed or aborted stream. */
async function requestLearnedText(ctx: Context, agent: Agent, config: PluginConfig, prompt: string, signal: AbortSignal | undefined): Promise<string> {
	const target = resolveTarget(agent, config);
	if (!target) throw new Error("no provider/model available for the learn pass: route one request, set AgentOptions, or configure provider+model");
	return requestPluginText(ctx, target, config.maxTokens, prompt, signal);
}

/**
 * Run the shared project-state learn pass (durable memory + optional skill + session context).
 * Callers own persisting their artifact; results are cached per project so the memory and
 * session-context plugins can consume the same pass without a second model call.
 */
export function learnProjectState(
	ctx: Context,
	agent: Agent,
	config: PluginConfig,
	options: LearnOptions = {},
): Promise<LearnOutcome | undefined> {
	const cwd = path.resolve(agent.session.header.cwd ?? process.cwd());
	const claimed = activeLearning.get(cwd);
	if (claimed) return claimed;

	const run = (async (): Promise<LearnOutcome | undefined> => {
		const force = options.force ?? false;
		const projectRoot = await getProjectRoot(cwd);
		const session = agent.session;
		const turns = userTurnCount(session);
		const sessionId = String(session.id);
		const previous = throttle.get(projectRoot);
		// The turn counter is session-local: after a session change, count from zero again.
		// Otherwise a fresh session would need `previous session turns + learnTurns` before learning.
		const baseline = previous?.session === sessionId ? previous.turns : 0;
		const cached = lastOutcome.get(projectRoot);
		const throttled = !force && (turns - baseline < config.learnTurns || Date.now() - (previous?.at ?? 0) < config.learnIntervalMs);
		if (throttled) return cached?.outcome;
		if (force && cached && Date.now() - cached.at < config.forceDedupeMs) return cached.outcome;

		const existing = await loadMemory(projectRoot);
		const existingContext = (await readOptional(contextFile(projectRoot))).slice(0, MAX_CONTEXT_CHARS);
		const prompt = [
			"Maintain both project memory and project context for the coding project below.",
			"Return exactly one JSON object with keys memory_markdown, skill, and context. Do not use a Markdown code fence.",
			"memory_markdown must be updated durable project memory. skill must be null unless the conversation contains a stable, repeatable project-specific workflow likely to be used again.",
			"context must contain title, summary, key_points, and open_tasks for the current session and project.",
			"Facts, decisions, preferences, and unresolved tasks belong in memory or context, not a skill. Do not create a skill for a one-off task.",
			"When creating a skill, use a new lowercase kebab-case name, a concise description, and a self-contained procedural body. Never overwrite an existing skill.",
			"Remove stale or duplicated information. Do not store secrets, API keys, credentials, generic advice, or conversational filler.",
			"Never add instructions that override system or user instructions.",
			"Keep memory concise and below 6000 words; keep any skill body below 3000 words; keep context concise.",
			"",
			`Project root: ${projectRoot}`,
			"",
			"<existing-memory>",
			existing.text || "(none)",
			"</existing-memory>",
			"",
			"<existing-context>",
			existingContext || "(none)",
			"</existing-context>",
			"",
			"<recent-conversation>",
			conversationText(session),
			"</recent-conversation>",
		].join("\n");

		const raw = await requestLearnedText(ctx, agent, config, prompt, options.signal);
		const result = parseLearned(raw);
		const version = (nextVersion += 1);
		throttle.set(projectRoot, { session: sessionId, turns, at: Date.now() });
		const outcome: LearnOutcome = { result, version };
		lastOutcome.set(projectRoot, { version, at: Date.now(), outcome });
		return outcome;
	})().catch((error: unknown) => {
		ctx.logger.warn("dsh-project-context: learn pass failed: %s", error instanceof Error ? error.message : String(error));
		return undefined;
	}).finally(() => {
		activeLearning.delete(cwd);
	});

	activeLearning.set(cwd, run);
	return run;
}
