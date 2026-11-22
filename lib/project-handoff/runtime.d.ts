/**
 * Structural views of the optional host services this plugin consumes, and the routed model
 * of a session. Each service is optional per profile, so every view is read defensively.
 */
import { type Session } from "../host/contract.js";
import type { SessionControllerLike, SettingsLike, SessionTitleLike, TokenMeterLike, WorkspaceRegistryLike } from "../host/dsh/services.js";
export type { SessionControllerLike, SettingsLike, SessionTitleLike, TokenMeterLike, WorkspaceRegistryLike, };
import { type SessionProjectionRegistry } from "../host/contract.js";
import { type PluginConfig } from "../shared/config.js";
import { type MeasuredContext } from "./measure.js";
/**
 * The envelope the next request carries beyond the conversation, for `threshold.ts`.
 *
 * Read from the harness's own `contextBreakdown` projection (`systemTokens + toolsTokens`), which is
 * a synchronous read of an already-folded view — the harness's answer to "what is the prompt made
 * of", not something this plugin derives. It is
 * **never** derived by subtracting two meter outputs: `tokenMeter.measure`'s `totalTokens` is anchored
 * on the provider's `usage` while its `surfaceTokens` is priced by a fixed-density heuristic, so the
 * difference is `envelope + density error` — 263324 against a real 42845 on one measured session, an
 * error that grows with the conversation and put the floor permanently past the knee.
 *
 * `undefined` when the registry or the projection is absent, which leaves the floor at `keep + MIN`.
 * The composition is the meter's fixed-density estimate, the same basis `keep`, `MIN_DROP_TOKENS`
 * and `handoffSplit` are measured in, so the floor stays internally consistent.
 */
export declare function projectionEnvelope(projections: SessionProjectionRegistry | undefined, session: Session): number | undefined;
export type { EnvelopeSource, MeasuredContext } from "./measure.js";
/**
 * The meter's measurement plus the harness-reported envelope, ready for `threshold.ts`. One entry
 * point so the automatic path and the `/handoff status` receipt cannot read different envelopes.
 *
 * The source is reported, not just the value: the receipt's `threshold auto <n>` is the **same string**
 * whether the envelope was read or not (at a 1M window with a small `keep` the knee, not the floor, is
 * what binds), so a value alone leaves "did `contextBreakdown` parse?" unanswerable from the receipt.
 */
export declare function measuredContext(meter: TokenMeterLike, projections: SessionProjectionRegistry | undefined, session: Session): MeasuredContext;
/**
 * Structural view of the workspace registry (`ctx.workspaceRegistry`); the service
 * is optional per profile, and `resolveByPath` canonicalizes like the registry does.
 */
/**
 * Structural view of the title service (`ctx.get("sessionTitle")`, `@deepseek-ai/dsh-session-title`).
 * Optional per profile, so both reads are defended: `get` folds the session's own log for the latest
 * `session/title`, and `rename` appends one with the `user` source and reports the accepted snapshot.
 * Both are synchronous, and `rename` throws when the session is not live in this store.
 */
/** Resolve the handoff route: explicit config, then the session's latest routed request. */
export declare function resolveTarget(session: Session, config: PluginConfig): {
    provider: string;
    model: string;
} | undefined;
