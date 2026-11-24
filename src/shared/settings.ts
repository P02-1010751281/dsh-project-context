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
 * Batch AC gave each of the four entries its own card, so this module now exports four schemas. The
 * publisher is still the archive entry: its nine keys are the ones every entry reads, and the other
 * three overlay them onto their own keys on every read.
 */

import type { HostContext } from "../host/contract.js";
import z from "@deepseek-ai/schemastery";
import { DEFAULT_CONFIG, SHARED_KEYS, resolveSharedConfig, type PluginConfig } from "./config.js";
import {
	MAX_HANDOFF_RECENT_TOKENS,
	MAX_HANDOFF_SUMMARY_TOKENS,
	MIN_HANDOFF_RECENT_TOKENS,
	MIN_HANDOFF_SUMMARY_TOKENS,
} from "./limits.js";
import { MAX_MEMORY_CHARS_LIMIT, MIN_MEMORY_CHARS } from "./project-state.js";
import { formatThresholdSpec } from "./threshold-spec.js";

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
export const SharedSettingsSchema = z.object({
	archiveEnabled: z.boolean().default(DEFAULT_CONFIG.archiveEnabled).extra("volatile", true),
	sessionSettledDays: z.natural().min(1).max(365).default(DEFAULT_CONFIG.sessionSettledDays).extra("volatile", true),
	forceDedupeMs: z.natural().default(DEFAULT_CONFIG.forceDedupeMs).extra("volatile", true),
	maxTokens: z.natural().min(256).default(DEFAULT_CONFIG.maxTokens).extra("volatile", true),
	maxOutputTokens: z.natural().min(256).default(DEFAULT_CONFIG.maxOutputTokens).extra("volatile", true),
	maxMemoryChars: z.natural().min(MIN_MEMORY_CHARS).max(MAX_MEMORY_CHARS_LIMIT).default(DEFAULT_CONFIG.maxMemoryChars).extra("volatile", true),
	taskMode: z.union(["assisted", "delegated", "manual"]).default(DEFAULT_CONFIG.taskMode).extra("volatile", true),
	provider: z.string().default(DEFAULT_CONFIG.provider).extra("volatile", true),
	model: z.string().default(DEFAULT_CONFIG.model).extra("volatile", true),
	// Read by every entry through `receiptLanguage`, not just by handoff: it is the explicit language
	// override for all four command surfaces, so it belongs to the card everyone reads.
	handoffLang: z.union(["auto", "zh", "en"]).default(DEFAULT_CONFIG.handoffLang).extra("volatile", true),
});

/** The memory entry's own three keys; `Config` in `src/project-memory/index.ts` is this schema. */
export const MemorySettingsSchema = z.object({
	memoryEnabled: z.boolean().default(DEFAULT_CONFIG.memoryEnabled).extra("volatile", true),
	consolidateTurns: z.natural().min(1).default(DEFAULT_CONFIG.consolidateTurns).extra("volatile", true),
	consolidateIntervalMs: z.natural().min(1000).default(DEFAULT_CONFIG.consolidateIntervalMs).extra("volatile", true),
});

/** The autolearn entry's own four keys. */
export const AutolearnSettingsSchema = z.object({
	autolearnEnabled: z.boolean().default(DEFAULT_CONFIG.autolearnEnabled).extra("volatile", true),
	autolearnExpireSkills: z.boolean().default(DEFAULT_CONFIG.autolearnExpireSkills).extra("volatile", true),
	autolearnTurns: z.natural().min(1).default(DEFAULT_CONFIG.autolearnTurns).extra("volatile", true),
	autolearnIntervalMs: z.natural().min(1000).default(DEFAULT_CONFIG.autolearnIntervalMs).extra("volatile", true),
});

/** The handoff entry's own seven keys. */
export const HandoffSettingsSchema = z.object({
	handoffEnabled: z.boolean().default(DEFAULT_CONFIG.handoffEnabled).extra("volatile", true),
	handoffThreshold: z.string().default(formatThresholdSpec(DEFAULT_CONFIG.handoffThreshold)).extra("volatile", true),
	handoffBudgetSummaryTokens: z.natural().min(MIN_HANDOFF_SUMMARY_TOKENS).max(MAX_HANDOFF_SUMMARY_TOKENS).default(DEFAULT_CONFIG.handoffBudgetSummaryTokens).extra("volatile", true),
	handoffBudgetRecentTokens: z.natural().min(MIN_HANDOFF_RECENT_TOKENS).max(MAX_HANDOFF_RECENT_TOKENS).default(DEFAULT_CONFIG.handoffBudgetRecentTokens).extra("volatile", true),
	handoffPendingQuestion: z.union(["defer", "wait"]).default(DEFAULT_CONFIG.handoffPendingQuestion).extra("volatile", true),
	handoffRetireReplaced: z.boolean().default(DEFAULT_CONFIG.handoffRetireReplaced).extra("volatile", true),
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
 * @param host - the plugin's facility set; the publication is released with it.
 * @param entry - the config this owner entry was applied with, used when its fiber is gone or its
 * config does not resolve.
 */
export function publishProjectContextSettings(host: HostContext, entry: PluginConfig): void {
	const token = ++owner;
	live = () => readLiveSettings(host, entry);
	host.onDispose(() => {
		if (owner !== token) return;
		live = undefined;
	}, "project-context: settings namespace");
}

/**
 * The current settings this entry resolves to, read through the host's port.
 *
 * Three degradations, each returning the value the entry was applied with: the host cannot read its
 * own settings (`current()` throws), it publishes nothing (`undefined`), or what it publishes is not
 * this module's shape. The last one is a bug in our own schema — but it must not take down each
 * caller's event handler, so it degrades the same way.
 */
function readLiveSettings(host: HostContext, entry: PluginConfig): PluginConfig {
	let resolved: unknown;
	try {
		resolved = host.settings.current();
	} catch {
		return entry;
	}
	if (resolved === undefined) return entry;
	try {
		// Resolved on every read, never cached: the host hands each field over as a live reference whose
		// value changes under the same object, so caching by object identity would freeze a write out.
		//
		// Only this card's keys are handed to the resolver: a fiber's config carries every key the entry
		// declares, and a card resolver rejects a key another card owns, so passing the whole object would
		// always throw and silently pin every read to the applied default.
		return { ...DEFAULT_CONFIG, ...resolveSharedConfig(sharedKeysOf(resolved)) };
	} catch {
		return entry;
	}
}

/**
 * Narrow a raw config object to the shared nine.
 *
 * The publisher's fiber config carries every key the entry declares, and a card resolver rejects a key
 * it does not own — so the publication must hand over only what it is responsible for.
 * @param raw - an object as the host exposes it.
 * @returns an object holding just the shared keys it found.
 */
function sharedKeysOf(raw: unknown): Record<string, unknown> {
	if (typeof raw !== "object" || raw === null) return {};
	const source = raw as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	for (const key of SHARED_KEYS) if (key in source) out[key] = source[key];
	return out;
}

/** The nine keys whose value is shared across entries, owned by the `project-context` entry. */
export type SharedSettings = Pick<PluginConfig, (typeof SHARED_KEYS)[number]>;

/** Cut a full config down to the shared nine. */
export function sharedOf(config: PluginConfig): SharedSettings {
	const out: Partial<SharedSettings> = {};
	for (const key of SHARED_KEYS) (out as Record<string, unknown>)[key] = config[key];
	return out as SharedSettings;
}

/**
 * The shared values currently in force.
 *
 * Read through the owner's publication on every call, never snapshotted: a volatile-only save is
 * committed straight into the running fiber's live references and does not restart the entry, so a
 * snapshot would show the save in the form and leave it inert everywhere else.
 * @param fallback - the caller's own entry config, used when the owner never applied.
 * @returns the shared nine, from the owner if it is live.
 */
export function effectiveSharedSettings(fallback: PluginConfig): SharedSettings {
	return sharedOf(live?.() ?? fallback);
}

/**
 * Overlay the shared nine onto a feature card's own keys.
 *
 * A feature entry's resolver only fills its own keys, so reading a shared key off it would silently read
 * a default. This is the one way to get the whole config a feature actually runs with.
 * @param own - the feature card's own resolved config.
 * @param shared - the shared nine currently in force.
 * @returns one full config: `shared` for the nine, `own` for everything else.
 */
export function withShared(own: PluginConfig, shared: SharedSettings): PluginConfig {
	return { ...own, ...shared };
}

/**
 * Re-resolve this entry's own config on every read.
 *
 * The value `apply` received is a snapshot; a volatile-only settings write never restarts the entry, so
 * only the fiber's live config shows a later save. Three degradations each return the applied value:
 * the host has no fiber, it publishes nothing, or what it publishes does not resolve.
 * @param host - the entry's host façade.
 * @param fallback - the config this entry was applied with.
 * @param resolve - this card's resolver.
 * @returns the config currently in force for this entry.
 */
export function livePluginConfig(host: HostContext, fallback: PluginConfig, resolve: (raw: unknown) => PluginConfig): PluginConfig {
	let raw: unknown;
	try {
		raw = host.settings.current();
	} catch {
		return fallback;
	}
	if (raw === undefined) return fallback;
	try {
		return resolve(raw);
	} catch {
		return fallback;
	}
}
