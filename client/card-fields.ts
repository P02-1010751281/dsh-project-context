/**
 * The card's field table: the one place a settings key is named.
 *
 * The staged form's specs, the card's projection and the rendered rows are all built from
 * {@link SECTIONS}, so a key cannot appear in one and be missing from another. The table is plain
 * data behind type-only imports, which keeps it loadable by the test suite (the card itself pulls
 * React in).
 *
 * Number and text rows reuse the platform's own specs (`settingsNumberField` / `settingsTextField`,
 * called in `settings-card.tsx`); the two shapes the platform does not ship — a boolean and a closed
 * enum — are declared here in the same `SettingsFieldSpec` shape, so `SettingsFormModel` treats every
 * row alike and a draft it cannot parse blocks the save instead of writing something else.
 */

import type { SettingsFieldSpec } from "@deepseek-ai/dsh-client-ui-primitives";
import type { SettingsCardKey } from "./locales.ts";

/** The `project-context` settings section shape (mirrors the host schema). */
export interface ProjectContextSettings {
	archiveEnabled: boolean;
	autoConsolidate: boolean;
	consolidateTurns: number;
	consolidateIntervalMs: number;
	forceDedupeMs: number;
	maxTokens: number;
	maxOutputTokens: number;
	maxMemoryChars: number;
	provider: string;
	model: string;
	autoLearn: boolean;
	autolearnTurns: number;
	autolearnIntervalMs: number;
	handoffEnabled: boolean;
	handoffAdaptive: boolean;
	handoffThresholdRatio: number;
	handoffTargetTokens: number;
	handoffKeepTokens: number;
	handoffSummaryThinking: "off" | "session";
	handoffPendingQuestion: "defer" | "wait";
	handoffLanguage: "auto" | "zh" | "en";
}

/** How one row is edited. */
export type FieldKind = "boolean" | "number" | "text" | "union";

/** One settings row: its key, its editor, and — for a union — its closed value set. */
export interface FieldRow {
	readonly key: keyof ProjectContextSettings;
	readonly kind: FieldKind;
	readonly options?: readonly string[];
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
			{ key: "autoConsolidate", kind: "boolean" },
			{ key: "consolidateTurns", kind: "number" },
			{ key: "consolidateIntervalMs", kind: "number" },
			{ key: "forceDedupeMs", kind: "number" },
			// Shared auxiliary route: consolidation, autolearn and the handoff summary all use it.
			{ key: "maxTokens", kind: "number" },
			{ key: "maxOutputTokens", kind: "number" },
			{ key: "maxMemoryChars", kind: "number" },
			{ key: "provider", kind: "text" },
			{ key: "model", kind: "text" },
		],
	},
	{
		titleKey: "section.autolearn.title",
		descriptionKey: "section.autolearn.description",
		rows: [
			{ key: "autoLearn", kind: "boolean" },
			{ key: "autolearnTurns", kind: "number" },
			{ key: "autolearnIntervalMs", kind: "number" },
		],
	},
	{
		titleKey: "section.handoff.title",
		descriptionKey: "section.handoff.description",
		rows: [
			{ key: "handoffEnabled", kind: "boolean" },
			{ key: "handoffAdaptive", kind: "boolean" },
			{ key: "handoffThresholdRatio", kind: "number" },
			{ key: "handoffTargetTokens", kind: "number" },
			{ key: "handoffKeepTokens", kind: "number" },
			{ key: "handoffSummaryThinking", kind: "union", options: ["off", "session"] },
			{ key: "handoffPendingQuestion", kind: "union", options: ["defer", "wait"] },
			{ key: "handoffLanguage", kind: "union", options: ["auto", "zh", "en"] },
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
