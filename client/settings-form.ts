/**
 * Staged form model behind the plugin settings card.
 *
 * Adapted from dsh-client-auto-continue (MIT, Copyright (c) 2025 HsiangNianian)
 * following the plugin-card store pattern used by the DSH plugin configuration
 * section: a card stages what the user types and writes it only on save.
 */

import type { SettingsScope, SnapshotStore } from "./dsh-store-compat.ts";

/** The write one field's staged text performs when the card is saved. */
export type FieldWrite = { kind: "set"; value: unknown } | { kind: "clear" };

/** How one field converts between its stored value and its draft text. */
export interface CardFieldSpec {
	field: string;
	format: (value: unknown) => string;
	parse: (text: string) => FieldWrite | undefined;
}

/** One field as the card's control renders it. */
export interface CardFieldState {
	text: string;
	overridden: boolean;
	invalid: boolean;
}

/** Form state every plugin card shares. */
export interface CardShell {
	available: boolean;
	writable: boolean;
	dirty: boolean;
	invalid: boolean;
	saving: boolean;
	failed: boolean;
}

/** The write actions the card's slot entry injects. */
export interface CardActions {
	edit: (field: string, text: string) => void;
	resetField: (field: string) => void;
	save: () => void;
	discard: () => void;
}

/** A whole-number field. An empty draft clears the field; a non-number or out-of-range draft blocks the save. */
export function numberField(field: string, min = 0): CardFieldSpec {
	return {
		field,
		format: (value) => (typeof value === "number" ? String(value) : ""),
		parse: (text) => {
			const trimmed = text.trim();
			if (trimmed === "") return { kind: "clear" };
			const parsed = Number(trimmed);
			if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < min) return undefined;
			return { kind: "set", value: parsed };
		},
	};
}

/** A decimal field with an inclusive range. An empty draft clears the field; a non-number or out-of-range draft blocks the save. */
export function decimalField(field: string, min: number, max: number): CardFieldSpec {
	return {
		field,
		format: (value) => (typeof value === "number" ? String(value) : ""),
		parse: (text) => {
			const trimmed = text.trim();
			if (trimmed === "") return { kind: "clear" };
			const parsed = Number(trimmed);
			if (!Number.isFinite(parsed) || parsed < min || parsed > max) return undefined;
			return { kind: "set", value: parsed };
		},
	};
}

/** A free-text field. An empty draft clears the field, so emptying the control and saving is the same gesture as resetting it. */
export function textField(field: string): CardFieldSpec {
	return {
		field,
		format: (value) => (typeof value === "string" ? value : ""),
		parse: (text) => {
			const trimmed = text.trim();
			return trimmed === "" ? { kind: "clear" } : { kind: "set", value: trimmed };
		},
	};
}

/** A boolean field, edited through true/false draft text; an empty draft inherits. */
export function booleanField(field: string): CardFieldSpec {
	return {
		field,
		format: (value) => (typeof value === "boolean" ? String(value) : ""),
		parse: (text) => {
			const trimmed = text.trim();
			if (trimmed === "") return { kind: "clear" };
			if (trimmed === "true") return { kind: "set", value: true };
			if (trimmed === "false") return { kind: "set", value: false };
			return undefined;
		},
	};
}

/** One field's staged edit. */
interface StagedEdit {
	text: string;
	clear: boolean;
}

/** Stages one card's edits over one settings namespace and writes them on save. */
export class CardForm<T> {
	private readonly specs: Map<string, CardFieldSpec>;
	private readonly staged = new Map<string, StagedEdit>();
	private readonly listeners = new Set<() => void>();
	private saving = false;
	private failed = false;

	/**
	 * @param scope - the bound settings scope for this card's namespace.
	 * @param specs - the section fields this card edits.
	 */
	constructor(
		private readonly scope: SettingsScope<T>,
		specs: CardFieldSpec[],
	) {
		this.specs = new Map(specs.map((spec) => [spec.field, spec]));
		this.scope.subscribe(() => this.publish());
	}

	/** Publish a projection of this form, rebuilt whenever the scope or a draft changes. */
	bind<S>(project: () => S, createStore: (init: S) => SnapshotStore<S>): SnapshotStore<S> {
		const store = createStore(project());
		this.listeners.add(() => store.set(project()));
		return store;
	}

	/** Read the card-level state: what the Host serves, and what a save would do. */
	shell(): CardShell {
		const snapshot = this.scope.getSnapshot();
		return {
			available: snapshot.status === "ready",
			writable: snapshot.writable,
			dirty: this.plan().length > 0,
			invalid: this.plan().some((item) => item.run === undefined),
			saving: this.saving,
			failed: this.failed,
		};
	}

	/** Read one field's state from the effective section and its staged draft. */
	field(field: string): CardFieldState {
		const spec = this.specOf(field);
		const staged = this.staged.get(field);
		if (staged === undefined) {
			return { text: spec.format(this.sectionValue(field)), overridden: this.stored(field), invalid: false };
		}
		const write = staged.clear ? { kind: "clear" as const } : spec.parse(staged.text);
		return { text: staged.text, overridden: write?.kind === "set", invalid: write === undefined };
	}

	/** The actions the card's slot registration injects. */
	actions(): CardActions {
		return {
			edit: (field, text) => this.stage(field, { text, clear: false }),
			resetField: (field) => {
				this.stage(field, { text: this.specOf(field).format(this.baseValue(field)), clear: true });
			},
			save: () => void this.save(),
			discard: () => {
				if (this.staged.size === 0 && !this.failed) return;
				this.staged.clear();
				this.failed = false;
				this.publish();
			},
		};
	}

	/** Write every staged edit, then re-seed from what the Host accepted. */
	async save(): Promise<void> {
		const plan = this.plan();
		const writes = plan.flatMap((item) => (item.run === undefined ? [] : [item.run]));
		if (plan.length === 0 || this.saving || writes.length !== plan.length) return;
		const fields = new Set(plan.map((item) => item.field));
		this.saving = true;
		this.failed = false;
		this.publish();
		let landed = true;
		for (const write of writes) landed = (await write()) && landed;
		if (landed) {
			for (const field of fields) this.staged.delete(field);
		}
		this.saving = false;
		this.failed = !landed;
		this.publish();
	}

	private plan(): { field: string; run: (() => Promise<boolean>) | undefined }[] {
		const plan: { field: string; run: (() => Promise<boolean>) | undefined }[] = [];
		for (const [field, staged] of this.staged) {
			const spec = this.specOf(field);
			if (staged.clear) {
				if (this.stored(field)) plan.push({ field, run: () => this.clear(field) });
				continue;
			}
			if (staged.text === spec.format(this.sectionValue(field))) continue;
			const write = spec.parse(staged.text);
			if (write === undefined) plan.push({ field, run: undefined });
			else if (write.kind === "clear") plan.push({ field, run: () => this.clear(field) });
			else plan.push({ field, run: () => this.store(field, write.value) });
		}
		return plan;
	}

	private async clear(field: string): Promise<boolean> {
		await this.scope.unset(field);
		return !this.stored(field);
	}

	private async store(field: string, value: unknown): Promise<boolean> {
		await this.scope.set(field, value);
		return this.userLayer()?.[field] === value;
	}

	private stage(field: string, edit: StagedEdit): void {
		this.staged.set(field, edit);
		this.failed = false;
		this.publish();
	}

	private specOf(field: string): CardFieldSpec {
		const spec = this.specs.get(field);
		if (spec === undefined) throw new Error(`settings card has no field ${field}`);
		return spec;
	}

	private sectionValue(field: string): unknown {
		return (this.scope.getSnapshot().value as Record<string, unknown> | undefined)?.[field];
	}

	private baseValue(field: string): unknown {
		return (this.scope.getSnapshot().base as Record<string, unknown> | undefined)?.[field];
	}

	private userLayer(): Record<string, unknown> | undefined {
		return this.scope.getSnapshot().user as Record<string, unknown> | undefined;
	}

	private stored(field: string): boolean {
		const user = this.userLayer();
		return user !== undefined && Object.prototype.hasOwnProperty.call(user, field);
	}

	private publish(): void {
		for (const listener of this.listeners) listener();
	}
}
