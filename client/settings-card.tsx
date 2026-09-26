/**
 * Project-context settings card: edits the `project-context` namespace from
 * the Plugin configuration section (Settings → Plugins).
 *
 * Adapted from the card pattern of dsh-client-auto-continue
 * (MIT, Copyright (c) 2025 HsiangNianian); chrome and controls are local.
 */

import { type ReactNode } from "react";
// Type-only: pulls the `plugins.bundle.config` SlotMap merge (the Plugins page's bundle-config slot).
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type { InjectFace, PropsLocale, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import { createSnapshotStore, type SettingsScope, type SnapshotStore } from "./dsh-store-compat.ts";
import type { SettingsCardKey } from "./locales.ts";
import {
	booleanField,
	CardForm,
	decimalField,
	numberField,
	textField,
	type CardActions,
	type CardFieldState,
	type CardShell,
} from "./settings-form.ts";
import { injectStyles } from "./styles.ts";

// Styles must land during factory materialization so the module system's style bookkeeping owns them.
injectStyles();

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

/** What the card renders. */
export interface ProjectContextSettingsCardState extends CardShell {
	archiveEnabled: CardFieldState;
	autoConsolidate: CardFieldState;
	consolidateTurns: CardFieldState;
	consolidateIntervalMs: CardFieldState;
	forceDedupeMs: CardFieldState;
	maxTokens: CardFieldState;
	maxOutputTokens: CardFieldState;
	maxMemoryChars: CardFieldState;
	provider: CardFieldState;
	model: CardFieldState;
	autoLearn: CardFieldState;
	autolearnTurns: CardFieldState;
	autolearnIntervalMs: CardFieldState;
	handoffEnabled: CardFieldState;
	handoffAdaptive: CardFieldState;
	handoffThresholdRatio: CardFieldState;
	handoffTargetTokens: CardFieldState;
	handoffKeepTokens: CardFieldState;
	handoffSummaryThinking: CardFieldState;
	handoffPendingQuestion: CardFieldState;
	handoffLanguage: CardFieldState;
}

/** The registration-side face the card's slot entry injects. */
export interface ProjectContextSettingsCardFace extends CardActions {
	hooks: {
		/** Card snapshot bound by the renderer as useProjectContextSettingsCard. */
		projectContextSettingsCard: SnapshotStore<ProjectContextSettingsCardState>;
	};
}

/** Bridges the `project-context` scope onto the card's staged form. */
export class ProjectContextSettingsCardController {
	private readonly form: CardForm<ProjectContextSettings>;
	private readonly store: SnapshotStore<ProjectContextSettingsCardState>;

	/**
	 * @param scope - the bound settings scope for the `project-context` namespace.
	 * @param createStore - platform snapshot-store factory.
	 */
	constructor(scope: SettingsScope<ProjectContextSettings>, createStore: typeof createSnapshotStore) {
		this.form = new CardForm(scope, [
			booleanField("archiveEnabled"),
			booleanField("autoConsolidate"),
			numberField("consolidateTurns", 1),
			numberField("consolidateIntervalMs", 1000),
			numberField("forceDedupeMs", 0),
			numberField("maxTokens", 256),
			numberField("maxOutputTokens", 256),
			numberField("maxMemoryChars", 4000),
			textField("provider"),
			textField("model"),
			booleanField("autoLearn"),
			numberField("autolearnTurns", 1),
			numberField("autolearnIntervalMs", 1000),
			booleanField("handoffEnabled"),
			booleanField("handoffAdaptive"),
			decimalField("handoffThresholdRatio", 0.1, 0.95),
			numberField("handoffTargetTokens", 8000),
			numberField("handoffKeepTokens", 0),
			textField("handoffSummaryThinking"),
			textField("handoffPendingQuestion"),
			textField("handoffLanguage"),
		]);
		this.store = this.form.bind(() => this.projection(), createStore);
	}

	private projection(): ProjectContextSettingsCardState {
		return {
			...this.form.shell(),
			archiveEnabled: this.form.field("archiveEnabled"),
			autoConsolidate: this.form.field("autoConsolidate"),
			consolidateTurns: this.form.field("consolidateTurns"),
			consolidateIntervalMs: this.form.field("consolidateIntervalMs"),
			forceDedupeMs: this.form.field("forceDedupeMs"),
			maxTokens: this.form.field("maxTokens"),
			maxOutputTokens: this.form.field("maxOutputTokens"),
			maxMemoryChars: this.form.field("maxMemoryChars"),
			provider: this.form.field("provider"),
			model: this.form.field("model"),
			autoLearn: this.form.field("autoLearn"),
			autolearnTurns: this.form.field("autolearnTurns"),
			autolearnIntervalMs: this.form.field("autolearnIntervalMs"),
			handoffEnabled: this.form.field("handoffEnabled"),
			handoffAdaptive: this.form.field("handoffAdaptive"),
			handoffThresholdRatio: this.form.field("handoffThresholdRatio"),
			handoffTargetTokens: this.form.field("handoffTargetTokens"),
			handoffKeepTokens: this.form.field("handoffKeepTokens"),
			handoffSummaryThinking: this.form.field("handoffSummaryThinking"),
			handoffPendingQuestion: this.form.field("handoffPendingQuestion"),
			handoffLanguage: this.form.field("handoffLanguage"),
		};
	}

	/** Build the face the card's slot registration injects. */
	inject(): ProjectContextSettingsCardFace {
		return { hooks: { projectContextSettingsCard: this.store }, ...this.form.actions() };
	}

	/** Release the form's scope subscription; the owning fiber calls this on unload. */
	dispose(): void {
		this.form.dispose();
	}
}

/** Props the renderer binds for the project-context plugin-configuration card. */
export type ProjectContextSettingsCardProps =
	& PropsRuntime<"plugins.bundle.config">
	& PropsLocale<"project-context">
	& InjectFace<ProjectContextSettingsCardFace>;

type FieldControl = "text" | "number" | "decimal" | "boolean" | "enum";

interface FieldProps {
	id: string;
	label: string;
	hint: string;
	control: FieldControl;
	options?: readonly string[];
	state: CardFieldState;
	disabled: boolean;
	overriddenLabel: string;
	resetLabel: string;
	onEdit: (text: string) => void;
	onReset: () => void;
}

function Field(props: FieldProps) {
	const { state } = props;
	const selectOptions = props.control === "boolean"
		? [{ value: "true", label: "✓" }, { value: "false", label: "✗" }]
		: (props.options ?? []).map((value) => ({ value, label: value }));
	return (
		<div className="dshPcField">
			<div className="dshPcFieldHead">
				<label className="dshPcLabel" htmlFor={props.id}>{props.label}</label>
				{state.overridden ? (
					<span className="dshPcBadges">
						<span className="dshPcBadge">{props.overriddenLabel}</span>
						<button type="button" className="dshPcReset" disabled={props.disabled} onClick={props.onReset}>
							{props.resetLabel}
						</button>
					</span>
				) : null}
			</div>
			{props.control === "boolean" || props.control === "enum" ? (
				<select
					id={props.id}
					className="dshPcSelect"
					value={state.text}
					disabled={props.disabled}
					onChange={(event) => props.onEdit(event.target.value)}
				>
					<option value="">—</option>
					{selectOptions.map((option) => (
						<option key={option.value} value={option.value}>{option.label}</option>
					))}
				</select>
			) : (
				<input
					id={props.id}
					className={state.invalid ? "dshPcInput dshPcInputInvalid" : "dshPcInput"}
					type="text"
					inputMode={props.control === "number" ? "numeric" : props.control === "decimal" ? "decimal" : undefined}
					value={state.text}
					disabled={props.disabled}
					onChange={(event) => props.onEdit(event.target.value)}
				/>
			)}
			<p className={state.invalid ? "dshPcInvalid" : "dshPcHint"}>{props.hint}</p>
		</div>
	);
}

function Section(props: { title: string; description: string; children: ReactNode }) {
	return (
		<section className="dshPcSection">
			<div className="dshPcSectionTitle">{props.title}</div>
			<p className="dshPcSectionDescription">{props.description}</p>
			<div className="dshPcGrid">{props.children}</div>
		</section>
	);
}

/**
 * Render the project-context card.
 * @param props - locale copy, the card snapshot, and its form actions.
 */
export function ProjectContextSettingsCard(props: ProjectContextSettingsCardProps) {
	const { t } = props;
	const state = props.useProjectContextSettingsCard((snapshot) => snapshot);
	// The Plugins page renders the list row from the summary case and mounts this
	// component again as the page body once the row is opened.
	if (props.view === "summary") return t("card.description");
	if (!state.available) return null;

	const disabled = !state.writable;
	const blocked = !state.dirty || state.invalid || state.saving;
	const field = (
		id: string,
		labelKey: SettingsCardKey,
		hintKey: SettingsCardKey,
		control: FieldControl,
		value: CardFieldState,
		fieldName: keyof ProjectContextSettings,
		options?: readonly string[],
	) => (
		<Field
			id={id}
			label={t(labelKey)}
			hint={t(hintKey)}
			control={control}
			options={options}
			state={value}
			disabled={disabled}
			overriddenLabel={t("chrome.overridden")}
			resetLabel={t("chrome.reset")}
			onEdit={(text) => props.edit(fieldName, text)}
			onReset={() => props.resetField(fieldName)}
		/>
	);

	return (
		<div className="dshPcCard">
			<div className="dshPcBody">
				{!state.writable ? <p className="dshPcReadOnly">{t("chrome.readOnly")}</p> : null}
				<Section title={t("section.memory.title")} description={t("section.memory.description")}>
					{field("pc-archive-enabled", "field.archiveEnabled", "field.archiveEnabledHint", "boolean", state.archiveEnabled, "archiveEnabled")}
					{field("pc-auto-consolidate", "field.autoConsolidate", "field.autoConsolidateHint", "boolean", state.autoConsolidate, "autoConsolidate")}
					{field("pc-consolidate-turns", "field.consolidateTurns", "field.consolidateTurnsHint", "number", state.consolidateTurns, "consolidateTurns")}
					{field("pc-consolidate-interval", "field.consolidateIntervalMs", "field.consolidateIntervalMsHint", "number", state.consolidateIntervalMs, "consolidateIntervalMs")}
					{field("pc-force-dedupe", "field.forceDedupeMs", "field.forceDedupeMsHint", "number", state.forceDedupeMs, "forceDedupeMs")}
					{/* Shared auxiliary route: consolidation, autolearn and the handoff summary all use it. */}
					{field("pc-max-tokens", "field.maxTokens", "field.maxTokensHint", "number", state.maxTokens, "maxTokens")}
					{field("pc-max-output-tokens", "field.maxOutputTokens", "field.maxOutputTokensHint", "number", state.maxOutputTokens, "maxOutputTokens")}
					{field("pc-max-memory-chars", "field.maxMemoryChars", "field.maxMemoryCharsHint", "number", state.maxMemoryChars, "maxMemoryChars")}
					{field("pc-provider", "field.provider", "field.providerHint", "text", state.provider, "provider")}
					{field("pc-model", "field.model", "field.modelHint", "text", state.model, "model")}
				</Section>
				<Section title={t("section.autolearn.title")} description={t("section.autolearn.description")}>
					{field("pc-auto-learn", "field.autoLearn", "field.autoLearnHint", "boolean", state.autoLearn, "autoLearn")}
					{field("pc-autolearn-turns", "field.autolearnTurns", "field.autolearnTurnsHint", "number", state.autolearnTurns, "autolearnTurns")}
					{field("pc-autolearn-interval", "field.autolearnIntervalMs", "field.autolearnIntervalMsHint", "number", state.autolearnIntervalMs, "autolearnIntervalMs")}
				</Section>
				<Section title={t("section.handoff.title")} description={t("section.handoff.description")}>
					{field("pc-handoff-enabled", "field.handoffEnabled", "field.handoffEnabledHint", "boolean", state.handoffEnabled, "handoffEnabled")}
					{field("pc-handoff-adaptive", "field.handoffAdaptive", "field.handoffAdaptiveHint", "boolean", state.handoffAdaptive, "handoffAdaptive")}
					{field("pc-handoff-ratio", "field.handoffThresholdRatio", "field.handoffThresholdRatioHint", "decimal", state.handoffThresholdRatio, "handoffThresholdRatio")}
					{field("pc-handoff-target", "field.handoffTargetTokens", "field.handoffTargetTokensHint", "number", state.handoffTargetTokens, "handoffTargetTokens")}
					{field("pc-handoff-keep", "field.handoffKeepTokens", "field.handoffKeepTokensHint", "number", state.handoffKeepTokens, "handoffKeepTokens")}
					{field("pc-handoff-thinking", "field.handoffSummaryThinking", "field.handoffSummaryThinkingHint", "enum", state.handoffSummaryThinking, "handoffSummaryThinking", ["off", "session"])}
					{field("pc-handoff-pending", "field.handoffPendingQuestion", "field.handoffPendingQuestionHint", "enum", state.handoffPendingQuestion, "handoffPendingQuestion", ["defer", "wait"])}
					{field("pc-handoff-language", "field.handoffLanguage", "field.handoffLanguageHint", "enum", state.handoffLanguage, "handoffLanguage", ["auto", "zh", "en"])}
				</Section>
				<div className="dshPcFooter">
					{state.dirty ? <span className="dshPcPending">{t("chrome.unsaved")}</span> : null}
					{state.failed ? <p className="dshPcFailed">{t("chrome.saveFailed")}</p> : null}
					<button type="button" className="dshPcDiscard" disabled={!state.dirty || state.saving} onClick={props.discard}>
						{t("chrome.discard")}
					</button>
					<button type="button" className="dshPcSave" disabled={blocked} onClick={props.save}>
						{t(state.saving ? "chrome.saving" : "chrome.save")}
					</button>
				</div>
			</div>
		</div>
	);
}
