/**
 * One plugin-sourced auxiliary model call: which route to use, what metadata the adapter
 * exposes, the output limit for that route, and the single-shot and meta-returning calls.
 */

import { randomUUID } from "node:crypto";
import { type Context } from "@deepseek-ai/cordis";
import { type Agent } from "@deepseek-ai/dsh-agent";
import { type GenerateOptions, type LlmResolvedModelInfo, type UserMessage } from "@deepseek-ai/dsh-llm";
import { type PluginConfig } from "./config.js";

export const LEARN_PLUGIN_NAME = "dsh-project-context";

/**
 * This producer's message-source kind.
 *
 * dsh 0.1.7-rc.2 dropped the shared catch-all `plugin` kind: `MessageSourceMap` is merge-extensible and
 * each producer declares its own kind in its own module (in-tree, `compact-checkpoint` does the same).
 * The kind deliberately is not `user`: `userTurnCount` counts human turns by `source.kind === "user"`,
 * so tagging this synthetic message `user` would inflate the consolidation/autolearn turn counters.
 */
declare module "@deepseek-ai/dsh-llm" {
	interface MessageSourceMap {
		"dsh-project-context": { kind: "dsh-project-context" };
	}
}

/** One tool offered to a plugin-authored call: the declaration the adapter forwards to the provider. */
export type PluginTool = {
	name: string;
	description: string;
	/** JSON Schema object for the arguments. */
	parameters: Record<string, unknown>;
};

/**
 * One tool call the reply carried, with its arguments left as the raw JSON text the adapter
 * streamed. Whether those arguments are usable is the caller's policy, not this module's.
 */
export type PluginToolCall = { name: string; arguments: string };

/** What one plugin-authored model call produced: its visible text, how the stream ended, and any tool calls. */
export type CompletionOutcome = {
	/** Trimmed visible text. */
	text: string;
	/** dsh finish reason kind (`stop`, `tool-calls`, `max-tokens`, `aborted`, `error`, or an unknown kind). */
	stopReason: string;
	/** Hidden reasoning tokens, a subset of the output count; 0 when the adapter reports none. */
	reasoningTokens: number;
	/**
	 * Tool calls the reply carried, in stream order. Absent — never an empty array — when the reply
	 * carried none, so a caller that offers no tools sees the same object it saw before this field
	 * existed.
	 */
	toolCalls?: PluginToolCall[];
};

/**
 * One plugin-authored user message, tagged with this producer's own source kind.
 *
 * The kind is deliberately never `user`: `userTurnCount` counts human turns by `source.kind === "user"`,
 * and dsh's goal tools grant `create_goal` / `update_goal edit|pause|resume` to a "direct human turn" by
 * reading that same field (`goal/tool-goal/src/authority.ts`). Anything this plugin writes on the
 * model's behalf — an auxiliary call's prompt, or the handoff seed — must therefore carry its own
 * kind instead of borrowing the person's authority.
 */
export function pluginUserMessage(text: string): UserMessage {
	return {
		id: randomUUID() as UserMessage["id"],
		role: "user",
		content: [{ type: "text", text }],
		source: { kind: LEARN_PLUGIN_NAME },
	};
}

/** Resolve the learn-pass route: explicit config, then the agent's latest routed request, then AgentOptions. */
export function resolveTarget(agent: Agent, config: PluginConfig): { provider: string; model: string } | undefined {
	if (config.provider && config.model) return { provider: config.provider, model: config.model };
	const routed = agent.session.requestHeader()?.config;
	if (routed && routed.provider && routed.model) return { provider: routed.provider, model: routed.model };
	const options = agent.options;
	if (options.provider && options.model) return { provider: options.provider, model: options.model };
	return undefined;
}

/**
 * The routed model's own catalogue metadata: its output cap and whether it exposes reasoning
 * efforts. Model metadata is advisory, so an unknown or failing provider simply yields
 * `undefined` and the pass falls back to the configured ceiling. Consolidation reads one resolve
 * for both facts rather than spending two RPCs.
 * @param ctx - the plugin context holding the `llm` service.
 * @param target - the resolved provider/model route.
 * @param signal - the pass's abort signal.
 * @returns the resolved info, or `undefined` when the adapter cannot answer.
 */
export async function resolveModelMetadata(
	ctx: Context,
	target: { provider: string; model: string },
	signal: AbortSignal | undefined,
): Promise<LlmResolvedModelInfo | undefined> {
	try {
		return await ctx.llm.resolveModelInfo(target.provider, target.model, signal);
	} catch {
		return undefined;
	}
}

/**
 * The routed model's own output cap, when its adapter publishes one. Model catalog metadata is
 * advisory, so an unknown provider simply yields no cap.
 * @param ctx - the plugin context holding the `llm` service.
 * @param target - the resolved provider/model route.
 * @param signal - the pass's abort signal.
 * @returns the adapter's per-request output cap, or `undefined`.
 */
export async function modelOutputLimit(ctx: Context, target: { provider: string; model: string }, signal: AbortSignal | undefined): Promise<number | undefined> {
	return (await resolveModelMetadata(ctx, target, signal))?.defaultMaxTokens;
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
	return (await requestPluginTextWithMeta(ctx, target, maxTokens, prompt, signal, options)).text;
}

/**
 * One auxiliary plugin-authored model call, returning its visible text plus how it ended.
 *
 * The stop reason is the only signal that says a reply was cut off: a reply that hit the output
 * limit still carries content, so it parses as a truncated document rather than a failure. dsh
 * names that reason `max-tokens` — **not** pi's `length` — and it is deliberately not an error
 * here: the caller decides whether to retry with more headroom (a genuine `error`/`aborted`
 * finish still throws, with the message this plugin has always used).
 * @param ctx - the plugin context holding the `llm` service.
 * @param target - the resolved provider/model route.
 * @param maxTokens - the output cap to request.
 * @param prompt - the plugin-authored user message.
 * @param signal - the pass's abort signal.
 * @param options - optional reasoning effort override, and the tools to offer this call.
 * @returns the trimmed visible text, the finish reason kind, hidden reasoning tokens, and any tool calls.
 */
export async function requestPluginTextWithMeta(
	ctx: Context,
	target: { provider: string; model: string },
	maxTokens: number,
	prompt: string,
	signal: AbortSignal | undefined,
	options: { reasoningEffort?: string; tools?: readonly PluginTool[] } = {},
): Promise<CompletionOutcome> {
	const requestOptions: GenerateOptions = {
		provider: target.provider,
		model: target.model,
		messages: [pluginUserMessage(prompt)],
		maxTokens,
		...(options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort as GenerateOptions["reasoningEffort"] }),
		// Omitted — not an empty array — when this call offers no tool, so a caller that never grew a
		// tool keeps sending the byte-identical request it always did.
		...(options.tools === undefined || options.tools.length === 0 ? {} : { tools: [...options.tools] }),
		...(signal ? { signal } : {}),
	};

	let text = "";
	let stopReason = "";
	let reasoningTokens = 0;
	let failure: { message: string; code: string } | undefined;
	/** Assembled tool calls by block index: deltas arrive fragmented, `block-end` carries the join. */
	const toolCalls = new Map<number, PluginToolCall>();
	for await (const chunk of ctx.llm.stream(requestOptions)) {
		if (chunk.type === "text-delta") {
			text += chunk.text;
		} else if (chunk.type === "tool-call-delta") {
			// Only the first delta of a block names the tool; the rest report `name: undefined`, so the
			// name has to be kept from whichever delta carried it.
			const current = toolCalls.get(chunk.index) ?? { name: "", arguments: "" };
			if (chunk.name !== undefined && chunk.name !== "") current.name = chunk.name;
			current.arguments += chunk.argumentsDelta;
			toolCalls.set(chunk.index, current);
		} else if (chunk.type === "block-end") {
			// The assembled block is authoritative when it arrives: it carries the complete argument
			// string and the name regardless of how the deltas were fragmented or interleaved.
			if (chunk.block.type === "tool-call") {
				toolCalls.set(chunk.index, { name: chunk.block.name, arguments: chunk.block.arguments });
			}
		} else if (chunk.type === "usage") {
			reasoningTokens = chunk.usage.reasoningTokens ?? 0;
		} else if (chunk.type === "finish") {
			// Every known finish reason is recorded — including `max-tokens`, which is the signal a
			// caller needs to retry, unknown merge-extensible kinds, which are reported as-is, and
			// `tool-calls`, which is simply how a reply carrying a tool call ends.
			stopReason = chunk.reason.kind;
			if (chunk.reason.kind === "error" || chunk.reason.kind === "aborted") {
				failure = { message: chunk.reason.failure.message, code: chunk.reason.failure.code };
			}
		}
	}
	if (failure) throw new Error(`plugin model call failed (${failure.code}): ${failure.message}`);
	const collected = [...toolCalls.entries()]
		.sort(([left], [right]) => left - right)
		.map(([, call]) => call)
		.filter((call) => call.name !== "");
	return {
		text: text.trim(),
		stopReason,
		reasoningTokens,
		...(collected.length === 0 ? {} : { toolCalls: collected }),
	};
}

/**
 * Pick the tool call the caller asked for; the one place the "unusable call" policy lives.
 *
 * This module is name-agnostic, so it hands back every call it collected — including names this
 * caller does not accept, which is what lets these two be told apart:
 *
 * - a call with another name **and** readable text is the fail-open text path; `undefined` sends the
 *   caller on to parse the text;
 * - a call with another name **and** no text has nothing to fall back to, so it is an error —
 *   returning `undefined` there would feed `""` to the parser and read as a silent no-op success.
 * @param toolCalls - the calls the reply carried, when it carried any.
 * @param name - the one tool name this caller accepts.
 * @param text - the reply's visible text, which decides the no-matching-call case.
 * @returns the matching call's raw JSON argument text, or undefined when the text path should run.
 */
export function pickToolCall(toolCalls: readonly PluginToolCall[] | undefined, name: string, text: string): string | undefined {
	const match = toolCalls?.find((call) => call.name === name);
	if (match) return match.arguments;
	if (toolCalls !== undefined && toolCalls.length > 0 && text.trim() === "") {
		const names = toolCalls.map((call) => call.name).join(", ");
		throw new Error(`model called ${names} without text; expected ${name}`);
	}
	return undefined;
}

/**
 * True when a reply's tool call must not be trusted as complete.
 *
 * The adapter repairs a truncated arguments string into a shape-valid object, so the *presence* of a
 * call is not evidence that its contents arrived. dsh names a cut reply `max-tokens`, and an empty
 * finish reason means no terminal event was seen at all; either way the block may have been retained
 * half-written, so both are refused. A reply that carries no call is not this predicate's business.
 */
export function toolCallIsTruncated(completion: CompletionOutcome): boolean {
	return (completion.toolCalls?.length ?? 0) > 0 && (completion.stopReason === "max-tokens" || completion.stopReason === "");
}
