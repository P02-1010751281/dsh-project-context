/**
 * Project-context settings card: the `project-context` namespace's form on the Plugins page.
 *
 * The card is assembled from the platform's own settings surface rather than a private copy of it:
 * `SettingsForm` draws the frame, its read-only/unavailable notices and the single save that writes
 * every staged edit; `SettingsValueField` the released text and number rows; `Switch`, `Pill`, `Tag`
 * and `Button` the boolean and closed-enum rows the platform does not ship a field for; and
 * `SettingsFormModel` the staged, revision-fenced write over the shared configuration form.
 *
 * Nothing here paints — `styles.ts` is geometry only — so the card cannot drift from the theme the
 * way its hand-rolled button did (a literal white label on the dark theme's near-white fill), and
 * the platform owns the save's semantics: one atomic mutation, drafts kept when the Host refuses,
 * and every staged edit dropped when the page is left.
 */

import {
	booleanField,
	hintKey,
	labelKey,
	ROWS,
	SECTIONS,
	unionField,
	type FieldRow,
	type ProjectContextSettings,
} from "./card-fields.ts";
import {
	Button,
	Pill,
	SettingsForm,
	SettingsFormModel,
	SettingsValueField,
	Switch,
	Tag,
	settingsNumberField,
	settingsTextField,
	type SettingsFieldSpec,
	type SettingsFieldState,
	type SettingsFormActions,
	type SettingsFormScope,
	type SettingsFormShell,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { SnapshotStore } from "@deepseek-ai/dsh-client-store";
// Type-only: pulls the `plugins.bundle.config` SlotMap merge (the Plugins page's bundle-config slot).
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type { InjectFace, PropsLocale, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import { formLabels } from "./locales.ts";
import { injectStyles } from "./styles.ts";

// The layout sheet must land during factory materialization so the module system owns its bookkeeping.
injectStyles();

export type { ProjectContextSettings };

/** State the card renders: the shared form shell plus one entry per table row. */
export interface ProjectContextSettingsCardState extends SettingsFormShell {
	readonly fields: Readonly<Record<keyof ProjectContextSettings, SettingsFieldState>>;
}

/** The registration-side face the card's slot entry injects. */
export interface ProjectContextSettingsCardFace extends SettingsFormActions {
	hooks: {
		/** Card snapshot bound by the renderer as useProjectContextSettingsCard. */
		projectContextSettingsCard: SnapshotStore<ProjectContextSettingsCardState>;
	};
}

/**
 * The platform's spec builders, keyed by row kind. Number and text reuse the platform's own
 * conversions; boolean and enum are this plugin's, declared in `card-fields.ts`.
 */
const SPEC_BUILDERS: Record<FieldRow["kind"], (row: FieldRow) => SettingsFieldSpec> = {
	number: (row) => settingsNumberField(row.key),
	text: (row) => settingsTextField(row.key),
	boolean: (row) => booleanField(row.key),
	union: (row) => unionField(row.key, row.options ?? []),
};

/** Bridges the `project-context` scope onto the platform's staged settings form. */
export class ProjectContextSettingsCardController {
	private readonly form: SettingsFormModel<ProjectContextSettings>;
	private readonly store: SnapshotStore<ProjectContextSettingsCardState>;

	/** @param scope - the bound configuration form for the `project-context` namespace. */
	constructor(scope: SettingsFormScope<ProjectContextSettings>) {
		this.form = new SettingsFormModel(scope, ROWS.map((row) => SPEC_BUILDERS[row.kind](row)));
		this.store = this.form.bind(() => this.projection());
	}

	// One loop over the same table the specs and the rows come from: a key cannot be projected
	// twice, or be missing from the projection, without the table itself changing.
	private projection(): ProjectContextSettingsCardState {
		const fields = {} as Record<keyof ProjectContextSettings, SettingsFieldState>;
		for (const row of ROWS) fields[row.key] = this.form.field(row.key);
		return { ...this.form.shell(), fields };
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

/** Copy every row's control shares. */
interface RowCopy {
	label: string;
	hint: string;
	overriddenLabel: string;
	resetLabel: string;
	invalidLabel: string;
	disabled: boolean;
}

/**
 * The badge and reset a staged override shows beside any row's label.
 * @param props - whether the row is overridden, its actions, and the copy.
 * @returns the badge and reset, or null while nothing is staged.
 */
function Override(props: { overridden: boolean; disabled: boolean; overriddenLabel: string; resetLabel: string; onReset: () => void }) {
	if (!props.overridden) return null;
	return (
		<>
			<Tag tone="neutral">{props.overriddenLabel}</Tag>
			<Button variant="ghost" size="sm" disabled={props.disabled} onClick={props.onReset}>
				{props.resetLabel}
			</Button>
		</>
	);
}

/**
 * One boolean row: a labelled switch. The draft's text is where the staged state lives, so the
 * switch reads and writes the same draft every other control does.
 * @param props - the row, its state, the copy, and the edit actions.
 * @returns the row.
 */
function BooleanRow(props: { row: FieldRow; state: SettingsFieldState; copy: RowCopy; onEdit: (text: string) => void; onReset: () => void }) {
	const { copy, state } = props;
	return (
		<div className="dshPcRow">
			<div className="dshPcRowHead">
				<span className="dshPcRowLabel">{copy.label}</span>
				<Override
					overridden={state.overridden}
					disabled={copy.disabled}
					overriddenLabel={copy.overriddenLabel}
					resetLabel={copy.resetLabel}
					onReset={props.onReset}
				/>
			</div>
			<div className="dshPcRowControl">
				<Switch
					checked={state.text === "true"}
					label={copy.label}
					disabled={copy.disabled}
					onChange={(next) => { props.onEdit(next ? "true" : "false"); }}
				/>
			</div>
			<p className="dshPcRowText">{copy.hint}</p>
		</div>
	);
}

/**
 * One closed-enum row: the option set as selectable pills, so a value the schema would refuse
 * cannot be typed.
 * @param props - the row and its options, the state, the copy, and the edit actions.
 * @returns the row.
 */
function UnionRow(props: { row: FieldRow; state: SettingsFieldState; copy: RowCopy; onEdit: (text: string) => void; onReset: () => void }) {
	const { copy, state } = props;
	return (
		<div className="dshPcRow">
			<div className="dshPcRowHead">
				<span className="dshPcRowLabel">{copy.label}</span>
				<Override
					overridden={state.overridden}
					disabled={copy.disabled}
					overriddenLabel={copy.overriddenLabel}
					resetLabel={copy.resetLabel}
					onReset={props.onReset}
				/>
			</div>
			<div className="dshPcRowControl dshPcPills">
				{(props.row.options ?? []).map((option) => (
					<Pill
						key={option}
						active={state.text === option}
						disabled={copy.disabled}
						onClick={() => { props.onEdit(option); }}
					>
						{option}
					</Pill>
				))}
			</div>
			<p className="dshPcRowText">{copy.hint}</p>
		</div>
	);
}

/**
 * One table row, dispatched on its kind: the platform's field for text and number, this card's two
 * rows for the shapes the platform has no field for.
 * @param props - the row, its state, the row copy, and the edit actions.
 * @returns the rendered row.
 */
function Row(props: { row: FieldRow; state: SettingsFieldState; copy: RowCopy; onEdit: (text: string) => void; onReset: () => void }) {
	const { row, state, copy } = props;
	if (row.kind === "boolean") return <BooleanRow {...props} />;
	if (row.kind === "union") return <UnionRow {...props} />;
	return (
		<SettingsValueField
			id={`dsh-pc-${row.key}`}
			label={copy.label}
			hint={copy.hint}
			overriddenLabel={copy.overriddenLabel}
			resetLabel={copy.resetLabel}
			invalidLabel={copy.invalidLabel}
			{...(row.kind === "number" ? { numeric: true } : {})}
			disabled={copy.disabled}
			{...state}
			onEdit={props.onEdit}
			onReset={props.onReset}
		/>
	);
}

/**
 * Render the project-context card.
 * @param props - locale copy, the card snapshot, and its form actions.
 */
export function ProjectContextSettingsCard(props: ProjectContextSettingsCardProps) {
	const { t } = props;
	const state = props.useProjectContextSettingsCard((snapshot) => snapshot);
	// Today the Plugins page renders the keyed `plugins.bundle.config` slot with `view: 'page'` only
	// (`PluginManagerPage.tsx`), so this branch is not on the live path. It stays because `view` is
	// typed `'summary' | 'page'` for every configuration slot alike, and rendering the whole form
	// inside a one-line row would be the failure mode if a surface ever asked for the summary.
	if (props.view === "summary") return t("card.description");

	const copy = (row: FieldRow): RowCopy => ({
		label: t(labelKey(row.key)),
		hint: t(hintKey(row.key)),
		overriddenLabel: t("chrome.overridden"),
		resetLabel: t("chrome.reset"),
		invalidLabel: t("chrome.invalidNumber"),
		disabled: !state.writable,
	});

	return (
		<SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
			{SECTIONS.map((section) => (
				<section key={section.titleKey} className="dshPcSection">
					<h3 className="dshPcSectionTitle">{t(section.titleKey)}</h3>
					<p className="dshPcSectionDescription">{t(section.descriptionKey)}</p>
					{section.rows.map((row) => (
						<Row
							key={row.key}
							row={row}
							state={state.fields[row.key]}
							copy={copy(row)}
							onEdit={(text) => { props.edit(row.key, text); }}
							onReset={() => { props.resetField(row.key); }}
						/>
					))}
				</section>
			))}
		</SettingsForm>
	);
}
