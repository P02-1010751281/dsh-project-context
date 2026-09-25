/**
 * The trigger point: how much context may accumulate before a handoff, and the honest
 * account of it when a guardrail overrides a manually configured value.
 *
 * Two terms only — `min(quality(window), capacity(room))` — plus the two modes
 * (adaptive / fixed ratio) and the `override` report `/handoff status` renders.
 */

import { type PluginConfig } from "../shared/config.js";

// Threshold math, ported from pi's auto-handoff.
/** Don't hand off unless at least this much context is actually replaced by the summary. */
export const MIN_SUMMARIZE_TOKENS = 8_000;

/** Window headroom left for the next request (pi's default compaction reserve). */
const WINDOW_RESERVE_TOKENS = 16_384;

/** Stay this far below the usable window so streaming growth cannot cross it. */
const SAFETY_MARGIN_TOKENS = 4_000;

/** Everything the next request carries beyond the conversation surface, plus keep and the minimum. */
function thresholdFloor(config: PluginConfig, measurement: { totalTokens: number; surfaceTokens: number }): number {
	return Math.max(0, measurement.totalTokens - measurement.surfaceTokens) + config.handoffKeepTokens + MIN_SUMMARIZE_TOKENS;
}

/**
 * Why {@link resolveThreshold} returned `undefined`, named as the term that actually binds.
 *
 * `resolveThreshold` has three `undefined` exits with three different causes, and the receipt used
 * to render every one of them as "threshold unavailable at this window" — a claim about the window
 * that is *false* for two of the three. A roomy window (`usable > floor`) still refuses when the
 * summarizer minimum, the assembled baseline + carried tail, or the second 4K
 * {@link SAFETY_MARGIN_TOKENS} deduction is what decided it, and "at this window" sends the user to
 * change the model or the target when neither is the lever.
 */
export type ThresholdRefusal = "window-headroom" | "summarizer-floor" | "no-positive-threshold";

/**
 * The refusal cause behind `resolveThreshold(...) === undefined`, or `undefined` when the threshold
 * resolves. Read-only companion: it replays the same terms, in the same order, and only reports a
 * cause when `resolveThreshold` really is `undefined`, so the diagnosis cannot drift from the
 * formula (the formula itself is deliberately untouched).
 */
export function thresholdRefusal(
	config: PluginConfig,
	measurement: { totalTokens: number; surfaceTokens: number },
	contextWindow: number,
): ThresholdRefusal | undefined {
	if (resolveThreshold(config, measurement, contextWindow) !== undefined) return undefined;
	if (!config.handoffAdaptive) return "no-positive-threshold";
	// Reuse the orchestrator's own feasibility helper rather than re-deriving its terms: the two can
	// then only disagree if the *composition* changes, and the clamp is the only remaining refusal.
	return handoffRoom(config, measurement, contextWindow) === undefined ? "window-headroom" : "summarizer-floor";
}

/**
 * The refusal sentence for the `/handoff status` receipt. Each cause is phrased as the comparison
 * that failed, so the receipt cannot misattribute one refusal to another.
 */
export function thresholdRefusalText(
	reason: ThresholdRefusal,
	config: PluginConfig,
	measurement: { totalTokens: number; surfaceTokens: number },
	contextWindow: number,
): string {
	const floor = thresholdFloor(config, measurement);
	const usable = contextWindow - WINDOW_RESERVE_TOKENS;
	if (reason === "window-headroom") {
		// `usable` reaches zero (and goes negative) once the window is at or under the request
		// reserve; quoting "-8192 usable tokens" reads as nonsense, and "exceeds the window by 0"
		// contradicts itself, so each side of zero gets its own phrasing.
		const room = usable > 0
			? `${usable} usable token${usable === 1 ? "" : "s"} after the ${WINDOW_RESERVE_TOKENS}-token request reserve`
			: usable === 0
				? `no usable tokens at all — the ${WINDOW_RESERVE_TOKENS}-token request reserve consumes the entire ${contextWindow}-token window`
				: `no usable tokens at all — the ${WINDOW_RESERVE_TOKENS}-token request reserve exceeds the ${contextWindow}-token window by ${-usable}`;
		return `threshold unavailable: window too small — the ${contextWindow}-token window leaves ${room}, below the ${floor}-token floor (context assembly ${floor - config.handoffKeepTokens - MIN_SUMMARIZE_TOKENS} + keep ${config.handoffKeepTokens} + summarize minimum ${MIN_SUMMARIZE_TOKENS})`;
	}
	if (reason === "summarizer-floor") {
		return `threshold unavailable: the window is not the limit — the ${usable} usable tokens clear the ${floor}-token floor, but the ${SAFETY_MARGIN_TOKENS}-token safety margin leaves a summary that would replace fewer than the ${MIN_SUMMARIZE_TOKENS}-token minimum; a larger context window (or a smaller keep/target) is the lever, not this window alone`;
	}
	// Fixed mode refuses exactly when `min(round(W × ratio), W − SAFETY_MARGIN) ≤ 0`. Because the
	// ratio is validated into [0.1, 0.95], the second term binds first and the condition reduces to
	// `W ≤ SAFETY_MARGIN`: raising the ratio can never clear a refusal, so naming it would send the
	// user to a lever that does nothing.
	return `threshold unavailable: the ${contextWindow}-token window does not exceed the ${SAFETY_MARGIN_TOKENS}-token safety margin, so a fixed ${config.handoffThresholdRatio} ratio resolves to no positive threshold; a larger window is the only lever here (the ratio cannot help)`;
}

/** Where pi's fitted quality curve flattens out: the population-median reliable length. */
const KNEE_ASYMPTOTE_TOKENS = 157_000;

/** Window size at which the curve is half way between its asymptote and the declared window. */
const KNEE_TRANSITION_TOKENS = 450_000;

/** How sharply the curve turns; pi fitted 0.04 to the MRCR 8-needle population. */
const KNEE_TRANSITION_STEEPNESS = 0.04;

/**
 * pi's fitted knee curve: how much of a declared window a model still uses *well*.
 *
 * `knee(W) = W − (W − 157K) / (1 + e^(−ln(W/450K)/0.04))`, fitted to the MRCR 8-needle population
 * (46 models ≥1M: p25 127K / p50 157K / p75 190K). Its purpose is to **distrust a declared window**:
 * models advertising 1M measure 130–170K. The curve is ≈`W` below ~250K (so capacity, not the curve,
 * binds there), turns around 450K, and saturates at 157K.
 */
function kneeTokens(window: number): number {
	const z = Math.log(window / KNEE_TRANSITION_TOKENS) / KNEE_TRANSITION_STEEPNESS;
	return Math.round(window - (window - KNEE_ASYMPTOTE_TOKENS) / (1 + Math.exp(-z)));
}

/** What the next request carries besides the conversation, and what a handoff therefore needs. */
interface HandoffRoom {
	/** System prompt, tool schemas, injected project context: everything but the conversation. */
	baseline: number;
	/** Recent tokens carried into the successor verbatim. */
	keep: number;
	/** The smallest trigger that still lets a summary replace the summarize minimum. */
	floor: number;
	/** Window left for a request once the headroom reserve is taken. */
	usable: number;
}

/**
 * ① Feasibility only: is there room for a handoff at all? This answers "can we hand off", not "at
 * what threshold" — `undefined` here is a refusal before any value is computed.
 */
function handoffRoom(
	config: PluginConfig,
	measurement: { totalTokens: number; surfaceTokens: number },
	contextWindow: number,
): HandoffRoom | undefined {
	const baseline = Math.max(0, measurement.totalTokens - measurement.surfaceTokens);
	const keep = config.handoffKeepTokens;
	const floor = baseline + keep + MIN_SUMMARIZE_TOKENS;
	const usable = contextWindow - WINDOW_RESERVE_TOKENS;
	if (usable <= floor) return undefined;
	return { baseline, keep, floor, usable };
}

/**
 * ② Quality only: how much of the window the model still uses well.
 *
 * A **fallback chain**, not a sum and not a cap: prefer the harness's upstream usable-input
 * declaration — Codex (and the gateways that copy it) names the field `auto_compact_token_limit` —
 * and fall back to the fitted knee when the harness exposes none:
 * `quality = autoCompactTokenLimit ?? knee(window)`.
 *
 * dsh exposes only a combined `contextWindow` (`LlmModelContext`), so `autoCompactTokenLimit` is
 * always absent today and the chain takes its fallback branch. The parameter is the seam for the
 * harness change that would split declared capacity from usable input; until then callers pass
 * nothing. Exported so the chain's two branches are testable without a live session.
 */
export function qualityLimit(contextWindow: number, autoCompactTokenLimit?: number): number {
	return autoCompactTokenLimit ?? kneeTokens(contextWindow);
}

/**
 * ③ Capacity only: the last word. A trigger may not sit past the safe use of the window, whatever the
 * quality layer asked for.
 */
function capacityLimit(room: HandoffRoom): number {
	return room.usable - SAFETY_MARGIN_TOKENS;
}

/**
 * A manually-set threshold that a guardrail overrode, and which one. The threshold has two sources —
 * what the model actually supports (the quality layer, then the usable window) and what the user set by
 * hand (`/handoff target`, or a fixed `/handoff 0.4` ratio) — and the guardrail owns the trigger. A
 * manual setting the guardrail cannot honour must therefore be **named**, not silently ignored: a user
 * who raises `/handoff target` and sees nothing change has been sent to a control that does nothing.
 */
export interface ThresholdOverride {
	/** Which manual setting was overridden, as the receipt names it. */
	setting: "target" | "ratio";
	/** The threshold that setting asked for. */
	asked: number;
	/** What the guardrail resolved instead. */
	tokens: number;
	/** The guardrail that bound the trigger below `asked`. */
	by: "quality" | "capacity";
}

/**
 * ④ Orchestrator: mode selection and the composition of ①–③.
 *
 * The trigger is the **two-term** rule `min(quality(window), capacity(room))`: the quality layer is the
 * base and the capacity cap has the last word. The manually-set `handoffTargetTokens` deliberately does
 * not appear — a local preference must not lift the trigger above the honest quality knee, because
 * distrusting a declared window is the entire purpose of the curve. pi's `max(boundary, targetValue)`
 * does lift it (`handoff.ts:785` upstream), and dsh's earlier `min(configured, knee)` was the same
 * defect wearing the opposite sign: both let the local key decide a term that the quality layer owns.
 *
 * Not appearing is not the same as being ignored: the target is the user's statement of how much older
 * context is worth folding, so when the guardrail lands below the threshold that would need, the
 * returned {@link ThresholdOverride} says so and `/handoff status` warns. The physical "worthwhile
 * summary" floor stays enforced by ①: a threshold below it refuses, it does not clamp.
 */
export function resolveThreshold(
	config: PluginConfig,
	measurement: { totalTokens: number; surfaceTokens: number },
	contextWindow: number,
): { tokens: number; label: string; override?: ThresholdOverride } | undefined {
	if (!config.handoffAdaptive) {
		// Fixed mode: the manual setting *is* the trigger, so the safety margin is the only guardrail
		// above it. Clamping `0.95` on a small window is real (65_536 → 61_536) and the label alone
		// would keep claiming the full ratio.
		const asked = Math.round(contextWindow * config.handoffThresholdRatio);
		const tokens = Math.min(asked, contextWindow - SAFETY_MARGIN_TOKENS);
		if (tokens <= 0) return undefined;
		const percent = Math.round(config.handoffThresholdRatio * 100);
		const clamped = tokens < asked;
		return {
			tokens,
			// The label must not keep claiming the full ratio once the margin has taken part of it.
			label: clamped ? `${percent}% of window (capped to ${tokens})` : `${percent}% of window`,
			override: clamped ? { setting: "ratio", asked, tokens, by: "capacity" } : undefined,
		};
	}
	const room = handoffRoom(config, measurement, contextWindow);
	if (room === undefined) return undefined;
	// Two terms only: the quality base, then the capacity ban. No configured key on this line.
	const quality = qualityLimit(contextWindow);
	const capacity = capacityLimit(room);
	const tokens = Math.min(quality, capacity);
	if (tokens < room.floor) return undefined;
	// The threshold the configured target needs for its fold to fit under the trigger. Above the
	// guardrail's value the setting cannot be honoured, and the guardrail that bound it is named.
	const asked = room.baseline + room.keep + config.handoffTargetTokens;
	return {
		tokens,
		label: `auto ${tokens} (${Math.round((tokens / contextWindow) * 100)}%)`,
		override: asked > tokens
			? { setting: "target", asked, tokens, by: quality <= capacity ? "quality" : "capacity" }
			: undefined,
	};
}

/**
 * The `/handoff status` warning for a manual threshold the guardrail overrode. Both numbers and the
 * lever are named, so the receipt cannot send the user back to the same ineffective control.
 */
export function thresholdOverrideText(override: ThresholdOverride, config: PluginConfig, contextWindow: number): string {
	if (override.setting === "ratio") {
		return `fixed ratio ${Math.round(config.handoffThresholdRatio * 100)}% is not applied in full: it asks for ${override.asked} of this ${contextWindow}-token window and the ${SAFETY_MARGIN_TOKENS}-token safety margin leaves ${override.tokens}; a larger window is the lever`;
	}
	const guardrail = override.by === "quality"
		? `the model's quality knee allows ${override.tokens} at this window`
		: `only ${override.tokens} tokens fit this ${contextWindow}-token window after the ${WINDOW_RESERVE_TOKENS}-token request reserve and the ${SAFETY_MARGIN_TOKENS}-token safety margin`;
	return `handoff target ${config.handoffTargetTokens} is not applied in full: it needs a ${override.asked}-token threshold and ${guardrail}, so the auto guardrail decides — lower /handoff target, or use /handoff 0.4 for a fixed ratio`;
}
