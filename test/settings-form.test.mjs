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

test("each card's table covers its own host schema exactly once, with copy for every row", async () => {
	const settings = await import("../lib/shared/settings.js");

	// Batch AC split one 23-key schema into four, each owned by an entry. The tables and the schemas
	// have to agree card by card: a field with no row is invisible, and a row with no field writes a
	// namespace member the Host does not have.
	const pairs = [
		["shared", settings.SharedSettingsSchema],
		["memory", settings.MemorySettingsSchema],
		["autolearn", settings.AutolearnSettingsSchema],
		["handoff", settings.HandoffSettingsSchema],
	];

	const seen = new Set();
	for (const [card, schema] of pairs) {
		const schemaKeys = Object.keys(schema({}));
		assert.ok(schemaKeys.length > 0, `${card}: the schema must declare settings fields`);

		const rows = fields.CARD_ROWS[card];
		const rowKeys = rows.map((row) => row.key);
		assert.deepEqual([...rowKeys].sort(), [...schemaKeys].sort(), `${card}: every schema key needs exactly one row`);
		assert.equal(new Set(rowKeys).size, rowKeys.length, `${card}: a key must not appear in two rows`);

		// A key may only live on one card: two cards writing the same key is the drift this split exists
		// to prevent, since each entry has its own namespace.
		for (const key of rowKeys) {
			assert.equal(seen.has(key), false, `${key} is declared on two cards`);
			seen.add(key);
		}

		// The sections must partition the card's rows, or a row renders nowhere.
		assert.deepEqual(
			fields.CARD_TABLES[card].flatMap((section) => section.rows.map((row) => row.key)).sort(),
			[...rowKeys].sort(),
			`${card}: every row must live in exactly one section`,
		);

		for (const row of rows) {
			assert.ok(["boolean", "number", "text", "union", "threshold"].includes(row.kind), `${row.key} has an unknown kind`);
			if (row.kind === "union") {
				assert.ok(Array.isArray(row.options) && row.options.length > 0, `${row.key} is a union without options`);
				const declaredOptions = schema.dict[row.key].list.map((member) => member.value);
				assert.deepEqual([...row.options].sort(), [...declaredOptions].sort(), `${row.key}'s options must be the schema's union members`);
			} else {
				assert.equal(row.options, undefined, `${row.key} is not a union and must not carry options`);
			}
			for (const [name, dict] of [["zh", locales.zh], ["en", locales.en]]) {
				assert.equal(typeof dict[fields.labelKey(row.key)], "string", `${name} is missing ${fields.labelKey(row.key)}`);
				assert.equal(typeof dict[fields.hintKey(row.key)], "string", `${name} is missing ${fields.hintKey(row.key)}`);
			}
		}
	}

	// The four cards together are the whole 23-key config: a key dropped from every card is a setting
	// nobody can reach any more.
	const { DEFAULT_CONFIG } = await import("../lib/shared/config.js");
	assert.deepEqual([...seen].sort(), Object.keys(DEFAULT_CONFIG).sort(), "the four cards must cover the config exactly");

	const sectionKeys = Object.values(fields.CARD_TABLES).flatMap((sections) =>
		sections.flatMap((section) => [section.titleKey, section.descriptionKey]),
	);
	for (const key of [...sectionKeys, "card.description", "chrome.overridden", "chrome.reset", "chrome.invalidNumber", "chrome.saveFailed", "chrome.saveFailedRejected", "chrome.saveFailedConflict"]) {
		for (const dict of [locales.zh, locales.en]) {
			assert.equal(typeof dict[key], "string", `${key} must exist in both dictionaries`);
		}
	}

	// No dead copy: every `field.*` key in the dictionaries belongs to a row of some card.
	const expected = new Set(Object.values(fields.CARD_ROWS).flat().flatMap((row) => [fields.labelKey(row.key), fields.hintKey(row.key)]));
	const declared = Object.keys(locales.zh).filter((key) => key.startsWith("field."));
	assert.deepEqual(
		declared.filter((key) => !expected.has(key)),
		[],
		"a dictionary entry no row reads is copy that will never be shown",
	);
});

/** The four card schemas, loaded once: a case that needs bounds or marks reads the owning card's. */
let SCHEMAS;
test.before(async () => {
	const settings = await import("../lib/shared/settings.js");
	SCHEMAS = {
		shared: settings.SharedSettingsSchema,
		memory: settings.MemorySettingsSchema,
		autolearn: settings.AutolearnSettingsSchema,
		handoff: settings.HandoffSettingsSchema,
	};
});

test("every bounded number row enforces exactly the Host schema's inclusive bounds", async () => {
	// Derived from the schema object rather than restated, so changing `settings.ts` without the card
	// turns this red while a change made in the one shared pair moves both sides together.
	// Across all four cards: the bounded rows now live on two of them.
	const bounded = Object.values(fields.CARD_ROWS).flat().filter((row) => row.kind === "number" && row.bounds !== undefined);
	assert.deepEqual(
		bounded.map((row) => row.key).sort(),
		["handoffBudgetRecentTokens", "handoffBudgetSummaryTokens", "sessionSettledDays"],
		"the two handoff budget amounts and the archive's day boundary are the rows that carry bounds",
	);
	// The bounds must be read from the schema that owns the row, not from one merged schema.
	const ownerOf = (key) => {
		for (const [card, rows] of Object.entries(fields.CARD_ROWS)) if (rows.some((row) => row.key === key)) return card;
		throw new Error(`no card owns ${key}`);
	};
	for (const row of bounded) {
		const meta = SCHEMAS[ownerOf(row.key)].dict[row.key].meta;
		assert.equal(row.bounds.min, meta.min, `${row.key}'s lower bound must be the schema's`);
		assert.equal(row.bounds.max, meta.max, `${row.key}'s upper bound must be the schema's`);
		const spec = fields.boundedNumberField(row.key, row.bounds);
		assert.deepEqual(spec.parse(String(meta.min)), { kind: "set", value: meta.min }, `${row.key} must accept the minimum`);
		assert.deepEqual(spec.parse(String(meta.max)), { kind: "set", value: meta.max }, `${row.key} must accept the maximum`);
		assert.equal(spec.parse(String(meta.min - 1)), undefined, `${row.key} must refuse one below the minimum`);
		assert.equal(spec.parse(String(meta.max + 1)), undefined, `${row.key} must refuse one above the maximum`);
		// `z.natural()` is an integer, so a fractional draft would be refused by the Host as well.
		assert.equal(spec.parse(`${meta.min}.5`), undefined, `${row.key} must refuse a non-integer`);
		assert.deepEqual(spec.parse(""), { kind: "clear" });
	}
});

test("the failure line names the cause, and no cause keeps the generic sentence", () => {
	assert.equal(locales.formLabels((key) => key, "conflict").saveFailed, "chrome.saveFailedConflict");
	assert.equal(locales.formLabels((key) => key, "rejected").saveFailed, "chrome.saveFailedRejected");
	assert.equal(locales.formLabels((key) => key, "unknown").saveFailed, "chrome.saveFailed");
	assert.equal(locales.formLabels((key) => key).saveFailed, "chrome.saveFailed", "a form with no failure keeps the generic line");
});

test("the threshold row takes every spelling the command accepts and refuses everything else", () => {
	const spec = fields.thresholdField("handoffThreshold");
	assert.equal(spec.format("0.4"), "0.4");
	assert.equal(spec.format(undefined), "", "an absent value renders empty rather than as a value nobody chose");
	assert.deepEqual(spec.parse(""), { kind: "clear" });
	// The command has always folded these three; a card that passed `40` through failed the save.
	for (const typed of ["0.4", "40", "40%", " 40% "]) {
		assert.deepEqual(spec.parse(typed), { kind: "set", value: "0.4" }, typed);
	}
	// The spelling this batch added: an absolute count, canonicalized so it re-parses as the same count.
	assert.deepEqual(spec.parse("400k"), { kind: "set", value: "400000" });
	assert.deepEqual(spec.parse("400000"), { kind: "set", value: "400000" });
	assert.deepEqual(spec.parse("auto"), { kind: "set", value: "auto" });
	assert.deepEqual(spec.parse("0.95"), { kind: "set", value: "0.95" }, "the accepted bound must round-trip");
	// Outside the accepted shapes the Host would drop the write, so the field refuses the draft.
	for (const typed of ["0.09", "0.96", "nope", "5"]) assert.equal(spec.parse(typed), undefined, typed);
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

test("every entry exports the Config schema the Host projects its own card from", async () => {
	// dsh 0.1.7-rc.2 dropped runtime section registration (`settings.installSection`): the Host reads
	// the schema off the owning module (`SettingsForms.schema(entry) = entry.fiber.runtime.Config`)
	// and keys the form by the Loader entry id. So the `project-context` entry only gets a form while
	// its module exports `Config` — without it the card disappears with no error and no log, which is
	// the drift that made it invisible on alpha.1/alpha.2 and that this assertion pins.
	// Batch AC: four entries, four schemas, four cards. Every entry must export its own `Config` — an
	// entry without one is served by nobody, and its card silently never appears.
	const entries = {
		shared: await import("../lib/project-context/index.js"),
		memory: await import("../lib/project-memory/index.js"),
		autolearn: await import("../lib/project-autolearn/index.js"),
		handoff: await import("../lib/project-handoff/index.js"),
	};
	for (const [card, entry] of Object.entries(entries)) {
		assert.ok(entry.Config !== undefined, `${card}: the entry must export its settings schema as Config`);
		assert.equal(typeof entry.Config.toJSON, "function", `${card}: Config must be a schemastery schema`);
		assert.deepEqual(entry.Config({}), SCHEMAS[card]({}), `${card}: the exported schema is that card's schema`);
	}

	// Only the publishing entry keeps the loader id the browser card binds.
	const { CONTEXT_SETTINGS_NAMESPACE } = await import("../lib/shared/settings-namespaces.js");
	assert.equal(CONTEXT_SETTINGS_NAMESPACE, "project-context", "the publisher's namespace is its Loader id");
	const client = await readFile(new URL("../client/index.ts", import.meta.url), "utf8");
	assert.ok(client.includes(`const NS = "${CONTEXT_SETTINGS_NAMESPACE}"`), "the card must bind the namespace the Host serves");
});

test("every settings field carries the volatile mark the Host's form projection requires", async () => {
	// `SettingsForms.describe()` runs each schema through `volatileForm()`, which keeps a field only
	// when it (or an ancestor) carries the schemastery `volatile` mark and returns `undefined` for a
	// schema whose fields are all ordinary. Such an entry is served by nobody: the namespace never
	// reaches the client's describe mirror, `whileServed` never fires, and the card disappears with no
	// error and no log. Measured on dsh 0.1.7-rc.2: without the marks the Host serves 23 namespaces and
	// not this one; with them it serves 24 including `project-context`.
	for (const [card, schema] of Object.entries(SCHEMAS)) {
		const dict = schema.dict ?? {};
		const keys = Object.keys(dict);
		assert.ok(keys.length > 0, `${card}: the schema must declare settings fields`);
		for (const key of keys) {
			assert.equal(dict[key].meta?.volatile, true, `${card}.${key} must be volatile or the Host drops that whole namespace`);
		}
	}
});

test("volatile settings are read through their live references, not snapshotted", async () => {
	// The mark makes schemastery hand each field over as a live reference (cosmokit's shared protocol,
	// branded with a global symbol), and the Loader commits a volatile-only settings write straight into
	// those references (`Entry._commitVolatile`) without restarting the entry. Batch AC split the readers,
	// so all three paths have to follow a reference: the card resolvers, the publisher's read, and the
	// feature entry's own live read.
	const WRITE = Symbol.for("cosmokit.volatile.write");
	const reference = (value) => {
		let current = value;
		return Object.freeze({ get: () => current, [WRITE]: (next) => { current = next; } });
	};

	const { resolveSharedConfig, resolveHandoffConfig, resolveMemoryConfig } = await import("../lib/shared/config.js");
	// `handoffLang` is read by all four entries through `receiptLanguage`, so it is on the shared card.
	assert.equal(resolveSharedConfig({ handoffLang: reference("zh") }).handoffLang, "zh");
	assert.equal(resolveSharedConfig({ archiveEnabled: reference(false) }).archiveEnabled, false);
	assert.equal(resolveHandoffConfig({ handoffThreshold: reference("0.4") }).handoffThreshold.mode, "ratio");
	assert.equal(resolveMemoryConfig({ consolidateTurns: reference(9) }).consolidateTurns, 9);

	const { effectiveSharedSettings, livePluginConfig, publishProjectContextSettings, withShared } = await import("../lib/shared/settings.js");
	const fiberConfig = { archiveEnabled: reference(true), maxTokens: reference(8192) };
	let release;
	// The adapter's façade shape: `settings.current()` reads the fiber config on every call, and
	// `onDispose` registers the cleanup this test triggers by hand.
	const host = {
		settings: { current: () => fiberConfig },
		onDispose: (cleanup) => { release = cleanup; },
	};
	publishProjectContextSettings(host, resolveSharedConfig({}));
	assert.equal(effectiveSharedSettings(resolveSharedConfig({})).archiveEnabled, true);
	fiberConfig.archiveEnabled[WRITE](false);
	assert.equal(
		effectiveSharedSettings(resolveSharedConfig({})).archiveEnabled,
		false,
		"a volatile write must reach the other entries without a remount",
	);

	// The feature entry's own read follows a live reference the same way.
	const ownFiber = { consolidateTurns: reference(11) };
	const ownHost = { settings: { current: () => ownFiber } };
	const applied = resolveMemoryConfig({});
	assert.equal(livePluginConfig(ownHost, applied, resolveMemoryConfig).consolidateTurns, 11);
	ownFiber.consolidateTurns[WRITE](12);
	assert.equal(
		withShared(livePluginConfig(ownHost, applied, resolveMemoryConfig), effectiveSharedSettings(applied)).consolidateTurns,
		12,
		"and a later write is visible without re-applying",
	);

	release?.();
	assert.equal(effectiveSharedSettings(resolveSharedConfig({})).archiveEnabled, true, "releasing restores the caller's own config");
});

test("the save-failure copy does not promise a retry that cannot work", () => {
	// The form reports one flag for two unrelated causes: a value the Host rejects (the same draft fails
	// again) and a revision conflict (the baseline is taken once, on the first edit, and never reseeded,
	// so retrying the same draft fails again too). Only a transport blip is retryable, so the copy may
	// not present a bare retry as the remedy. This pins the string the card replaced; nothing else about
	// the platform's single flag is knowable from here.
	const retired = ["保存未生效，请重试", "Save did not land; try again"];
	for (const [name, dict] of [["zh", locales.zh], ["en", locales.en]]) {
		for (const key of ["chrome.saveFailed", "chrome.saveFailedRejected", "chrome.saveFailedConflict"]) {
			assert.equal(retired.includes(dict[key]), false, `${name} still promises the bare retry in ${key}`);
			assert.ok(dict[key].length > 0, `${name} must fill ${key}`);
		}
	}
});

test("every spelling the hint promises is one the card accepts", () => {
	// The hint is where the card's spellings are discoverable, so it must not name one the reader then
	// refuses: a hint promising `400k` while the field rejects it is the command/card split in prose.
	const spec = fields.thresholdField("handoffThreshold");
	for (const [name, dict] of [["zh", locales.zh], ["en", locales.en]]) {
		const hint = dict["field.handoffThresholdHint"];
		for (const token of ["auto", "0.4", "40", "40%", "400k"]) {
			assert.ok(hint.includes(token), `${name} hint must name ${token}: ${hint}`);
			assert.notEqual(spec.parse(token), undefined, `${name}: the card must accept ${token}, which the hint promises`);
		}
	}
});

test("the hint states the range the host enforces and the default it re-inherits", async () => {
	// Batch K: the card is a reader of the accepted ratio range like the parser and the validator are, so a
	// hint that hard-codes it is a copy that can drift into telling the user a range the host then rejects.
	// The default is `auto` now that the three spellings are one key.
	const { MAX_THRESHOLD_RATIO, MIN_THRESHOLD_RATIO } = await import("../lib/shared/limits.js");
	const range = `${MIN_THRESHOLD_RATIO}–${MAX_THRESHOLD_RATIO}`;
	for (const [name, dict] of [["zh", locales.zh], ["en", locales.en]]) {
		const hint = dict["field.handoffThresholdHint"];
		assert.ok(hint.includes(range), `${name} hint must state ${range}: ${hint}`);
		assert.ok(hint.includes("auto"), `${name} hint must state the default: ${hint}`);
	}
});

test("the shared value is read on every call, never captured at apply", async () => {
	// The publication is a reader, not a snapshot (see `publishProjectContextSettings`): a volatile-only
	// save never restarts the entry, so a value captured when the port was built would leave the card's
	// writes visible in the form and inert everywhere else.
	const { resolveSharedConfig } = await import("../lib/shared/config.js");
	const { effectiveSharedSettings, publishProjectContextSettings } = await import("../lib/shared/settings.js");

	let current = resolveSharedConfig({ maxTokens: 8_000 });
	publishProjectContextSettings(
		{ settings: { current: () => current }, onDispose: () => undefined },
		resolveSharedConfig({}),
	);
	assert.equal(effectiveSharedSettings(resolveSharedConfig({})).maxTokens, 8_000, "the first read sees the published value");
	current = resolveSharedConfig({ maxTokens: 120_000 });
	assert.equal(
		effectiveSharedSettings(resolveSharedConfig({})).maxTokens,
		120_000,
		"a later read must see the new value, so the port cannot be snapshotted at apply time",
	);
});

test("an unreadable settings port falls back to the entry config instead of failing a handler", async (t) => {
	// Two degradations the adapter can produce, both must be silent: the host may not expose settings at
	// all (`undefined`), or its reader may throw. Each caller is an event handler, so an exception here
	// would take down a turn rather than a settings read.
	const { resolveSharedConfig } = await import("../lib/shared/config.js");
	const { effectiveSharedSettings, publishProjectContextSettings } = await import("../lib/shared/settings.js");
	const releases = [];
	t.after(() => { for (const release of releases) release(); });

	// The fallback is the publisher's entry config, not the caller's: the publication returns the value
	// the namespace-owning entry was applied with.
	const published = resolveSharedConfig({});
	publishProjectContextSettings(
		{ settings: { current: () => undefined }, onDispose: (cleanup) => { releases.push(cleanup); } },
		published,
	);
	assert.equal(effectiveSharedSettings(resolveSharedConfig({ maxTokens: 1_024 })).maxTokens, published.maxTokens, "a port that publishes nothing leaves the publisher's entry config");

	publishProjectContextSettings(
		{
			settings: {
				current: () => {
					throw new Error("settings service unavailable");
				},
			},
			onDispose: (cleanup) => { releases.push(cleanup); },
		},
		resolveSharedConfig({}),
	);
	assert.equal(effectiveSharedSettings(resolveSharedConfig({ maxTokens: 1_024 })).maxTokens, published.maxTokens, "a throwing port leaves the publisher's entry config");
});

test("a config the port publishes in the wrong shape also falls back, never half-applied", async (t) => {
	// The card resolver rejects an unknown or malformed key; the reader must treat that as "unreadable"
	// rather than surfacing a partial config built from whichever fields happened to parse.
	const { resolveSharedConfig } = await import("../lib/shared/config.js");
	const { effectiveSharedSettings, publishProjectContextSettings } = await import("../lib/shared/settings.js");
	const releases = [];
	t.after(() => { for (const release of releases) release(); });

	const published = resolveSharedConfig({});
	publishProjectContextSettings(
		{
			settings: { current: () => ({ maxMemoryChars: "not a number" }) },
			onDispose: (cleanup) => { releases.push(cleanup); },
		},
		published,
	);
	assert.equal(effectiveSharedSettings(resolveSharedConfig({ maxTokens: 1_024 })).maxTokens, published.maxTokens, "a malformed published config falls back whole");
});

test("only the newest publication releases the shared value", async () => {
	// A config change that restarts the entry builds the new fiber before disposing the old one, so the
	// stale fiber's cleanup must not clear a newer publication.
	const { resolveSharedConfig } = await import("../lib/shared/config.js");
	const { effectiveSharedSettings, publishProjectContextSettings } = await import("../lib/shared/settings.js");
	const releases = [];
	const host = (config) => ({
		settings: { current: () => config },
		onDispose: (cleanup) => { releases.push(cleanup); },
	});

	const first = resolveSharedConfig({ maxTokens: 8_000 });
	const second = resolveSharedConfig({ maxTokens: 16_000 });
	const own = resolveSharedConfig({ maxTokens: 1_024 });
	publishProjectContextSettings(host(first), first);
	assert.equal(effectiveSharedSettings(own).maxTokens, 8_000);
	publishProjectContextSettings(host(second), second);
	assert.equal(effectiveSharedSettings(own).maxTokens, 16_000, "a reload republishes");
	releases[0]();
	assert.equal(effectiveSharedSettings(own).maxTokens, 16_000, "a stale fiber must not release a newer publication");
	releases[1]();
	assert.equal(effectiveSharedSettings(own).maxTokens, 1_024, "the owner's cleanup restores each plugin's own entry config");
});
