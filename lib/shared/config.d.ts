/**
 * Shared plugin configuration for the context pair.
 *
 * A key mirrors the thing that changes it: the command path where one exists — `/handoff budget summary`
 * writes `handoffBudgetSummaryTokens` — and otherwise the settings card, which is the only writer of the
 * two capability switches (`memoryEnabled`, `autolearnEnabled`; dsh has no `/memory on|off`). The card,
 * the command and the stored profile then spell one fact one way.
 *
 * Renaming one of these keys is a breaking change rather than a rename: the platform persists them
 * into each profile's own `cordis.patch.yml`, this repo cannot rewrite that file, and the type check
 * below throws on a key it does not know. The seven renames landed 2026-10-05 with no compatibility
 * reader on purpose — an alias nothing can retire is worse than a loud apply-time failure.
 */
export interface PluginConfig {
    /** Write the per-session archive (session.jsonl / session.md / INDEX.md) on turns and settles. Explicit commands still work when false. */
    archiveEnabled: boolean;
    /** Run the automatic consolidation pass after turns settle. Commands still work when false. */
    memoryEnabled: boolean;
    /** User turns accumulated before an automatic consolidation pass. */
    consolidateTurns: number;
    /** Minimum wall-clock gap between automatic consolidation passes. */
    consolidateIntervalMs: number;
    /** Suppress an almost-immediate duplicate forced pass. */
    forceDedupeMs: number;
    /** Output cap for every auxiliary model call (consolidation, autolearn). */
    maxTokens: number;
    /** Output cap for auxiliary passes whose answer can need more room than `maxTokens`. */
    maxOutputTokens: number;
    /** Cap on the rendered memory document, in characters; an over-cap memory is cut on a line boundary and marked. */
    maxMemoryChars: number;
    /** Optional auxiliary-call route override; must be set together with `model`. */
    provider: string;
    /** Optional auxiliary-call route override; must be set together with `provider`. */
    model: string;
    /** Run the low-frequency autolearn (skill distillation) pass after turns settle. */
    autolearnEnabled: boolean;
    /** Accumulated user turns before an automatic autolearn pass. */
    autolearnTurns: number;
    /** Minimum wall-clock gap between automatic autolearn passes. */
    autolearnIntervalMs: number;
    /** Start an automatic handoff when a top-level session approaches its context limit. */
    handoffEnabled: boolean;
    /** Adaptive threshold derived from window/target/keep instead of a fixed ratio. */
    handoffThresholdAuto: boolean;
    /** Context-window fraction (0.1–0.95) used when `handoffThresholdAuto` is false. */
    handoffThresholdRatio: number;
    /** Adaptive mode: the trigger request the pass reports (no model call reads it). */
    handoffBudgetSummaryTokens: number;
    /** Recent conversation tokens carried into the continuation verbatim (0 = no verbatim tail). */
    handoffBudgetRecentTokens: number;
    /** Automatic handoff when the last assistant message is a question: "defer" waits for the answer, "wait" hands off and carries the question into the continuation. */
    handoffPendingQuestion: "defer" | "wait";
    /** Handoff scaffolding language: "auto" follows the conversation, otherwise "zh" or "en". */
    handoffLang: "auto" | "zh" | "en";
}
export declare const DEFAULT_CONFIG: PluginConfig;
/** Validate one raw cordis config object and apply defaults. Throws on unknown keys or bad types. */
export declare function resolvePluginConfig(raw: unknown): PluginConfig;
