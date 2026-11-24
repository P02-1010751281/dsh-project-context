/**
 * project-context — the session archive (pass ①, no model calls).
 *
 * Writes the per-session raw JSONL and Markdown rendering plus the mechanical
 * session index under `.agents/memory/session-logs/`. Distilling the archive
 * into CONTEXT.md/MEMORY.md is the memory feature (`project-memory`); reading
 * it back for skills is autolearn (`project-autolearn`); pointing a fresh
 * session at it is handoff (`project-handoff`).
 *
 * Commands: /context, /session-log (bare = read state, `write` = write now, `tree` = the handoff lineage,
 * `import <archive…>` = backfill)
 */

import type { Context } from "../host/contract.js";
import { hostContextOf } from "../host/dsh/host-context.js";
import { resolvePluginConfig } from "../shared/config.js";
import { PluginSettingsSchema, publishProjectContextSettings } from "../shared/settings.js";
import { start } from "./start.js";

export const name = "project-context";
export const inject = ["commands"];

/**
 * The settings schema the Host projects into the Plugins page, and the one namespace all four
 * plugins share: the entry id below (`project-context`) is what the web card edits, and
 * {@link publishProjectContextSettings} republishes the value this entry was applied with.
 */
export const Config = PluginSettingsSchema;

/**
 * The cordis entry: resolve the config, publish the shared settings namespace, adapt the context to
 * the host-neutral façade and start the core (`start.ts`). This file is the only one in the plugin
 * that names the framework.
 */
export function apply(ctx: Context, rawConfig: unknown): void {
	const entry = resolvePluginConfig(rawConfig);
	const host = hostContextOf(ctx);
	// Publication precedes `start`: the core's first read of the shared settings must already see the
	// live reader, not only the config this entry was applied with.
	publishProjectContextSettings(host, entry);
	start(host, entry);
}
