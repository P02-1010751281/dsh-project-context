/**
 * The single resolution of the automatic trigger's inputs: the routed window, the measured
 * context, and the threshold — or `undefined` when a guardrail refused to produce one.
 *
 * It exists so nothing *reports* a decision the decision did not make. `auto.ts` consumes the
 * returned object, and the injected pressure line records that very object (see `display.ts`)
 * instead of replaying the terms in its own order. Two sequences over the same terms is the drift
 * this repo keeps paying for: the numbers the user reads are then a right value under a wrong
 * attribution, and no test can tell the two apart by comparing constants.
 */
import {} from "@deepseek-ai/cordis";
import {} from "@deepseek-ai/dsh-session";
import {} from "../shared/config.js";
import { withRouteFailure } from "./route-failure.js";
import { measuredContext, resolveTarget } from "./runtime.js";
import { resolveThreshold } from "./threshold.js";
/**
 * Resolve the trigger for one session, or `undefined` when this profile/session cannot be measured
 * at all (no session controller or meter, no routed target, no window). Those are the same silent
 * exits the automatic path has always had: nothing to decide is not a failure to report.
 *
 * A route the llm service refuses to resolve is *not* one of those exits: it throws
 * {@link HandoffRouteError}, because a dead route blocks every future attempt and reporting it as
 * "unmeasurable" would hide a repeatable failure behind the quiet half of this function.
 * @param ctx - Host context.
 * @param session - the session to measure.
 * @param config - effective plugin config.
 * @param signal - optional cooperative cancellation for the model-info read.
 * @returns the resolved gate, or `undefined` when the session is not measurable.
 */
export async function resolveHandoffGate(ctx, session, config, signal) {
    const controller = ctx.get("sessionController");
    const meter = ctx.get("tokenMeter");
    const projections = ctx.get("sessionProjections");
    if (!controller || !meter)
        return undefined;
    const target = resolveTarget(session, config);
    if (!target)
        return undefined;
    // A route the adapter refuses is *not* one of the silent exits below: it is named, because a dead
    // route blocks every future attempt and "nothing to decide" would hide a repeatable failure. The
    // wrap lives in `withRouteFailure` so the `/handoff status` receipt reports the same failure the
    // same way (a caller-cancelled read stays a cancellation, in both).
    const resolved = await withRouteFailure(target, () => ctx.llm.resolveModelInfo(target.provider, target.model, signal), signal);
    const contextWindow = resolved.context?.contextWindow;
    if (contextWindow === undefined || contextWindow <= 0)
        return undefined;
    // `measuredContext` folds in the harness's `contextBreakdown` envelope; without it the floor would
    // have to be derived from the meter's two differently-based outputs, which is the defect this exists
    // to prevent.
    const measurement = measuredContext(meter, projections, session);
    const threshold = resolveThreshold(config, measurement, contextWindow);
    return {
        contextWindow,
        measurement,
        threshold,
    };
}
