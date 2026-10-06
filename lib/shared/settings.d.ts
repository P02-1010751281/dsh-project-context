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
import { type PluginConfig } from "./config.js";
/** Settings namespace shared by the four plugins: the Loader entry id the Host projects a form for. */
export declare const SETTINGS_NAMESPACE: "project-context";
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
export declare const PluginSettingsSchema: z<Schemastery.ObjectS<{
    archiveEnabled: z<boolean, boolean>;
    memoryEnabled: z<boolean, boolean>;
    consolidateTurns: z<number, number>;
    consolidateIntervalMs: z<number, number>;
    forceDedupeMs: z<number, number>;
    maxTokens: z<number, number>;
    maxOutputTokens: z<number, number>;
    maxMemoryChars: z<number, number>;
    provider: z<string, string>;
    model: z<string, string>;
    autolearnEnabled: z<boolean, boolean>;
    autolearnTurns: z<number, number>;
    autolearnIntervalMs: z<number, number>;
    handoffEnabled: z<boolean, boolean>;
    handoffThresholdAuto: z<boolean, boolean>;
    handoffThresholdRatio: z<number, number>;
    handoffBudgetSummaryTokens: z<number, number>;
    handoffBudgetRecentTokens: z<number, number>;
    handoffPendingQuestion: z<"defer" | "wait", "defer" | "wait">;
    handoffLang: z<"auto" | "zh" | "en", "auto" | "zh" | "en">;
}>, Schemastery.ObjectT<{
    archiveEnabled: z<boolean, boolean>;
    memoryEnabled: z<boolean, boolean>;
    consolidateTurns: z<number, number>;
    consolidateIntervalMs: z<number, number>;
    forceDedupeMs: z<number, number>;
    maxTokens: z<number, number>;
    maxOutputTokens: z<number, number>;
    maxMemoryChars: z<number, number>;
    provider: z<string, string>;
    model: z<string, string>;
    autolearnEnabled: z<boolean, boolean>;
    autolearnTurns: z<number, number>;
    autolearnIntervalMs: z<number, number>;
    handoffEnabled: z<boolean, boolean>;
    handoffThresholdAuto: z<boolean, boolean>;
    handoffThresholdRatio: z<number, number>;
    handoffBudgetSummaryTokens: z<number, number>;
    handoffBudgetRecentTokens: z<number, number>;
    handoffPendingQuestion: z<"defer" | "wait", "defer" | "wait">;
    handoffLang: z<"auto" | "zh" | "en", "auto" | "zh" | "en">;
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
 * @param ctx - plugin context owning the effect and the resolved config.
 * @param entry - the config this owner entry was applied with, used when its fiber is gone or its
 * config does not resolve.
 */
export declare function publishProjectContextSettings(ctx: Context, entry: PluginConfig): void;
/** Live effective config: the owner's published value, else the caller's own entry config. */
export declare function effectivePluginConfig(fallback: PluginConfig): PluginConfig;
