export type { Context } from "@deepseek-ai/cordis";
export type { Agent } from "@deepseek-ai/dsh-agent";
export type { ContentBlock, GenerateOptions, LlmResolvedModelInfo, Message, ToolCallBlock, UserMessage, } from "@deepseek-ai/dsh-llm";
import { isSurfaceEligibleType } from "@deepseek-ai/dsh-session";
export { isSurfaceEligibleType };
import type { EventEnvelope } from "../contract.js";
/**
 * Whether a logged event is a replacement copy rather than an append-origin record.
 *
 * Mirrors the host's own `isReplacementSurfaceEvent` exactly as upstream implements it
 * (`core/session/src/surface.ts`): `isSurfaceEvent(event) && event.surfaceOp !== "append"`, and
 * `isSurfaceEvent` is **two** tests — `SURFACE_EVENT_TYPES.has(event.type)` first, then
 * `event.surfaceOp !== undefined`. Both halves matter: an event that carries a surface marker but
 * whose type is not surface-eligible (a `turn/start`, say) is NOT a surface event upstream, so it
 * must not read as a replacement here either. `isSurfaceEligibleType` is the host's own set, so the
 * type half cannot drift.
 *
 * Written out instead of re-exported because the host signature takes its own `SessionEvent`, while
 * a core holds the contract's {@link EventEnvelope}. If upstream changes the marker, the contract's
 * `surfaceOp` doc and this body are what to re-read.
 */
export declare function isReplacementSurfaceEvent(event: EventEnvelope): boolean;
export type { Session } from "@deepseek-ai/dsh-session";
export type { SessionProjectionRegistry } from "@deepseek-ai/dsh-session-projection";
export type { ContextBreakdownProjection } from "@deepseek-ai/dsh-token-meter";
import type { ContentBlockMap } from "@deepseek-ai/dsh-llm";
import type { SessionEventMap } from "@deepseek-ai/dsh-session";
declare module "../contract.js" {
    interface OpaqueBlockTypes extends Record<Exclude<keyof ContentBlockMap, "text" | "tool-call">, true> {
    }
    interface OpaqueEventTypes extends Record<Exclude<keyof SessionEventMap, "user/message">, true> {
    }
}
