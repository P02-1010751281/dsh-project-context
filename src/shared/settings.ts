/**
 * Shared settings for the four plugins.
 *
 * dsh 0.1.7-rc.2 removed the runtime `settings.installSection()` registration: a settings form is now
 * **projected from the owning module's exported `Config` schema** and keyed by the Loader entry id
 * (`SettingsForms.schema(entry) = entry.fiber.runtime.Config`, `describe()` reports `ns = entry.id`).
 * The archive plugin therefore exports {@link PluginSettingsSchema} as its `Config`, which makes the
 * `project-context` entry the one editable namespace the web card reads and writes.
 *
 * Every field is marked `.volatile()`, which is what makes the entry appear in that projection at all:
 * `SettingsForms.describe()` runs each schema through `volatileForm()`, which keeps a field only when
 * it — or an ancestor — carries the schemastery `volatile` mark, and returns `undefined` for a schema
 * whose fields are all ordinary. An entry skipped there is served by nobody: no settings namespace, so
 * the card's `whileServed` never fires and the card disappears **without any error anywhere**. The mark
 * also means "a live reference, not a remount trigger"; cordis still restarts the entry on a write
 * (`Fiber.update` → `restart`), so the publication below is refreshed by the owner's next `apply`.
 *
 * All four plugins still share that one namespace: the archive plugin publishes the config its entry
 * was applied with, and the other three read it, so one card edit reaches every feature. Without the
 * archive plugin (or before it applies) each plugin falls back to its own entry config.
 */

import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { DEFAULT_CONFIG, resolvePluginConfig, type PluginConfig } from "./config.js";
import { MAX_MEMORY_CHARS_LIMIT, MIN_MEMORY_CHARS } from "./project-state.js";

/** Settings namespace shared by the four plugins: the Loader entry id the Host projects a form for. */
export const SETTINGS_NAMESPACE = "project-context" as const;

/**
 * Wire schema shown by the web settings card and validated by the host; exported as the owner's `Config`.
 *
 * Fields carry the metadata mark `volatile: true` rather than the `.volatile()` modifier. The modifier
 * sets the same mark but also switches the schema's parse mode to `volatile`, which wraps every value
 * in a live `Volatile` reference: nothing here consumes that reference — each plugin resolves its own
 * config and the owner republishes it after the entry restarts — and the wrapper's inferred type is
 * only nameable through schemastery's pnpm-internal path, so exporting the schema would stop compiling
 * (`TS2742`). The mark alone is what the form projection reads.
 */
export const PluginSettingsSchema = z.object({
	archiveEnabled: z.boolean().default(DEFAULT_CONFIG.archiveEnabled).extra("volatile", true),
	autoConsolidate: z.boolean().default(DEFAULT_CONFIG.autoConsolidate).extra("volatile", true),
	consolidateTurns: z.natural().min(1).default(DEFAULT_CONFIG.consolidateTurns).extra("volatile", true),
	consolidateIntervalMs: z.natural().min(1000).default(DEFAULT_CONFIG.consolidateIntervalMs).extra("volatile", true),
	forceDedupeMs: z.natural().default(DEFAULT_CONFIG.forceDedupeMs).extra("volatile", true),
	maxTokens: z.natural().min(256).default(DEFAULT_CONFIG.maxTokens).extra("volatile", true),
	maxOutputTokens: z.natural().min(256).default(DEFAULT_CONFIG.maxOutputTokens).extra("volatile", true),
	maxMemoryChars: z.natural().min(MIN_MEMORY_CHARS).max(MAX_MEMORY_CHARS_LIMIT).default(DEFAULT_CONFIG.maxMemoryChars).extra("volatile", true),
	provider: z.string().default(DEFAULT_CONFIG.provider).extra("volatile", true),
	model: z.string().default(DEFAULT_CONFIG.model).extra("volatile", true),
	autoLearn: z.boolean().default(DEFAULT_CONFIG.autoLearn).extra("volatile", true),
	autolearnTurns: z.natural().min(1).default(DEFAULT_CONFIG.autolearnTurns).extra("volatile", true),
	autolearnIntervalMs: z.natural().min(1000).default(DEFAULT_CONFIG.autolearnIntervalMs).extra("volatile", true),
	handoffEnabled: z.boolean().default(DEFAULT_CONFIG.handoffEnabled).extra("volatile", true),
	handoffAdaptive: z.boolean().default(DEFAULT_CONFIG.handoffAdaptive).extra("volatile", true),
	handoffThresholdRatio: z.number().min(0.1).max(0.95).default(DEFAULT_CONFIG.handoffThresholdRatio).extra("volatile", true),
	handoffTargetTokens: z.natural().min(8_000).max(200_000).default(DEFAULT_CONFIG.handoffTargetTokens).extra("volatile", true),
	handoffKeepTokens: z.natural().max(200_000).default(DEFAULT_CONFIG.handoffKeepTokens).extra("volatile", true),
	handoffSummaryThinking: z.union(["off", "session"]).default(DEFAULT_CONFIG.handoffSummaryThinking).extra("volatile", true),
	handoffPendingQuestion: z.union(["defer", "wait"]).default(DEFAULT_CONFIG.handoffPendingQuestion).extra("volatile", true),
	handoffLanguage: z.union(["auto", "zh", "en"]).default(DEFAULT_CONFIG.handoffLanguage).extra("volatile", true),
});

let live: (() => PluginConfig) | undefined;
/** Identifies the publication that owns the shared value, so a stale fiber cannot release it. */
let owner = 0;

/**
 * Publish the namespace owner's live config for the other three plugins.
 *
 * dsh keys one projected form by the Loader entry id (`describe()` reports `ns = entry.id`) and reads
 * the schema off the owning module (`entry.fiber.runtime.Config`), so the archive plugin — whose entry
 * id is `project-context` — owns the namespace the web card edits. This function only republishes the
 * value that entry resolves to; the form itself comes from the `Config` export.
 *
 * The published value is a *reader*, not a snapshot: a settings write that touches only volatile
 * fields is committed by the Loader straight into the running fiber's references
 * (`Entry._commitVolatile`) and never restarts the entry, so a snapshot taken here would leave the
 * card's writes frozen — visible in the form and inert everywhere else.
 *
 * The publication is released with the owning fiber. A config change that restarts the entry makes the
 * Loader build the new fiber before disposing the old one, so only the newest publication may clear it,
 * and the reload republishes on apply.
 * @param ctx - plugin context owning the effect and the resolved config.
 * @param entry - the config this owner entry was applied with, used when its fiber is gone or its
 * config does not resolve.
 */
export function publishProjectContextSettings(ctx: Context, entry: PluginConfig): void {
	const token = ++owner;
	live = () => {
		const resolved = (ctx as { fiber?: { config?: unknown } }).fiber?.config;
		if (resolved === undefined) return entry;
		try {
			return resolvePluginConfig(resolved);
		} catch {
			// Every one of these values comes from this module's own schema, so a shape that does not
			// resolve is a bug — but it must not take down each caller's event handler. Fall back to
			// the values this entry was applied with.
			return entry;
		}
	};
	ctx.effect(() => () => {
		if (owner !== token) return;
		live = undefined;
	}, "project-context: settings namespace");
}

/** Live effective config: the owner's published value, else the caller's own entry config. */
export function effectivePluginConfig(fallback: PluginConfig): PluginConfig {
	return live?.() ?? fallback;
}
