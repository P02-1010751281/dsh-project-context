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
import { DEFAULT_HANDOFF_SUMMARY_TOKENS, MAX_HANDOFF_RECENT_TOKENS, MAX_HANDOFF_SUMMARY_TOKENS, MIN_HANDOFF_RECENT_TOKENS, MIN_HANDOFF_SUMMARY_TOKENS, } from "./limits.js";
import { MAX_THRESHOLD_RATIO, MIN_THRESHOLD_RATIO } from "./limits.js";
import { MAX_MEMORY_CHARS, MAX_MEMORY_CHARS_LIMIT, MIN_MEMORY_CHARS } from "./project-state.js";
import { parseThresholdSpec, thresholdSpecHelp } from "./threshold-spec.js";
export const DEFAULT_CONFIG = {
    archiveEnabled: true,
    memoryEnabled: true,
    consolidateTurns: 6,
    consolidateIntervalMs: 5 * 60 * 1000,
    forceDedupeMs: 15 * 1000,
    maxTokens: 8192,
    maxOutputTokens: 32_768,
    maxMemoryChars: MAX_MEMORY_CHARS,
    taskMode: "assisted",
    provider: "",
    model: "",
    autolearnEnabled: true,
    autolearnTurns: 20,
    autolearnIntervalMs: 30 * 60 * 1000,
    handoffEnabled: true,
    handoffThreshold: { mode: "auto" },
    handoffBudgetSummaryTokens: DEFAULT_HANDOFF_SUMMARY_TOKENS,
    handoffBudgetRecentTokens: 20_000,
    handoffPendingQuestion: "defer",
    handoffLang: "auto",
    handoffRetireReplaced: true,
};
const CONFIG_KEYS = new Set(Object.keys(DEFAULT_CONFIG));
/**
 * Brand of cosmokit's live config reference, taken from the global symbol registry.
 *
 * schemastery resolves a `volatile` settings field to such a reference instead of the value, and
 * cosmokit brands it with a well-known `Symbol.for(...)` so copies of the library that do not share a
 * module instance still recognize it. Reading through that same global symbol keeps this package's
 * runtime dependency surface unchanged (`schemastery` only).
 */
const VOLATILE_WRITE = Symbol.for("cosmokit.volatile.write");
/** Follow a schemastery `volatile` settings field to its current value; plain values pass through. */
function fieldValue(value) {
    if (typeof value !== "object" || value === null || !(VOLATILE_WRITE in value))
        return value;
    const read = value.get;
    return (typeof read === "function" ? read.call(value) : value);
}
/** Validate one raw cordis config object and apply defaults. Throws on unknown keys or bad types. */
export function resolvePluginConfig(raw) {
    if (raw === undefined || raw === null)
        return { ...DEFAULT_CONFIG };
    if (typeof raw !== "object" || Array.isArray(raw))
        throw new Error("dsh-project-context: config must be an object");
    // The owner entry's config arrives *resolved*, and every field of PluginSettingsSchema is marked
    // volatile so the Host projects a form for it — which makes schemastery hand those fields over as
    // live references rather than values. Follow each one; the reference's value is re-read on every
    // call, so a later settings write is visible without the entry restarting.
    const input = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, fieldValue(value)]));
    for (const key of Object.keys(input)) {
        if (!CONFIG_KEYS.has(key))
            throw new Error(`dsh-project-context: unknown config key "${key}"`);
    }
    const positive = (name, fallback, min) => {
        const value = input[name];
        if (value === undefined)
            return fallback;
        if (typeof value !== "number" || !Number.isFinite(value) || value < min) {
            throw new Error(`dsh-project-context: ${name} must be a number >= ${min}`);
        }
        return Math.round(value);
    };
    const string = (name, fallback) => {
        const value = input[name];
        if (value === undefined)
            return fallback;
        if (typeof value !== "string")
            throw new Error(`dsh-project-context: ${name} must be a string`);
        return value;
    };
    const boolean = (name, fallback) => {
        const value = input[name];
        if (value === undefined)
            return fallback;
        if (typeof value !== "boolean")
            throw new Error(`dsh-project-context: ${name} must be a boolean`);
        return value;
    };
    // The merged threshold is stored as a string and parsed by the one reader, so the accepted
    // spellings cannot drift between the profile, the card and the command.
    const threshold = (name, fallback) => {
        const value = input[name];
        if (value === undefined)
            return fallback;
        // A resolved config is a legal input to this reader — `publishProjectContextSettings` re-resolves the
        // config the entry was applied with — so a spec that is already parsed is returned as it is rather
        // than sent through the string reader and rejected for not being a string.
        if (typeof value === "object" && value !== null && "mode" in value) {
            const spec = value;
            if (spec.mode === "auto")
                return { mode: "auto" };
            if (spec.mode === "ratio" && typeof spec.ratio === "number" && spec.ratio >= MIN_THRESHOLD_RATIO && spec.ratio <= MAX_THRESHOLD_RATIO) {
                return { mode: "ratio", ratio: spec.ratio };
            }
            if (spec.mode === "tokens" && Number.isSafeInteger(spec.tokens) && spec.tokens >= 1)
                return { mode: "tokens", tokens: spec.tokens };
            throw new Error(`dsh-project-context: ${name} must be ${thresholdSpecHelp()} (got ${JSON.stringify(value)})`);
        }
        if (typeof value !== "string")
            throw new Error(`dsh-project-context: ${name} must be ${thresholdSpecHelp()}`);
        const spec = parseThresholdSpec(value);
        if (spec === undefined)
            throw new Error(`dsh-project-context: ${name} must be ${thresholdSpecHelp()} (got ${JSON.stringify(value)})`);
        return spec;
    };
    const bounded = (name, fallback, min, max) => {
        const value = input[name];
        if (value === undefined)
            return fallback;
        if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
            throw new Error(`dsh-project-context: ${name} must be a number between ${min} and ${max}`);
        }
        return Math.round(value);
    };
    const pendingQuestion = input.handoffPendingQuestion;
    if (pendingQuestion !== undefined && pendingQuestion !== "defer" && pendingQuestion !== "wait") {
        throw new Error('dsh-project-context: handoffPendingQuestion must be "defer" or "wait"');
    }
    const taskMode = input.taskMode;
    if (taskMode !== undefined && taskMode !== "assisted" && taskMode !== "delegated" && taskMode !== "manual") {
        throw new Error('dsh-project-context: taskMode must be "assisted", "delegated", or "manual"');
    }
    const handoffLang = input.handoffLang;
    if (handoffLang !== undefined && handoffLang !== "auto" && handoffLang !== "zh" && handoffLang !== "en") {
        throw new Error('dsh-project-context: handoffLang must be "auto", "zh", or "en"');
    }
    const provider = string("provider", DEFAULT_CONFIG.provider);
    const model = string("model", DEFAULT_CONFIG.model);
    if ((provider.length === 0) !== (model.length === 0)) {
        throw new Error("dsh-project-context: provider and model must be set together");
    }
    return {
        archiveEnabled: boolean("archiveEnabled", DEFAULT_CONFIG.archiveEnabled),
        memoryEnabled: boolean("memoryEnabled", DEFAULT_CONFIG.memoryEnabled),
        consolidateTurns: positive("consolidateTurns", DEFAULT_CONFIG.consolidateTurns, 1),
        consolidateIntervalMs: positive("consolidateIntervalMs", DEFAULT_CONFIG.consolidateIntervalMs, 1000),
        forceDedupeMs: positive("forceDedupeMs", DEFAULT_CONFIG.forceDedupeMs, 0),
        maxTokens: positive("maxTokens", DEFAULT_CONFIG.maxTokens, 256),
        maxOutputTokens: positive("maxOutputTokens", DEFAULT_CONFIG.maxOutputTokens, 256),
        maxMemoryChars: bounded("maxMemoryChars", DEFAULT_CONFIG.maxMemoryChars, MIN_MEMORY_CHARS, MAX_MEMORY_CHARS_LIMIT),
        taskMode: taskMode ?? DEFAULT_CONFIG.taskMode,
        provider,
        model,
        autolearnEnabled: boolean("autolearnEnabled", DEFAULT_CONFIG.autolearnEnabled),
        autolearnTurns: positive("autolearnTurns", DEFAULT_CONFIG.autolearnTurns, 1),
        autolearnIntervalMs: positive("autolearnIntervalMs", DEFAULT_CONFIG.autolearnIntervalMs, 1000),
        handoffEnabled: boolean("handoffEnabled", DEFAULT_CONFIG.handoffEnabled),
        handoffThreshold: threshold("handoffThreshold", DEFAULT_CONFIG.handoffThreshold),
        handoffBudgetSummaryTokens: bounded("handoffBudgetSummaryTokens", DEFAULT_CONFIG.handoffBudgetSummaryTokens, MIN_HANDOFF_SUMMARY_TOKENS, MAX_HANDOFF_SUMMARY_TOKENS),
        handoffBudgetRecentTokens: bounded("handoffBudgetRecentTokens", DEFAULT_CONFIG.handoffBudgetRecentTokens, MIN_HANDOFF_RECENT_TOKENS, MAX_HANDOFF_RECENT_TOKENS),
        handoffPendingQuestion: pendingQuestion ?? DEFAULT_CONFIG.handoffPendingQuestion,
        handoffLang: handoffLang ?? DEFAULT_CONFIG.handoffLang,
        handoffRetireReplaced: boolean("handoffRetireReplaced", DEFAULT_CONFIG.handoffRetireReplaced),
    };
}
