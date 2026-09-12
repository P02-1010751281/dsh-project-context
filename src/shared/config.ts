/** Shared plugin configuration for the context pair. */

export interface PluginConfig {
	/** Run the automatic consolidation pass after turns settle. Commands still work when false. */
	autoConsolidate: boolean;
	/** User turns accumulated before an automatic consolidation pass. */
	consolidateTurns: number;
	/** Minimum wall-clock gap between automatic consolidation passes. */
	consolidateIntervalMs: number;
	/** Suppress an almost-immediate duplicate forced pass. */
	forceDedupeMs: number;
	/** Output cap for every auxiliary model call (consolidation, autolearn, handoff summary). */
	maxTokens: number;
	/** Optional auxiliary-call route override; must be set together with `model`. */
	provider: string;
	/** Optional auxiliary-call route override; must be set together with `provider`. */
	model: string;
	/** Run the low-frequency autolearn (skill distillation) pass after turns settle. */
	autoLearn: boolean;
	/** Accumulated user turns before an automatic autolearn pass. */
	autolearnTurns: number;
	/** Minimum wall-clock gap between automatic autolearn passes. */
	autolearnIntervalMs: number;
	/** Start an automatic handoff when a top-level session approaches its context limit. */
	handoffEnabled: boolean;
	/** Adaptive threshold derived from window/target/keep instead of a fixed ratio. */
	handoffAdaptive: boolean;
	/** Context-window fraction (0.1–0.95) used when `handoffAdaptive` is false. */
	handoffThresholdRatio: number;
	/** Adaptive mode: conversation tokens handed to each summary. */
	handoffTargetTokens: number;
	/** Recent conversation tokens carried into the continuation verbatim (0 = summary only). */
	handoffKeepTokens: number;
	/** Thinking for the summary call: "off" (fast) or the session's routed level. */
	handoffSummaryThinking: "off" | "session";
}

export const DEFAULT_CONFIG: PluginConfig = {
	autoConsolidate: true,
	consolidateTurns: 6,
	consolidateIntervalMs: 5 * 60 * 1000,
	forceDedupeMs: 15 * 1000,
	maxTokens: 8192,
	provider: "",
	model: "",
	autoLearn: true,
	autolearnTurns: 20,
	autolearnIntervalMs: 30 * 60 * 1000,
	handoffEnabled: true,
	handoffAdaptive: true,
	handoffThresholdRatio: 0.4,
	handoffTargetTokens: 64_000,
	handoffKeepTokens: 20_000,
	handoffSummaryThinking: "off",
};

const CONFIG_KEYS = new Set(Object.keys(DEFAULT_CONFIG));

/** Validate one raw cordis config object and apply defaults. Throws on unknown keys or bad types. */
export function resolvePluginConfig(raw: unknown): PluginConfig {
	if (raw === undefined || raw === null) return { ...DEFAULT_CONFIG };
	if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("dsh-project-context: config must be an object");

	const input = raw as Record<string, unknown>;
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

	const summaryThinking = input.handoffSummaryThinking;
	if (summaryThinking !== undefined && summaryThinking !== "off" && summaryThinking !== "session") {
		throw new Error('dsh-project-context: handoffSummaryThinking must be "off" or "session"');
	}

	const provider = string("provider", DEFAULT_CONFIG.provider);
	const model = string("model", DEFAULT_CONFIG.model);
	if ((provider.length === 0) !== (model.length === 0)) {
		throw new Error("dsh-project-context: provider and model must be set together");
	}

	return {
		autoConsolidate: boolean("autoConsolidate", DEFAULT_CONFIG.autoConsolidate),
		consolidateTurns: positive("consolidateTurns", DEFAULT_CONFIG.consolidateTurns, 1),
		consolidateIntervalMs: positive("consolidateIntervalMs", DEFAULT_CONFIG.consolidateIntervalMs, 1000),
		forceDedupeMs: positive("forceDedupeMs", DEFAULT_CONFIG.forceDedupeMs, 0),
		maxTokens: positive("maxTokens", DEFAULT_CONFIG.maxTokens, 256),
		provider,
		model,
		autoLearn: boolean("autoLearn", DEFAULT_CONFIG.autoLearn),
		autolearnTurns: positive("autolearnTurns", DEFAULT_CONFIG.autolearnTurns, 1),
		autolearnIntervalMs: positive("autolearnIntervalMs", DEFAULT_CONFIG.autolearnIntervalMs, 1000),
		handoffEnabled: boolean("handoffEnabled", DEFAULT_CONFIG.handoffEnabled),
		handoffAdaptive: boolean("handoffAdaptive", DEFAULT_CONFIG.handoffAdaptive),
		handoffThresholdRatio: ratio("handoffThresholdRatio", DEFAULT_CONFIG.handoffThresholdRatio),
		handoffTargetTokens: bounded("handoffTargetTokens", DEFAULT_CONFIG.handoffTargetTokens, 8_000, 200_000),
		handoffKeepTokens: bounded("handoffKeepTokens", DEFAULT_CONFIG.handoffKeepTokens, 0, 200_000),
		handoffSummaryThinking: summaryThinking ?? DEFAULT_CONFIG.handoffSummaryThinking,
	};
}
