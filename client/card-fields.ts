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
import { parseRatioInput } from "../src/shared/ratio.ts";
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
	provider: string;
	model: string;
	autolearnEnabled: boolean;
	autolearnTurns: number;
	autolearnIntervalMs: number;
	handoffEnabled: boolean;
	handoffThresholdAuto: boolean;
	handoffThresholdRatio: number;
	handoffBudgetSummaryTokens: number;
	handoffBudgetRecentTokens: number;
	handoffPendingQuestion: "defer" | "wait";
	handoffLang: "auto" | "zh" | "en";
}

/** How one row is edited. `ratio` is a number row whose text folds `40` / `40%` into `0.4`. */
export type FieldKind = "boolean" | "number" | "text" | "union" | "ratio";

/**
 * A condition under which a row's setting is *consulted*: the boolean row named by `key` must be
 * `text`. Two threshold rows carry one each, because the trigger computation reads only one of them
 * per mode — `handoffThresholdRatio` in fixed mode, `handoffBudgetSummaryTokens` in adaptive mode.
 *
 * Not every inert row is hidden (with `handoffEnabled: false` every handoff row is inert and all of
 * them still render), and the gate is not a promise about validation: the config validator still
 * checks every key in every mode.
 *
 * `text` is the boolean literal, not `string`: the value is only ever produced by `booleanField`, so a
 * misspelled gate here would silently disable the row forever, and that class is better impossible
 * than merely tested.
 */
export interface FieldGate {
	readonly key: keyof ProjectContextSettings;
	readonly text: "true" | "false";
}

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
	readonly appliesWhen?: FieldGate;
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
			{ key: "handoffThresholdAuto", kind: "boolean" },
			// Only the fixed ratio is gated, because it is the other mode's *trigger*: while adaptive decides
			// nothing consults it, and sitting next to the switch it would read as a second trigger. The
			// summary target is not a trigger and is not gated — it is a budget that
			// `/handoff budget summary` accepts in either mode and that only reports whether the target was
			// honoured, so hiding it would make the card stricter than the command and take away the only
			// control for a value the user still owns.
			{ key: "handoffThresholdRatio", kind: "ratio", appliesWhen: { key: "handoffThresholdAuto", text: "false" } },
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
		],
	},
];

/** Every row, flattened: what both the spec list and the projection walk. */
export const ROWS: readonly FieldRow[] = SECTIONS.flatMap((section) => section.rows);

/** What a gate reads off a row: the platform's field state, structurally (no runtime import). */
export interface FieldDraftState {
	readonly text: string;
	readonly overridden: boolean;
	readonly invalid: boolean;
}

/**
 * Whether a row renders, given the effective mode and the row's own draft.
 *
 * A row whose setting is inert in the current mode is hidden — unless it carries the user's own
 * attention: a stored override (which would otherwise be unreachable and unresettable) or a draft that
 * blocks the save (an invisible one would block it with no control to fix). A staged `unset` is the one
 * case that is *not* kept: it is invisible but still lands, because the Host re-inherits the default
 * and the row it belongs to is inert by construction in that mode.
 * @param row - the table row.
 * @param fields - every row's current field state, as the card projects it.
 * @param modes - each gate key's effective mode after the pending write, not the formatted draft: a
 *   reset stages a draft built from the (empty) composition layer, which for an absent field reads as
 *   `false` while the write re-inherits the schema default `true`.
 * @returns whether the row belongs on the page.
 */
export function rowVisible(
	row: FieldRow,
	fields: Readonly<Record<keyof ProjectContextSettings, FieldDraftState>>,
	modes: Readonly<Partial<Record<keyof ProjectContextSettings, "true" | "false">>>,
): boolean {
	const gate = row.appliesWhen;
	if (gate === undefined) return true;
	const self = fields[row.key];
	if (self?.overridden === true || self?.invalid === true) return true;
	return modes[gate.key] === gate.text;
}

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
 * A ratio row: the same text the `/handoff threshold` command accepts, so the card cannot stage
 * `40` for a schema that only stores `0.4`.
 * @param field - field name inside the namespace section.
 * @returns the field's conversion spec.
 */
export function ratioField(field: string): SettingsFieldSpec {
	return {
		field,
		format: (value) => (typeof value === "number" ? String(value) : ""),
		parse: (text) => {
			const trimmed = text.trim();
			if (trimmed === "") return { kind: "clear" };
			const ratio = parseRatioInput(trimmed);
			return ratio === undefined ? undefined : { kind: "set", value: ratio };
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
