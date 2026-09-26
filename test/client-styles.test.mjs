/**
 * The client half's presentation contract: the platform draws the card, and nothing local paints.
 *
 * The defect this replaced: the card hand-rolled its own button as
 * `background: var(--dsw-alias-brand-primary); color: #fff`. This platform binds that token to its
 * *inverted* surface ink (near-black in the light theme, **near-white in the dark one**), so in the
 * dark theme the label was white on near-white — a blank pill with its text still in the DOM. It
 * also named `--dsw-alias-label-error`, which no theme layer defines. Both are one class of mistake:
 * a colour written by a plugin that does not know the theme.
 *
 * The fix is structural rather than a better literal. Every control now comes from the platform —
 * `SettingsForm` for the frame and its save, `SettingsValueField` for text and number rows, `Switch`,
 * `Pill`, `Tag` and `Button` for the rest — and `client/styles.ts` is geometry only, so there is no
 * place left in this repo for a colour to be written at all. The assertions below are that invariant,
 * not a spot fix: they stay red if any literal colour, any paint declaration, or any hand-rolled
 * control returns.
 *
 * `client/*.ts(x)` is browser-side source that `pnpm test` never compiles, like the other client
 * halves this suite static-asserts. Run `pnpm test`.
 */

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const client = new URL("../client/", import.meta.url);
/** Strip comments: prose may discuss colours, code may not write them. */
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const card = await readFile(new URL("settings-card.tsx", client), "utf8");
const sheet = await readFile(new URL("styles.ts", client), "utf8");
const entry = await readFile(new URL("index.ts", client), "utf8");
const cardCode = strip(card);

test("every control on the card is the platform's own", () => {
	assert.match(
		cardCode,
		/from "@deepseek-ai\/dsh-client-ui-primitives"/,
		"the card must render the platform's settings components",
	);
	// The frame, its staged model, and the four controls the card composes rows from.
	for (const name of ["SettingsForm", "SettingsFormModel", "SettingsValueField", "Switch", "Pill", "Tag", "Button"]) {
		assert.match(cardCode, new RegExp(`\\b${name}\\b`), `${name} must come from the platform package`);
	}
	// The staged form, the cross-layout store probe and the private field controls are retired: the
	// platform owns atomic revision-fenced writes, the save's failure handling and its unmount discard.
	assert.doesNotMatch(cardCode, /\bclass\s+\w*Form\b/, "a private staged form must not come back");
	assert.doesNotMatch(cardCode, /require\(/, "the platform modules are imported, not probed at runtime");
	assert.doesNotMatch(entry, /createSnapshotStore|dsh-store-compat/, "the store probe must not come back");
});

test("the card's table is the only place a field is declared", () => {
	// One table drives the specs, the projection and the rows; a second list of keys is how the three
	// drift apart (a spec with no row, a row reading another field's state).
	assert.match(cardCode, /ROWS\.map\(\(row\) => SPEC_BUILDERS\[row\.kind\]\(row\)\)/, "specs must come from the table");
	assert.match(cardCode, /for \(const row of ROWS\) fields\[row\.key\] = this\.form\.field\(row\.key\)/, "the projection must walk the table");
	assert.match(cardCode, /SECTIONS\.map\(/, "the rows must come from the table's sections");
});

test("the card's own stylesheet paints nothing", () => {
	const css = /const css = `([\s\S]*?)`;/.exec(sheet)?.[1];
	assert.ok(css, "client/styles.ts must keep its stylesheet in a `const css` template literal");
	const declarations = [...strip(css).matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)];
	assert.ok(declarations.length > 0, "the sheet must still carry the card's layout");
	// Paint is anything that can name a colour. Geometry (display, flex, gap, padding, margin,
	// font-size, font-weight, letter-spacing, text-transform) is all this sheet may use.
	const paint = /^(?:color|background|background-.+|border|border-.+|outline|outline-.+|box-shadow|text-shadow|fill|stroke|accent-color|caret-color|text-decoration-color|column-rule.*)$/;
	const offenders = declarations
		.filter(([, property]) => paint.test(property.trim()))
		.map(([, property, value]) => `${property}: ${value.trim()}`);
	assert.deepEqual(
		offenders,
		[],
		`the card must paint nothing itself; every colour comes from the platform's components (found: ${offenders.join(" | ")})`,
	);
});

test("no colour literal is written anywhere in the client half", async () => {
	const literal = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|\b(?:white|black|red|blue|green|gray|grey|silver|maroon|navy|teal|olive|lime|aqua|fuchsia|purple|orange|yellow)\b/i;
	const offenders = [];
	for (const file of await readdir(client)) {
		if (!/\.tsx?$/.test(file)) continue;
		for (const [index, line] of strip(await readFile(new URL(file, client), "utf8")).split("\n").entries()) {
			if (literal.test(line)) offenders.push(`${file}:${index + 1}: ${line.trim()}`);
		}
	}
	assert.deepEqual(
		offenders,
		[],
		`a colour written here cannot follow the theme (${offenders.join(" | ")})`,
	);
});

test("the client bundle resolves the platform's modules instead of inlining a copy", async () => {
	// The shell seeds this table (`@deepseek-ai/dsh-client-web`'s `platform.ts` / `seed.ts`); dropping
	// an entry from the externals list would inline the package instead — including its CSS modules,
	// which cannot ride a single-JS bundle.
	const script = await readFile(new URL("../scripts/build-client.mjs", import.meta.url), "utf8");
	assert.match(script, /"@deepseek-ai\/dsh-client-ui-primitives"/, "ui-primitives must stay external");
	assert.match(script, /"@deepseek-ai\/dsh-client-store"/, "the client store must stay external");
});

test("the retired client modules stay deleted", async () => {
	const files = (await readdir(client)).sort();
	assert.deepEqual(
		files,
		["card-fields.ts", "index.ts", "locales.ts", "settings-card.tsx", "styles.ts"],
		"the hand-rolled form, store probe and field styles must not return as files nobody asserts",
	);
});
