/**
 * Batch K — the fixed threshold tells the truth (pi `057021d`, `3a0183b`, `e024595`).
 *
 * Four behaviours pi landed in its v0.4.3 review rounds and dsh lacked, all ported 2026-10-06:
 *
 *  1. fixed-ratio mode obeys the same physical drop floor the adaptive branch does, as a **refusal gate**
 *     and not a lift;
 *  2. its two refusals are named apart — a trigger that rounds out (no ratio can help) versus a positive
 *     trigger under the floor (the ratio is the first lever);
 *  3. the accepted ratio range comes from one exported pair, covering **both** bounds;
 *  4. `/handoff threshold <ratio>` hands back the receipt, so a configuration that cannot fire is not
 *     confirmed as a success.
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { parseRatio, settingPatch } from "../lib/project-handoff/command.js";
import { apply } from "../lib/project-handoff/index.js";
import { MIN_DROP_TOKENS, resolveThreshold, thresholdRefusal, thresholdRefusalText } from "../lib/project-handoff/threshold.js";
import { DEFAULT_CONFIG, resolvePluginConfig } from "../lib/shared/config.js";
import { DEFAULT_THRESHOLD_RATIO, MAX_THRESHOLD_RATIO, MIN_THRESHOLD_RATIO } from "../lib/shared/limits.js";
import { PluginSettingsSchema } from "../lib/shared/settings.js";

/** A resolved config on the test route; `over` drives one field at a time. */
const config = (over) => resolvePluginConfig({ provider: "test-provider", model: "test-model", ...over });

/** The measurement with no harness envelope: the floor carries only the terms this plugin owns. */
const plain = { totalTokens: 0, surfaceTokens: 0 };

test("fixed mode obeys the physical floor, and the boundary is the floor itself", () => {
	// The knob is the kept tail rather than the window, so the boundary is exact: at a 400_000-token window
	// a 0.4 trigger is 160_000, and the floor is `keep + MIN_DROP_TOKENS` because no envelope is reported.
	const window = 400_000;
	const trigger = Math.round(window * DEFAULT_CONFIG.handoffThresholdRatio);
	const keepAtFloor = trigger - MIN_DROP_TOKENS;
	const onFloor = config({ handoffThresholdAuto: false, handoffBudgetRecentTokens: keepAtFloor });
	assert.equal(resolveThreshold(onFloor, plain, window)?.tokens, trigger,
		"a trigger exactly on the floor still resolves — the gate refuses below it, it does not lift to it");
	const below = config({ handoffThresholdAuto: false, handoffBudgetRecentTokens: keepAtFloor + 1 });
	assert.equal(resolveThreshold(below, plain, window), undefined, "one token of floor above the trigger refuses");
	assert.equal(thresholdRefusal(below, plain, window), "fixed-below-floor");
	// The floor is the *same* one adaptive mode uses, so a reported envelope counts in fixed mode too: a
	// 200_000 envelope puts the floor at 208_000, past the 160_000 trigger, while the identical measurement
	// without the projection resolves. That is what makes this a pin on the floor and not on the refusal.
	const noKeep = config({ handoffThresholdAuto: false, handoffBudgetRecentTokens: 0 });
	assert.equal(resolveThreshold(noKeep, plain, window)?.tokens, trigger, "without an envelope the same numbers resolve");
	assert.equal(
		resolveThreshold(noKeep, { totalTokens: 300_000, surfaceTokens: 100_000, overheadTokens: 200_000 }, window),
		undefined,
		"a harness envelope participates in fixed mode's floor",
	);
	// The other fixed cause is a different one and is not reachable through the floor: at `W <= SAFETY_MARGIN`
	// the trigger is not positive at all, and there the ratio genuinely cannot help.
	assert.equal(thresholdRefusal(below, plain, 4_000), "no-positive-threshold");
});

test("the fixed-floor receipt quotes both numbers and names only a lever that works", () => {
	// keep 0 leaves an 8_000 floor, and the largest legal ratio here (0.95 × 30_000, clamped to 26_000)
	// clears it: raising the ratio is a real lever and must be named.
	const raisable = config({ handoffThresholdAuto: false, handoffThresholdRatio: 0.1, handoffBudgetRecentTokens: 0 });
	assert.equal(resolveThreshold(raisable, plain, 30_000), undefined, "0.1 × 30_000 = 3_000 is under the 8_000 floor");
	const raisableText = thresholdRefusalText("fixed-below-floor", raisable, plain, 30_000, "en");
	assert.match(raisableText, /the fixed 10% trigger of 3000 tokens is below the 8000-token floor/, `both numbers are quoted: ${raisableText}`);
	assert.match(raisableText, /raise the ratio \(\/handoff threshold\) or lower "Recent tokens kept"/, `a working lever: ${raisableText}`);
	// When even the largest legal ratio cannot clear the floor, naming the ratio would send the user to a
	// control that changes nothing — the dead-lever defect this whole receipt exists to prevent.
	const stuck = thresholdRefusalText("fixed-below-floor", config({ handoffThresholdAuto: false }), plain, 8_000, "en");
	assert.match(stuck, /lower "Recent tokens kept" — no legal ratio clears the floor at this window/, `the honest lever: ${stuck}`);
	assert.doesNotMatch(stuck, /raise the ratio/, "the ratio is not offered when it cannot help");
	// The two fixed causes must not be told as one sentence: `no-positive-threshold` keeps its own claim,
	// which is true of the rounding case and false of the floor case.
	const noPositive = thresholdRefusalText("no-positive-threshold", config({ handoffThresholdAuto: false }), plain, 3_000, "en");
	assert.match(noPositive, /a larger window is the only lever/);
	assert.match(noPositive, /the ratio cannot help/);
	assert.notEqual(noPositive, stuck, "the two fixed refusals are different receipts");
});

test("the ratio range comes from one exported pair, and every reader follows it", () => {
	// Both bounds are covered on purpose: a guard that checks only the maximum lets the mirror mutation
	// through — pi moved its minimum while its parser kept the literal, and that stayed green.
	assert.equal(PluginSettingsSchema.dict.handoffThresholdRatio.meta.min, MIN_THRESHOLD_RATIO, "the schema's lower bound is the exported minimum");
	assert.equal(PluginSettingsSchema.dict.handoffThresholdRatio.meta.max, MAX_THRESHOLD_RATIO, "the schema's upper bound is the exported maximum");
	assert.equal(PluginSettingsSchema.dict.handoffThresholdRatio.meta.default, DEFAULT_THRESHOLD_RATIO);
	assert.equal(DEFAULT_CONFIG.handoffThresholdRatio, DEFAULT_THRESHOLD_RATIO);
	for (const bound of [MIN_THRESHOLD_RATIO, MAX_THRESHOLD_RATIO]) {
		assert.equal(parseRatio(String(bound)), bound, `the parser accepts the ${bound} bound`);
		assert.equal(resolvePluginConfig({ handoffThresholdRatio: bound }).handoffThresholdRatio, bound, `the validator accepts the ${bound} bound`);
		assert.equal(PluginSettingsSchema({ handoffThresholdRatio: bound }).handoffThresholdRatio, bound, `the schema accepts the ${bound} bound`);
	}
	for (const outside of [(MIN_THRESHOLD_RATIO - 0.01).toFixed(2), (MAX_THRESHOLD_RATIO + 0.01).toFixed(2)]) {
		assert.equal(parseRatio(outside), undefined, `the parser refuses ${outside}`);
		assert.throws(() => resolvePluginConfig({ handoffThresholdRatio: Number(outside) }),
			new RegExp(`between ${MIN_THRESHOLD_RATIO} and ${MAX_THRESHOLD_RATIO}`), `the validator refuses ${outside} and names the pair`);
		assert.throws(() => PluginSettingsSchema({ handoffThresholdRatio: Number(outside) }), `the schema refuses ${outside}`);
	}
	// The usage sentence is derived too, so the message cannot advertise a range the parser then rejects.
	const error = settingPatch("threshold 0.96").error;
	assert.match(error, new RegExp(`between ${MIN_THRESHOLD_RATIO} and ${MAX_THRESHOLD_RATIO}`), `the usage line quotes the pair: ${error}`);
	assert.match(error, new RegExp(`threshold ${String(DEFAULT_THRESHOLD_RATIO)}`), "and its example is the default");
});

test("/handoff threshold <ratio> hands back the receipt instead of a blind confirmation", async () => {
	// The window is the one thing the receipt needs from the harness, so it stays mutable: the same command
	// must answer with a refusal for an unfirable ratio and with a resolved trigger for a working one.
	let contextWindow = 30_000;
	const commands = new Map();
	const writes = [];
	const ctx = {
		on: () => () => undefined,
		commands: { register: (command) => { commands.set(command.name, command); return () => undefined; } },
		logger: { info: () => undefined, warn: () => undefined },
		llm: { resolveModelInfo: async () => ({ context: { contextWindow } }) },
		get: (service) => (service === "settings"
			? { update: async (namespace, patch) => { writes.push({ namespace, patch }); } }
			: service === "tokenMeter"
				? { measure: () => ({ totalTokens: 26_000, surfaceTokens: 20_000 }) }
				: undefined),
	};
	apply(ctx, { provider: "test-provider", model: "test-model" });
	const command = commands.get("handoff");
	const session = { id: "session-batch-k", header: { cwd: process.cwd(), createdAt: Date.now() }, deriveMessages: () => [], requestHeader: () => undefined, snapshotEvents: () => [] };
	const call = (rawInput) => command.handler({ agent: { session }, rawInput, signal: new AbortController().signal });

	// At a 30_000-token window the default kept tail (20_000) plus the drop minimum is a 28_000 floor, so a
	// 0.1 ratio (3_000) can never fire. Reporting "updated" would call that a success.
	const refused = await call("threshold 0.1");
	assert.equal(refused.kind, "success", "the write itself lands");
	assert.deepEqual(writes.at(-1).patch, { handoffThresholdAuto: false, handoffThresholdRatio: 0.1 });
	assert.match(refused.text, /threshold unavailable/, `an unfirable ratio is not confirmed as success: ${refused.text}`);
	assert.match(refused.text, /below the 28000-token floor/, `and the refusal names the floor: ${refused.text}`);
	assert.doesNotMatch(refused.text, /^Handoff setting updated/);

	// The positive control: the same command at a window where the ratio does clear the floor reports the
	// resolved trigger, so the receipt is not simply always a refusal.
	contextWindow = 400_000;
	const accepted = await call("threshold 0.4");
	assert.equal(accepted.kind, "success");
	assert.match(accepted.text, /threshold 40% of window/, `a working ratio reports its trigger: ${accepted.text}`);
	assert.doesNotMatch(accepted.text, /threshold unavailable/);

	// Every other verb keeps the plain confirmation: the receipt is answered for the one write whose effect
	// can be nothing at all, not for `on`/`off`/`budget`/`pending`/`lang`.
	const other = await call("pending wait");
	assert.equal(other.text, "Handoff setting updated: pending wait");
});
