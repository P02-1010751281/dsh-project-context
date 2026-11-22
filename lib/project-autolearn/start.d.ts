/**
 * The autolearn core: registration and the pass trigger, behind the host façade.
 *
 * This module registers nothing with a framework. It receives the {@link HostContext} the entry
 * built from its cordis context and only calls `host.on` / `host.registerCommand`; the pass and the
 * expiry transition receive the narrower {@link HostPorts} they actually read.
 *
 * Commands: /autolearn
 */
import type { HostContext } from "../host/contract.js";
import { type PluginConfig } from "../shared/config.js";
/**
 * Start the plugin behind the façade.
 * @param host - the registration façade and ports the entry built.
 * @param entry - the resolved plugin config, shared with the other three plugins.
 */
export declare function start(host: HostContext, entry: PluginConfig): void;
