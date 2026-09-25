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

/** What one plugin-authored model call produced: its visible text and how the stream ended. */
export type CompletionOutcome = {
	/** Trimmed visible text. */
	text: string;
	/** dsh finish reason kind (`stop`, `tool-calls`, `max-tokens`, `aborted`, `error`, or an unknown kind). */
	stopReason: string;
	/** Hidden reasoning tokens, a subset of the output count; 0 when the adapter reports none. */
	reasoningTokens: number;
};

function pluginUserMessage(text: string): UserMessage {
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
 * @param options - optional reasoning effort override.
 * @returns the trimmed visible text, the finish reason kind, and hidden reasoning tokens.
 */
export async function requestPluginTextWithMeta(
	ctx: Context,
	target: { provider: string; model: string },
	maxTokens: number,
	prompt: string,
	signal: AbortSignal | undefined,
	options: { reasoningEffort?: string } = {},
): Promise<CompletionOutcome> {
	const requestOptions: GenerateOptions = {
		provider: target.provider,
		model: target.model,
		messages: [pluginUserMessage(prompt)],
		maxTokens,
		...(options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort as GenerateOptions["reasoningEffort"] }),
		...(signal ? { signal } : {}),
	};

	let text = "";
	let stopReason = "";
	let reasoningTokens = 0;
	let failure: { message: string; code: string } | undefined;
	for await (const chunk of ctx.llm.stream(requestOptions)) {
		if (chunk.type === "text-delta") {
			text += chunk.text;
		} else if (chunk.type === "usage") {
			reasoningTokens = chunk.usage.reasoningTokens ?? 0;
		} else if (chunk.type === "finish") {
			// Every known finish reason is recorded — including `max-tokens`, which is the signal a
			// caller needs to retry, and unknown merge-extensible kinds, which are reported as-is.
			stopReason = chunk.reason.kind;
			if (chunk.reason.kind === "error" || chunk.reason.kind === "aborted") {
				failure = { message: chunk.reason.failure.message, code: chunk.reason.failure.code };
			}
		}
	}
	if (failure) throw new Error(`plugin model call failed (${failure.code}): ${failure.message}`);
	return { text: text.trim(), stopReason, reasoningTokens };
}
