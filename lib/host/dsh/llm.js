import { ReasoningEffortId } from "@deepseek-ai/dsh-llm/brand";
import { SessionId } from "@deepseek-ai/dsh-session";
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
export function toHostRequest(options) {
    const messages = options.messages.map((message) => ({ role: "user", content: message.content }));
    return {
        provider: options.provider,
        model: options.model,
        messages,
        sessionId: SessionId(options.sessionId),
        // Absent stays absent: each optional field is spread in only when the core set it, so a caller
        // that never named one sends the byte-identical request it always did.
        ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
        ...(options.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(options.reasoningEffort) }),
        ...(options.tools === undefined ? {} : { tools: [...options.tools] }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
    };
}
/**
 * Bind the host's model service to the neutral port.
 * @param ctx - the plugin context `apply` received.
 * @returns the port the cores call.
 */
export function llmOf(ctx) {
    return {
        resolveModelInfo(provider, model, signal) {
            return ctx.llm.resolveModelInfo(provider, model, signal);
        },
        stream(options) {
            return ctx.llm.stream(toHostRequest(options));
        },
    };
}
