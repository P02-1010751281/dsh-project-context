/**
 * The dsh binding of the model port.
 *
 * The port itself — {@link LlmPort} and the reply-chunk union — is declared in `../contract.ts`, so a
 * core names no framework type. This file owns the mapping in both directions: an outbound
 * `GenerateOptions` is rebuilt field by field with the host's own brand constructors
 * ({@link toHostRequest}), and the service's reply stream is exposed as the contract's chunk union,
 * whose open halves the adapter's type registries close (`./types.ts`).
 *
 * Nothing here casts the service or the request: every shape mismatch between the two vocabularies is
 * a compile error in this file, not a pass-through that a later reader has to trust. The one residual
 * widening in the package is documented where it lives (`projectionsOf` in `./services.ts`).
 */
import type { Context, GenerateOptions, LlmPort } from "../contract.js";
import type { GenerateOptions as HostGenerateOptions } from "@deepseek-ai/dsh-llm";
export type { BlockEndChunk, FinishChunk, LlmPort, StreamChunk, TextDeltaChunk, ToolCallDeltaChunk, UsageChunk, } from "../contract.js";
/**
 * Rebuild one contract request as the host's own request.
 *
 * Field by field on purpose. The two shapes differ in the branded ids (`sessionId`, `reasoningEffort`)
 * and in array mutability (`messages`, `tools`), which is exactly what a wholesale cast used to hide.
 * The messages are identity-free user inputs: a plugin request carries one prompt, the host's own
 * one-shot shape has no slot for a durable message id or source, and the contract's request message
 * names text blocks only. The tool declarations are copied into a new mutable array because the host
 * owns the array it is given.
 * The routing session is required in the result even though the host declares it optional: a route
 * may refuse a request that names none, so this conversion states the obligation instead of
 * inheriting "optional" from the host's type.
 * @param options - the request a core built.
 * @returns the same request in the host's vocabulary.
 */
export declare function toHostRequest(options: GenerateOptions): HostGenerateOptions & {
    readonly sessionId: NonNullable<HostGenerateOptions["sessionId"]>;
};
/**
 * Bind the host's model service to the neutral port.
 * @param ctx - the plugin context `apply` received.
 * @returns the port the cores call.
 */
export declare function llmOf(ctx: Context): LlmPort;
