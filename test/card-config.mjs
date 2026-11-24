/**
 * Card-shaped config fixtures for a suite that drives one entry's `apply()`.
 *
 * Batch AC split the single 23-key settings schema into four cards, each owned by one Loader entry. An
 * entry's `apply()` now resolves only its own card's keys and rejects a key another card owns, naming
 * that card — so a suite that used to hand one `resolvePluginConfig({...})` object to every plugin has
 * to hand each plugin only that plugin's keys.
 *
 * The shared nine (`provider`, `model`, the caps, `taskMode`, the archive switches) reach a feature
 * entry through the archive entry's publication, not through its own config. A suite that drives a
 * feature entry alone therefore has to play the publisher too — {@link publishSharedFor} does that.
 *
 * Not a `*.test.mjs` file, so the package's test glob does not pick it up.
 */

import { resolvePluginConfig } from "../lib/shared/config.js";
import { publishProjectContextSettings, sharedOf } from "../lib/shared/settings.js";

/** Which keys each card owns, in the split's terms. */
export const CARD_KEYS = {
	shared: [
		"archiveEnabled",
		"sessionSettledDays",
		"forceDedupeMs",
		"maxTokens",
		"maxOutputTokens",
		"maxMemoryChars",
		"taskMode",
		"provider",
		"model",
		"handoffLang",
	],
	memory: ["memoryEnabled", "consolidateTurns", "consolidateIntervalMs"],
	autolearn: ["autolearnEnabled", "autolearnExpireSkills", "autolearnTurns", "autolearnIntervalMs"],
	handoff: [
		"handoffEnabled",
		"handoffThreshold",
		"handoffBudgetSummaryTokens",
		"handoffBudgetRecentTokens",
		"handoffPendingQuestion",
		"handoffRetireReplaced",
	],
};

/**
 * One card's keys, resolved and filled from the defaults.
 *
 * Values are passed through `resolvePluginConfig` first, so a fixture that overrides a key gets the
 * same coercion the real entry would (a `handoffThreshold` string becomes its parsed spec, for one).
 * @param card - the card whose keys to keep.
 * @param over - the fixture's overrides, in whole-config terms.
 * @returns just that card's keys.
 */
export function cardConfig(card, over = {}) {
	const resolved = resolvePluginConfig(over);
	const out = {};
	for (const key of CARD_KEYS[card]) out[key] = resolved[key];
	return out;
}

/**
 * Publish the shared nine as the archive entry would, for a suite driving a feature entry alone.
 *
 * Without this a feature entry reads `DEFAULT_CONFIG`'s shared values — an empty route, the default
 * caps — which is the split's named degradation for "the publisher is not loaded", not a fixture bug.
 * A case that expects the routed model has to publish it.
 * @param over - the shared values to publish, in whole-config terms.
 */
export function publishSharedFor(over = {}) {
	const entry = sharedOf(resolvePluginConfig(over));
	publishProjectContextSettings(
		{ settings: { current: () => entry }, onDispose: () => () => undefined },
		entry,
	);
	return entry;
}

/**
 * Wrap one entry's `apply` so a fixture can keep passing a whole-config object.
 *
 * Every suite's fixture was written against the pre-split contract — one 23-key config for all four
 * plugins — and rewriting all of them to hand each entry only its own keys would spread the split's
 * key sets across a dozen files. This keeps that knowledge here instead: the suite keeps its fixture,
 * and the wrapper narrows it per card.
 *
 * A suite that needs the shared values (`provider`/`model`, the caps) to reach a feature entry must
 * also call {@link publishSharedFor}, because those live on the archive entry's publication.
 * @param apply - the entry's real `apply`.
 * @param card - which card that entry owns.
 * @returns an `apply`-shaped function that narrows the config first.
 */
export function cardApplied(apply, card) {
	return (ctx, config) => {
		// A fixture that names `provider`/`model` expects them to reach the entry, and since the split
		// they arrive through the archive entry's publication rather than through this entry's config.
		// Publishing here keeps every suite's existing fixture meaning what it says.
		publishSharedFor(config ?? {});
		return apply(ctx, cardConfig(card, config));
	};
}
