/**
 * The host contract.
 *
 * This is the **only** module in `src/` allowed to name the harness packages. Everything else
 * imports the vocabulary from here, so a second host can implement the same contract without
 * touching the cores, and the boundary is enforceable by a script (`scripts/check-boundary.mjs`)
 * rather than by convention.
 *
 * What the contract names is deliberately narrow: the data shapes the cores read (a session's id,
 * header, event log; an agent's session and status), the service views they need (`services.ts`),
 * and the few pure predicates that belong to the host's event model. The dsh adapter currently
 * mirrors these from the pinned packages; when a shape differs on another host, the adapter maps
 * it here rather than the core branching on the host.
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
