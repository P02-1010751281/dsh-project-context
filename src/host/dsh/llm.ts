/**
 * The dsh binding of the model port.
 *
 * The port itself — {@link LlmPort} and the reply-chunk union — is declared in `../contract.ts`, so a
 * core names no framework type. This file owns the one mapping: `ctx.llm` is dsh's service object,
 * and it is widened once, here, instead of at every call site.
 *
 * The widening is deliberate and narrow: dsh's declared `stream` accepts dsh's own request type,
 * which carries more fields than the contract's {@link GenerateOptions}; the contract only ever
 * sends the subset it declares, so the cast buys the neutral vocabulary without claiming the two
 * requests are identical. A second adapter supplies its own port and needs no cast.
 */
import type { Context, LlmPort } from "../contract.js";

export type {
	BlockEndChunk,
	FinishChunk,
	LlmPort,
	StreamChunk,
	TextDeltaChunk,
	ToolCallDeltaChunk,
	UsageChunk,
} from "../contract.js";

/**
 * Bind the host's model service to the neutral port.
 * @param ctx - the plugin context `apply` received.
 * @returns the port the cores call.
 */
export function llmOf(ctx: Context): LlmPort {
	return ctx.llm as unknown as LlmPort;
}
