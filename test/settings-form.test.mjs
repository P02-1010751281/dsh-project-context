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
		assert.ok(["boolean", "number", "text", "union"].includes(row.kind), `${row.key} has an unknown kind`);
		if (row.kind === "union") {
			assert.ok(Array.isArray(row.options) && row.options.length > 0, `${row.key} is a union without options`);
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
	const spec = fields.unionField("handoffLanguage", ["auto", "zh", "en"]);
	assert.equal(spec.format("zh"), "zh");
	assert.equal(spec.format("klingon"), "", "a value outside the set is not shown as the selection");
	assert.equal(spec.format(undefined), "");
	assert.deepEqual(spec.parse("en"), { kind: "set", value: "en" });
	assert.deepEqual(spec.parse(""), { kind: "clear" });
	// The schema's union would refuse these; staging them would turn a typo into a failed save with
	// no explanation, so the field refuses them first.
	assert.equal(spec.parse("zh-CN"), undefined);
	assert.equal(spec.parse("handoffLanguage"), undefined);
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
	assert.equal(resolvePluginConfig({ handoffSummaryThinking: reference("session") }).handoffSummaryThinking, "session");
	assert.equal(resolvePluginConfig({ archiveEnabled: reference(false) }).archiveEnabled, false);

	const { effectivePluginConfig, publishProjectContextSettings } = await import("../lib/shared/settings.js");
	const fiberConfig = { archiveEnabled: reference(true), handoffTargetTokens: reference(64_000) };
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
