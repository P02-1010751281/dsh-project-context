/**
 * The dsh adapter's type vocabulary.
 *
 * This is the one place in `src/` allowed to name a harness package, and it lives inside the adapter
 * directory on purpose: a second harness gets `src/host/<harness>/types.ts` with its own imports and
 * its own mapping, while `src/host/contract.ts` stays the host-neutral surface the cores import.
 * `scripts/check-boundary.mjs` enforces the direction: host imports are legal under
 * `src/host/<name>/`, illegal in `contract.ts`, and — since this file now also owns the module
 * augmentations — a `declare module "@deepseek-ai/…"` outside the adapter is a boundary break too.
 *
 * The registries at the bottom are what let the contract's own interfaces stay closed unions: the
 * contract declares the members the cores name and leaves the rest of each vocabulary opaque, and the
 * adapter closes those opaque halves from the host's own maps.
 */
import type {} from "@deepseek-ai/dsh-commands";
import type {} from "@deepseek-ai/dsh-session-projection";
// Side-effect only and load-bearing — do not "clean it up": the augmentation below targets this
// module, and the `Context` service reads depend on the declaration being part of the program.
import type {} from "@deepseek-ai/dsh-llm";

export type { Context } from "@deepseek-ai/cordis";

import { isSurfaceEligibleType } from "@deepseek-ai/dsh-session";

export { isSurfaceEligibleType };

import type { ContentBlockMap } from "@deepseek-ai/dsh-llm";
import type { SessionEventMap } from "@deepseek-ai/dsh-session";
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

/**
 * This package's own message-source kind.
 *
 * `MessageSourceMap` is merge-extensible and every producer declares its own kind in its own module
 * (in-tree, `compact-checkpoint` does the same). The kind deliberately is not `user`:
 * `userTurnCount` counts human turns by `source.kind === "user"`, so tagging this package's synthetic
 * message `user` would inflate the consolidation and autolearn turn counters.
 */
declare module "@deepseek-ai/dsh-llm" {
	interface MessageSourceMap {
		"dsh-project-context": { kind: "dsh-project-context" };
	}
}

// ── Contract registries ──────────────────────────────────────────────────────────────────────────
//
// `src/host/contract.ts` models two host vocabularies as "declared members + an opaque rest": the
// content-block kinds and the session-event kinds a core does not narrow on. The adapter is what
// closes those unions, by naming the host's own key sets here. Without this augmentation the opaque
// half is `never`, and no host block or event is assignable to the contract.
//
// Both are computed from the host's own maps, so a new upstream block or event keeps compiling
// without a hand-maintained list going stale.
declare module "../contract.js" {
	interface OpaqueBlockTypes extends Record<Exclude<keyof ContentBlockMap, "text" | "tool-call">, true> {}
	interface OpaqueEventTypes extends Record<Exclude<keyof SessionEventMap, "user/message">, true> {}
}
