export { isSurfaceEligibleType } from "@deepseek-ai/dsh-session";
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
export function isReplacementSurfaceEvent(event) {
    return event.surfaceOp !== undefined && event.surfaceOp !== "append";
}
