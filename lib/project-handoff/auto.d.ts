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
export declare function maybeAutoHandoff(ctx: Context, session: Session, config: PluginConfig, triggerSeq?: number): Promise<void>;
