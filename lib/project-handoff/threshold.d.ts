/**
 * The trigger point: how much context may accumulate before a handoff, and the honest
 * account of it when a guardrail overrides a manually configured value.
 *
 * Two terms only — `min(quality(window), capacity(room))` — plus the two modes
 * (adaptive / fixed ratio) and the `override` report `/handoff status` renders.
 */
import { type PluginConfig } from "../shared/config.js";
import { type HandoffLanguage } from "./language.js";
/** Don't hand off unless at least this much context is actually dropped. */
export declare const MIN_DROP_TOKENS = 8000;
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
 * Why {@link resolveThreshold} returned `undefined`, named as the term that actually binds.
 *
 * `resolveThreshold` has five `undefined` exits with five different causes, and the receipt used to
 * render every one of them as "threshold unavailable at this window" — a claim about the window that
 * is *false* for four of the five. A roomy window (`usable > floor`) still refuses when the drop
 * minimum, the reported envelope + carried tail, the second 4K
 * {@link SAFETY_MARGIN_TOKENS} deduction, the **quality knee**, or fixed mode's own floor is what
 * decided it, and "at this window" sends the user to change the model or the target when neither is
 * the lever.
 *
 * The knee and the margin want *opposite* levers, which is why they cannot share a cause: a larger
 * window raises the capacity deduction's headroom but lowers the knee, so advice written for one is
 * actively backwards for the other. Fixed mode's two causes want opposite levers from each other too:
 * at `tokens <= 0` only a larger window helps, while a positive trigger under the floor is cleared by
 * raising the ratio or lowering the carried tail.
 */
export type ThresholdRefusal = "window-headroom" | "quality-knee" | "drop-floor" | "no-positive-threshold" | "fixed-below-floor";
/**
 * The refusal cause behind `resolveThreshold(...) === undefined`, or `undefined` when the threshold
 * resolves. Read-only companion: it replays the same terms, in the same order, and only reports a
 * cause when `resolveThreshold` really is `undefined`, so the diagnosis cannot drift from the formula.
 */
export declare function thresholdRefusal(config: PluginConfig, measurement: ContextMeasurement, contextWindow: number): ThresholdRefusal | undefined;
/**
 * The refusal sentence for the `/handoff status` receipt, in the handoff's own language. Each cause is
 * phrased as the comparison that failed, so the receipt cannot misattribute one refusal to another.
 *
 * `resolveHandoffLanguage` already picks one language per handoff for `HANDOFF.md`, and the receipt
 * explains the same decision, so it follows that language rather than leaving a Chinese session with
 * an English account of why nothing started. The setting is named by the settings card's label
 * ({@link HANDOFF_BUDGET_RECENT_LABEL}) — `keep` is not a name the user can see anywhere.
 */
export declare function thresholdRefusalText(reason: ThresholdRefusal, config: PluginConfig, measurement: ContextMeasurement, contextWindow: number, language: HandoffLanguage): string;
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
export declare function qualityLimit(contextWindow: number, autoCompactTokenLimit?: number): number;
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
 * base and the capacity cap has the last word. The manually-set `handoffBudgetSummaryTokens` deliberately does
 * not appear — a local preference must not lift the trigger above the honest quality knee, because
 * distrusting a declared window is the entire purpose of the curve. pi's `max(boundary, targetValue)`
 * does lift it (`handoff.ts:785` upstream), and dsh's earlier `min(configured, knee)` was the same
 * defect wearing the opposite sign: both let the local key decide a term that the quality layer owns.
 *
 * Not appearing is not the same as being ignored: the target is the user's statement of how much older
 * context is worth dropping, so when the guardrail lands below the threshold that would need, the
 * returned {@link ThresholdOverride} says so and `/handoff status` warns. The physical "worthwhile
 * drop" floor stays enforced by ①: a threshold below it refuses, it does not clamp.
 */
export declare function resolveThreshold(config: PluginConfig, measurement: ContextMeasurement, contextWindow: number): {
    tokens: number;
    label: string;
    override?: ThresholdOverride;
} | undefined;
/**
 * The `/handoff status` warning for a manual threshold the guardrail overrode. Both numbers and the
 * lever are named, so the receipt cannot send the user back to the same ineffective control.
 */
export declare function thresholdOverrideText(override: ThresholdOverride, config: PluginConfig, contextWindow: number): string;
