/**
 * The client half's activation contract.
 *
 * `client/index.ts` declares a static `inject` list that the host resolves *before* the plugin
 * activates: a name in that list which the composition does not provide fails activation. dsh
 * 0.1.7-alpha.1 removed the client-side `settingsScope` service, and listing it there crashed the
 * desktop at web boot; `50d5f06` moved the settings card behind an optional
 * `ctx.inject(["settingsScope"], …)` so a core without the service degrades to "no settings card".
 * That repair was source-verified but had no test, so a later edit could put the name back into the
 * static list and re-break boot with a green suite.
 *
 * A static assertion is the right shape here: `client/index.ts` pulls React in through the card, so
 * the suite never imports it. The two halves asserted below are exactly the ones the repair rests
 * on — the name must not be *required*, and the card must still *ask* for it.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../client/index.ts", import.meta.url), "utf8");

test("the client's static inject list stays clear of the removed settingsScope service", () => {
	const match = /export const inject = (\[[^\]]*\]);/.exec(source);
	assert.ok(match, "client/index.ts must export its static inject list");
	const inject = JSON.parse(match[1]);
	// This list is the activation contract, so treat it as one: every name must exist in the
	// composition or the client cannot activate. Keep it explicit rather than pattern-matching a
	// subset, so adding a service is a deliberate edit that updates this assertion.
	assert.deepEqual(inject, ["slots", "locale"], "the static activation contract changed");
	assert.ok(
		!inject.includes("settingsScope"),
		"settingsScope is optional since dsh 0.1.7-alpha.1; requiring it blocks activation and crashed the desktop at boot",
	);

	// The other half: the card must still request the service optionally. Without this the first
	// assertion would also pass by deleting the feature outright.
	assert.match(
		source,
		/ctx\.inject\(\["settingsScope"\]/,
		"the settings card must still request settingsScope through an optional ctx.inject",
	);
});
