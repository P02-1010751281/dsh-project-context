/**
 * The automatic trigger: measure context pressure, decide, and hand off.
 *
 * The decision itself lives in `decide.ts` as a pure function of resolved inputs; this file is the dsh
 * adapter around it — it reads the host services, renders the split, and acts on the outcome. The
 * split stays here rather than in the decision because `handoffSplit` reads a `Session`, and the
 * decision must not.
 *
 * The measurement itself lives in `gate.ts` because the injected pressure line reports the same
 * numbers; this function adds only the guards, the split and the handoff.
 */

import { type Context } from "@deepseek-ai/cordis";
import { type Session } from "@deepseek-ai/dsh-session";
import { type PluginConfig } from "../shared/config.js";
import { CHARS_PER_TOKEN, type HandoffSplit, handoffSplit, pendingQuestion, resolveHandoffLanguage, sessionLanguageMessages } from "./conversation.js";
import { type GateInputs, decideAutoHandoff } from "./decide.js";
import { recordHandoffDeferral, recordHandoffGate } from "./display.js";
import { type ResolvedHandoffGate, resolveHandoffGate } from "./gate.js";
import { pendingSubagentWork } from "./guard.js";
import { performHandoff } from "./perform.js";
import { SKIP_LOG_INTERVAL_MS, skippedLoggedAt, skippedSince } from "./state.js";

/** What the adapter had to go and read, plus the decision inputs assembled from it. */
interface GatheredDecisionInputs {
	/** The pure seam's entire input, assembled at exactly one site outside the tests. */
	readonly inputs: GateInputs;
	/** The rendered split the outcome goes on to use — a handoff performs it; nothing else does. */
	readonly split: HandoffSplit;
	/** The named subagents; the decision needs their count, the deferral log quotes the count too. */
	readonly subagents: readonly string[];
}

/**
 * Read everything `decideAutoHandoff` judges on, and nothing else.
 *
 * This is the adapter half of the seam (§3.4 of `docs/batch-w-decision-seam-spec.md`): every host read
 * happens here and what leaves is plain data. A host whose trigger event or capability reads differ —
 * a different registry shape, a trigger that is not `turn/end` — reimplements this one function and
 * reuses the chain unchanged, which is the whole point of separating judge from measure.
 *
 * It deliberately does not resolve the gate: `resolveHandoffGate` is shared with the injected pressure
 * line and its result is also frozen into the crossing by `recordHandoffGate`, so that resolution
 * stays in `maybeAutoHandoff` where both readers can see it happened once.
 *
 * **The order of the three reads is load-bearing and matches the pre-seam adapter**: the question and
 * then the host listing before, the split after. Nothing is written across that `await`, but the event
 * loop can still run inside it (a settled child's notice is a queued microtask), so the two orders
 * decide which snapshot of the session each input sees — below the threshold, and while a question is
 * open, a message that lands inside the await changes the outcome. No test can see that difference, so
 * it has to be preserved by construction rather than by a pinned case.
 */
async function gatherDecisionInputs(ctx: Context, session: Session, config: PluginConfig, gate: ResolvedHandoffGate): Promise<GatheredDecisionInputs> {
	const question = pendingQuestion(session);
	const subagents = await pendingSubagentWork(ctx, session);
	const split = handoffSplit(session, Math.round(config.handoffBudgetRecentTokens * CHARS_PER_TOKEN));
	return {
		split,
		subagents,
		inputs: {
			measurement: gate.measurement,
			contextWindow: gate.contextWindow,
			threshold: gate.threshold,
			pendingQuestion: question,
			pendingSubagents: subagents,
			olderTokens: Math.round(split.older.length / CHARS_PER_TOKEN),
		},
	};
}

/**
 * Measure pressure and act on the decision. Exported so a test can drive the guards (pending question,
 * running subagents, minimum span, a session that moved on) without the session/event plumbing of the
 * plugin's own turn-end listener.
 *
 * Every `turn/end` re-measures. The trigger is already a once-per-turn event, so the 15 s wall-clock
 * throttle this used to carry saved at most one measurement per ~90 turns (measured on this repo's 72
 * archived sessions: 1 of 89 inter-turn gaps was under 15 s) while letting a deferral swallow the
 * first idle after the user answered. Model-info resolution and the surface pricing behind
 * `tokenMeter.measure` are cheap enough to re-run per turn.
 *
 * All inputs are materialized before the decision sees them, which is the price of one pure call: a
 * `turn/end` that ends up below the threshold still pays for one `handoffSplit` and one subagent
 * listing, where the previous shape paid for them only after the guards passed. Neither read writes
 * anything — the listing is a projection snapshot, the split a pure render — so the decision still
 * concludes what it used to; but "no observable effect" would be too strong a claim, because the read
 * *order* against the await is observable (§`gatherDecisionInputs`) and the extra reads are a real,
 * accepted cost. See §7 of the spec for the residual.
 * @param ctx - plugin context, for the meter, the projections and the subagent registry.
 * @param session - the session to measure.
 * @param config - effective plugin config.
 * @param triggerSeq - the `turn/end` that caused this attempt, carried into the handoff.
 * @returns nothing; the outcome is a handoff, a recorded deferral or a recorded skip.
 */
export async function maybeAutoHandoff(ctx: Context, session: Session, config: PluginConfig, triggerSeq?: number): Promise<void> {
	const key = String(session.id);
	const now = Date.now();

	// One resolution, shared with the injected pressure line (`gate.ts`), so the number the user reads
	// is the number this decision used.
	const gate = await resolveHandoffGate(ctx, session, config);
	if (!gate) return;
	// The language is resolved here, once, and frozen with the crossing: the context provider must not
	// re-derive it per assembly (see `display.ts`).
	recordHandoffGate(session, gate, resolveHandoffLanguage(sessionLanguageMessages(session), config));

	const { inputs, split, subagents } = await gatherDecisionInputs(ctx, session, config, gate);
	const decision = decideAutoHandoff(inputs, config);

	switch (decision.kind) {
		case "unmeasurable":
		case "below-threshold":
			// Nothing to act on and nothing to report: a session that cannot be measured and one that has
			// not crossed the threshold are both silent exits, exactly as they were before the seam.
			return;
		case "defer":
			recordHandoffDeferral(key, decision.reason);
			if (decision.reason === "question") {
				ctx.logger.info("dsh-project-context: handoff deferred — the last assistant message is a pending question");
			} else {
				ctx.logger.info("dsh-project-context: handoff deferred — %d background subagent(s) still running", subagents.length);
			}
			return;
		case "skip":
			recordHandoffDeferral(key, "nothing-to-drop");
			// Nothing worth dropping: the conversation fits the recent window. Not a failure, and dsh has
			// no host-side notification channel, so the reason is a rate-limited log line and a line in the
			// `/handoff status` receipt, which is the surface the user actually reads.
			if (!skippedSince.has(key)) skippedSince.set(key, now);
			if (now - (skippedLoggedAt.get(key) ?? 0) >= SKIP_LOG_INTERVAL_MS) {
				skippedLoggedAt.set(key, now);
				ctx.logger.info("dsh-project-context: automatic handoff skipped — the conversation fits the recent window (handoffBudgetRecentTokens), so there is nothing older to drop");
			}
			return;
		case "handoff":
			// This idle found something to drop, so any earlier skip no longer describes the session.
			skippedSince.delete(key);
			await performHandoff(ctx, session, config, "auto", undefined, split, triggerSeq);
			return;
	}
	assertNever(decision);
}

/**
 * Compile-time proof that every `Decision` kind above was handled.
 *
 * A parameter typed `never` cannot accept a value, so adding a sixth kind to `Decision` turns the call
 * site into a type error instead of a silent fall-through at the end of the `switch` — which matters
 * because falling through means "no handoff", the quiet half of this file's failure modes. The body is
 * empty on purpose: this guard must be free at runtime and must not add a failure path of its own.
 * @param decision - unreachable; the narrowed remainder of the switch.
 */
function assertNever(decision: never): void {
	void decision;
}
