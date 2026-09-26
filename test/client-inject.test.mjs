/**
 * The client half's activation and settings-card contract.
 *
 * `client/index.ts` declares a static `inject` list that the host resolves *before* the plugin
 * activates: a name in that list which the composition does not provide fails activation. dsh
 * 0.1.7-alpha.1 removed the client-side `settingsScope` service, and listing it there crashed the
 * desktop at web boot; `50d5f06` moved the settings card behind an optional
 * `ctx.inject(["settingsScope"], …)` so a core without the service degrades to "no settings card".
 *
 * The same release then replaced `settingsScope` with `configForms` (per-profile plugin Config) and
 * reorganized the card slots: the old `settings.plugin.item` list is now the official-only
 * `plugins.item` plus the bundle-scoped `plugins.bundle.config`, which the Plugins page dispatches by
 * the bundle's package name. The card kept targeting both dead names, so it compiled while rendering
 * nothing: the optional `settingsScope` lookup never fired, and the slot it would have registered into
 * is no longer declared (`slots.register` throws for an undeclared slot, which is why the lookup has to
 * wait for the declaration).
 *
 * A static assertion is the right shape here: the card pulls React in, so the suite never imports
 * it. The halves asserted below are exactly the ones the repair rests on — the services must not be
 * *required*, the card must still *ask* for them, and it must name the slot and key the page declares.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const entry = await readFile(new URL("../client/index.ts", import.meta.url), "utf8");
const card = await readFile(new URL("../client/settings-card.tsx", import.meta.url), "utf8");
// The retired names may still be *documented* — a comment explaining the rename is useful. Only the
// code is part of the contract, so strip comments before any negative assertion.
const code = entry.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the client's static inject list carries only services every composition provides", () => {
	const match = /export const inject = (\[[^\]]*\]);/.exec(entry);
	assert.ok(match, "client/index.ts must export its static inject list");
	const inject = JSON.parse(match[1]);
	// This list is the activation contract, so treat it as one: every name must exist in the
	// composition or the client cannot activate. Keep it explicit rather than pattern-matching a
	// subset, so adding a service is a deliberate edit that updates this assertion.
	assert.deepEqual(inject, ["slots", "locale"], "the static activation contract changed");
	for (const optional of ["settingsScope", "configForms"]) {
		assert.ok(
			!inject.includes(optional),
			`${optional} must stay optional: requiring it blocks activation, which the desktop turns into a crash at web boot`,
		);
	}

	// The other half: the card must still request the service optionally. Without this the first
	// assertion would also pass by deleting the feature outright.
	assert.match(
		entry,
		/ctx\.inject\(\["configForms"\]/,
		"the settings card must request configForms through an optional ctx.inject",
	);
});

test("the settings card registers on the slot the Plugins page declares, and only while served", () => {
	// `settings.plugin.item` was the pre-0.1.7 name. Today the page declares `plugins.item` for the
	// official cards and `plugins.bundle.config` for a bundle's own configuration — this plugin ships a
	// bundle patch, so its card belongs to the latter, keyed by the package name the page dispatches.
	const packageName = JSON.parse(
		readFileSync(new URL("../package.json", import.meta.url), "utf8"),
	).name;
	assert.match(code, /const CARD_SLOT = "plugins\.bundle\.config"/, "the card slot must be the current one");
	assert.match(code, new RegExp(`const BUNDLE_KEY = "${packageName}"`), "the card key must be the bundle the page dispatches");
	assert.doesNotMatch(code, /settings\.plugin\.item/, "the retired slot name must not come back");
	assert.doesNotMatch(code, /settingsScope/, "the retired service must not come back");
	assert.match(card, /PropsRuntime<"plugins\.bundle\.config">/, "the card's props must bind the current slot");

	// A deployment that never composed the host half serves no `project-context` namespace, and the
	// page must then show no trace of the card.
	assert.match(
		entry,
		/configForms\.whileServed\(\[NS\]/,
		"the card must be kept alive by whileServed over its own namespace",
	);
	assert.match(entry, /formsCtx\.configForms\.get<ProjectContextSettings>\(NS\)/, "the card edits its own namespace");

	// The slot contract types both views on the same component; the bundle page asks for the body, and
	// a card without the summary branch renders its whole form inside the official row.
	assert.match(card, /props\.view === "summary"/, "the card must answer the summary view");
});
