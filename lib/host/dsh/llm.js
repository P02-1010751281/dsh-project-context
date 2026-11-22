/**
 * Bind the host's model service to the neutral port.
 * @param ctx - the plugin context `apply` received.
 * @returns the port the cores call.
 */
export function llmOf(ctx) {
    return ctx.llm;
}
