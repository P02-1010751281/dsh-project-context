/**
 * Shared settings namespace for the context pair.
 *
 * The namespace is owned by whichever plugin of this package loads first;
 * both plugins read the same live value. While a settings provider is mounted,
 * the user layer resolves over the plugin's composition entry config; without
 * one, the entry config stays authoritative.
 */

import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import type {} from "@deepseek-ai/dsh-settings";
import { DEFAULT_CONFIG, type PluginConfig } from "./config.js";

/** Settings namespace shared by `project-context` and `project-memory`. */
export const SETTINGS_NAMESPACE = "project-context" as const;

/** Wire schema shown by the web settings card and validated by the host. */
export const PluginSettingsSchema = z.object({
	archiveEnabled: z.boolean().default(DEFAULT_CONFIG.archiveEnabled),
	autoConsolidate: z.boolean().default(DEFAULT_CONFIG.autoConsolidate),
	consolidateTurns: z.natural().min(1).default(DEFAULT_CONFIG.consolidateTurns),
	consolidateIntervalMs: z.natural().min(1000).default(DEFAULT_CONFIG.consolidateIntervalMs),
	forceDedupeMs: z.natural().default(DEFAULT_CONFIG.forceDedupeMs),
	maxTokens: z.natural().min(256).default(DEFAULT_CONFIG.maxTokens),
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
});

let installed = false;
let source: (() => PluginConfig) | undefined;
/** Identifies the installation that owns the guard, so a stale fiber cannot release it. */
let generation = 0;

/** Attach the shared namespace once per loaded plugin, with the entry config as the base layer. */
export function installProjectContextSettings(ctx: Context, entry: PluginConfig): void {
	if (installed) return;
	installed = true;
	// The guard is released with the owning fiber. Were it process-global, a reload
	// would find `installed` already true, never re-register the namespace, and the
	// settings card plus the user layer would stay gone for the rest of the process.
	const token = ++generation;
	ctx.effect(() => () => {
		// An update can build the new fiber before the old one is disposed; only the
		// installation that still owns the guard may release it.
		if (generation !== token) return;
		installed = false;
		source = undefined;
	}, "project-context: settings namespace");
	ctx.inject(["settings"], (settingsCtx) => {
		settingsCtx.settings.installSection(ctx, SETTINGS_NAMESPACE, PluginSettingsSchema, entry, {
			setSource: (current) => {
				source = current;
			},
			onChange: () => {
				// Reads go through the thunk; nothing derived needs re-judging.
			},
		});
	});
}

/** Live effective config: settings source when attached, else the plugin entry config. */
export function effectivePluginConfig(fallback: PluginConfig): PluginConfig {
	if (!source) return fallback;
	try {
		return source();
	} catch {
		return fallback;
	}
}
