/**
 * The memory core: the consolidation pass's registrations and the todo fold, behind the host façade.
 *
 * This module registers nothing with a framework. It receives the {@link HostContext} the entry
 * built from its cordis context and only calls `host.on` / `host.registerCommand` /
 * `host.addPromptContext`; the pass and the todo fold receive the narrower {@link HostPorts} /
 * {@link ServiceHost} they actually read.
 *
 * Commands: /memory [status] | update | prune [--apply] | reconcile [--accept <id>]
 */
import type { HostContext, ServiceHost, Session } from "../host/contract.js";
import { type PluginConfig } from "../shared/config.js";
/**
 * Copy one session's todo snapshot into the context document it owns.
 *
 * The document is the session's task's when the binding is in use, else `CONTEXT.md`; a missing
 * document stays missing — this is a mechanical patch on the pass's artifact, not a second creator
 * of one. A `null` projection (no todo write this turn) or an unchanged document writes nothing.
 *
 * No model call and no lock: the write is a read-modify-write of a few lines, and the pass applies
 * the same projection after its own rewrite, so the two can only ever converge on the same block.
 * @param host - the service lookup the projection read takes.
 * @param config - the effective config; `taskMode` decides which document the session owns.
 * @param session - the session whose turn just ended.
 */
export declare function writeTodoSnapshot(host: ServiceHost, config: PluginConfig, session: Session): Promise<void>;
/**
 * Start the plugin behind the façade.
 * @param host - the registration façade and ports the entry built.
 * @param entry - the resolved plugin config, shared with the other three plugins.
 */
export declare function start(host: HostContext, entry: PluginConfig): void;
