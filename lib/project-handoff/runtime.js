/**
 * Structural views of the optional host services this plugin consumes, and the routed model
 * of a session. Each service is optional per profile, so every view is read defensively.
 */
import {} from "@deepseek-ai/dsh-session";
import {} from "../shared/config.js";
/**
 * The envelope the next request carries beyond the conversation, for `threshold.ts`.
 *
 * Read from the harness's `contextBreakdown` projection (`systemTokens + toolsTokens`). It is
 * **never** derived by subtracting two meter outputs: `tokenMeter.measure`'s `totalTokens` is anchored
 * on the provider's `usage` while its `surfaceTokens` is priced by a fixed-density heuristic, so the
 * difference is `envelope + density error` — 263324 against a real 42845 on one measured session, an
 * error that grows with the conversation and put the floor permanently past the knee.
 *
 * `undefined` when the registry or the projection is absent, which leaves the floor at `keep + MIN`.
 * The composition is the meter's fixed-density estimate, the same basis `keep`, `MIN_DROP_TOKENS`
 * and `handoffSplit` are measured in, so the floor stays internally consistent.
 */
export function projectionEnvelope(projections, session) {
    const value = projections?.snapshot(session, ["contextBreakdown"]).values.contextBreakdown;
    if (value === undefined || value === null || typeof value !== "object")
        return undefined;
    const { systemTokens, toolsTokens } = value;
    if (typeof systemTokens !== "number" && typeof toolsTokens !== "number")
        return undefined;
    return (typeof systemTokens === "number" ? systemTokens : 0) + (typeof toolsTokens === "number" ? toolsTokens : 0);
}
/**
 * The meter's measurement plus the harness-reported envelope, ready for `threshold.ts`. One entry
 * point so the automatic path and the `/handoff status` receipt cannot read different envelopes.
 *
 * The source is reported, not just the value: the receipt's `threshold auto <n>` is the **same string**
 * whether the envelope was read or not (at a 1M window with a small `keep` the knee, not the floor, is
 * what binds), so a value alone leaves "did `contextBreakdown` parse?" unanswerable from the receipt.
 */
export function measuredContext(meter, projections, session) {
    const measured = meter.measure(session);
    const envelope = projectionEnvelope(projections, session);
    if (envelope !== undefined)
        return { ...measured, overheadTokens: envelope, envelopeSource: "projection" };
    // No projection: keep an envelope the meter itself reported, but label it as the meter's.
    return measured.overheadTokens === undefined ? measured : { ...measured, envelopeSource: "meter" };
}
/** Resolve the handoff route: explicit config, then the session's latest routed request. */
export function resolveTarget(session, config) {
    if (config.provider && config.model)
        return { provider: config.provider, model: config.model };
    const routed = session.requestHeader()?.config;
    if (routed && routed.provider && routed.model)
        return { provider: routed.provider, model: routed.model };
    return undefined;
}
