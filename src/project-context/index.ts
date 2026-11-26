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
import { resolveSharedConfig } from "../shared/config.js";
import { SharedSettingsSchema, publishProjectContextSettings } from "../shared/settings.js";
import { start } from "./start.js";

export const name = "project-context";
export const inject = ["commands"];

/**
 * The shared/archive card: ten keys read by every entry (archive, budgets, `taskMode`, the auxiliary
 * route). Each of the other three entries exports its own narrow schema, so this is one of four cards,
 * not the only one — but it is still the one that publishes, because its ten keys are what the other
 * three overlay onto their own.
 */
export const Config = SharedSettingsSchema;

/**
 * The cordis entry: resolve the config, publish the shared settings namespace, adapt the context to
 * the host-neutral façade and start the core (`start.ts`). This file is the only one in the plugin
 * that names the framework.
 */
export function apply(ctx: Context, rawConfig: unknown): void {
	const entry = resolveSharedConfig(rawConfig);
	const host = hostContextOf(ctx);
	// Publication precedes `start`: the core's first read of the shared settings must already see the
	// live reader, not only the config this entry was applied with.
	publishProjectContextSettings(host, entry);
	start(host, entry);
}
