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

export { isReplacementSurfaceEvent, isSurfaceEligibleType } from "@deepseek-ai/dsh-session";
export type { Session } from "@deepseek-ai/dsh-session";

export type { SessionProjectionRegistry } from "@deepseek-ai/dsh-session-projection";

export type { ContextBreakdownProjection } from "@deepseek-ai/dsh-token-meter";
