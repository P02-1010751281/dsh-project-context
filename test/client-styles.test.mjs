/**
 * The card's colour contract: every colour it paints comes from the platform's theme token layer.
 *
 * The defect this pins: the primary action button was `background: var(--dsw-alias-brand-primary)`
 * with a literal `color: #fff`. This platform binds `--dsw-alias-brand-primary` to its *inverted*
 * surface ink — near-black in the light theme, **near-white in the dark one** (`ui-theme`'s
 * `design-platform.css`; `ui-dockkit` warns about exactly this in a source comment). So in the dark
 * theme the button was white-on-near-white: a blank grey pill with the label still in the DOM and
 * still taking up width. The light theme looked correct, which is why only a dark-theme screenshot
 * caught it.
 *
 * The fix is the platform's own pairing — `ui-primitives` `Button.primary` uses
 * `--dsw-alias-button-primary-fill` with `--dsw-alias-label-primary-foreground`, and the foreground
 * flips with the theme. The general assertion below keeps the next colour from being hardcoded the
 * same way: a bare literal in a colour position is only allowed as a `var()` fallback.
 *
 * `client/styles.ts` is browser-side source that `pnpm test` never compiles, like the other client
 * halves this suite static-asserts. Run `pnpm test`.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../client/styles.ts", import.meta.url), "utf8");
const css = /const css = `([\s\S]*?)`;/.exec(source)?.[1];
assert.ok(css, "client/styles.ts must keep its stylesheet in a `const css` template literal");
// Comments explain the token choice; they are not part of the colour contract.
const declarations = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)];

test("the primary action pairs the platform's fill token with its foreground token", () => {
	// A selector can appear in a combined rule (the shared sizing) *and* in its own rule (the colour),
	// so collect every rule that names it instead of trusting the first match.
	const rule = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
		.filter(([, selectors]) => selectors.split(",").some((part) => part.trim() === ".dshPcSave"))
		.map(([, , body]) => body)
		.join("\n");
	assert.ok(rule.includes("background"), "the .dshPcSave rule must paint its own fill");
	// Both halves must be the platform's pair: taking the fill from the theme while hardcoding the
	// label is exactly the bug, and it is invisible in whichever theme the other half happens to fit.
	assert.match(
		rule,
		/background:\s*var\(--dsw-alias-button-primary-fill/,
		"the primary button's fill must come from the platform's button fill token",
	);
	assert.match(
		rule,
		/color:\s*var\(--dsw-alias-label-primary-foreground/,
		"the primary button's label must come from the platform's paired foreground token",
	);
	assert.doesNotMatch(
		rule,
		/color:\s*(#fff\b|#ffffff\b|white\b)/i,
		"a literal white label vanishes on the dark theme's near-white fill",
	);
});

test("no colour is hardcoded outside a var() fallback", () => {
	const colour = /(^|-)color$|background|border|outline|fill|stroke/;
	const literal = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|\b(?:white|black|red|blue|green|gray|grey)\b/i;
	const offenders = declarations
		// A `var(--token, fallback)` fallback is theme-layer adjacent and allowed; strip the whole call.
		// The fallback may itself contain parens (`rgb(127 127 127 / 24%)`), hence the nested group.
		.map(([, property, value]) => [property, value.replace(/var\((?:[^()]|\([^()]*\))*\)/g, "var()")])
		.filter(([property, value]) => colour.test(property) && literal.test(value))
		.map(([property, value]) => `${property}: ${value.trim()}`);
	assert.deepEqual(
		offenders,
		[],
		`every colour must come from a --dsw-* token (literal found in: ${offenders.join(" | ")})`,
	);
});

test("the error colour names a token the theme layer actually defines", () => {
	// `--dsw-alias-label-error` reads plausibly but does not exist in `ui-theme`'s
	// `design-platform.css` (0.1.7-rc.2): the card silently fell back to a hardcoded red that then
	// ignored the theme. The family is `--dsw-alias-state-error-*`.
	assert.match(css, /--dsw-alias-state-error-primary/, "the error colour must use the state-error token");
	assert.doesNotMatch(
		css,
		/--dsw-alias-label-error/,
		"--dsw-alias-label-error is not a theme token; its fallback is a hardcoded red",
	);
});
