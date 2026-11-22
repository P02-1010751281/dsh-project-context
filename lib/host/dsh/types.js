import { isSurfaceEligibleType } from "@deepseek-ai/dsh-session";
export { isSurfaceEligibleType };
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
export function isReplacementSurfaceEvent(event) {
    return isSurfaceEligibleType(event.type) && event.surfaceOp !== undefined && event.surfaceOp !== "append";
}
