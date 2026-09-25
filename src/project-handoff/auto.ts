/**
 * The automatic trigger: measure context pressure and hand off once the threshold is
 * crossed, unless a guard defers. Driven by the `turn/end` listener in `index.ts`.
 */

import { type Context } from "@deepseek-ai/cordis";
import { type Session } from "@deepseek-ai/dsh-session";
import { type PluginConfig } from "../shared/config.js";
import { CHARS_PER_TOKEN, handoffSplit, pendingQuestion } from "./conversation.js";
import { pendingSubagentWork } from "./guard.js";
import { performHandoff } from "./perform.js";
import { type SessionControllerLike, type TokenMeterLike, resolveTarget } from "./runtime.js";
import { SKIP_LOG_INTERVAL_MS, skippedLoggedAt, skippedSince } from "./state.js";
import { MIN_SUMMARIZE_TOKENS, resolveThreshold } from "./threshold.js";

/**
 * Measure pressure and hand off when the configured threshold is crossed. Exported so a test can
 * drive the guards (pending question, running subagents, minimum span, a session that moved on)
 * without the session/event plumbing of the plugin's own turn-end listener.
 *
 * Every `turn/end` re-measures. The trigger is already a once-per-turn event, so the 15 s
 * wall-clock throttle this used to carry saved at most one measurement per ~90 turns (measured on
 * this repo's 72 archived sessions: 1 of 89 inter-turn gaps was under 15 s) while letting a
 * deferral swallow the first idle after the user answered. Model-info resolution and the surface
 * pricing behind `tokenMeter.measure` are cheap enough to re-run per turn.
 */
export async function maybeAutoHandoff(ctx: Context, session: Session, config: PluginConfig, triggerSeq?: number): Promise<void> {
	const controller = ctx.get("sessionController") as SessionControllerLike | undefined;
	const meter = ctx.get("tokenMeter") as TokenMeterLike | undefined;
	if (!controller || !meter) return;
	const target = resolveTarget(session, config);
	if (!target) return;

	const key = String(session.id);
	const now = Date.now();

	const resolved = await ctx.llm.resolveModelInfo(target.provider, target.model);
	const contextWindow = resolved.context?.contextWindow;
	if (contextWindow === undefined || contextWindow <= 0) return;
	const measurement = meter.measure(session);
	const threshold = resolveThreshold(config, measurement, contextWindow);
	if (!threshold || measurement.totalTokens < threshold.tokens) return;

	// dsh has no editor draft mode, so by default an open question defers the handoff
	// instead of being answered by the continuation (pi's wait). `handoffPendingQuestion`
	// = "wait" opts into carrying the question into the new session.
	if (config.handoffPendingQuestion === "defer" && pendingQuestion(session) !== undefined) {
		ctx.logger.info("dsh-project-context: handoff deferred — the last assistant message is a pending question");
		return;
	}

	// A running continuable subagent will wake this session again when it settles, so handing off
	// now would leave two sessions working the same project.
	const pending = await pendingSubagentWork(ctx, session);
	if (pending.length > 0) {
		ctx.logger.info("dsh-project-context: handoff deferred — %d background subagent(s) still running", pending.length);
		return;
	}

	const split = handoffSplit(session, Math.round(config.handoffKeepTokens * CHARS_PER_TOKEN));
	if (Math.round(split.older.length / CHARS_PER_TOKEN) < MIN_SUMMARIZE_TOKENS) {
		// Nothing worth summarizing: the conversation fits the recent window. Not a failure, and
		// dsh has no host-side notification channel, so the reason is a rate-limited log line and a
		// line in the `/handoff status` receipt, which is the surface the user actually reads.
		if (!skippedSince.has(key)) skippedSince.set(key, now);
		if (now - (skippedLoggedAt.get(key) ?? 0) >= SKIP_LOG_INTERVAL_MS) {
			skippedLoggedAt.set(key, now);
			ctx.logger.info("dsh-project-context: automatic handoff skipped — the conversation fits the recent window (handoffKeepTokens), so there is nothing older to summarize");
		}
		return;
	}
	// This idle found something to summarize, so any earlier skip no longer describes the session.
	skippedSince.delete(key);

	await performHandoff(ctx, session, target, config, resolved, "auto", undefined, split, triggerSeq);
}
