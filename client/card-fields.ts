/**
 * The card's field table: the one place a settings key is named.
 *
 * The staged form's specs, the card's projection and the rendered rows are all built from
 * {@link SECTIONS}, so a key cannot appear in one and be missing from another. The table is plain
 * data behind type-only imports, which keeps it loadable by the test suite (the card itself pulls
 * React in).
 *
 * Number and text rows reuse the platform's own specs (`settingsNumberField` / `settingsTextField`,
 * called in `settings-card.tsx`); the shapes the platform does not ship — a boolean, a closed enum and
 * a ratio that accepts `40` / `40%` as well as `0.4` — are declared here in the same
 * `SettingsFieldSpec` shape, so `SettingsFormModel` treats every row alike and a draft it cannot parse
 * blocks the save instead of writing something the Host then refuses.
 */

import type { SettingsFieldSpec } from "@deepseek-ai/dsh-client-ui-primitives";

import {
	MAX_HANDOFF_RECENT_TOKENS,
	MAX_HANDOFF_SUMMARY_TOKENS,
	MIN_HANDOFF_RECENT_TOKENS,
	MIN_HANDOFF_SUMMARY_TOKENS,
} from "../src/shared/limits.ts";
import { formatThresholdSpec, parseThresholdSpec } from "../src/shared/threshold-spec.ts";
import type { SettingsCardKey } from "./locales.ts";

/** The `project-context` settings section shape (mirrors the host schema). */
export interface ProjectContextSettings {
	archiveEnabled: boolean;
	memoryEnabled: boolean;
	consolidateTurns: number;
	consolidateIntervalMs: number;
	forceDedupeMs: number;
	maxTokens: number;
	maxOutputTokens: number;
	maxMemoryChars: number;
	taskMode: "assisted" | "delegated" | "manual";
	provider: string;
	model: string;
	autolearnEnabled: boolean;
	autolearnTurns: number;
	autolearnIntervalMs: number;
	handoffEnabled: boolean;
	handoffThreshold: string;
	handoffBudgetSummaryTokens: number;
	handoffBudgetRecentTokens: number;
	handoffPendingQuestion: "defer" | "wait";
	handoffLang: "auto" | "zh" | "en";
	handoffRetireReplaced: boolean;
}

/** How one row is edited. `threshold` folds `auto` / `40%` / `400k` into the stored spelling. */
export type FieldKind = "boolean" | "number" | "text" | "union" | "threshold";

/** The inclusive bounds a numeric row enforces locally, mirroring the Host schema's `min`/`max`. */
export interface FieldBounds {
	readonly min: number;
	readonly max: number;
}

/** One settings row: its key, its editor, and — for a union — its closed value set. */
export interface FieldRow {
	readonly key: keyof ProjectContextSettings;
	readonly kind: FieldKind;
	readonly options?: readonly string[];
	readonly bounds?: FieldBounds;
}

/** One rendered group of rows. */
export interface FieldSection {
	readonly titleKey: SettingsCardKey;
	readonly descriptionKey: SettingsCardKey;
	readonly rows: readonly FieldRow[];
}

/**
 * The card's rows in their three groups, in render order. Every key of the host schema appears
 * exactly once; `test/settings-form.test.mjs` compares this set with the schema's.
 */
export const SECTIONS: readonly FieldSection[] = [
	{
		titleKey: "section.memory.title",
		descriptionKey: "section.memory.description",
		rows: [
			{ key: "archiveEnabled", kind: "boolean" },
			{ key: "memoryEnabled", kind: "boolean" },
			{ key: "consolidateTurns", kind: "number" },
			{ key: "consolidateIntervalMs", kind: "number" },
			{ key: "forceDedupeMs", kind: "number" },
			// Shared auxiliary route: consolidation, autolearn and the handoff summary all use it.
			{ key: "maxTokens", kind: "number" },
			{ key: "maxOutputTokens", kind: "number" },
			{ key: "maxMemoryChars", kind: "number" },
			// Who may create a task, and whether age may change its status: `assisted`/`manual` both
			// refuse to invent a task from a bare slug (creation needs the explicit `new`), `manual`
			// additionally freezes the stored status, so only `delegated` lets the pass act alone.
			{ key: "taskMode", kind: "union", options: ["assisted", "delegated", "manual"] },
			{ key: "provider", kind: "text" },
			{ key: "model", kind: "text" },
		],
	},
	{
		titleKey: "section.autolearn.title",
		descriptionKey: "section.autolearn.description",
		rows: [
			{ key: "autolearnEnabled", kind: "boolean" },
			{ key: "autolearnTurns", kind: "number" },
			{ key: "autolearnIntervalMs", kind: "number" },
		],
	},
	{
		titleKey: "section.handoff.title",
		descriptionKey: "section.handoff.description",
		rows: [
			{ key: "handoffEnabled", kind: "boolean" },
			// One row, because the trigger is one fact: `auto`, a fraction of the window, or an absolute
			// token count all live in the same key, so the card cannot show two controls that disagree
			// about which mode is in force. The summary target is a separate budget
			// `/handoff budget summary` accepts in either mode and that only reports whether the target
			// was honoured, so it is its own row.
			{ key: "handoffThreshold", kind: "threshold" },
			{
				key: "handoffBudgetSummaryTokens",
				kind: "number",
				bounds: { min: MIN_HANDOFF_SUMMARY_TOKENS, max: MAX_HANDOFF_SUMMARY_TOKENS },
			},
			{
				key: "handoffBudgetRecentTokens",
				kind: "number",
				bounds: { min: MIN_HANDOFF_RECENT_TOKENS, max: MAX_HANDOFF_RECENT_TOKENS },
			},
			{ key: "handoffPendingQuestion", kind: "union", options: ["defer", "wait"] },
			{ key: "handoffLang", kind: "union", options: ["auto", "zh", "en"] },
			// A trade, not a free switch: with retirement off the replaced session stays in the sidebar and
			// keeps whatever runs in it, but it also sorts above the continuation that replaced it — the
			// symptom retirement was added for. The hint says so, because the two effects cannot be split.
			{ key: "handoffRetireReplaced", kind: "boolean" },
		],
	},
];

/** Every row, flattened: what both the spec list and the projection walk. */
export const ROWS: readonly FieldRow[] = SECTIONS.flatMap((section) => section.rows);

/**
 * A row's visible label key. The convention is fixed by the dictionaries (`field.<key>`), and the
 * template type is what makes a missing translation a compile error rather than a blank label.
 * @param key - a settings row key.
 * @returns the label's dictionary key.
 */
export function labelKey(key: keyof ProjectContextSettings): SettingsCardKey {
	return `field.${key}`;
}

/**
 * A row's hint key, `field.<key>Hint`.
 * @param key - a settings row key.
 * @returns the hint's dictionary key.
 */
export function hintKey(key: keyof ProjectContextSettings): SettingsCardKey {
	return `field.${key}Hint`;
}

/**
 * A boolean field: draft text is the literal `true`/`false`, an empty draft clears the field, and
 * anything else is not a value the field accepts (which blocks the save rather than discarding it).
 * @param field - field name inside the namespace section.
 * @returns the field's conversion spec.
 */
export function booleanField(field: string): SettingsFieldSpec {
	return {
		field,
		format: (value) => (value === true ? "true" : "false"),
		parse: (text) => {
			const trimmed = text.trim();
			if (trimmed === "true") return { kind: "set", value: true };
			if (trimmed === "false") return { kind: "set", value: false };
			return trimmed === "" ? { kind: "clear" } : undefined;
		},
	};
}

/**
 * A whole-number row with the Host schema's inclusive bounds: a draft outside them, or a non-integer,
 * is refused here instead of being staged into a write the Host rejects. The bounds are the same pair
 * the schema and the config validator read (`limits.ts`), never a second copy.
 * @param field - field name inside the namespace section.
 * @param bounds - the inclusive bounds the schema declares.
 * @returns the field's conversion spec.
 */
export function boundedNumberField(field: string, bounds: FieldBounds): SettingsFieldSpec {
	return {
		field,
		format: (value) => (typeof value === "number" ? String(value) : ""),
		parse: (text) => {
			const trimmed = text.trim();
			if (trimmed === "") return { kind: "clear" };
			const value = Number(trimmed);
			// `z.natural()` is an integer, so `64000.5` would be rejected by the Host as well.
			if (!Number.isInteger(value) || value < bounds.min || value > bounds.max) return undefined;
			return { kind: "set", value };
		},
	};
}

/**
 * The threshold row: the same spellings the `/handoff threshold` command accepts, so the card cannot
 * stage a value the stored schema would refuse. The draft is written in its canonical spelling, which
 * is what makes `400k` come back as the count it means rather than as a suffix the reader must keep.
 * @param field - field name inside the namespace section.
 * @returns the field's conversion spec.
 */
export function thresholdField(field: string): SettingsFieldSpec {
	return {
		field,
		format: (value) => (typeof value === "string" ? value : ""),
		parse: (text) => {
			const trimmed = text.trim();
			if (trimmed === "") return { kind: "clear" };
			const spec = parseThresholdSpec(trimmed);
			return spec === undefined ? undefined : { kind: "set", value: formatThresholdSpec(spec) };
		},
	};
}

/**
 * A closed enum field over `options`: a draft outside the set is rejected, so the control cannot
 * stage a value the schema's union would refuse.
 * @param field - field name inside the namespace section.
 * @param options - the values the field accepts.
 * @returns the field's conversion spec.
 */
export function unionField(field: string, options: readonly string[]): SettingsFieldSpec {
	return {
		field,
		format: (value) => (typeof value === "string" && options.includes(value) ? value : ""),
		parse: (text) => {
			const trimmed = text.trim();
			if (trimmed === "") return { kind: "clear" };
			return options.includes(trimmed) ? { kind: "set", value: trimmed } : undefined;
		},
	};
}
