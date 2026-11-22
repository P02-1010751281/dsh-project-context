/**
 * The dsh adapter's type vocabulary.
 *
 * This is the one place in `src/` that names a harness package, and it lives inside the adapter
 * directory on purpose: a second harness gets `src/host/<harness>/types.ts` with its own imports and
 * its own mapping, while `src/host/contract.ts` stays the host-neutral surface the cores import from.
 * `scripts/check-boundary.mjs` enforces the direction: host imports are legal under `src/host/<name>/`
 * and illegal in `contract.ts`.
 *
 * Today the entries below are re-exports, because the cores still read the harness's own shapes (a
 * session's event log, an agent's session, the LLM message vocabulary). The next step — own structural
 * interfaces declared in `contract.ts` and mapped here — is tracked in `docs/core-host-boundary.md`
 * §2; it changes these entries into mappings rather than aliases. Splitting the file out is what makes
 * that change local to this directory instead of a rewrite of the contract's importers.
 *
 * Two of the imports are side-effect only and load-bearing — do not "clean them up": they pull the
 * `Context` augmentations this package reads (`ctx.commands`, the session-projection map). Without
 * them the service reads stop typechecking.
 */
import type {} from "@deepseek-ai/dsh-commands";
import type {} from "@deepseek-ai/dsh-session-projection";

export type { Context } from "@deepseek-ai/cordis";

export type { Agent } from "@deepseek-ai/dsh-agent";

export type {
	ContentBlock,
	GenerateOptions,
	LlmResolvedModelInfo,
	Message,
	ToolCallBlock,
	UserMessage,
} from "@deepseek-ai/dsh-llm";

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
export function isReplacementSurfaceEvent(event: EventEnvelope): boolean {
	return isSurfaceEligibleType(event.type) && event.surfaceOp !== undefined && event.surfaceOp !== "append";
}
export type { Session } from "@deepseek-ai/dsh-session";

export type { SessionProjectionRegistry } from "@deepseek-ai/dsh-session-projection";

export type { ContextBreakdownProjection } from "@deepseek-ai/dsh-token-meter";

// ── Contract registries ──────────────────────────────────────────────────────────────────────────
//
// `src/host/contract.ts` models two host vocabularies as "declared members + an opaque rest": the
// content-block kinds and the session-event kinds a core does not narrow on. The adapter is what
// closes those unions, by naming the host's own key sets here. Without this augmentation the opaque
// half is `never`, and no host block or event is assignable to the contract.
//
// Both are computed from the host's own maps, so a new upstream block or event keeps compiling
// without a hand-maintained list going stale.
import type { ContentBlockMap } from "@deepseek-ai/dsh-llm";
import type { SessionEventMap } from "@deepseek-ai/dsh-session";

declare module "../contract.js" {
	interface OpaqueBlockTypes extends Record<Exclude<keyof ContentBlockMap, "text" | "tool-call">, true> {}
	interface OpaqueEventTypes extends Record<Exclude<keyof SessionEventMap, "user/message">, true> {}
}
