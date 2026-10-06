/**
 * The trigger point: how much context may accumulate before a handoff, and the honest
 * account of it when a guardrail overrides a manually configured value.
 *
 * Two terms only — `min(quality(window), capacity(room))` — plus the two modes
 * (adaptive / fixed ratio) and the `override` report `/handoff status` renders.
 */
import {} from "../shared/config.js";
import { MAX_THRESHOLD_RATIO, MIN_THRESHOLD_RATIO } from "../shared/limits.js";
import { HANDOFF_BUDGET_RECENT_LABEL } from "../shared/setting-labels.js";
import {} from "./language.js";
// Threshold math, ported from pi's auto-handoff.
/** Don't hand off unless at least this much context is actually dropped. */
export const MIN_DROP_TOKENS = 8_000;
/** Window headroom left for the next request (pi's default compaction reserve). */
const WINDOW_RESERVE_TOKENS = 16_384;
/** Stay this far below the usable window so streaming growth cannot cross it. */
const SAFETY_MARGIN_TOKENS = 4_000;
/**
 * The smallest trigger that still drops a worthwhile prefix: the carried tail plus the drop minimum,
 * plus the envelope when the harness reports one.
 *
 * It deliberately does **not** derive the envelope as `totalTokens − surfaceTokens`. That difference is
 * `overhead + (real surface − heuristic surface)`: for a CJK-heavy conversation the density heuristic
 * undercounts the surface by roughly 2×, and the whole shortfall lands in the difference. A real
 * session measured `495117 − 231793 = 263324` where the envelope was `42845`, so the floor became
 * `263324 + keep + 8000 = 271324` — above the `157000` knee at a 1M window — and `resolveThreshold`
 * refused **permanently**, with a receipt that blamed the knee. The knee was never the cause.
 */
function thresholdFloor(config, measurement) {
    const overhead = measurement.overheadTokens ?? 0;
    return Math.max(0, overhead) + config.handoffBudgetRecentTokens + MIN_DROP_TOKENS;
}
/**
 * Fixed mode's trigger before the floor gate: `min(round(W × ratio), W − SAFETY_MARGIN)`.
 *
 * One definition for the three readers — {@link resolveThreshold} computes it, {@link thresholdRefusal}
 * compares it against the floor, and {@link thresholdRefusalText} quotes it — because the small-window
 * clamp is exactly the kind of rule this repo has twice let two copies drift apart.
 */
function fixedThreshold(config, contextWindow) {
    return Math.min(Math.round(contextWindow * config.handoffThresholdRatio), contextWindow - SAFETY_MARGIN_TOKENS);
}
/**
 * The `/handoff threshold <r>` control a receipt may name, or `undefined` when no legal ratio clears
 * this window's physical floor.
 *
 * A receipt must not recommend a control that does nothing. Two of them used to end with a written-down
 * `/handoff threshold 0.4`, which batch K's floor gate now refuses in reachable windows (a 200K envelope
 * at a 1M window needs ≥ 0.23, and the default 65_536-token window needs ≥ 0.43). The recommendation is
 * therefore computed from the same floor the decision uses, and withheld when the floor is out of every
 * ratio's reach.
 *
 * `min(round(r × W), W − SAFETY_MARGIN) ≥ floor` needs *both* terms: `W − SAFETY_MARGIN ≥ floor` (the cap
 * cannot lift a trigger) and `r ≥ floor / W`. Two decimals is what `/handoff threshold` accepts, so the
 * rounded-up value is verified against the real arithmetic rather than trusted.
 */
function fixedRatioAdvice(config, measurement, contextWindow) {
    const floor = thresholdFloor(config, measurement);
    if (contextWindow - SAFETY_MARGIN_TOKENS < floor)
        return undefined;
    const needed = Math.max(MIN_THRESHOLD_RATIO, Math.ceil((floor / contextWindow) * 100) / 100);
    if (needed > MAX_THRESHOLD_RATIO)
        return undefined;
    return fixedThreshold({ ...config, handoffThresholdRatio: needed }, contextWindow) >= floor ? needed : undefined;
}
/**
 * The refusal cause behind `resolveThreshold(...) === undefined`, or `undefined` when the threshold
 * resolves. Read-only companion: it replays the same terms, in the same order, and only reports a
 * cause when `resolveThreshold` really is `undefined`, so the diagnosis cannot drift from the formula.
 */
export function thresholdRefusal(config, measurement, contextWindow) {
    if (resolveThreshold(config, measurement, contextWindow) !== undefined)
        return undefined;
    if (!config.handoffThresholdAuto) {
        // Two fixed-mode refusals, named apart because the levers are different: a trigger that rounds out
        // (where no legal ratio could help, because `W − SAFETY_MARGIN <= 0` already decides it) and a
        // positive trigger under the physical floor (where raising the ratio is the first lever).
        return fixedThreshold(config, contextWindow) <= 0 ? "no-positive-threshold" : "fixed-below-floor";
    }
    // Reuse the orchestrator's own feasibility helper rather than re-deriving its terms: the two can
    // then only disagree if the *composition* changes, and the clamp is the only remaining refusal.
    const room = handoffRoom(config, measurement, contextWindow);
    if (room === undefined)
        return "window-headroom";
    // Both terms of the two-term rule can sit below the floor, and they want opposite levers. Compare
    // them exactly as the orchestrator does. Before the trigger became two terms the target lift kept
    // the knee path unreachable, so the whole case used to render as "drop-floor" — with "a larger
    // context window" as the advice, which is backwards when the knee is what bound.
    return qualityLimit(contextWindow) <= capacityLimit(room) ? "quality-knee" : "drop-floor";
}
/**
 * The refusal sentence for the `/handoff status` receipt, in the handoff's own language. Each cause is
 * phrased as the comparison that failed, so the receipt cannot misattribute one refusal to another.
 *
 * `resolveHandoffLanguage` already picks one language per handoff for `HANDOFF.md`, and the receipt
 * explains the same decision, so it follows that language rather than leaving a Chinese session with
 * an English account of why nothing started. The setting is named by the settings card's label
 * ({@link HANDOFF_BUDGET_RECENT_LABEL}) — `keep` is not a name the user can see anywhere.
 */
export function thresholdRefusalText(reason, config, measurement, contextWindow, language) {
    const zh = language === "zh";
    const label = HANDOFF_BUDGET_RECENT_LABEL[language];
    const floor = thresholdFloor(config, measurement);
    const usable = contextWindow - WINDOW_RESERVE_TOKENS;
    if (reason === "window-headroom") {
        // `usable` reaches zero (and goes negative) once the window is at or under the request
        // reserve; quoting "-8192 usable tokens" reads as nonsense, and "exceeds the window by 0"
        // contradicts itself, so each side of zero gets its own phrasing.
        const room = usable > 0
            ? zh
                ? `扣掉 ${WINDOW_RESERVE_TOKENS} token 的请求预留后可用 ${usable} token`
                : `${usable} usable token${usable === 1 ? "" : "s"} after the ${WINDOW_RESERVE_TOKENS}-token request reserve`
            : usable === 0
                ? zh
                    ? `没有任何可用 token —— ${WINDOW_RESERVE_TOKENS} token 的请求预留吃掉了整个 ${contextWindow} token 的窗口`
                    : `no usable tokens at all — the ${WINDOW_RESERVE_TOKENS}-token request reserve consumes the entire ${contextWindow}-token window`
                : zh
                    ? `没有任何可用 token —— ${WINDOW_RESERVE_TOKENS} token 的请求预留比 ${contextWindow} token 的窗口还多 ${-usable}`
                    : `no usable tokens at all — the ${WINDOW_RESERVE_TOKENS}-token request reserve exceeds the ${contextWindow}-token window by ${-usable}`;
        const envelope = floor - config.handoffBudgetRecentTokens - MIN_DROP_TOKENS;
        // The envelope term exists only when the harness reports one; printing "0-token envelope" would
        // invent a term that took no part in the comparison.
        const assembly = envelope > 0
            ? zh
                ? `harness 报出的 ${envelope} token 包络 + 「${label}」 ${config.handoffBudgetRecentTokens} + 丢弃下限 ${MIN_DROP_TOKENS}`
                : `the ${envelope}-token envelope the harness reports + "${label}" ${config.handoffBudgetRecentTokens} + drop minimum ${MIN_DROP_TOKENS}`
            : zh
                ? `「${label}」 ${config.handoffBudgetRecentTokens} + 摘要下限 ${MIN_DROP_TOKENS}`
                : `"${label}" ${config.handoffBudgetRecentTokens} + summarize minimum ${MIN_DROP_TOKENS}`;
        return zh
            ? `阈值不可用：窗口太小 —— ${contextWindow} token 的窗口只剩 ${room}，低于 ${floor} token 的下限（${assembly}）`
            : `threshold unavailable: window too small — the ${contextWindow}-token window leaves ${room}, below the ${floor}-token floor (${assembly})`;
    }
    if (reason === "quality-knee") {
        // "A larger window" is the lever for the margin case and the *opposite* of the lever here: the
        // curve approaches its 157K asymptote from above, so a wider window lowers the knee. Say which
        // control actually helps rather than reusing the margin sentence.
        //
        // The floor's terms are the harness-reported envelope, the kept tail and the drop minimum.
        // Only `handoffBudgetRecentTokens` is a config key, and it reaches this refusal on its own **today**: it
        // is bounded at 200_000 (`config.ts`), so at a 1M window `keep >= 149_001` puts the floor past the
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
        // Naming the kept-tail setting is only honest when it can actually clear the knee: `floor − keep −
        // MIN` is the envelope, so the setting helps iff `knee − envelope − MIN > 0`. In the
        // envelope-driven case no value of it clears the refusal, and naming one would be the same
        // dead-lever defect the baseline wording had.
        const envelope = floor - config.handoffBudgetRecentTokens - MIN_DROP_TOKENS;
        const keepClears = knee - envelope - MIN_DROP_TOKENS > 0;
        const lever = envelope > 0
            ? keepClears
                ? zh
                    ? `调小「${label}」（harness 报出的 ${envelope} token 包络不是设置项，而窗口是反方向的杠杆 —— 窗口越大膝越低）`
                    : `lower "${label}" (the ${envelope}-token envelope the harness reports is not a setting, and the window is the wrong lever — raising it lowers the knee)`
                : zh
                    ? `没有任何「${label}」取值能清掉它：harness 报出的 ${envelope} token 包络不是设置项，而窗口是反方向的杠杆（窗口越大膝越低）`
                    : `no "${label}" value clears this: the ${envelope}-token envelope the harness reports is not a setting, and the window is the wrong lever (raising it lowers the knee)`
            : zh
                ? `调小「${label}」（窗口是反方向的杠杆 —— 窗口越大膝越低）`
                : `lower "${label}" (the window is the wrong lever — raising it lowers the knee)`;
        // The ratio is a real escape from the knee, but not at a written-down value: the floor gate refuses
        // a small one, so the receipt names the smallest ratio that clears *this* floor, or says plainly
        // that the route is closed rather than sending the user to a control that now does nothing.
        const advice = fixedRatioAdvice(config, measurement, contextWindow);
        const ratioPart = advice === undefined
            ? zh
                ? "这个窗口下固定比例这条路也不通 —— 没有任何合法比例能清掉下限"
                : "a fixed ratio is closed here too — no legal ratio clears the floor at this window"
            : zh
                ? `或者用固定比例把触发显式化 —— /handoff threshold ${advice} 不经过膝检，而正是膝检挡住了自动档`
                : `or make the trigger explicit with a fixed ratio — /handoff threshold ${advice} is not checked against the knee, which is what blocks auto here`;
        return zh
            ? `阈值不可用：不是窗口的问题 —— 可用 ${usable} token 已越过 ${floor} token 的下限，但这个窗口下模型的质量膝只允许 ${knee}，交接最早也只能在膝之后启动；${lever}，${ratioPart}`
            : `threshold unavailable: not the window — the ${usable} usable tokens clear the ${floor}-token floor, but the model's quality knee allows only ${knee} at this window, so a handoff could only start past the knee; ${lever}, ${ratioPart}`;
    }
    if (reason === "drop-floor") {
        return zh
            ? `阈值不可用：窗口不是限制 —— 可用 ${usable} token 已越过 ${floor} token 的下限，但 ${SAFETY_MARGIN_TOKENS} token 的安全余量会让可丢弃的内容少于 ${MIN_DROP_TOKENS} token 的下限；杠杆是更大的上下文窗口（或调小「${label}」），而不是这个窗口本身`
            : `threshold unavailable: the window is not the limit — the ${usable} usable tokens clear the ${floor}-token floor, but the ${SAFETY_MARGIN_TOKENS}-token safety margin leaves less than the ${MIN_DROP_TOKENS}-token minimum worth dropping; a larger context window (or lowering "${label}") is the lever, not this window alone`;
    }
    if (reason === "fixed-below-floor") {
        // The floor binds, not the window: name both numbers and a lever that works with them. The ratio is
        // named at a value that really clears this floor, or the sentence says the route is closed — "raise
        // the threshold" with no number is still a lever the user has to guess at.
        const asked = Math.round(contextWindow * config.handoffThresholdRatio);
        const shown = fixedThreshold(config, contextWindow);
        const percent = Math.round(config.handoffThresholdRatio * 100);
        const ratio = fixedRatioAdvice(config, measurement, contextWindow);
        const lever = ratio === undefined
            ? zh
                ? `调小「${label}」—— 这个窗口下任何合法比例都清不掉下限`
                : `lower "${label}" — no legal ratio clears the floor at this window`
            : zh
                ? `调大比例（/handoff threshold ${ratio}）或调小「${label}」`
                : `raise the ratio (/handoff threshold ${ratio}) or lower "${label}"`;
        // The safety-margin clamp can be what produced `shown`; quoting it under the percentage without
        // saying so would credit the ratio with a number it does not yield.
        const capped = shown < asked
            ? zh
                ? `（${SAFETY_MARGIN_TOKENS} token 的安全余量把它从 ${asked} 压到 ${shown}）`
                : ` (the ${SAFETY_MARGIN_TOKENS}-token safety margin caps ${asked})`
            : "";
        return zh
            ? `阈值不可用：固定 ${percent}% 的 ${shown} token 触发器${capped}低于这个基线下的 ${floor} token 下限（丢弃不足 ${MIN_DROP_TOKENS} token 换不来上下文，只是换个会话）；${lever}`
            : `threshold unavailable: the fixed ${percent}% trigger of ${shown} tokens${capped} is below the ${floor}-token floor a worthwhile handoff needs at this baseline (a drop under ${MIN_DROP_TOKENS} tokens only switches sessions); ${lever}`;
    }
    // `no-positive-threshold`: `min(round(W × ratio), W − SAFETY_MARGIN) ≤ 0`. Because the ratio is
    // validated into [MIN_THRESHOLD_RATIO, MAX_THRESHOLD_RATIO], the second term binds first and the
    // condition reduces to `W ≤ SAFETY_MARGIN`: raising the ratio can never clear *this* one, so naming it
    // would send the user to a lever that does nothing. A positive trigger under the floor is the separate
    // `fixed-below-floor` cause above, where the ratio *is* the first lever.
    return zh
        ? `阈值不可用：${contextWindow} token 的窗口没有超过 ${SAFETY_MARGIN_TOKENS} token 的安全余量，所以固定 ${config.handoffThresholdRatio} 这一比例算不出正阈值；这里唯一的杠杆是更大的窗口（比例帮不上忙）`
        : `threshold unavailable: the ${contextWindow}-token window does not exceed the ${SAFETY_MARGIN_TOKENS}-token safety margin, so a fixed ${config.handoffThresholdRatio} ratio resolves to no positive threshold; a larger window is the only lever here (the ratio cannot help)`;
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
function kneeTokens(window) {
    const z = Math.log(window / KNEE_TRANSITION_TOKENS) / KNEE_TRANSITION_STEEPNESS;
    return Math.round(window - (window - KNEE_ASYMPTOTE_TOKENS) / (1 + Math.exp(-z)));
}
/**
 * ① Feasibility only: is there room for a handoff at all? This answers "can we hand off", not "at
 * what threshold" — `undefined` here is a refusal before any value is computed.
 */
function handoffRoom(config, measurement, contextWindow) {
    const overhead = Math.max(0, measurement.overheadTokens ?? 0);
    const keep = config.handoffBudgetRecentTokens;
    // One definition of the floor, shared with the receipt's `thresholdRefusalText`: a rule written twice
    // is this repo's documented recurring root cause, and the two copies had already drifted once.
    const floor = thresholdFloor(config, measurement);
    const usable = contextWindow - WINDOW_RESERVE_TOKENS;
    if (usable <= floor)
        return undefined;
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
export function qualityLimit(contextWindow, autoCompactTokenLimit) {
    return autoCompactTokenLimit ?? kneeTokens(contextWindow);
}
/**
 * ③ Capacity only: the last word. A trigger may not sit past the safe use of the window, whatever the
 * quality layer asked for.
 */
function capacityLimit(room) {
    return room.usable - SAFETY_MARGIN_TOKENS;
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
export function resolveThreshold(config, measurement, contextWindow) {
    if (!config.handoffThresholdAuto) {
        // Fixed mode: the manual setting *is* the trigger, so the ratio alone decides where it sits — but
        // the two guardrails the adaptive branch owns still apply. The safety margin clamps it (clamping
        // `0.95` on a small window is real: 65_536 → 61_536, and the label alone would keep claiming the
        // full ratio), and the physical floor below refuses it outright.
        const asked = Math.round(contextWindow * config.handoffThresholdRatio);
        const tokens = fixedThreshold(config, contextWindow);
        if (tokens <= 0)
            return undefined;
        // The physical floor is a **refusal gate** in fixed mode too, not a lift: below it a handoff would
        // drop less than `MIN_DROP_TOKENS`, replacing the session without buying context. It needs no
        // model — only the measured envelope and the carried-tail setting — so both modes agree on what
        // counts as worthwhile. The threshold itself still comes from the ratio alone.
        if (tokens < thresholdFloor(config, measurement))
            return undefined;
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
    if (room === undefined)
        return undefined;
    // Two terms only: the quality base, then the capacity ban. No configured key on this line.
    const quality = qualityLimit(contextWindow);
    const capacity = capacityLimit(room);
    const tokens = Math.min(quality, capacity);
    if (tokens < room.floor)
        return undefined;
    // The threshold the configured target needs for its fold to fit under the trigger. Above the
    // guardrail's value the setting cannot be honoured, and the guardrail that bound it is named.
    const asked = room.overhead + room.keep + config.handoffBudgetSummaryTokens;
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
 *
 * `measurement` is needed for the ratio advice: honoring an overridden `/handoff budget summary` by
 * switching to a fixed ratio only works above the physical floor, and the ratio that clears it depends on
 * the envelope and the carried tail.
 */
export function thresholdOverrideText(override, config, measurement, contextWindow) {
    if (override.setting === "ratio") {
        return `fixed ratio ${Math.round(config.handoffThresholdRatio * 100)}% is not applied in full: it asks for ${override.asked} of this ${contextWindow}-token window and the ${SAFETY_MARGIN_TOKENS}-token safety margin leaves ${override.tokens}; a larger window is the lever`;
    }
    const guardrail = override.by === "quality"
        ? `the model's quality knee allows ${override.tokens} at this window`
        : `only ${override.tokens} tokens fit this ${contextWindow}-token window after the ${WINDOW_RESERVE_TOKENS}-token request reserve and the ${SAFETY_MARGIN_TOKENS}-token safety margin`;
    const ratio = fixedRatioAdvice(config, measurement, contextWindow);
    const escape = ratio === undefined
        ? "no fixed ratio clears the floor at this window either"
        : `use /handoff threshold ${ratio} for a fixed ratio`;
    return `handoff budget summary ${config.handoffBudgetSummaryTokens} is not applied in full: it needs a ${override.asked}-token threshold and ${guardrail}, so the auto guardrail decides — lower /handoff budget summary, or ${escape}`;
}
