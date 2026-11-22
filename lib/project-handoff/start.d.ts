/**
 * The handoff core: the trigger, the injected pressure line and the `/handoff` command, behind the
 * host façade.
 *
 * This module registers nothing with a framework. It receives the {@link HostContext} the entry
 * built from its cordis context and only calls `host.on` / `host.registerCommand` /
 * `host.addPromptContext`; the trigger, the gate and the command helpers receive the narrower
 * `HostPorts` / `ServiceHost` they actually read. See `index.ts` for the plugin's own description.
 *
 * Commands: /handoff [status|now|on|off|threshold auto|<ratio>|budget summary <tokens>|budget recent <tokens>|pending defer|wait|lang auto|zh|en]
 */
import type { HostContext } from "../host/contract.js";
import { type PluginConfig } from "../shared/config.js";
/**
 * Start the plugin behind the façade.
 * @param host - the registration façade and ports the entry built.
 * @param entry - the resolved plugin config, shared with the other three plugins.
 */
export declare function start(host: HostContext, entry: PluginConfig): void;
export declare function movesThreshold(patch: Record<string, unknown> | undefined): boolean;
