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

/**
 * What this plugin reads from the harness's meter.
 *
 * `totalTokens` is anchored on the routed provider's reported `usage`; `surfaceTokens` is priced by the
 * meter's **fixed-density heuristic** (4 characters per token). The two are on *different bases*, so no
 * arithmetic may cross them — and this plugin is a consumer of measurements, not a repricer of them.
 *
 * `overheadTokens` is the envelope the next request carries beyond the conversation surface (system
 * prompt, tool schemas). Callers read it from the harness: `projectionEnvelope` sums the token meter's
 * own `contextBreakdown` projection (`systemTokens + toolsTokens`). When no registry is mounted the
 * floor carries only the terms this plugin owns.
 *
 * `surfaceTokens` is part of the meter's contract and is deliberately **not read** here: the plugin has
 * no question of its own that the surface alone answers, and reading it only ever invited the
 * cross-basis subtraction this interface exists to forbid.
 */
export interface ContextMeasurement {
	readonly totalTokens: number;
	readonly surfaceTokens: number;
	readonly overheadTokens?: number;
}

/**
 * The smallest trigger that still lets a summary replace the summarize minimum: the carried tail plus
 * that minimum, plus the envelope when the harness reports one.
 *
 * It deliberately does **not** derive the envelope as `totalTokens − surfaceTokens`. That difference is
 * `overhead + (real surface − heuristic surface)`: for a CJK-heavy conversation the density heuristic
 * undercounts the surface by roughly 2×, and the whole shortfall lands in the difference. A real
 * session measured `495117 − 231793 = 263324` where the envelope was `42845`, so the floor became
 * `263324 + keep + 8000 = 271324` — above the `157000` knee at a 1M window — and `resolveThreshold`
 * refused **permanently**, with a receipt that blamed the knee. The knee was never the cause.
 */
function thresholdFloor(config: PluginConfig, measurement: ContextMeasurement): number {
	const overhead = measurement.overheadTokens ?? 0;
	return Math.max(0, overhead) + config.handoffKeepTokens + MIN_SUMMARIZE_TOKENS;
}

/**
 * Why {@link resolveThreshold} returned `undefined`, named as the term that actually binds.
 *
 * `resolveThreshold` has four `undefined` exits with four different causes, and the receipt used to
 * render every one of them as "threshold unavailable at this window" — a claim about the window that
 * is *false* for three of the four. A roomy window (`usable > floor`) still refuses when the
 * summarizer minimum, the reported envelope + carried tail, the second 4K
 * {@link SAFETY_MARGIN_TOKENS} deduction, or the **quality knee** is what decided it, and "at this
 * window" sends the user to change the model or the target when neither is the lever.
 *
 * The knee and the margin want *opposite* levers, which is why they cannot share a cause: a larger
 * window raises the capacity deduction's headroom but lowers the knee, so advice written for one is
 * actively backwards for the other.
 */
export type ThresholdRefusal = "window-headroom" | "quality-knee" | "summarizer-floor" | "no-positive-threshold";

/**
 * The refusal cause behind `resolveThreshold(...) === undefined`, or `undefined` when the threshold
 * resolves. Read-only companion: it replays the same terms, in the same order, and only reports a
 * cause when `resolveThreshold` really is `undefined`, so the diagnosis cannot drift from the formula.
 */
export function thresholdRefusal(
	config: PluginConfig,
	measurement: ContextMeasurement,
	contextWindow: number,
): ThresholdRefusal | undefined {
	if (resolveThreshold(config, measurement, contextWindow) !== undefined) return undefined;
	if (!config.handoffAdaptive) return "no-positive-threshold";
	// Reuse the orchestrator's own feasibility helper rather than re-deriving its terms: the two can
	// then only disagree if the *composition* changes, and the clamp is the only remaining refusal.
	const room = handoffRoom(config, measurement, contextWindow);
	if (room === undefined) return "window-headroom";
	// Both terms of the two-term rule can sit below the floor, and they want opposite levers. Compare
	// them exactly as the orchestrator does. Before the trigger became two terms the target lift kept
	// the knee path unreachable, so the whole case used to render as "summarizer-floor" — with "a
	// larger context window" as the advice, which is backwards when the knee is what bound.
	return qualityLimit(contextWindow) <= capacityLimit(room) ? "quality-knee" : "summarizer-floor";
}

/**
 * The refusal sentence for the `/handoff status` receipt. Each cause is phrased as the comparison
 * that failed, so the receipt cannot misattribute one refusal to another.
 */
export function thresholdRefusalText(
	reason: ThresholdRefusal,
	config: PluginConfig,
	measurement: ContextMeasurement,
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
		const envelope = floor - config.handoffKeepTokens - MIN_SUMMARIZE_TOKENS;
		// The envelope term exists only when the harness reports one; printing "0-token envelope" would
		// invent a term that took no part in the comparison.
		const assembly = envelope > 0
			? `the ${envelope}-token envelope the harness reports + keep ${config.handoffKeepTokens} + summarize minimum ${MIN_SUMMARIZE_TOKENS}`
			: `keep ${config.handoffKeepTokens} + summarize minimum ${MIN_SUMMARIZE_TOKENS}`;
		return `threshold unavailable: window too small — the ${contextWindow}-token window leaves ${room}, below the ${floor}-token floor (${assembly})`;
	}
	if (reason === "quality-knee") {
		// "A larger window" is the lever for the margin case and the *opposite* of the lever here: the
		// curve approaches its 157K asymptote from above, so a wider window lowers the knee. Say which
		// control actually helps rather than reusing the margin sentence.
		//
		// The floor's terms are the harness-reported envelope, `keep` and the summarize minimum. Only
		// `keep` is a config key, and it reaches this refusal on its own **today**: `handoffKeepTokens` is
		// bounded at 200_000 (`config.ts`), so at a 1M window `keep >= 149_001` puts the floor past the
		// 157_000 knee (measured: 149_000 resolves, 149_001 refuses). A reported envelope can reach it too.
		// Neither the window nor the target is a lever here — the window is the *opposite* lever (the curve
		// approaches 157K from above, so a wider window lowers the knee) and `/handoff budget summary` never
		// enters the floor. The setting that clears it *today* is an explicit ratio, which is not checked
		// against the knee at all because the agreed fence lets an explicit setting override the quality
		// ceiling that governs the auto composition — exactly what {@link thresholdOverrideText} already
		// tells a user whose `/handoff budget summary` the knee overrode. Say *that*, not where the resulting
		// trigger lands: below the `knee(W)` / `0.4W` crossing (≈488K at the current constants) a 0.4 trigger
		// sits under the knee, so "auto can start past it" is false in a reachable band (checked at W=450K:
		// knee 303500, 0.4 trigger 180000). It must not mention the safety margin either: that term did
		// not bind here, and naming it would misattribute the refusal.
		const knee = qualityLimit(contextWindow);
		// Naming `keep` is only honest when `keep` can actually clear the knee: `floor − keep − MIN` is the
		// envelope, so `keep` helps iff `knee − envelope − MIN > 0`. In the envelope-driven case no `keep`
		// value clears it, and naming one would be the same dead-lever defect the baseline wording had.
		const envelope = floor - config.handoffKeepTokens - MIN_SUMMARIZE_TOKENS;
		const keepClears = knee - envelope - MIN_SUMMARIZE_TOKENS > 0;
		const lever = envelope > 0
			? keepClears
				? `lower \`keep\` (the ${envelope}-token envelope the harness reports is not a setting, and the window is the wrong lever — raising it lowers the knee)`
				: `no \`keep\` value clears this: the ${envelope}-token envelope the harness reports is not a setting, and the window is the wrong lever (raising it lowers the knee)`
			: "lower `keep` (the window is the wrong lever — raising it lowers the knee)";
		return `threshold unavailable: not the window — the ${usable} usable tokens clear the ${floor}-token floor, but the model's quality knee allows only ${knee} at this window, so a handoff could only start past the knee; ${lever}, or make the trigger explicit with a fixed ratio — /handoff threshold 0.4 is not checked against the knee, which is what blocks auto here`;
	}
	if (reason === "summarizer-floor") {
		return `threshold unavailable: the window is not the limit — the ${usable} usable tokens clear the ${floor}-token floor, but the ${SAFETY_MARGIN_TOKENS}-token safety margin leaves a summary that would replace fewer than the ${MIN_SUMMARIZE_TOKENS}-token minimum; a larger context window (or a smaller keep) is the lever, not this window alone`;
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
	/** Envelope the harness reports on the total's basis; 0 when it reports none (see `ContextMeasurement`). */
	overhead: number;
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
	measurement: ContextMeasurement,
	contextWindow: number,
): HandoffRoom | undefined {
	const overhead = Math.max(0, measurement.overheadTokens ?? 0);
	const keep = config.handoffKeepTokens;
	// One definition of the floor, shared with the receipt's `thresholdRefusalText`: a rule written twice
	// is this repo's documented recurring root cause, and the two copies had already drifted once.
	const floor = thresholdFloor(config, measurement);
	const usable = contextWindow - WINDOW_RESERVE_TOKENS;
	if (usable <= floor) return undefined;
	return { overhead, keep, floor, usable };
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
 * hand (`/handoff budget summary`, or a fixed `/handoff threshold 0.4` ratio) — and the guardrail owns
 * the trigger. A manual setting the guardrail cannot honour must therefore be **named**, not silently
 * ignored: a user who raises `/handoff budget summary` and sees nothing change has been sent to a control
 * that does nothing.
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
	measurement: ContextMeasurement,
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
	const asked = room.overhead + room.keep + config.handoffTargetTokens;
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
	return `handoff budget summary ${config.handoffTargetTokens} is not applied in full: it needs a ${override.asked}-token threshold and ${guardrail}, so the auto guardrail decides — lower /handoff budget summary, or use /handoff threshold 0.4 for a fixed ratio`;
}
