/**
 * project-context core — the session archive (pass ①, no model calls).
 *
 * Host-neutral: it receives a {@link HostContext} from the plugin entry (`index.ts`) and registers its
 * lifecycle listeners and commands through it. See `index.ts` for the plugin's own description.
 *
 * Commands: /context, /session-log (bare = read state, `write` = write now, `tree` = the handoff lineage,
 * `import <archive…>` = backfill)
 */
import type { HostContext } from "../host/contract.js";
import type { PluginConfig } from "../shared/config.js";
/**
 * Start the archive core: register its lifecycle listeners and its two commands.
 * @param host - the registration façade the entry adapted from its harness context.
 * @param entry - the config this plugin entry was applied with; every read goes through
 * `effectivePluginConfig(entry)` so a settings write reaches it without a restart.
 */
export declare function start(host: HostContext, entry: PluginConfig): void;
