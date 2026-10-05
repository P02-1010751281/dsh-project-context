/**
 * The `/handoff` surface: argument parsing, the `/handoff status` receipt and the manual
 * handoff the bare command and `now` share.
 */
import {} from "@deepseek-ai/cordis";
import {} from "@deepseek-ai/dsh-session";
import {} from "../shared/config.js";
import { SETTINGS_NAMESPACE, effectivePluginConfig } from "../shared/settings.js";
import { HANDOFF_BUDGET_RECENT_LABEL } from "../shared/setting-labels.js";
import { pendingSubagentWork } from "./guard.js";
import { HandoffDeferred, handoffFailureIsTransient } from "./classify.js";
import { resolveHandoffLanguage, sessionLanguageMessages } from "./conversation.js";
import { performHandoff } from "./perform.js";
import { measuredContext, resolveTarget } from "./runtime.js";
import { handedOff, inFlight, pendingTriggerSeq, skippedSince } from "./state.js";
import { resolveThreshold, thresholdOverrideText, thresholdRefusal, thresholdRefusalText } from "./threshold.js";
/** Parse "0.4", "40%", or "40" into a ratio. Exported for tests. */
export function parseRatio(input) {
    const text = input.trim().toLowerCase().replace(/%$/, "");
    const value = Number(text);
    if (!Number.isFinite(value))
        return undefined;
    const ratio = value > 1 ? value / 100 : value;
    // Same inclusive bounds as the settings schema, so accepted input always persists.
    return ratio >= 0.1 && ratio <= 0.95 ? ratio : undefined;
}
/** Parse "12k", "12000", or "0" into a token count. Exported for tests. */
export function parseTokenCount(input) {
    const match = /^(\d+(?:\.\d+)?)(k)?$/.exec(input.trim().toLowerCase());
    if (!match)
        return undefined;
    const value = Number(match[1]) * (match[2] ? 1_000 : 1);
    return Number.isFinite(value) ? Math.round(value) : undefined;
}
/** Map one command argument to a settings patch. */
/** Exported for tests: the settings patch `/handoff <args>` produces, if any. */
export function settingPatch(args) {
    if (args === "on")
        return { patch: { handoffEnabled: true } };
    if (args === "off")
        return { patch: { handoffEnabled: false } };
    const thinking = /^thinking\s+(off|session)$/.exec(args);
    if (thinking)
        return { patch: { handoffThinking: thinking[1] } };
    const pending = /^pending\s+(defer|wait)$/.exec(args);
    if (pending)
        return { patch: { handoffPendingQuestion: pending[1] } };
    const language = /^lang\s+(auto|zh|en)$/.exec(args);
    if (language)
        return { patch: { handoffLang: language[1] } };
    // One name for the fact "how the threshold is decided": `threshold auto`, or a ratio. The bare
    // ratio and the bare `auto` are retired rather than aliased — a second spelling is what let the two
    // drift apart, and an old spelling must not act.
    const threshold = /^threshold\s+(\S+)$/.exec(args);
    if (threshold) {
        if (threshold[1] === "auto")
            return { patch: { handoffThresholdAuto: true } };
        const ratio = parseRatio(threshold[1]);
        if (ratio === undefined)
            return { error: "threshold needs auto or a ratio between 0.1 and 0.95 (e.g. threshold 0.4)" };
        return { patch: { handoffThresholdAuto: false, handoffThresholdRatio: ratio } };
    }
    // `budget summary|recent`, because the two amounts size different things and `target`/`keep` did not
    // say which was which: `summary` is what each summary asks for, `recent` is what is carried
    // verbatim. The bounds do not move — only the names do.
    const budget = /^budget\s+(summary|recent)\s+(\S+)$/.exec(args);
    if (budget) {
        const tokens = parseTokenCount(budget[2]);
        if (budget[1] === "summary") {
            if (tokens === undefined || tokens < 8_000 || tokens > 200_000)
                return { error: "budget summary needs 8000–200000 tokens (e.g. budget summary 64k)" };
            return { patch: { handoffBudgetSummaryTokens: tokens } };
        }
        if (tokens === undefined || tokens > 200_000)
            return { error: "budget recent needs 0–200000 tokens (e.g. budget recent 20k, budget recent 0)" };
        return { patch: { handoffBudgetRecentTokens: tokens } };
    }
    // A verb used without its argument names its own sub-verbs rather than falling through to the whole
    // usage line, so the receipt says which spelling is missing.
    if (/^budget\b/.test(args))
        return { error: "budget needs summary or recent: budget summary <tokens> | budget recent <tokens>" };
    if (/^threshold\b/.test(args))
        return { error: "threshold needs auto or a ratio between 0.1 and 0.95 (e.g. threshold 0.4)" };
    return undefined;
}
export const USAGE = "Usage: /handoff [status|now|on|off|threshold auto|<ratio>|budget summary <tokens>|budget recent <tokens>|thinking off|session|pending defer|wait|lang auto|zh|en]";
/** Persist one settings patch through the mounted settings service. */
export async function writeSetting(ctx, patch) {
    const settings = ctx.get("settings");
    if (settings === undefined)
        return "the settings service is unavailable in this profile; edit the plugin config instead";
    try {
        await settings.update(SETTINGS_NAMESPACE, patch);
        return undefined;
    }
    catch (error) {
        return `settings update failed: ${error instanceof Error ? error.message : String(error)}`;
    }
}
/** Human-readable handoff state for the current session. */
/**
 * The `/handoff status` receipt. Exported so a test can read the skip report without going through
 * the command registration.
 */
export async function statusText(ctx, session, entry, signal) {
    const config = effectivePluginConfig(entry);
    // Resolved once and early: the threshold refusal below is written in this language, and it must be
    // the same one `HANDOFF.md` would use for this handoff.
    const language = resolveHandoffLanguage(sessionLanguageMessages(session), config);
    const parts = [`Auto handoff ${config.handoffEnabled ? "ON" : "OFF"}`];
    const target = resolveTarget(session, config);
    const meter = ctx.get("tokenMeter");
    const projections = ctx.get("sessionProjections");
    if (target !== undefined && meter !== undefined) {
        const resolved = await ctx.llm.resolveModelInfo(target.provider, target.model, signal);
        const contextWindow = resolved.context?.contextWindow;
        if (contextWindow !== undefined && contextWindow > 0) {
            // Same envelope the automatic path uses, so the receipt cannot explain a decision the trigger
            // did not make.
            const measurement = measuredContext(meter, projections, session);
            const percent = Math.round((measurement.totalTokens / contextWindow) * 100);
            parts.push(`context ${measurement.totalTokens}/${contextWindow} (${percent}%)`);
            // The envelope is an *input* to the trigger, and the trigger alone cannot show whether it
            // arrived: a 1M window with a small `keep` puts the knee above the floor either way, so the
            // same `threshold auto <n>` renders when the floor carries the envelope and when it falls back
            // to `keep + MIN`. Without this line "the harness projection parsed" is unfalsifiable from the
            // receipt — and it is the harness's composition, so a meter-supplied one is named as such.
            parts.push(measurement.envelopeSource === "projection"
                ? `harness envelope ${measurement.overheadTokens ?? 0}`
                : measurement.envelopeSource === "meter"
                    ? `meter envelope ${measurement.overheadTokens ?? 0} — not the harness composition`
                    : "harness envelope unavailable — no contextBreakdown projection");
            const threshold = resolveThreshold(config, measurement, contextWindow);
            // Never render every refusal as a claim about the window: `thresholdRefusal` names the
            // comparison that actually failed, and the two are derived from the same terms. It can
            // only return `undefined` here if `resolveThreshold` resolved, which this branch excludes.
            const refusal = threshold === undefined ? thresholdRefusal(config, measurement, contextWindow) : undefined;
            parts.push(threshold !== undefined
                ? `threshold ${threshold.label}`
                : refusal !== undefined
                    ? thresholdRefusalText(refusal, config, measurement, contextWindow, language)
                    // Unreachable: `thresholdRefusal` is total over `resolveThreshold`'s refusals. Say the
                    // honest minimum rather than inventing a cause if the two ever diverge.
                    : "threshold unavailable");
            // The threshold has two sources — the guardrail and the manual setting — and when the
            // guardrail overrides the manual one the receipt must say so, or the user keeps turning a
            // knob that cannot move the number above.
            if (threshold?.override !== undefined)
                parts.push(thresholdOverrideText(threshold.override, config, contextWindow));
        }
    }
    parts.push(config.handoffThresholdAuto ? `adaptive target ${config.handoffBudgetSummaryTokens}` : `fixed ratio ${config.handoffThresholdRatio}`);
    // The setting's name is the settings card's, in the receipt's own language — `keep` is an internal
    // shorthand that appears nowhere the user can see it.
    parts.push(config.handoffBudgetRecentTokens > 0
        ? (language === "zh"
            ? `「${HANDOFF_BUDGET_RECENT_LABEL.zh}」 ~${config.handoffBudgetRecentTokens}`
            : `"${HANDOFF_BUDGET_RECENT_LABEL.en}" ~${config.handoffBudgetRecentTokens}`)
        : (language === "zh" ? "0（不逐字带入对话尾料）" : "0 (no verbatim conversation tail)"));
    parts.push(`summary thinking ${config.handoffThinking}`);
    parts.push(`pending question ${config.handoffPendingQuestion}`);
    parts.push(config.handoffLang === "auto" ? `lang auto (${language})` : `lang ${language}`);
    // The automatic path skips this session while the conversation fits the recent window; without
    // this line the only trace is a rate-limited server log the user cannot see.
    const skippedAt = skippedSince.get(String(session.id));
    if (skippedAt !== undefined) {
        const at = new Date(skippedAt).toISOString();
        parts.push(language === "zh"
            ? `自 ${at} 起自动跳过 —— 全部对话都在「${HANDOFF_BUDGET_RECENT_LABEL.zh}」（~${config.handoffBudgetRecentTokens} token）之内，没有更早的内容可摘要`
            : `auto skipped since ${at} — everything is inside "${HANDOFF_BUDGET_RECENT_LABEL.en}" (~${config.handoffBudgetRecentTokens} tokens), so nothing older is left to summarize`);
    }
    if (handedOff.has(String(session.id)))
        parts.push("already handed off in this process");
    return parts.join(" · ");
}
/**
 * Manual handoff shared by the bare command and `now`. Exported so a test can drive the whole reply
 * path (an empty span must come back as an error reply, not as a fabricated child).
 */
export async function runManual(ctx, session, entry, signal) {
    const key = String(session.id);
    if (inFlight.has(key))
        return { kind: "error", text: "A handoff is already running for this session." };
    const config = effectivePluginConfig(entry);
    const target = resolveTarget(session, config);
    if (!target)
        return { kind: "error", text: "No routed model available for the handoff summary; send one message first." };
    const controller = ctx.get("sessionController");
    if (!controller) {
        return { kind: "error", text: "The session controller is unavailable in this profile; handoff needs the web/API session runtime." };
    }
    // A handoff forks and then retires the session it replaced, and that retirement cancels every
    // running subagent descendant of it (`workspace/session-stop`): a teammate mid-task would lose its
    // work with nothing to show for it. The automatic path defers for the same reason. The manual path
    // is the user's explicit request, so it **refuses by name** and names the lever instead of quietly
    // destroying the work — the one reply that cannot be undone is the one that must not be silent.
    const pending = await pendingSubagentWork(ctx, session);
    if (pending.length > 0) {
        const named = pending.slice(0, 3).join(", ");
        const more = pending.length > 3 ? `, +${pending.length - 3} more` : "";
        return {
            kind: "error",
            text: `Handoff refused: ${pending.length} background subagent(s) still running (${named}${more}). Handing off would retire this session and cancel them, losing their work — stop them first (\`interrupt_agent\` for a teammate) or run /handoff again once they settle.`,
        };
    }
    inFlight.add(key);
    try {
        const resolved = await ctx.llm.resolveModelInfo(target.provider, target.model, signal);
        const result = await performHandoff(ctx, session, target, config, resolved, "manual", signal);
        return { kind: "success", text: `Handoff session created: ${result.childId}\nHandoff document: ${result.file}` };
    }
    catch (error) {
        // A retryable cause must not be reported with the terminal wording: "Handoff failed" tells
        // the user the operation is over, when the recovery is to run `/handoff now` again. The
        // deferral and the transient classes are both non-terminal; everything else stays "failed".
        if (error instanceof HandoffDeferred) {
            return { kind: "error", text: `Handoff deferred: ${error.message}. Nothing was handed off — the session is still working, so run /handoff now again once it settles.` };
        }
        if (handoffFailureIsTransient(error)) {
            const message = error instanceof Error ? error.message : String(error);
            return { kind: "error", text: `Handoff deferred (temporarily failed, safe to retry): ${message}. Nothing was handed off; run /handoff now again.` };
        }
        return { kind: "error", text: `Handoff failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    finally {
        inFlight.delete(key);
        // A `turn/end` recorded while this manual attempt held the session belongs to the automatic
        // path, which never got to consume it; drop it rather than leaving it to fire much later.
        pendingTriggerSeq.delete(key);
    }
}
