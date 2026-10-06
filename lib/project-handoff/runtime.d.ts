/**
 * Structural views of the optional host services this plugin consumes, and the routed model
 * of a session. Each service is optional per profile, so every view is read defensively.
 */
import { type Session } from "@deepseek-ai/dsh-session";
import { type PluginConfig } from "../shared/config.js";
/** Structural view of the web/API session runtime; the service is optional per profile. */
export interface SessionControllerLike {
    create(request: {
        cwd?: string;
        workspaceId?: string;
        agentPreset?: string;
    }): Promise<{
        sessionId: string;
    }>;
    rename?(request: {
        sessionId: string;
        title: string;
    }): Promise<unknown>;
    /** Session-local model selection; absent in runtimes that predate it. */
    selectModel?(request: {
        sessionId: string;
        provider: string;
        model: string;
        reasoningEffort?: string;
    }): Promise<unknown>;
    /** Cancels the child's admitted turn when a seed has to be undone; absent in older runtimes. */
    cancel?(request: {
        sessionId: string;
    }): Promise<unknown>;
}
/**
 * Structural view of the session projection registry (`ctx.sessionProjections`,
 * `@deepseek-ai/dsh-session-projection`). The token meter registers `contextBreakdown` with it —
 * the harness's own answer to "what is the prompt made of" — and `snapshot` is synchronous.
 */
export interface SessionProjectionsLike {
    snapshot(session: Session, keys?: readonly string[]): {
        asOfSeq: number;
        values: Record<string, unknown>;
    };
}
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
export declare function projectionEnvelope(projections: SessionProjectionsLike | undefined, session: Session): number | undefined;
/**
 * Which read supplied {@link ContextMeasurement.overheadTokens}, or `undefined` when neither did.
 *
 * `"projection"` is the harness's own composition (`contextBreakdown`). `"meter"` is an envelope the
 * meter volunteered — the same *quantity*, but not the harness's answer, so it must not be reported as
 * if it were (this repo's recurring defect class is a right value under a wrong attribution).
 */
export type EnvelopeSource = "projection" | "meter";
/** {@link measuredContext}'s result: `threshold.ts`'s `ContextMeasurement` plus where the envelope came from. */
export interface MeasuredContext {
    readonly totalTokens: number;
    readonly surfaceTokens: number;
    readonly overheadTokens?: number;
    readonly envelopeSource?: EnvelopeSource;
}
/**
 * The meter's measurement plus the harness-reported envelope, ready for `threshold.ts`. One entry
 * point so the automatic path and the `/handoff status` receipt cannot read different envelopes.
 *
 * The source is reported, not just the value: the receipt's `threshold auto <n>` is the **same string**
 * whether the envelope was read or not (at a 1M window with a small `keep` the knee, not the floor, is
 * what binds), so a value alone leaves "did `contextBreakdown` parse?" unanswerable from the receipt.
 */
export declare function measuredContext(meter: TokenMeterLike, projections: SessionProjectionsLike | undefined, session: Session): MeasuredContext;
/**
 * Structural view of the workspace registry (`ctx.workspaceRegistry`); the service
 * is optional per profile, and `resolveByPath` canonicalizes like the registry does.
 */
export interface WorkspaceRegistryLike {
    resolveByPath(path: string): Promise<{
        readonly id: string;
    } | undefined>;
    /**
     * Hides a session from every grouping surface without touching its log or its workspace
     * accounting. Used to make an abandoned handoff child invisible instead of leaving an empty
     * session in the sidebar (there is no delete RPC; the archive is undoable through the client's
     * `uiWorkspace.unarchiveSession`, which restores the recorded workspace position).
     *
     * `stopActivity` asks the host to **stop** whatever still runs for the session instead of
     * refusing the archive because of it: without it a session with running work is rejected with
     * `WorkspaceActiveSessionError`, with it the archive is written and the stops are requested
     * afterwards. A handed-off session is retired with it (the host has no "end session" RPC); an
     * abandoned child is archived without it, so a child that may still be running is left alone.
     */
    archiveSession?(sessionId: string, options?: {
        readonly stopActivity?: boolean;
    }): Promise<void>;
}
/** Structural view of the token meter; the service is optional per profile. */
export interface TokenMeterLike {
    /**
     * `totalTokens` is anchored on the provider's reported usage; `surfaceTokens` is priced by the
     * meter's fixed-density heuristic, so the two are on different bases and must not be subtracted.
     * `overheadTokens` is the envelope from the harness's `contextBreakdown` projection (see
     * {@link projectionEnvelope}); it is never derived from the two above.
     */
    measure(session: Session): {
        totalTokens: number;
        surfaceTokens: number;
        overheadTokens?: number;
    };
}
/** Structural view of the settings service; writes persist the user layer. */
export interface SettingsLike {
    update(ns: string, patch: object): Promise<void>;
}
/** Resolve the handoff route: explicit config, then the session's latest routed request. */
export declare function resolveTarget(session: Session, config: PluginConfig): {
    provider: string;
    model: string;
} | undefined;
