/**
 * Shared settings for the four plugins.
 *
 * dsh 0.1.7-rc.2 removed the runtime `settings.installSection()` registration: a settings form is now
 * **projected from the owning module's exported `Config` schema** and keyed by the Loader entry id
 * (`SettingsForms.schema(entry) = entry.fiber.runtime.Config`, `describe()` reports `ns = entry.id`).
 * The archive plugin therefore exports {@link PluginSettingsSchema} as its `Config`, which makes the
 * `project-context` entry the one editable namespace the web card reads and writes.
 *
 * All four plugins still share that one namespace: the archive plugin publishes the config its entry
 * was applied with, and the other three read it, so one card edit reaches every feature. Without the
 * archive plugin (or before it applies) each plugin falls back to its own entry config.
 */

import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { DEFAULT_CONFIG, type PluginConfig } from "./config.js";
import { MAX_MEMORY_CHARS_LIMIT, MIN_MEMORY_CHARS } from "./project-state.js";

/** Settings namespace shared by the four plugins: the Loader entry id the Host projects a form for. */
export const SETTINGS_NAMESPACE = "project-context" as const;

/** Wire schema shown by the web settings card and validated by the host; exported as the owner's `Config`. */
export const PluginSettingsSchema = z.object({
	archiveEnabled: z.boolean().default(DEFAULT_CONFIG.archiveEnabled),
	autoConsolidate: z.boolean().default(DEFAULT_CONFIG.autoConsolidate),
	consolidateTurns: z.natural().min(1).default(DEFAULT_CONFIG.consolidateTurns),
	consolidateIntervalMs: z.natural().min(1000).default(DEFAULT_CONFIG.consolidateIntervalMs),
	forceDedupeMs: z.natural().default(DEFAULT_CONFIG.forceDedupeMs),
	maxTokens: z.natural().min(256).default(DEFAULT_CONFIG.maxTokens),
	maxOutputTokens: z.natural().min(256).default(DEFAULT_CONFIG.maxOutputTokens),
	maxMemoryChars: z.natural().min(MIN_MEMORY_CHARS).max(MAX_MEMORY_CHARS_LIMIT).default(DEFAULT_CONFIG.maxMemoryChars),
	provider: z.string().default(DEFAULT_CONFIG.provider),
	model: z.string().default(DEFAULT_CONFIG.model),
	autoLearn: z.boolean().default(DEFAULT_CONFIG.autoLearn),
	autolearnTurns: z.natural().min(1).default(DEFAULT_CONFIG.autolearnTurns),
	autolearnIntervalMs: z.natural().min(1000).default(DEFAULT_CONFIG.autolearnIntervalMs),
	handoffEnabled: z.boolean().default(DEFAULT_CONFIG.handoffEnabled),
	handoffAdaptive: z.boolean().default(DEFAULT_CONFIG.handoffAdaptive),
	handoffThresholdRatio: z.number().min(0.1).max(0.95).default(DEFAULT_CONFIG.handoffThresholdRatio),
	handoffTargetTokens: z.natural().min(8_000).max(200_000).default(DEFAULT_CONFIG.handoffTargetTokens),
	handoffKeepTokens: z.natural().max(200_000).default(DEFAULT_CONFIG.handoffKeepTokens),
	handoffSummaryThinking: z.union(["off", "session"]).default(DEFAULT_CONFIG.handoffSummaryThinking),
	handoffPendingQuestion: z.union(["defer", "wait"]).default(DEFAULT_CONFIG.handoffPendingQuestion),
	handoffLanguage: z.union(["auto", "zh", "en"]).default(DEFAULT_CONFIG.handoffLanguage),
});

let live: PluginConfig | undefined;
/** Identifies the publication that owns the shared value, so a stale fiber cannot release it. */
let owner = 0;

/**
 * Publish the namespace owner's live config for the other three plugins.
 *
 * dsh keys one projected form by the Loader entry id (`describe()` reports `ns = entry.id`) and reads
 * the schema off the owning module (`entry.fiber.runtime.Config`), so the archive plugin — whose entry
 * id is `project-context` — owns the namespace the web card edits. This function only republishes the
 * value that entry was applied with; the form itself comes from the `Config` export.
 *
 * The publication is released with the owning fiber. A config edit makes the Loader build the new
 * fiber before disposing the old one, so only the newest publication may clear it, and the reload
 * republishes on apply.
 * @param ctx - plugin context owning the effect.
 * @param entry - the resolved config this owner entry was applied with.
 */
export function publishProjectContextSettings(ctx: Context, entry: PluginConfig): void {
	const token = ++owner;
	live = entry;
	ctx.effect(() => () => {
		if (owner !== token) return;
		live = undefined;
	}, "project-context: settings namespace");
}

/** Live effective config: the owner's published value, else the caller's own entry config. */
export function effectivePluginConfig(fallback: PluginConfig): PluginConfig {
	return live ?? fallback;
}
