/**
 * How many tokens one auxiliary model call may spend: the reasoning reserve for the hidden
 * thinking that shares the output cap, the adaptive growth boundary, and the retry headroom
 * after a `max-tokens` truncation.
 */

/** Output room reserved for the JSON scaffolding and the rewritten context. */
export const REPLY_OUTPUT_MARGIN_TOKENS = 1024;

/** Chars kept per artifact when the budget allows; the split also reserves it as a token floor. */
export const MIN_CLIP_CHARS = 400;

/** Hard ceiling for an adaptive output cap when the model reports no limit of its own. */
export const MAX_ADAPTIVE_OUTPUT_TOKENS = 32_768;

/**
 * Hidden reasoning shares the same output cap as the visible reply (`TokenUsage.reasoningTokens`
 * is documented as a subset of `outputTokens`), so a reasoning model can spend the whole budget
 * thinking and have the JSON cut off mid-string. A reasoning route therefore reserves room for
 * that thinking on top of the visible content estimate.
 */
export const REASONING_RESERVE_RATIO = 0.35;

/** Reserve floor, so a short reply still leaves room for thinking. */
export const MIN_REASONING_RESERVE_TOKENS = 1024;

/** Reserve ceiling: past this, thinking is charged to the model's own budget rather than ours. */
export const MAX_REASONING_RESERVE_TOKENS = 8192;

/** Extra headroom a truncation retry asks for on top of the normal reserve. */
export const RETRY_OUTPUT_HEADROOM_TOKENS = 4096;

/**
 * Output tokens to hold back for hidden reasoning on a reasoning route. Proportional to the
 * visible content the reply must re-emit, clamped so a tiny reply still reserves the floor and a
 * huge one does not reserve more than the cap allows. Zero for a non-reasoning route and for an
 * empty input, which is what keeps the non-reasoning budget exactly as it was before.
 * @param contentTokens - estimated tokens of visible content the reply must reproduce.
 * @param model - the resolved model's capabilities.
 * @returns tokens to reserve, or 0 when no reserve applies.
 */
export function reasoningReserveTokens(contentTokens: number, model: { reasoning?: boolean }): number {
	if (model.reasoning !== true || contentTokens <= 0) return 0;
	return Math.min(MAX_REASONING_RESERVE_TOKENS, Math.max(MIN_REASONING_RESERVE_TOKENS, Math.round(contentTokens * REASONING_RESERVE_RATIO)));
}

/** Split a token budget between two artifacts: each keeps a floor, the rest follows the need. */
export function allocateTokens(budget: number, memoryTokens: number, contextTokens: number): { memory: number; context: number } {
	if (memoryTokens + contextTokens <= budget) return { memory: memoryTokens, context: contextTokens };
	const active = (memoryTokens > 0 ? 1 : 0) + (contextTokens > 0 ? 1 : 0);
	if (active === 0) return { memory: 0, context: 0 };
	if (memoryTokens === 0) return { memory: 0, context: budget };
	if (contextTokens === 0) return { memory: budget, context: 0 };
	const floor = Math.min(MIN_CLIP_CHARS, Math.floor(budget / 2));
	let memory = Math.min(memoryTokens, floor);
	let context = Math.min(contextTokens, floor);
	const rest = Math.max(0, budget - memory - context);
	// Whatever a floored artifact does not need flows to the other one, by remaining need.
	const needMemory = memoryTokens - memory;
	const needContext = contextTokens - context;
	if (rest > 0 && needMemory + needContext > 0) {
		const giveMemory = Math.min(needMemory, rest * (needMemory / (needMemory + needContext)));
		const giveContext = Math.min(needContext, rest - giveMemory);
		memory += giveMemory;
		context += giveContext;
	}
	return { memory, context };
}

/**
 * Raise the configured output cap to what the pass needs, bounded by the model's own limit and the
 * configured ceiling. The ceiling bounds how far the cap may *grow*: it never forces the request
 * below the configured starting cap, so `maxTokens` stays the base budget (pi's rule). Without model
 * metadata an adaptive cap could exceed what the provider accepts, so the pass never asks for more
 * than those bounds; an over-long input is then clipped.
 */
export function adaptiveOutputTokens(configured: number, needed: number, model: { maxTokens?: number }, ceiling: number): number {
	const cap = typeof model.maxTokens === "number" && model.maxTokens > 0 ? model.maxTokens : undefined;
	const grown = Math.max(configured, needed);
	return Math.min(cap ? Math.min(grown, cap) : grown, Math.max(configured, ceiling));
}
