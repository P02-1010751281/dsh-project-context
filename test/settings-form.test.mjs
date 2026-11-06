/**
 * The client half's form contract: one table drives the specs, the projection and the rows.
 *
 * `client/card-fields.ts` is browser-side data behind type-only imports, so esbuild can bundle it
 * (with the dictionaries) and the suite can check it against the Host schema without a browser. The
 * staged write itself now belongs to the platform (`SettingsFormModel`), which is why nothing here
 * re-implements it: the defects that used to live in a private copy — a save that wrote field by
 * field, no revision fence, and `saving` wedged true when a write rejected — are the platform's to
 * keep fixed, and `client-styles.test.mjs` pins that the copy does not come back.
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

/** Bundle the card's table and dictionaries and import them through a data URL (writes nothing). */
async function loadClientTables() {
	const result = await build({
		stdin: {
			contents: [
				'export * as fields from "./client/card-fields.ts";',
				'export * as locales from "./client/locales.ts";',
			].join("\n"),
			resolveDir: fileURLToPath(new URL("..", import.meta.url)),
			loader: "ts",
		},
		bundle: true,
		format: "esm",
		platform: "neutral",
		target: "es2022",
		write: false,
		logLevel: "warning",
	});
	const [output] = result.outputFiles ?? [];
	if (output === undefined) throw new Error("esbuild produced no output for the client table");
	return import(`data:text/javascript;base64,${Buffer.from(output.text, "utf8").toString("base64")}`);
}

const { fields, locales } = await loadClientTables();

test("the card's table covers the host schema exactly once, with copy for every row", async () => {
	const { PluginSettingsSchema } = await import("../lib/shared/settings.js");
	const schemaKeys = Object.keys(PluginSettingsSchema({}));
	assert.ok(schemaKeys.length > 0, "the schema must declare settings fields");

	const rows = fields.ROWS;
	const rowKeys = rows.map((row) => row.key);
	// Set equality both ways: a field with no row is invisible, and a row with no field writes a
	// namespace member the Host does not have.
	assert.deepEqual([...rowKeys].sort(), [...schemaKeys].sort(), "every schema key needs exactly one row");
	assert.equal(new Set(rowKeys).size, rowKeys.length, "a key must not appear in two rows");

	// The table is the only place a row is declared: the sections must partition it, or a row would
	// render nowhere (the card maps over SECTIONS, not ROWS).
	assert.deepEqual(
		fields.SECTIONS.flatMap((section) => section.rows.map((row) => row.key)).sort(),
		[...rowKeys].sort(),
		"every row must live in exactly one section",
	);

	for (const row of rows) {
		assert.ok(["boolean", "number", "text", "union", "ratio"].includes(row.kind), `${row.key} has an unknown kind`);
		if (row.kind === "union") {
			assert.ok(Array.isArray(row.options) && row.options.length > 0, `${row.key} is a union without options`);
			// The row renders one control per option, so drift here loses a value the host still accepts:
			// the card would offer fewer choices than the schema allows. `card-render.test.mjs` counts
			// pills from this same table, so the count can never notice — only this comparison can.
			const declaredOptions = PluginSettingsSchema.dict[row.key].list.map((member) => member.value);
			assert.deepEqual([...row.options].sort(), [...declaredOptions].sort(), `${row.key}'s options must be the schema's union members`);
		} else {
			assert.equal(row.options, undefined, `${row.key} is not a union and must not carry options`);
		}
		// A label or hint key with no entry renders as its raw key name on the card.
		for (const [name, dict] of [["zh", locales.zh], ["en", locales.en]]) {
			assert.equal(typeof dict[fields.labelKey(row.key)], "string", `${name} is missing ${fields.labelKey(row.key)}`);
			assert.equal(typeof dict[fields.hintKey(row.key)], "string", `${name} is missing ${fields.hintKey(row.key)}`);
		}
	}

	const sectionKeys = fields.SECTIONS.flatMap((section) => [section.titleKey, section.descriptionKey]);
	for (const key of [...sectionKeys, "card.description", "chrome.overridden", "chrome.reset", "chrome.invalidNumber"]) {
		for (const dict of [locales.zh, locales.en]) {
			assert.equal(typeof dict[key], "string", `${key} must exist in both dictionaries`);
		}
	}

	// No dead copy: every `field.*` key in the dictionaries belongs to a row of this table.
	const expected = new Set(rows.flatMap((row) => [fields.labelKey(row.key), fields.hintKey(row.key)]));
	const declared = Object.keys(locales.zh).filter((key) => key.startsWith("field."));
	assert.deepEqual(
		declared.filter((key) => !expected.has(key)),
		[],
		"a dictionary entry no row reads is copy that will never be shown",
	);
});

test("a mode-gated row renders only in the mode that reads it, and never hides a draft", () => {
	// The two threshold rows are the two modes: `handoffBudgetSummaryTokens` only reports an override in
	// adaptive mode, and `handoffThresholdRatio` is only consulted when adaptive is off. Hiding the inert
	// one is what keeps the pair from reading as two competing triggers.
	const drafts = (auto, extra = {}) => Object.fromEntries(fields.ROWS.map((row) => [row.key, {
		text: row.key === "handoffThresholdAuto" ? String(auto) : "0",
		overridden: false,
		invalid: false,
		...extra[row.key],
	}]));
	const row = (key) => fields.ROWS.find((candidate) => candidate.key === key);
	const visible = (key, state) => fields.rowVisible(row(key), state);

	assert.equal(visible("handoffBudgetSummaryTokens", drafts(true)), true);
	assert.equal(visible("handoffThresholdRatio", drafts(true)), false, "the fixed ratio is inert while adaptive is on");
	assert.equal(visible("handoffThresholdRatio", drafts(false)), true);
	assert.equal(visible("handoffBudgetSummaryTokens", drafts(false)), false, "the summary target is inert in fixed mode");

	// The user's own value keeps the row: hiding an override would make it unreachable, and hiding an
	// invalid draft would block the save with no control left to fix it.
	assert.equal(
		visible("handoffThresholdRatio", drafts(true, { handoffThresholdRatio: { overridden: true } })),
		true,
		"an overridden gated row must stay visible",
	);
	assert.equal(
		visible("handoffThresholdRatio", drafts(true, { handoffThresholdRatio: { invalid: true } })),
		true,
		"an invalid gated draft must stay visible",
	);

	// A row with no gate is never hidden by a mode.
	for (const auto of [true, false]) assert.equal(visible("handoffLang", drafts(auto)), true);
});

test("a gate names a boolean row, or it can never be satisfied", () => {
	const kinds = new Map(fields.ROWS.map((row) => [row.key, row.kind]));
	for (const row of fields.ROWS) {
		if (row.appliesWhen === undefined) continue;
		assert.equal(
			kinds.get(row.appliesWhen.key),
			"boolean",
			`${row.key}'s gate reads ${row.appliesWhen.key}, which is not a boolean row`,
		);
		assert.ok(["true", "false"].includes(row.appliesWhen.text), `${row.key}'s gate must compare a boolean literal`);
		// A row that gated itself would be unreachable: its own draft would decide whether it exists.
		assert.notEqual(row.appliesWhen.key, row.key, `${row.key} must not gate itself`);
	}
});

test("the ratio row takes the command's three spellings and refuses everything else", () => {
	const spec = fields.ratioField("handoffThresholdRatio");
	assert.equal(spec.format(0.4), "0.4");
	assert.equal(spec.format(undefined), "", "an absent value renders empty rather than as a ratio nobody chose");
	assert.deepEqual(spec.parse(""), { kind: "clear" });
	// The command has always folded these three; a card that passed `40` through failed the save.
	for (const typed of ["0.4", "40", "40%", " 40% "]) {
		assert.deepEqual(spec.parse(typed), { kind: "set", value: 0.4 }, typed);
	}
	assert.deepEqual(spec.parse("0.95"), { kind: "set", value: 0.95 }, "the accepted bound must round-trip");
	// Outside the pair the Host would drop the write, so the field refuses the draft and blocks the save.
	for (const typed of ["0.09", "0.96", "nope"]) assert.equal(spec.parse(typed), undefined, typed);
});

test("the retired handoffThinking row and its copy are gone from the card", () => {
	// The card face of the retirement: a row, a label or a hint left behind would keep an unknown
	// key visible (and writable) on a card whose host schema no longer declares it.
	assert.equal(fields.ROWS.some((row) => row.key === "handoffThinking"), false, "no row may survive");
	assert.equal(fields.SECTIONS.flatMap((section) => section.rows).some((row) => row.key === "handoffThinking"), false);
	for (const [name, dict] of [["zh", locales.zh], ["en", locales.en]]) {
		assert.equal("field.handoffThinking" in dict, false, `${name} still labels the retired row`);
		assert.equal("field.handoffThinkingHint" in dict, false, `${name} still hints the retired row`);
	}
});

test("a boolean row stages the two literals and refuses any other draft", () => {
	const spec = fields.booleanField("archiveEnabled");
	assert.equal(spec.format(true), "true");
	assert.equal(spec.format(false), "false");
	assert.equal(spec.format(undefined), "false", "an absent value renders as the switch's off state");
	assert.deepEqual(spec.parse("true"), { kind: "set", value: true });
	assert.deepEqual(spec.parse(" false "), { kind: "set", value: false });
	assert.deepEqual(spec.parse(""), { kind: "clear" });
	// `undefined` is what blocks the save in the platform's model, rather than writing something else.
	assert.equal(spec.parse("yes"), undefined);
	assert.equal(spec.parse("1"), undefined);
});

test("a union row accepts only its declared values, and blocks the save on anything else", () => {
	const spec = fields.unionField("handoffLang", ["auto", "zh", "en"]);
	assert.equal(spec.format("zh"), "zh");
	assert.equal(spec.format("klingon"), "", "a value outside the set is not shown as the selection");
	assert.equal(spec.format(undefined), "");
	assert.deepEqual(spec.parse("en"), { kind: "set", value: "en" });
	assert.deepEqual(spec.parse(""), { kind: "clear" });
	// The schema's union would refuse these; staging them would turn a typo into a failed save with
	// no explanation, so the field refuses them first.
	assert.equal(spec.parse("zh-CN"), undefined);
	assert.equal(spec.parse("handoffLang"), undefined);
});

test("the archive entry exports the Config schema the Host projects a settings form from", async () => {
	// dsh 0.1.7-rc.2 dropped runtime section registration (`settings.installSection`): the Host reads
	// the schema off the owning module (`SettingsForms.schema(entry) = entry.fiber.runtime.Config`)
	// and keys the form by the Loader entry id. So the `project-context` entry only gets a form while
	// its module exports `Config` — without it the card disappears with no error and no log, which is
	// the drift that made it invisible on alpha.1/alpha.2 and that this assertion pins.
	const entry = await import("../lib/project-context/index.js");
	assert.ok(entry.Config !== undefined, "the archive entry must export the settings schema as Config");
	assert.equal(typeof entry.Config.toJSON, "function", "Config must be a schemastery schema");
	const { PluginSettingsSchema, SETTINGS_NAMESPACE } = await import("../lib/shared/settings.js");
	assert.deepEqual(entry.Config({}), PluginSettingsSchema({}), "the exported schema is the shared settings schema");
	assert.equal(SETTINGS_NAMESPACE, "project-context", "the form's namespace is the archive entry's Loader id");

	// The browser card binds that same namespace; a private copy drifting from the entry id would
	// leave the card watching a namespace the Host never serves.
	const client = await readFile(new URL("../client/index.ts", import.meta.url), "utf8");
	assert.ok(client.includes(`const NS = "${SETTINGS_NAMESPACE}"`), "the card must bind the namespace the Host serves");
});

test("every settings field carries the volatile mark the Host's form projection requires", async () => {
	// `SettingsForms.describe()` runs each schema through `volatileForm()`, which keeps a field only
	// when it (or an ancestor) carries the schemastery `volatile` mark and returns `undefined` for a
	// schema whose fields are all ordinary. Such an entry is served by nobody: the namespace never
	// reaches the client's describe mirror, `whileServed` never fires, and the card disappears with no
	// error and no log. Measured on dsh 0.1.7-rc.2: without the marks the Host serves 23 namespaces and
	// not this one; with them it serves 24 including `project-context`.
	const { PluginSettingsSchema } = await import("../lib/shared/settings.js");
	const dict = PluginSettingsSchema.dict ?? {};
	const keys = Object.keys(dict);
	assert.ok(keys.length > 0, "the schema must declare settings fields");
	for (const key of keys) {
		assert.equal(dict[key].meta?.volatile, true, `${key} must be volatile or the Host drops the whole namespace`);
	}
});

test("volatile settings are read through their live references, not snapshotted", async () => {
	// The mark makes schemastery hand each field over as a live reference (cosmokit's shared protocol,
	// branded with a global symbol), and the Loader commits a volatile-only settings write straight into
	// those references (`Entry._commitVolatile`) without restarting the entry. So both halves matter:
	// the owner must be able to resolve a reference, and every reader must see a later write.
	const WRITE = Symbol.for("cosmokit.volatile.write");
	const reference = (value) => {
		let current = value;
		return Object.freeze({ get: () => current, [WRITE]: (next) => { current = next; } });
	};

	const { resolvePluginConfig } = await import("../lib/shared/config.js");
	assert.equal(resolvePluginConfig({ handoffLang: reference("zh") }).handoffLang, "zh");
	assert.equal(resolvePluginConfig({ archiveEnabled: reference(false) }).archiveEnabled, false);

	const { effectivePluginConfig, publishProjectContextSettings } = await import("../lib/shared/settings.js");
	const fiberConfig = { archiveEnabled: reference(true), handoffBudgetSummaryTokens: reference(64_000) };
	let release;
	const ctx = {
		effect: (callback) => { release = callback(); return release; },
		fiber: { config: fiberConfig },
	};
	publishProjectContextSettings(ctx, resolvePluginConfig({}));
	assert.equal(effectivePluginConfig(resolvePluginConfig({})).archiveEnabled, true);
	fiberConfig.archiveEnabled[WRITE](false);
	assert.equal(
		effectivePluginConfig(resolvePluginConfig({})).archiveEnabled,
		false,
		"a volatile write must reach the other plugins without a remount",
	);
	release?.();
	assert.equal(effectivePluginConfig(resolvePluginConfig({})).archiveEnabled, true, "releasing restores the caller's own config");
});

test("the save-failure copy does not promise a retry that cannot work", () => {
	// The form reports one flag for two unrelated causes: a value the Host rejects (the same draft fails
	// again) and a revision conflict (the baseline is taken once, on the first edit, and never reseeded,
	// so retrying the same draft fails again too). Only a transport blip is retryable, so the copy may
	// not present a bare retry as the remedy. This pins the string the card replaced; nothing else about
	// the platform's single flag is knowable from here.
	const retired = ["保存未生效，请重试", "Save did not land; try again"];
	for (const [name, dict] of [["zh", locales.zh], ["en", locales.en]]) {
		assert.equal(retired.includes(dict["chrome.saveFailed"]), false, `${name} still promises the bare retry`);
	}
});

test("every ratio spelling the hint promises is one the card accepts", async () => {
	// The hint is where the card's extra spellings are discoverable, so it must not name one the parser
	// then refuses: a hint that promises `40%` while the field rejects it is the same defect as the
	// command/card split, moved into prose.
	const { parseRatioInput } = await import("../lib/shared/ratio.js");
	const spec = fields.ratioField("handoffThresholdRatio");
	for (const [name, dict] of [["zh", locales.zh], ["en", locales.en]]) {
		const hint = dict["field.handoffThresholdRatioHint"];
		const percents = [...hint.matchAll(/\d+(?:\.\d+)?%/g)].map((match) => match[0]);
		assert.ok(percents.length > 0, `${name} hint must show the percent spelling the card accepts: ${hint}`);
		for (const token of percents) {
			const ratio = parseRatioInput(token);
			assert.notEqual(ratio, undefined, `${name} hint names ${token}, which the parser refuses`);
			assert.deepEqual(spec.parse(token), { kind: "set", value: ratio }, `${name}: the card must accept what the hint promises`);
		}
	}
});

test("the ratio hint states the range the host enforces, from the one exported pair", async () => {
	// Batch K: the card is a reader of the accepted ratio range like the parser and the validator are, so a
	// hint that hard-codes it is a copy that can drift into telling the user a range the host then rejects.
	const { DEFAULT_THRESHOLD_RATIO, MAX_THRESHOLD_RATIO, MIN_THRESHOLD_RATIO } = await import("../lib/shared/limits.js");
	const range = `${MIN_THRESHOLD_RATIO}–${MAX_THRESHOLD_RATIO}`;
	for (const [name, dict] of [["zh", locales.zh], ["en", locales.en]]) {
		const hint = dict["field.handoffThresholdRatioHint"];
		assert.ok(hint.includes(range), `${name} hint must state ${range}: ${hint}`);
		assert.ok(hint.includes(String(DEFAULT_THRESHOLD_RATIO)), `${name} hint must state the default: ${hint}`);
	}
});
