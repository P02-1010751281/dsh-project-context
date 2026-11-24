/**
 * The dsh implementation of the registration façade ({@link HostContext} in `../contract.ts`).
 *
 * A plugin entry calls {@link hostContextOf} once with its cordis `Context` and hands the result to
 * its core's `start(host)`. Every method forwards to the cordis call the entry used to make itself,
 * with the same arguments, so the registrations are owned by the same fiber and released by the same
 * disposal as before; nothing is wrapped or reordered.
 *
 * The compile-time checks below are the mapping's proof: each contract event listener, the command
 * registration and the prompt contribution must be assignable to the host's own declaration. If dsh
 * changes a payload so that a core would read something the host no longer sends, this file stops
 * compiling instead of a core failing at runtime.
 */
import type { Events } from "@deepseek-ai/cordis";
import type { CommandDefinition } from "@deepseek-ai/dsh-commands";
import type { PromptContext } from "@deepseek-ai/dsh-system-prompt";
import type { CommandRegistration, Context, HostContext, HostEvents, HostLog, LlmPort, PromptContribution, SettingsPort } from "../contract.js";
import { onDispose } from "./lifecycle.js";
import { llmOf } from "./llm.js";
import { logOf } from "./log.js";

/** Fails to compile when a contract listener is not a valid listener for the host event of that name. */
type ListenerFits = { [K in keyof HostEvents]: HostEvents[K] extends Events[K] ? true : never };
const listenersFit: ListenerFits = {
	"agent/created": true,
	"agent/status": true,
	"agent/disposed": true,
	"session/event": true,
	"session/flush": true,
	"session/disposed": true,
};
void listenersFit;

/**
 * `interpolate` is part of the host's `PromptContext` since 0.2.x; the pinned
 * `@deepseek-ai/dsh-system-prompt` types this package builds against (0.1.7-rc.2) predate it, and a
 * host that does not know the flag ignores it.
 */
type HostPromptContext = PromptContext & { readonly interpolate?: boolean };

/** The contract's command shape, checked against the host's declaration. */
function commandDefinition(command: CommandRegistration): CommandDefinition {
	return command;
}

/** The contract's prompt contribution, checked against the host's declaration. */
function promptContext(contribution: PromptContribution): HostPromptContext {
	return contribution;
}

/**
 * Adapt one plugin's cordis context to the façade.
 * @param ctx - the plugin context `apply` received.
 * @returns the façade the core starts with.
 */
export function hostContextOf(ctx: Context): HostContext {
	return {
		on(name, listener) {
			// The generic `K` cannot be narrowed per key here; `ListenerFits` above checks every pair.
			(ctx.on as (name: string, listener: (...args: never[]) => unknown) => unknown)(name, listener as (...args: never[]) => unknown);
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
		get log(): HostLog {
			return logOf(ctx);
		},
		services: ctx,
		// Read on use, as `llmOf(ctx)` was at every former call site.
		get llm(): LlmPort {
			return llmOf(ctx);
		},
		// The Loader commits a volatile-only settings write into the running fiber's references, so the
		// config must be read through that fiber on every call rather than captured here.
		get settings(): SettingsPort {
			return { current: () => (ctx as { fiber?: { config?: unknown } }).fiber?.config };
		},
	};
}
