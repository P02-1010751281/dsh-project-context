/**
 * The `/handoff` surface: argument parsing, the `/handoff status` receipt and the manual
 * handoff the bare command and `now` share.
 */

import { type Context } from "@deepseek-ai/cordis";
import { type Session } from "@deepseek-ai/dsh-session";
import { type PluginConfig } from "../shared/config.js";
import { SETTINGS_NAMESPACE, effectivePluginConfig } from "../shared/settings.js";
import { pendingSubagentWork } from "./guard.js";
import { resolveLanguage } from "./language.js";
import { HandoffDeferred, handoffFailureIsTransient } from "./classify.js";
import { sessionLanguageMessages } from "./conversation.js";
import { performHandoff } from "./perform.js";
import { type SessionControllerLike, type SettingsLike, type TokenMeterLike, resolveTarget } from "./runtime.js";
import { handedOff, inFlight, pendingTriggerSeq, skippedSince } from "./state.js";
import { resolveThreshold, thresholdOverrideText, thresholdRefusal, thresholdRefusalText } from "./threshold.js";

/** Parse "0.4", "40%", or "40" into a ratio. Exported for tests. */
export function parseRatio(input: string): number | undefined {
	const text = input.trim().toLowerCase().replace(/%$/, "");
	const value = Number(text);
	if (!Number.isFinite(value)) return undefined;
	const ratio = value > 1 ? value / 100 : value;
	// Same inclusive bounds as the settings schema, so accepted input always persists.
	return ratio >= 0.1 && ratio <= 0.95 ? ratio : undefined;
}

/** Parse "12k", "12000", or "0" into a token count. Exported for tests. */
export function parseTokenCount(input: string): number | undefined {
	const match = /^(\d+(?:\.\d+)?)(k)?$/.exec(input.trim().toLowerCase());
	if (!match) return undefined;
	const value = Number(match[1]) * (match[2] ? 1_000 : 1);
	return Number.isFinite(value) ? Math.round(value) : undefined;
}

/** Map one command argument to a settings patch. */
/** Exported for tests: the settings patch `/handoff <args>` produces, if any. */
export function settingPatch(args: string): { patch?: Record<string, unknown>; error?: string } | undefined {
	if (args === "on") return { patch: { handoffEnabled: true } };
	if (args === "off") return { patch: { handoffEnabled: false } };
	if (args === "auto") return { patch: { handoffAdaptive: true } };
	const thinking = /^thinking\s+(off|session)$/.exec(args);
	if (thinking) return { patch: { handoffSummaryThinking: thinking[1] } };
	const pending = /^pending\s+(defer|wait)$/.exec(args);
	if (pending) return { patch: { handoffPendingQuestion: pending[1] } };
	const language = /^lang\s+(auto|zh|en)$/.exec(args);
	if (language) return { patch: { handoffLanguage: language[1] } };
	const target = /^target\s+(\S+)$/.exec(args);
	if (target) {
		const tokens = parseTokenCount(target[1]);
		if (tokens === undefined || tokens < 8_000 || tokens > 200_000) return { error: "target needs 8000–200000 tokens (e.g. target 64k)" };
		return { patch: { handoffTargetTokens: tokens } };
	}
	const keep = /^keep\s+(\S+)$/.exec(args);
	if (keep) {
		const tokens = parseTokenCount(keep[1]);
		if (tokens === undefined || tokens > 200_000) return { error: "keep needs 0–200000 tokens (e.g. keep 20k, keep 0)" };
		return { patch: { handoffKeepTokens: tokens } };
	}
	const ratio = parseRatio(args);
	if (ratio !== undefined) return { patch: { handoffAdaptive: false, handoffThresholdRatio: ratio } };
	return undefined;
}

export const USAGE = "Usage: /handoff [status|now|on|off|auto|<ratio>|target <tokens>|keep <tokens>|thinking off|session|pending defer|wait|lang auto|zh|en]";

/** Persist one settings patch through the mounted settings service. */
export async function writeSetting(ctx: Context, patch: Record<string, unknown>): Promise<string | undefined> {
	const settings = ctx.get("settings") as SettingsLike | undefined;
	if (settings === undefined) return "the settings service is unavailable in this profile; edit the plugin config instead";
	try {
		await settings.update(SETTINGS_NAMESPACE, patch);
		return undefined;
	} catch (error: unknown) {
		return `settings update failed: ${error instanceof Error ? error.message : String(error)}`;
	}
}

/** Human-readable handoff state for the current session. */
/**
 * The `/handoff status` receipt. Exported so a test can read the skip report without going through
 * the command registration.
 */
export async function statusText(ctx: Context, session: Session, entry: PluginConfig, signal: AbortSignal): Promise<string> {
	const config = effectivePluginConfig(entry);
	const parts: string[] = [`Auto handoff ${config.handoffEnabled ? "ON" : "OFF"}`];
	const target = resolveTarget(session, config);
	const meter = ctx.get("tokenMeter") as TokenMeterLike | undefined;
	if (target !== undefined && meter !== undefined) {
		const resolved = await ctx.llm.resolveModelInfo(target.provider, target.model, signal);
		const contextWindow = resolved.context?.contextWindow;
		if (contextWindow !== undefined && contextWindow > 0) {
			const measurement = meter.measure(session);
			const percent = Math.round((measurement.totalTokens / contextWindow) * 100);
			parts.push(`context ${measurement.totalTokens}/${contextWindow} (${percent}%)`);
			const threshold = resolveThreshold(config, measurement, contextWindow);
			// Never render every refusal as a claim about the window: `thresholdRefusal` names the
			// comparison that actually failed, and the two are derived from the same terms. It can
			// only return `undefined` here if `resolveThreshold` resolved, which this branch excludes.
			const refusal = threshold === undefined ? thresholdRefusal(config, measurement, contextWindow) : undefined;
			parts.push(threshold !== undefined
				? `threshold ${threshold.label}`
				: refusal !== undefined
					? thresholdRefusalText(refusal, config, measurement, contextWindow)
					// Unreachable: `thresholdRefusal` is total over `resolveThreshold`'s refusals. Say the
					// honest minimum rather than inventing a cause if the two ever diverge.
					: "threshold unavailable");
			// The threshold has two sources — the guardrail and the manual setting — and when the
			// guardrail overrides the manual one the receipt must say so, or the user keeps turning a
			// knob that cannot move the number above.
			if (threshold?.override !== undefined) parts.push(thresholdOverrideText(threshold.override, config, contextWindow));
		}
	}
	parts.push(config.handoffAdaptive ? `adaptive target ${config.handoffTargetTokens}` : `fixed ratio ${config.handoffThresholdRatio}`);
	parts.push(config.handoffKeepTokens > 0 ? `keep ~${config.handoffKeepTokens} recent tokens` : "summary only");
	parts.push(`summary thinking ${config.handoffSummaryThinking}`);
	parts.push(`pending question ${config.handoffPendingQuestion}`);
	const language = resolveLanguage(sessionLanguageMessages(session), config.handoffLanguage);
	parts.push(config.handoffLanguage === "auto" ? `lang auto (${language})` : `lang ${language}`);
	// The automatic path skips this session while the conversation fits the recent window; without
	// this line the only trace is a rate-limited server log the user cannot see.
	const skippedAt = skippedSince.get(String(session.id));
	if (skippedAt !== undefined) {
		parts.push(`auto skipped since ${new Date(skippedAt).toISOString()} — nothing older than keep ~${config.handoffKeepTokens} tokens to summarize`);
	}
	if (handedOff.has(String(session.id))) parts.push("already handed off in this process");
	return parts.join(" · ");
}

/**
 * Manual handoff shared by the bare command and `now`. Exported so a test can drive the whole reply
 * path (an empty span must come back as an error reply, not as a fabricated child).
 */
export async function runManual(ctx: Context, session: Session, entry: PluginConfig, signal: AbortSignal) {
	const key = String(session.id);
	if (inFlight.has(key)) return { kind: "error" as const, text: "A handoff is already running for this session." };

	const config = effectivePluginConfig(entry);
	const target = resolveTarget(session, config);
	if (!target) return { kind: "error" as const, text: "No routed model available for the handoff summary; send one message first." };
	const controller = ctx.get("sessionController") as SessionControllerLike | undefined;
	if (!controller) {
		return { kind: "error" as const, text: "The session controller is unavailable in this profile; handoff needs the web/API session runtime." };
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
			kind: "error" as const,
			text: `Handoff refused: ${pending.length} background subagent(s) still running (${named}${more}). Handing off would retire this session and cancel them, losing their work — stop them first (\`interrupt_agent\` for a teammate) or run /handoff again once they settle.`,
		};
	}

	inFlight.add(key);
	try {
		const resolved = await ctx.llm.resolveModelInfo(target.provider, target.model, signal);
		const result = await performHandoff(ctx, session, target, config, resolved, "manual", signal);
		return { kind: "success" as const, text: `Handoff session created: ${result.childId}\nHandoff document: ${result.file}` };
	} catch (error: unknown) {
		// A retryable cause must not be reported with the terminal wording: "Handoff failed" tells
		// the user the operation is over, when the recovery is to run `/handoff now` again. The
		// deferral and the transient classes are both non-terminal; everything else stays "failed".
		if (error instanceof HandoffDeferred) {
			return { kind: "error" as const, text: `Handoff deferred: ${error.message}. Nothing was handed off — the session is still working, so run /handoff now again once it settles.` };
		}
		if (handoffFailureIsTransient(error)) {
			const message = error instanceof Error ? error.message : String(error);
			return { kind: "error" as const, text: `Handoff deferred (temporarily failed, safe to retry): ${message}. Nothing was handed off; run /handoff now again.` };
		}
		return { kind: "error" as const, text: `Handoff failed: ${error instanceof Error ? error.message : String(error)}` };
	} finally {
		inFlight.delete(key);
		// A `turn/end` recorded while this manual attempt held the session belongs to the automatic
		// path, which never got to consume it; drop it rather than leaving it to fire much later.
		pendingTriggerSeq.delete(key);
	}
}
