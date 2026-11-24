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
import { SHARED_KEYS, type PluginConfig } from "./config.js";
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
export declare const SharedSettingsSchema: z<Schemastery.ObjectS<{
    archiveEnabled: z<boolean, boolean>;
    sessionSettledDays: z<number, number>;
    forceDedupeMs: z<number, number>;
    maxTokens: z<number, number>;
    maxOutputTokens: z<number, number>;
    maxMemoryChars: z<number, number>;
    taskMode: z<"assisted" | "delegated" | "manual", "assisted" | "delegated" | "manual">;
    provider: z<string, string>;
    model: z<string, string>;
    handoffLang: z<"zh" | "en" | "auto", "zh" | "en" | "auto">;
}>, Schemastery.ObjectT<{
    archiveEnabled: z<boolean, boolean>;
    sessionSettledDays: z<number, number>;
    forceDedupeMs: z<number, number>;
    maxTokens: z<number, number>;
    maxOutputTokens: z<number, number>;
    maxMemoryChars: z<number, number>;
    taskMode: z<"assisted" | "delegated" | "manual", "assisted" | "delegated" | "manual">;
    provider: z<string, string>;
    model: z<string, string>;
    handoffLang: z<"zh" | "en" | "auto", "zh" | "en" | "auto">;
}>>;
/** The memory entry's own three keys; `Config` in `src/project-memory/index.ts` is this schema. */
export declare const MemorySettingsSchema: z<Schemastery.ObjectS<{
    memoryEnabled: z<boolean, boolean>;
    consolidateTurns: z<number, number>;
    consolidateIntervalMs: z<number, number>;
}>, Schemastery.ObjectT<{
    memoryEnabled: z<boolean, boolean>;
    consolidateTurns: z<number, number>;
    consolidateIntervalMs: z<number, number>;
}>>;
/** The autolearn entry's own four keys. */
export declare const AutolearnSettingsSchema: z<Schemastery.ObjectS<{
    autolearnEnabled: z<boolean, boolean>;
    autolearnExpireSkills: z<boolean, boolean>;
    autolearnTurns: z<number, number>;
    autolearnIntervalMs: z<number, number>;
}>, Schemastery.ObjectT<{
    autolearnEnabled: z<boolean, boolean>;
    autolearnExpireSkills: z<boolean, boolean>;
    autolearnTurns: z<number, number>;
    autolearnIntervalMs: z<number, number>;
}>>;
/** The handoff entry's own seven keys. */
export declare const HandoffSettingsSchema: z<Schemastery.ObjectS<{
    handoffEnabled: z<boolean, boolean>;
    handoffThreshold: z<string, string>;
    handoffBudgetSummaryTokens: z<number, number>;
    handoffBudgetRecentTokens: z<number, number>;
    handoffPendingQuestion: z<"defer" | "wait", "defer" | "wait">;
    handoffRetireReplaced: z<boolean, boolean>;
}>, Schemastery.ObjectT<{
    handoffEnabled: z<boolean, boolean>;
    handoffThreshold: z<string, string>;
    handoffBudgetSummaryTokens: z<number, number>;
    handoffBudgetRecentTokens: z<number, number>;
    handoffPendingQuestion: z<"defer" | "wait", "defer" | "wait">;
    handoffRetireReplaced: z<boolean, boolean>;
}>>;
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
export declare function publishProjectContextSettings(host: HostContext, entry: PluginConfig): void;
/** The nine keys whose value is shared across entries, owned by the `project-context` entry. */
export type SharedSettings = Pick<PluginConfig, (typeof SHARED_KEYS)[number]>;
/** Cut a full config down to the shared nine. */
export declare function sharedOf(config: PluginConfig): SharedSettings;
/**
 * The shared values currently in force.
 *
 * Read through the owner's publication on every call, never snapshotted: a volatile-only save is
 * committed straight into the running fiber's live references and does not restart the entry, so a
 * snapshot would show the save in the form and leave it inert everywhere else.
 * @param fallback - the caller's own entry config, used when the owner never applied.
 * @returns the shared nine, from the owner if it is live.
 */
export declare function effectiveSharedSettings(fallback: PluginConfig): SharedSettings;
/**
 * Overlay the shared nine onto a feature card's own keys.
 *
 * A feature entry's resolver only fills its own keys, so reading a shared key off it would silently read
 * a default. This is the one way to get the whole config a feature actually runs with.
 * @param own - the feature card's own resolved config.
 * @param shared - the shared nine currently in force.
 * @returns one full config: `shared` for the nine, `own` for everything else.
 */
export declare function withShared(own: PluginConfig, shared: SharedSettings): PluginConfig;
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
export declare function livePluginConfig(host: HostContext, fallback: PluginConfig, resolve: (raw: unknown) => PluginConfig): PluginConfig;
