/**
 * The single resolution of the automatic trigger's inputs: the routed window, the measured
 * context, and the threshold — or the refusal that stands in for it.
 *
 * It exists so nothing *reports* a decision the decision did not make. `auto.ts` consumes the
 * returned object, and the injected pressure line records that very object (see `display.ts`)
 * instead of replaying the terms in its own order. Two sequences over the same terms is the drift
 * this repo keeps paying for: the numbers the user reads are then a right value under a wrong
 * attribution, and no test can tell the two apart by comparing constants.
 */
import { type Context } from "@deepseek-ai/cordis";
import { type Session } from "@deepseek-ai/dsh-session";
import { type PluginConfig } from "../shared/config.js";
import { type MeasuredContext } from "./runtime.js";
import { type ThresholdRefusal, resolveThreshold } from "./threshold.js";
/**
 * Everything the trigger decides on, resolved once.
 *
 * `threshold` is `undefined` when a guardrail refuses; `refusal` then names which term bound it, so
 * a caller that *shows* the state does not have to render every refusal as a claim about the window
 * (see `thresholdRefusal`).
 */
export interface ResolvedHandoffGate {
    readonly contextWindow: number;
    readonly measurement: MeasuredContext;
    readonly threshold: ReturnType<typeof resolveThreshold>;
    readonly refusal: ThresholdRefusal | undefined;
}
/**
 * Resolve the trigger for one session, or `undefined` when this profile/session cannot be measured
 * at all (no session controller or meter, no routed target, no window). Those are the same silent
 * exits the automatic path has always had: nothing to decide is not a failure to report.
 * @param ctx - Host context.
 * @param session - the session to measure.
 * @param config - effective plugin config.
 * @param signal - optional cooperative cancellation for the model-info read.
 * @returns the resolved gate, or `undefined` when the session is not measurable.
 */
export declare function resolveHandoffGate(ctx: Context, session: Session, config: PluginConfig, signal?: AbortSignal): Promise<ResolvedHandoffGate | undefined>;
