/**
 * The `/handoff` surface: argument parsing, the `/handoff status` receipt and the manual
 * handoff the bare command and `now` share.
 */

import { type HostPorts, type ServiceHost } from "../host/contract.js";
import { projectionsOf, sessionControllerOf, settingsServiceOf, tokenMeterOf } from "../host/dsh/services.js";
import { type Session } from "../host/contract.js";
import { type PluginConfig } from "../shared/config.js";
import {
	MAX_HANDOFF_RECENT_TOKENS,
	MAX_HANDOFF_SUMMARY_TOKENS,
	MIN_HANDOFF_RECENT_TOKENS,
	MIN_HANDOFF_SUMMARY_TOKENS,
} from "../shared/limits.js";
import { parseRatioInput } from "../shared/ratio.js";
import { pick } from "../shared/language.js";
import { formatThresholdSpec, parseThresholdSpec, parseTokenCount, thresholdSpecHelp } from "../shared/threshold-spec.js";
import { SETTINGS_NAMESPACE, effectivePluginConfig } from "../shared/settings.js";
import { HANDOFF_BUDGET_RECENT_LABEL } from "../shared/setting-labels.js";
import { pendingSubagentWork } from "./guard.js";
import { HandoffDeferred, handoffFailureIsTransient } from "./classify.js";
import { compactionStatusLine } from "./compaction.js";
import { readCompactionFeed } from "./compaction-events.js";
import { resolveHandoffLanguage, sessionLanguageMessages } from "./conversation.js";
import { performHandoff } from "./perform.js";
import { seedReceiptLine } from "./receipt.js";
import { isHandoffRouteError, routeFailureReceipt, withRouteFailure } from "./route-failure.js";
import { measuredContext, resolveTarget } from "./runtime.js";
import { handedOff, handoffReceipts, inFlight, pendingTriggerSeq, skippedSince } from "./state.js";
import { resolveThreshold, thresholdOverrideText, thresholdRefusal, thresholdRefusalText } from "./threshold.js";

/**
 * Parse "0.4", "40%", or "40" into a ratio. Exported for tests.
 *
 * The folding rule itself lives in `shared/ratio.ts` because the settings card reads the same text:
 * two copies of it is how the command accepts `40` while the card's number field passes `40` through
 * to a schema that refuses it. The bounds are likewise the one pair in `limits.ts`.
 */
export function parseRatio(input: string): number | undefined {
	return parseRatioInput(input);
}

/** Re-exported for tests: the one token-count reader lives in `shared/threshold-spec.ts`. */
export { parseTokenCount };

/** Map one command argument to a settings patch. */
/** Exported for tests: the settings patch `/handoff <args>` produces, if any. */
export function settingPatch(args: string): { patch?: Record<string, unknown>; error?: string } | undefined {
	if (args === "on") return { patch: { handoffEnabled: true } };
	if (args === "off") return { patch: { handoffEnabled: false } };
	const pending = /^pending\s+(defer|wait)$/.exec(args);
	if (pending) return { patch: { handoffPendingQuestion: pending[1] } };
	const language = /^lang\s+(auto|zh|en)$/.exec(args);
	if (language) return { patch: { handoffLang: language[1] } };
	// One name for the fact "where the trigger sits": `threshold` takes `auto`, a window fraction or an
	// absolute count, and all three write the same key. The value is stored in its canonical spelling so
	// `400k` comes back as the count it means.
	const threshold = /^threshold\s+(\S+)$/.exec(args);
	if (threshold) {
		const spec = parseThresholdSpec(threshold[1]);
		if (spec === undefined) return { error: `threshold takes ${thresholdSpecHelp()} (e.g. threshold 0.4, threshold 400k)` };
		return { patch: { handoffThreshold: formatThresholdSpec(spec) } };
	}
	// `budget summary|recent`, because the two amounts size different things and `target`/`keep` did not
	// say which was which: `summary` is the trigger request the pass reports (no model call reads it
	// since the generated summary was dropped), `recent` is what is carried verbatim. The bounds do not
	// move — only the names do.
	const budget = /^budget\s+(summary|recent)\s+(\S+)$/.exec(args);
	if (budget) {
		const tokens = parseTokenCount(budget[2]);
		if (budget[1] === "summary") {
			if (tokens === undefined || tokens < MIN_HANDOFF_SUMMARY_TOKENS || tokens > MAX_HANDOFF_SUMMARY_TOKENS) {
				return { error: `budget summary needs ${MIN_HANDOFF_SUMMARY_TOKENS}–${MAX_HANDOFF_SUMMARY_TOKENS} tokens (e.g. budget summary 64k)` };
			}
			return { patch: { handoffBudgetSummaryTokens: tokens } };
		}
		if (tokens === undefined || tokens < MIN_HANDOFF_RECENT_TOKENS || tokens > MAX_HANDOFF_RECENT_TOKENS) {
			return { error: `budget recent needs ${MIN_HANDOFF_RECENT_TOKENS}–${MAX_HANDOFF_RECENT_TOKENS} tokens (e.g. budget recent 20k, budget recent 0)` };
		}
		return { patch: { handoffBudgetRecentTokens: tokens } };
	}
	// A verb used without its argument names its own sub-verbs rather than falling through to the whole
	// usage line, so the receipt says which spelling is missing.
	if (/^budget\b/.test(args)) return { error: "budget needs summary or recent: budget summary <tokens> | budget recent <tokens>" };
	if (/^threshold\b/.test(args)) return { error: `threshold takes ${thresholdSpecHelp()} (e.g. threshold 0.4, threshold 400k)` };
	return undefined;
}

export const USAGE = "Usage: /handoff [status|now|on|off|threshold auto|<ratio>|<tokens>|budget summary <tokens>|budget recent <tokens>|pending defer|wait|lang auto|zh|en]";

/** Persist one settings patch through the mounted settings service. */
export async function writeSetting(host: ServiceHost, patch: Record<string, unknown>): Promise<string | undefined> {
	const settings = settingsServiceOf(host.services);
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
 *
 * `pending` is the patch a just-completed settings write is about to put in force. The receipt explains
 * the *effect* of a write, and the host's entry restart may not have republished the config by the time
 * this runs, so reading the live config alone would explain the previous ratio instead of the one just
 * set — a fresh misattribution in the place a misattribution is least tolerable. `/handoff status`
 * passes nothing and reports exactly what is in force.
 */
export async function statusText(
	host: HostPorts,
	session: Session,
	entry: PluginConfig,
	signal: AbortSignal,
	/** The raw patch a just-completed write will put in force — stored spellings, not resolved values. */
	pending?: Partial<Record<keyof PluginConfig, unknown>>,
): Promise<string> {
	const live = effectivePluginConfig(entry);
	// The threshold's stored spelling is a string (`400k`) while the resolved config holds the parsed
	// spec, so the pending value has to go through the one reader: spreading it raw would hand the
	// receipt a mode-less object and explain the write as `fixed 0%`.
	const merged = { ...live, ...(pending ?? {}) } as PluginConfig;
	const config: PluginConfig = typeof pending?.handoffThreshold === "string"
		? { ...merged, handoffThreshold: parseThresholdSpec(pending.handoffThreshold) ?? live.handoffThreshold }
		: merged;
	// Resolved once and early: the threshold refusal below is written in this language, and it must be
	// the same one `HANDOFF.md` would use for this handoff.
	const language = resolveHandoffLanguage(sessionLanguageMessages(session), config);
	// The head is one line and carries the payload. The client renders a command receipt as a single
	// `nowrap` ellipsized row whose summary is the *whole* text, and the expandable `<pre>` exists only
	// when the text contains a newline — so a one-line receipt is clipped after roughly eighty columns
	// and can never be opened. The decision (mode, occupancy, the threshold that will fire) therefore
	// leads, and every supporting fact gets its own line, where the expanded body wraps it.
	const head: string[] = [pick(language, `自动交接 ${config.handoffEnabled ? "开" : "关"}`, `Auto handoff ${config.handoffEnabled ? "ON" : "OFF"}`)];
	const details: string[] = [];
	/** The resolved trigger's own label, when the head could render one. */
	let resolvedTrigger: string | undefined;
	const target = resolveTarget(session, config);
	const meter = tokenMeterOf(host.services);
	const projections = projectionsOf(host.services);
	if (target !== undefined && meter !== undefined) {
		let contextWindow: number | undefined;
		try {
			contextWindow = (await withRouteFailure(target, () => host.llm.resolveModelInfo(target.provider, target.model, signal), signal)).context?.contextWindow;
		} catch (error: unknown) {
			// The receipt is the surface a user opens *because* handoff stopped; it must survive the very
			// failure it exists to explain. A stale provider/model pair used to throw out of this handler,
			// so the one readable answer was the exception's absence of an answer.
			if (!isHandoffRouteError(error)) throw error;
			// Its own line: the failure explanation is a paragraph, and spending the clip on the cause
			// would hide the numbers the reader opened this receipt for.
			details.push(routeFailureReceipt(error.failure, error.detail, language));
			contextWindow = undefined;
		}
		if (contextWindow !== undefined && contextWindow > 0) {
			// Same envelope the automatic path uses, so the receipt cannot explain a decision the trigger
			// did not make.
			const measurement = measuredContext(meter, projections, session);
			const percent = Math.round((measurement.totalTokens / contextWindow) * 100);
			head.push(pick(language, `上下文 ${measurement.totalTokens}/${contextWindow}（${percent}%）`, `context ${measurement.totalTokens}/${contextWindow} (${percent}%)`));
			// The envelope is an *input* to the trigger, and the trigger alone cannot show whether it
			// arrived: a 1M window with a small `keep` puts the knee above the floor either way, so the
			// same `threshold auto <n>` renders when the floor carries the envelope and when it falls back
			// to `keep + MIN`. Without this line "the harness projection parsed" is unfalsifiable from the
			// receipt — and it is the harness's composition, so a meter-supplied one is named as such.
			details.push(measurement.envelopeSource === "projection"
				? pick(language, `harness 包络 ${measurement.overheadTokens ?? 0}`, `harness envelope ${measurement.overheadTokens ?? 0}`)
				: measurement.envelopeSource === "meter"
					? pick(language, `计量器包络 ${measurement.overheadTokens ?? 0} —— 不是 harness 的组合`, `meter envelope ${measurement.overheadTokens ?? 0} — not the harness composition`)
					: pick(language, "harness 包络不可用 —— 没有 contextBreakdown 投影", "harness envelope unavailable — no contextBreakdown projection"));
			const threshold = resolveThreshold(config, measurement, contextWindow, language);
			// Never render every refusal as a claim about the window: `thresholdRefusal` names the
			// comparison that actually failed, and the two are derived from the same terms. It can
			// only return `undefined` here if `resolveThreshold` resolved, which this branch excludes.
			const refusal = threshold === undefined ? thresholdRefusal(config, measurement, contextWindow) : undefined;
			// The head names only the outcome; the refusal's own sentence — which carries the remedy and
			// is therefore long — becomes a detail line so the clip cannot eat it.
			// The head keeps the receipt's own language: a Chinese session gets 阈值不可用, never the English
			// word, because the head is the only part a folded card shows.
			head.push(threshold !== undefined ? pick(language, `阈值 ${threshold.label}`, `threshold ${threshold.label}`) : pick(language, "阈值不可用", "threshold unavailable"));
			resolvedTrigger = threshold?.label;
			if (refusal !== undefined) details.push(thresholdRefusalText(refusal, config, measurement, contextWindow, language));
			// Unreachable, and stated as the honest minimum rather than an invented cause: `thresholdRefusal`
			// is total over `resolveThreshold`'s refusals, so this branch cannot pair with a threshold.
			// The threshold has two sources — the guardrail and the manual setting — and when the
			// guardrail overrides the manual one the receipt must say so, or the user keeps turning a
			// knob that cannot move the number above.
			if (threshold?.override !== undefined) details.push(thresholdOverrideText(threshold.override, config, measurement, contextWindow));
		}
	}
	// The host's own compaction, read from the durable log. It sits with the occupancy lines because
	// the two are read together, and it is pushed outside the block above on purpose: the compaction
	// history is a fact about this session even when the route or the meter is what is broken — that
	// is exactly the receipt a user opens while handoff is not firing.
	details.push(compactionStatusLine(readCompactionFeed(session.snapshotEvents()), language));
	// This session's own seed, when this process performed the handoff that created it. Recorded by the
	// transaction that wrote the artifacts, so the numbers are the seed's, not a second estimate; a
	// session that was not seeded here has no entry and prints no line (the parent keeps only
	// `already handed off`, further down).
	const seed = handoffReceipts.get(String(session.id));
	if (seed !== undefined) details.push(seedReceiptLine(seed, language));
	const thresholdSetting = config.handoffThreshold;
	// The setting's own spelling is a second fact only when the head could not name the trigger: in
	// fixed mode the head prints exactly this number, so repeating `fixed threshold <n> tokens` below
	// it showed the same value twice. `auto` still names the adaptive target, which the head never
	// shows, and a refusal still says what was configured.
	if (thresholdSetting.mode === "auto") details.push(pick(language, `自适应目标 ${config.handoffBudgetSummaryTokens}`, `adaptive target ${config.handoffBudgetSummaryTokens}`));
	else if (resolvedTrigger === undefined) details.push(thresholdSetting.mode === "ratio" ? `fixed ratio ${Math.round(thresholdSetting.ratio * 100)}%` : `fixed threshold ${thresholdSetting.tokens} tokens`);
	// The setting's name is the settings card's, in the receipt's own language — `keep` is an internal
	// shorthand that appears nowhere the user can see it.
	details.push(config.handoffBudgetRecentTokens > 0
		? (language === "zh"
			? `「${HANDOFF_BUDGET_RECENT_LABEL.zh}」 ~${config.handoffBudgetRecentTokens}`
			: `"${HANDOFF_BUDGET_RECENT_LABEL.en}" ~${config.handoffBudgetRecentTokens}`)
		: (language === "zh" ? "0（不逐字带入对话尾料）" : "0 (no verbatim conversation tail)"));
	details.push(pick(language, `待答问题 ${config.handoffPendingQuestion}`, `pending question ${config.handoffPendingQuestion}`));
	details.push(config.handoffLang === "auto" ? pick(language, `语言 自动（${language}）`, `lang auto (${language})`) : pick(language, `语言 ${language}`, `lang ${language}`));
	// The automatic path skips this session while the conversation fits the recent window; without
	// this line the only trace is a rate-limited server log the user cannot see.
	const skippedAt = skippedSince.get(String(session.id));
	if (skippedAt !== undefined) {
		const at = new Date(skippedAt).toISOString();
		details.push(language === "zh"
			? `自 ${at} 起自动跳过 —— 全部对话都在「${HANDOFF_BUDGET_RECENT_LABEL.zh}」（~${config.handoffBudgetRecentTokens} token）之内，没有更早的内容可丢弃`
			: `auto skipped since ${at} — everything is inside "${HANDOFF_BUDGET_RECENT_LABEL.en}" (~${config.handoffBudgetRecentTokens} tokens), so nothing older is left to drop`);
	}
	if (handedOff.has(String(session.id))) details.push("already handed off in this process");
	return [head.join(" · "), ...details].join("\n");
}

/**
 * Manual handoff shared by the bare command and `now`. Exported so a test can drive the whole reply
 * path (an empty span must come back as an error reply, not as a fabricated child).
 */
export async function runManual(host: HostPorts, session: Session, entry: PluginConfig, signal: AbortSignal) {
	const key = String(session.id);
	if (inFlight.has(key)) return { kind: "error" as const, text: "A handoff is already running for this session." };

	const config = effectivePluginConfig(entry);
	// No routed model is needed: nothing is generated any more. Only the automatic path resolves a
	// model, and only for its `contextWindow` (the threshold reads it); `/handoff now` proceeds with
	// whatever route the session is on, exactly as pi does.
	const controller = sessionControllerOf(host.services);
	if (!controller) {
		return { kind: "error" as const, text: "The session controller is unavailable in this profile; handoff needs the web/API session runtime." };
	}

	// A handoff forks and then retires the session it replaced, and that retirement cancels every
	// running subagent descendant of it (`workspace/session-stop`): a teammate mid-task would lose its
	// work with nothing to show for it. The automatic path defers for the same reason. The manual path
	// is the user's explicit request, so it **refuses by name** and names the lever instead of quietly
	// destroying the work — the one reply that cannot be undone is the one that must not be silent.
	const pending = await pendingSubagentWork(host, session);
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
		const result = await performHandoff(host, session, config, "manual", signal);
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
