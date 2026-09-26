/**
 * The client half's render contract: the card really renders every row of its field table through
 * the platform's settings surface.
 *
 * Every other client test in this suite scans the source as text, which can prove a string is absent
 * but never that a control reaches the DOM. This one bundles the card together with the platform's
 * `SettingsForm` / `SettingsValueField` / `Switch` / `Pill`, renders it with `react-dom/server`, and
 * asserts the markup a user would get: one row per table entry, a switch per boolean, a pill per enum
 * option, no control the page did not ask for, and the platform's staged write (one revision-fenced
 * mutation; a refusal that keeps the drafts and does not wedge `saving`).
 *
 * Scope, deliberately: the expectations are derived from `client/card-fields.ts` itself, so this
 * answers "does the card render the table", not "is the table right" — a dropped row is
 * `settings-form.test.mjs`'s job, which compares the table against the Host schema.
 *
 * Two things about the harness are worth knowing before reading the plugins below.
 *
 * 1. `@deepseek-ai/dsh-client-ui-primitives` bundles its whole public surface into one `lib/index.js`
 *    and its published manifest declares **no** runtime dependencies beyond the cordis peer, so the
 *    Shell supplies them from its own workspace. Bundling that file here therefore meets imports of
 *    `shiki`, `katex`, `micromark`, `simple-icons` and friends that are not installed and that this
 *    card never renders. They become inert passthroughs carrying exactly the names the index binds
 *    (recorded in `stubbedSurfaces`); everything the card does render stays the real component, and a
 *    stub that reached one would fail the render, where a function is not a valid React child.
 * 2. `react`, `react-dom`, `clsx`, `zustand` and `immer` are devDependencies for this harness alone —
 *    the same undeclared-dependency story, supplied for real rather than stubbed because the form
 *    model and the snapshot store it binds actually run. The browser bundle treats them as externals.
 *
 * Run `pnpm test`.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Specifiers the pinned platform package imports without shipping deps for, and this card never renders. */
const STUBBED = /^(?:@shikijs\/|shiki\/|shiki$|micromark-|mdast-util-|katex$|diff$|anser$|simple-icons$|@deepseek-ai\/dsh-util-)/;
const stubbedSurfaces = new Set();

/** The pinned platform index: one bundled file whose every import must resolve. */
const platformIndex = readFileSync(
	join(dirname(createRequire(import.meta.url).resolve("@deepseek-ai/dsh-client-ui-primitives/package.json")), "lib", "index.js"),
	"utf8",
);

/**
 * What the index imports from the surfaces it does not ship deps for — read off the installed bundle
 * rather than restated, so bumping the package re-derives the stub instead of stubbing wrong names.
 * @param source - the index's source text.
 * @returns specifier → the names an importer binds from it.
 */
function stubExports(source) {
	const names = new Map();
	/** @param specifier - a stubbed module. @param name - one export an importer binds. */
	const add = (specifier, name) => {
		if (!names.has(specifier)) names.set(specifier, new Set());
		names.get(specifier).add(name);
	};
	for (const match of source.matchAll(/(?:import|export)\s*\{([\s\S]*?)\}\s*from\s*"([^"]+)"/g)) {
		if (!STUBBED.test(match[2])) continue;
		for (const binding of match[1].split(",")) {
			// `x as y` binds `y` locally but needs `x` exported.
			const imported = binding.trim().split(/\s+as\s+/)[0].trim();
			if (/^[A-Za-z_$][\w$]*$/.test(imported)) add(match[2], imported);
		}
	}
	for (const match of source.matchAll(/import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[\s\S]*?\})?\s*from\s*"([^"]+)"/g)) {
		if (STUBBED.test(match[2])) add(match[2], "default");
	}
	return names;
}

const stubNames = stubExports(platformIndex);

/**
 * An inert passthrough that answers to any name and may be called: the platform's index runs a few of
 * these at module scope (`shiki`'s theme factory) merely by being imported. A component that truly
 * needed one still fails at render, where a function is not a valid React child.
 */
const PASSTHROUGH = [
	"const passthrough = new Proxy(function () {}, {",
	"\tget: (_target, key) => {",
	'\t\tif (key === Symbol.toPrimitive) return () => "stub";',
	'\t\tif (key === "then" || typeof key === "symbol") return undefined;',
	"\t\treturn passthrough;",
	"\t},",
	"\tapply: () => passthrough,",
	"\tconstruct: () => passthrough,",
	"});",
].join("\n");

const unusedSurfaceStub = {
	name: "unused-surface-stub",
	setup(pluginBuild) {
		pluginBuild.onResolve({ filter: STUBBED }, (args) => ({ path: args.path, namespace: "unused-surface" }));
		pluginBuild.onLoad({ filter: /.*/, namespace: "unused-surface" }, (args) => {
			const bound = stubNames.get(args.path) ?? new Set();
			stubbedSurfaces.add(`${args.path} (${bound.size})`);
			const lines = [PASSTHROUGH];
			if (bound.has("default") || bound.size === 0) lines.push("export default passthrough;");
			for (const name of bound) {
				if (name !== "default") lines.push(`export const ${name} = passthrough;`);
			}
			return { contents: lines.join("\n"), loader: "js" };
		});
	},
};

/** CSS modules and other assets become key-returning stubs; the shell supplies the real sheets. */
const assetStub = {
	name: "asset-stub",
	setup(pluginBuild) {
		pluginBuild.onResolve({ filter: /\.(css|svg|png|woff2?)$/ }, (args) => ({ path: args.path, namespace: "asset-stub" }));
		pluginBuild.onLoad({ filter: /.*/, namespace: "asset-stub" }, () => ({
			contents: 'export default new Proxy({}, { get: (_target, key) => (typeof key === "string" ? key : undefined) })',
			loader: "js",
		}));
	},
};

// A re-export shim only: every scenario below stays plain JavaScript in this file.
const result = await build({
	stdin: {
		contents: [
			'export { createElement } from "react";',
			'export { renderToStaticMarkup } from "react-dom/server";',
			'export { ProjectContextSettingsCard, ProjectContextSettingsCardController } from "./client/settings-card.tsx";',
			'export { ROWS } from "./client/card-fields.ts";',
		].join("\n"),
		resolveDir: root,
		loader: "tsx",
		sourcefile: "card-render-entry.tsx",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	target: "es2022",
	jsx: "automatic",
	write: false,
	logLevel: "warning",
	metafile: true,
	// esbuild's ESM wrapper routes CJS `require` through `__require`, which needs a real one in
	// scope: React's CJS internals load node builtins that way.
	banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
	plugins: [unusedSurfaceStub, assetStub],
});

const [output] = result.outputFiles ?? [];
assert.ok(output, "esbuild produced no bundle for the card");
const dir = mkdtempSync(join(tmpdir(), "dsh-card-render-"));
const bundlePath = join(dir, "card.mjs");
writeFileSync(bundlePath, output.text);
process.on("exit", () => { rmSync(dir, { recursive: true, force: true }); });

const {
	createElement,
	renderToStaticMarkup,
	ProjectContextSettingsCard,
	ProjectContextSettingsCardController,
	ROWS,
} = await import(pathToFileURL(bundlePath).href);

/** A section value that carries every field of the table. */
const VALUE = {
	archiveEnabled: true,
	autoConsolidate: true,
	consolidateTurns: 12,
	consolidateIntervalMs: 600000,
	forceDedupeMs: 60000,
	maxTokens: 4096,
	maxOutputTokens: 8192,
	maxMemoryChars: 32000,
	provider: "deepseek",
	model: "deepseek-chat",
	autoLearn: true,
	autolearnTurns: 12,
	autolearnIntervalMs: 600000,
	handoffEnabled: true,
	handoffAdaptive: true,
	handoffThresholdRatio: 0.8,
	handoffTargetTokens: 64000,
	handoffKeepTokens: 20000,
	handoffSummaryThinking: "session",
	handoffPendingQuestion: "defer",
	handoffLanguage: "auto",
};

/** The table's shape, read from the source of truth rather than restated here. */
const BOOLEAN_ROWS = ROWS.filter((row) => row.kind === "boolean");
const UNION_ROWS = ROWS.filter((row) => row.kind === "union");
const PLATFORM_ROWS = ROWS.filter((row) => row.kind === "number" || row.kind === "text");
const PILL_TOTAL = UNION_ROWS.reduce((sum, row) => sum + (row.options?.length ?? 0), 0);

/** Every clickable control a clean page is allowed: one switch per boolean, one pill per option, one save. */
const CLEAN_BUTTONS = BOOLEAN_ROWS.length + PILL_TOTAL + 1;

const occurrences = (haystack, needle) => haystack.split(needle).length - 1;
const tick = () => new Promise((resolve) => { setImmediate(resolve); });

/** @param options - scope overrides. */
function makeScope(options = {}) {
	const calls = [];
	return {
		calls,
		getSnapshot: () => ({
			status: options.status ?? "ready",
			value: options.value ?? VALUE,
			base: {},
			user: options.user ?? {},
			writable: options.writable ?? true,
			revision: 7,
		}),
		subscribe: () => () => {},
		mutate: async (ops, expectedRevision) => {
			calls.push({ ops, expectedRevision });
			return options.accept ?? true;
		},
	};
}

/** @param scope - the fake section form the card stages over. */
function mount(scope) {
	const controller = new ProjectContextSettingsCardController(scope);
	const face = controller.inject();
	const store = face.hooks.projectContextSettingsCard;
	const props = {
		...face,
		view: "page",
		t: (key) => key,
		useProjectContextSettingsCard: (select) => select(store.getSnapshot()),
	};
	return { controller, face, store, props };
}

/** @param props - render props. @param view - which view to ask for. */
function render(props, view = "page") {
	const html = renderToStaticMarkup(createElement(ProjectContextSettingsCard, { ...props, view }));
	// The platform names each field twice: its input and its message both start with `dsh-pc-<key>`.
	const fieldKeys = [...new Set([...html.matchAll(/id="dsh-pc-([a-zA-Z]+)"/g)].map((match) => match[1]))];
	const pillGroups = [...html.matchAll(/<div class="[^"]*dshPcPills[^"]*">([\s\S]*?)<\/div>/g)];
	return {
		html,
		cardRows: occurrences(html, 'class="dshPcRow"'),
		fieldKeys,
		switchRows: occurrences(html, 'role="switch"'),
		pillGroups: pillGroups.length,
		pills: pillGroups.reduce((sum, group) => sum + occurrences(group[1], "<button"), 0),
		buttons: occurrences(html, "<button"),
		saveLabels: occurrences(html, ">chrome.save<"),
		overriddenLabels: occurrences(html, ">chrome.overridden<"),
		resetLabels: occurrences(html, ">chrome.reset<"),
		saveTag: /<button[^>]*>chrome\.save<\/button>/.exec(html)?.[0],
	};
}

/** Render the served page over a scope built from the options. */
function page(options) {
	const scope = makeScope(options);
	const { controller, props } = mount(scope);
	const rendered = render(props);
	controller.dispose();
	return { scope, rendered };
}

test("the bundle resolves exactly one React, so the card's hooks cannot be split across copies", (t) => {
	const copies = new Set();
	for (const input of Object.keys(result.metafile.inputs)) {
		const match = /node_modules\/(?:\.pnpm\/)?(react@[^/]+)\//.exec(input);
		if (match) copies.add(match[1]);
	}
	t.diagnostic(`stubbed un-shipped platform surfaces: ${[...stubbedSurfaces].sort().join(", ")}`);
	assert.ok(stubbedSurfaces.size > 0, "the harness documents stubbing these surfaces; losing them means resolution changed");
	assert.deepEqual([...copies], ["react@18.3.1"], "two React copies would make every assertion below fail for the wrong reason");
});

test("the card renders exactly one row per field of its table", () => {
	const { rendered } = page();
	assert.equal(rendered.cardRows, BOOLEAN_ROWS.length + UNION_ROWS.length, "the card wraps its own switch and pill rows");
	assert.equal(rendered.fieldKeys.length, PLATFORM_ROWS.length, "the platform draws the number and text rows");
	assert.deepEqual(
		[...rendered.fieldKeys].sort(),
		PLATFORM_ROWS.map((row) => row.key).sort(),
		"the platform-drawn rows must be exactly the table's number and text fields",
	);
	assert.equal(rendered.cardRows + rendered.fieldKeys.length, ROWS.length, "every field of the table must reach the page once");
});

test("a boolean field is a switch and an enum field is one pill per option", () => {
	const { rendered } = page();
	assert.equal(rendered.switchRows, BOOLEAN_ROWS.length, "one switch per boolean field");
	assert.equal(rendered.pillGroups, UNION_ROWS.length, "one pill group per enum field");
	assert.equal(rendered.pills, PILL_TOTAL, "one pill per declared option");
});

test("the platform owns the frame: one save, and no control the page did not ask for", () => {
	const { rendered } = page();
	assert.equal(rendered.saveLabels, 1, "the form must offer exactly one save control");
	assert.equal(
		rendered.buttons,
		CLEAN_BUTTONS,
		"a clean page holds only the switches, the pills and the save — no private discard control",
	);
	assert.equal(rendered.overriddenLabels, 0, "nothing is overridden on a clean scope");
	assert.equal(rendered.resetLabels, 0, "no reset control on a clean scope");
	assert.match(rendered.saveTag ?? "", /disabled/, "a clean form has nothing to save, so its save starts disabled");
});

test("an unserved namespace renders the notice instead of the form", () => {
	const { rendered } = page({ status: "unavailable" });
	assert.equal(rendered.cardRows + rendered.fieldKeys.length, 0, "no row may render for a namespace nobody serves");
	assert.equal(rendered.buttons, 0, "and no control either");
	assert.ok(rendered.html.includes("chrome.unavailable"), "the notice copy must say the plugin cannot be configured");
});

test("a read-only document still shows every row, with the save disabled", () => {
	const { rendered } = page({ writable: false });
	assert.equal(rendered.cardRows + rendered.fieldKeys.length, ROWS.length, "read-only hides nothing");
	assert.equal(rendered.buttons, CLEAN_BUTTONS, "the rows stay interactive-looking except the save");
	assert.ok(rendered.html.includes("chrome.readOnly"), "the read-only notice must be shown");
	assert.match(rendered.saveTag ?? "", /disabled/, "the save must refuse while the document is read-only");
});

test("an overridden field is badged and resettable, whichever control draws it", () => {
	for (const key of [BOOLEAN_ROWS[0].key, PLATFORM_ROWS[0].key]) {
		const { rendered } = page({ user: { [key]: VALUE[key] } });
		assert.equal(rendered.overriddenLabels, 1, `${key} must show one override badge`);
		assert.equal(rendered.resetLabels, 1, `${key} must offer one reset`);
		assert.equal(rendered.buttons, CLEAN_BUTTONS + 1, `${key} adds the reset and nothing else`);
	}
});

test("the summary view is the one-liner, not the form", () => {
	const scope = makeScope();
	const { controller, props } = mount(scope);
	const summary = renderToStaticMarkup(createElement(ProjectContextSettingsCard, { ...props, view: "summary" }));
	controller.dispose();
	assert.equal(summary, "card.description", "a list row gets the description; the form belongs to the page view");
});

test("a save writes every staged edit in one revision-fenced mutation", async () => {
	const scope = makeScope();
	const { controller, face, props, store } = mount(scope);
	face.edit("consolidateTurns", "20");
	await tick();
	assert.equal(store.getSnapshot().dirty, true, "a staged edit makes the form dirty");
	assert.equal(scope.calls.length, 0, "staging writes nothing");
	assert.doesNotMatch(render(props).saveTag ?? "", /disabled/, "a staged edit is what enables the save");

	face.save();
	await tick();
	assert.equal(scope.calls.length, 1, "the staged edits go out in one mutation, never field by field");
	assert.deepEqual(scope.calls[0], { ops: [{ op: "set", path: ["consolidateTurns"], value: 20 }], expectedRevision: 7 });
	assert.equal(store.getSnapshot().failed, false, "an accepted save reports no failure");
	assert.equal(store.getSnapshot().dirty, false, "an accepted save clears the drafts");
	controller.dispose();
});

test("a refused save keeps its drafts without wedging, and an invalid one is never written", async () => {
	const refused = makeScope({ accept: false });
	const first = mount(refused);
	first.face.edit("consolidateTurns", "20");
	await tick();
	first.face.save();
	await tick();
	assert.equal(first.store.getSnapshot().failed, true, "the refusal must be reported");
	assert.equal(first.store.getSnapshot().saving, false, "a rejected write must not leave the form saving forever");
	assert.equal(first.store.getSnapshot().dirty, true, "the drafts must survive so the user can correct them");
	first.controller.dispose();

	const invalid = makeScope();
	const second = mount(invalid);
	second.face.edit("consolidateTurns", "not-a-number");
	await tick();
	second.face.save();
	await tick();
	assert.equal(invalid.calls.length, 0, "a draft the field cannot parse must never be written");
	assert.equal(second.store.getSnapshot().invalid, true, "and it must block the save instead of being dropped");
	assert.equal(second.store.getSnapshot().dirty, true);
	second.controller.dispose();
});
