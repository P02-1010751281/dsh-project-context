export type { Context } from "@deepseek-ai/cordis";
export type { Agent } from "@deepseek-ai/dsh-agent";
export type { ContentBlock, GenerateOptions, LlmResolvedModelInfo, Message, ToolCallBlock, UserMessage, } from "@deepseek-ai/dsh-llm";
export { isSurfaceEligibleType } from "@deepseek-ai/dsh-session";
import type { EventEnvelope } from "../contract.js";
/**
 * Whether a logged event is a replacement copy rather than an append-origin record.
 *
 * This mirrors the host's own `isReplacementSurfaceEvent` (upstream `core/session/src/surface.ts`:
 * `isSurfaceEvent(event) && event.surfaceOp !== "append"`, where `isSurfaceEvent` is
 * `event.surfaceOp !== undefined`). It is written out here instead of re-exported because the host
 * signature takes its own `SessionEvent`, while a core holds the contract's {@link EventEnvelope};
 * the marker it reads is carried into the contract for exactly this test. If upstream changes the
 * marker, the contract's `surfaceOp` doc and this body are what to re-read.
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
