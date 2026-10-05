/**
 * Shared plugin configuration for the context pair.
 *
 * Every key mirrors the command path that changes it — `/memory on|off` writes `memoryEnabled`,
 * `/handoff budget summary` writes `handoffBudgetSummaryTokens`, `/handoff thinking` writes
 * `handoffThinking` — so the card, the command and the stored profile spell one fact one way.
 *
 * Renaming one of these keys is a breaking change rather than a rename: the platform persists them
 * into each profile's own `cordis.patch.yml`, this repo cannot rewrite that file, and the type check
 * below throws on a key it does not know. The seven renames landed 2026-10-05 with no compatibility
 * reader on purpose — an alias nothing can retire is worse than a loud apply-time failure.
 */

import { MAX_MEMORY_CHARS, MAX_MEMORY_CHARS_LIMIT, MIN_MEMORY_CHARS } from "./project-state.js";

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
	/** Output cap for every auxiliary model call (consolidation, autolearn, handoff summary). */
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
	/** Adaptive mode: conversation tokens handed to each summary. */
	handoffBudgetSummaryTokens: number;
	/** Recent conversation tokens carried into the continuation verbatim (0 = summary only). */
	handoffBudgetRecentTokens: number;
	/** Thinking for the summary call: "off" (fast) or the session's routed level. */
	handoffThinking: "off" | "session";
	/** Automatic handoff when the last assistant message is a question: "defer" waits for the answer, "wait" hands off and carries the question into the continuation. */
	handoffPendingQuestion: "defer" | "wait";
	/** Handoff scaffolding language: "auto" follows the conversation, otherwise "zh" or "en". */
	handoffLang: "auto" | "zh" | "en";
}

export const DEFAULT_CONFIG: PluginConfig = {
	archiveEnabled: true,
	memoryEnabled: true,
	consolidateTurns: 6,
	consolidateIntervalMs: 5 * 60 * 1000,
	forceDedupeMs: 15 * 1000,
	maxTokens: 8192,
	maxOutputTokens: 32_768,
	maxMemoryChars: MAX_MEMORY_CHARS,
	provider: "",
	model: "",
	autolearnEnabled: true,
	autolearnTurns: 20,
	autolearnIntervalMs: 30 * 60 * 1000,
	handoffEnabled: true,
	handoffThresholdAuto: true,
	handoffThresholdRatio: 0.4,
	handoffBudgetSummaryTokens: 64_000,
	handoffBudgetRecentTokens: 20_000,
	handoffThinking: "off",
	handoffPendingQuestion: "defer",
	handoffLang: "auto",
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
function fieldValue<T>(value: T): T {
	if (typeof value !== "object" || value === null || !(VOLATILE_WRITE in value)) return value;
	const read = (value as { get?: () => unknown }).get;
	return (typeof read === "function" ? read.call(value) : value) as T;
}

/** Validate one raw cordis config object and apply defaults. Throws on unknown keys or bad types. */
export function resolvePluginConfig(raw: unknown): PluginConfig {
	if (raw === undefined || raw === null) return { ...DEFAULT_CONFIG };
	if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("dsh-project-context: config must be an object");

	// The owner entry's config arrives *resolved*, and every field of PluginSettingsSchema is marked
	// volatile so the Host projects a form for it — which makes schemastery hand those fields over as
	// live references rather than values. Follow each one; the reference's value is re-read on every
	// call, so a later settings write is visible without the entry restarting.
	const input = Object.fromEntries(
		Object.entries(raw as Record<string, unknown>).map(([key, value]) => [key, fieldValue(value)]),
	);
	for (const key of Object.keys(input)) {
		if (!CONFIG_KEYS.has(key)) throw new Error(`dsh-project-context: unknown config key "${key}"`);
	}

	const positive = (name: keyof PluginConfig, fallback: number, min: number): number => {
		const value = input[name];
		if (value === undefined) return fallback;
		if (typeof value !== "number" || !Number.isFinite(value) || value < min) {
			throw new Error(`dsh-project-context: ${name} must be a number >= ${min}`);
		}
		return Math.round(value);
	};

	const string = (name: keyof PluginConfig, fallback: string): string => {
		const value = input[name];
		if (value === undefined) return fallback;
		if (typeof value !== "string") throw new Error(`dsh-project-context: ${name} must be a string`);
		return value;
	};

	const boolean = (name: keyof PluginConfig, fallback: boolean): boolean => {
		const value = input[name];
		if (value === undefined) return fallback;
		if (typeof value !== "boolean") throw new Error(`dsh-project-context: ${name} must be a boolean`);
		return value;
	};

	const ratio = (name: keyof PluginConfig, fallback: number): number => {
		const value = input[name];
		if (value === undefined) return fallback;
		if (typeof value !== "number" || !Number.isFinite(value) || value < 0.1 || value > 0.95) {
			throw new Error(`dsh-project-context: ${name} must be a number between 0.1 and 0.95`);
		}
		return value;
	};

	const bounded = (name: keyof PluginConfig, fallback: number, min: number, max: number): number => {
		const value = input[name];
		if (value === undefined) return fallback;
		if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
			throw new Error(`dsh-project-context: ${name} must be a number between ${min} and ${max}`);
		}
		return Math.round(value);
	};

	const summaryThinking = input.handoffThinking;
	if (summaryThinking !== undefined && summaryThinking !== "off" && summaryThinking !== "session") {
		throw new Error('dsh-project-context: handoffThinking must be "off" or "session"');
	}

	const pendingQuestion = input.handoffPendingQuestion;
	if (pendingQuestion !== undefined && pendingQuestion !== "defer" && pendingQuestion !== "wait") {
		throw new Error('dsh-project-context: handoffPendingQuestion must be "defer" or "wait"');
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
		provider,
		model,
		autolearnEnabled: boolean("autolearnEnabled", DEFAULT_CONFIG.autolearnEnabled),
		autolearnTurns: positive("autolearnTurns", DEFAULT_CONFIG.autolearnTurns, 1),
		autolearnIntervalMs: positive("autolearnIntervalMs", DEFAULT_CONFIG.autolearnIntervalMs, 1000),
		handoffEnabled: boolean("handoffEnabled", DEFAULT_CONFIG.handoffEnabled),
		handoffThresholdAuto: boolean("handoffThresholdAuto", DEFAULT_CONFIG.handoffThresholdAuto),
		handoffThresholdRatio: ratio("handoffThresholdRatio", DEFAULT_CONFIG.handoffThresholdRatio),
		handoffBudgetSummaryTokens: bounded("handoffBudgetSummaryTokens", DEFAULT_CONFIG.handoffBudgetSummaryTokens, 8_000, 200_000),
		handoffBudgetRecentTokens: bounded("handoffBudgetRecentTokens", DEFAULT_CONFIG.handoffBudgetRecentTokens, 0, 200_000),
		handoffThinking: summaryThinking ?? DEFAULT_CONFIG.handoffThinking,
		handoffPendingQuestion: pendingQuestion ?? DEFAULT_CONFIG.handoffPendingQuestion,
		handoffLang: handoffLang ?? DEFAULT_CONFIG.handoffLang,
	};
}
