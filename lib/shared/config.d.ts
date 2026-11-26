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
import { type ThresholdSpec } from "./threshold-spec.js";
/** Who may create a task and what may change its status; the enum behind `taskMode`. */
export type TaskMode = "assisted" | "delegated" | "manual";
export interface PluginConfig {
    /** Write the per-session archive (session.jsonl / session.md / INDEX.md) on turns and settles. Explicit commands still work when false. */
    archiveEnabled: boolean;
    /** Days without activity before a session counts as settled; a handoff continuation with no human turn older than this is called abandoned. */
    sessionSettledDays: number;
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
    /**
     * How a task may come into existence, and what may change its status.
     *
     * `assisted` (the default) and `manual` both refuse a bare slug that names no existing task, so
     * creating one always carries the user's confirmation; `delegated` accepts the bare slug as the
     * declaration and creates the file. Status: `manual` never derives a status from age, the other
     * two do, and only `delegated` auto-archives a task that has been dormant past its horizon.
     */
    taskMode: TaskMode;
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
    /** Move a learned skill whose cited files are all gone out of the harness's view; runs before the pass, and without it. */
    autolearnExpireSkills: boolean;
    /** Start an automatic handoff when a top-level session approaches its context limit. */
    handoffEnabled: boolean;
    /**
     * Where the handoff trigger sits — the one fact `/handoff threshold`, the settings card and the
     * stored profile have to agree on. The stored value is a string (`auto`, `0.4`/`40`/`40%`, or a
     * token count such as `400k`); {@link parseThresholdSpec} is its only reader, so a fraction that is
     * out of range stays a refusal instead of silently becoming a count.
     */
    handoffThreshold: ThresholdSpec;
    /** Adaptive mode: the trigger request the pass reports (no model call reads it). */
    handoffBudgetSummaryTokens: number;
    /** Recent conversation tokens carried into the continuation verbatim (0 = no verbatim tail). */
    handoffBudgetRecentTokens: number;
    /** Automatic handoff when the last assistant message is a question: "defer" waits for the answer, "wait" hands off and carries the question into the continuation. */
    handoffPendingQuestion: "defer" | "wait";
    /** Handoff scaffolding language: "auto" follows the conversation, otherwise "zh" or "en". */
    handoffLang: "auto" | "zh" | "en";
    /**
     * Archive (dsh's "hide from the workspace list") the session a handoff replaced, after stopping
     * whatever still runs in it. On by default because a handoff *forks*: the replaced session stays
     * live and, being active, sorts above its own continuation. Off leaves both sessions visible and
     * touches none of the old session's running work.
     */
    handoffRetireReplaced: boolean;
}
export declare const DEFAULT_CONFIG: PluginConfig;
/** Validate one raw cordis config object and apply defaults. Throws on unknown keys or bad types. */
export declare function resolvePluginConfig(raw: unknown): PluginConfig;
/**
 * The four settings cards' key sets, one per owning entry.
 *
 * Each entry exports its own `Config` schema, so the Host projects one form per entry and a save lands in
 * that entry's own fiber. A resolver therefore accepts only its own keys: a key that belongs to another
 * card is a mistake to name loudly (with the card it belongs to), not to ignore — silently accepting it
 * would make a mis-placed profile line look applied while nothing reads it.
 */
export declare const SHARED_KEYS: readonly ["archiveEnabled", "sessionSettledDays", "forceDedupeMs", "maxTokens", "maxOutputTokens", "maxMemoryChars", "taskMode", "provider", "model", "handoffLang"];
export declare const MEMORY_KEYS: readonly ["memoryEnabled", "consolidateTurns", "consolidateIntervalMs"];
export declare const AUTOLEARN_KEYS: readonly ["autolearnEnabled", "autolearnExpireSkills", "autolearnTurns", "autolearnIntervalMs"];
export declare const HANDOFF_KEYS: readonly ["handoffEnabled", "handoffThreshold", "handoffBudgetSummaryTokens", "handoffBudgetRecentTokens", "handoffPendingQuestion", "handoffRetireReplaced"];
/** The shared/archive card's ten keys. Also the only resolver that enforces the provider/model pairing. */
export declare function resolveSharedConfig(raw: unknown): PluginConfig;
/** The memory card's three keys. */
export declare function resolveMemoryConfig(raw: unknown): PluginConfig;
/** The skills card's four keys. */
export declare function resolveAutolearnConfig(raw: unknown): PluginConfig;
/** The handoff card's seven keys. */
export declare function resolveHandoffConfig(raw: unknown): PluginConfig;
