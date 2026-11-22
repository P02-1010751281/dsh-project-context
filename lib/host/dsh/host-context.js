import { onDispose } from "./lifecycle.js";
import { logOf } from "./log.js";
const listenersFit = {
    "agent/created": true,
    "agent/status": true,
    "agent/disposed": true,
    "session/event": true,
    "session/flush": true,
    "session/disposed": true,
};
void listenersFit;
/** The contract's command shape, checked against the host's declaration. */
function commandDefinition(command) {
    return command;
}
/** The contract's prompt contribution, checked against the host's declaration. */
function promptContext(contribution) {
    return contribution;
}
/**
 * Adapt one plugin's cordis context to the façade.
 * @param ctx - the plugin context `apply` received.
 * @returns the façade the core starts with.
 */
export function hostContextOf(ctx) {
    return {
        on(name, listener) {
            // The generic `K` cannot be narrowed per key here; `ListenerFits` above checks every pair.
            ctx.on(name, listener);
        },
        registerCommand(command) {
            ctx.commands.register(commandDefinition(command));
        },
        addPromptContext(contribution) {
            ctx.systemPrompt.context(promptContext(contribution));
        },
        onDispose(cleanup, label) {
            onDispose(ctx, cleanup, label);
        },
        // Read on use, as `logOf(ctx)` was at every former call site.
        get log() {
            return logOf(ctx);
        },
        services: ctx,
    };
}
