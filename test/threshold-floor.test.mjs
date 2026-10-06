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
import { apply as applyHandoff, movesThreshold } from "../lib/project-handoff/index.js";
import { MIN_DROP_TOKENS, resolveThreshold, thresholdOverrideText, thresholdRefusal, thresholdRefusalText } from "../lib/project-handoff/threshold.js";
import { DEFAULT_CONFIG, resolvePluginConfig } from "../lib/shared/config.js";
import { DEFAULT_THRESHOLD_RATIO, MAX_THRESHOLD_RATIO, MIN_THRESHOLD_RATIO } from "../lib/shared/limits.js";
import { PluginSettingsSchema } from "../lib/shared/settings.js";

/** A resolved config on the test route; `over` drives one field at a time. */
const config = (over) => resolvePluginConfig({ provider: "test-provider", model: "test-model", ...over });

/**
 * The plugin declares `systemPrompt` (its pressure-line contribution), so a fixture that applies it
 * supplies the service; these cases are about the receipt, not about that line
 * (test/handoff-pressure.test.mjs owns its behaviour).
 */
const apply = (ctx, rawConfig) => applyHandoff({ systemPrompt: { context: () => () => undefined }, ...ctx }, rawConfig);

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
	assert.match(raisableText, /raise the ratio \(\/handoff threshold \d+(?:\.\d+)?\) or lower "Recent tokens kept"/, `a working lever: ${raisableText}`);
	// …and the ratio it names must really clear this floor: a receipt that recommends a ratio its own gate
	// then refuses is the dead-lever defect wearing a number (batch K's floor made `/handoff threshold 0.4`
	// exactly that in reachable windows).
	const advised = Number(/\/handoff threshold (\d+(?:\.\d+)?)/.exec(raisableText)[1]);
	assert.notEqual(
		resolveThreshold(config({ handoffThresholdAuto: false, handoffThresholdRatio: advised, handoffBudgetRecentTokens: 0 }), plain, 30_000),
		undefined,
		"the named ratio resolves in the same fixture",
	);
	// The named ratio is the *smallest* that works, not one step past it. `14 000 / 50 000 × 100` is
	// 28.000000000000004 in floating point, so a bare `Math.ceil` names 0.29 while 0.28 already clears the
	// floor — and the receipt's contract is the smallest control that works.
	const exact = config({ handoffThresholdAuto: false, handoffThresholdRatio: 0.1, handoffBudgetRecentTokens: 5_000 });
	const exactText = thresholdRefusalText("fixed-below-floor", exact, { totalTokens: 0, surfaceTokens: 0, overheadTokens: 1_000 }, 50_000, "en");
	assert.match(exactText, /\/handoff threshold 0\.28\b/, `the smallest working ratio, not the ceil overshoot: ${exactText}`);
	// The safety-margin clamp decides the lever whenever it is what sits under the floor: at W=50_000 this
	// floor is 47_000, and 0.95 × 50_000 = 47_500 would clear it while the clamped 46_000 does not. Note what
	// this guards: the pre-batch-K code applied the same clamp inside its own condition, so this pair does not
	// fail on a revert — it fails on a *capless rewrite*, which is the mistake it exists to catch. The revert
	// discriminator in this block is the numeric lever above.
	const clamped = config({ handoffThresholdAuto: false, handoffThresholdRatio: 0.4, handoffBudgetRecentTokens: 39_000 });
	const clampedText = thresholdRefusalText("fixed-below-floor", clamped, plain, 50_000, "en");
	assert.match(clampedText, /no legal ratio clears the floor at this window/, `the clamp decides this one: ${clampedText}`);
	assert.doesNotMatch(clampedText, /raise the ratio/, "0.95 is refused by the clamp, so it must not be offered");
	// The clamp is also admitted when it is what produced the quoted trigger: 0.95 × 65_536 = 62_259 is
	// capped to 61_536, and the refusal must not credit the ratio with the larger number.
	const capped = config({ handoffThresholdAuto: false, handoffThresholdRatio: 0.95, handoffBudgetRecentTokens: 60_000 });
	const cappedText = thresholdRefusalText("fixed-below-floor", capped, plain, 65_536, "en");
	assert.match(cappedText, /trigger of 61536 tokens \(the 4000-token safety margin caps 62259\)/, `the cap is admitted: ${cappedText}`);
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

	// Every other verb keeps the plain confirmation: the receipt is answered for the writes the trigger's
	// resolution reads, not for `on`/`off`/`pending`/`lang`.
	const other = await call("pending wait");
	assert.equal(other.text, "Handoff setting updated: pending wait");
});

test("a receipt never recommends a ratio its own floor refuses", () => {
	// The knee escape a receipt may offer must be a working control. A 960_000-token envelope at a 1M
	// window puts the floor at 968_000 — above 0.95 × W — so no legal ratio clears it, and the receipt has
	// to say that instead of naming a dead lever.
	const auto = config({ handoffBudgetRecentTokens: 0 });
	const closed = { totalTokens: 600_000, surfaceTokens: 300_000, overheadTokens: 960_000 };
	assert.equal(thresholdRefusal(auto, closed, 1_000_000), "quality-knee");
	const closedText = thresholdRefusalText("quality-knee", auto, closed, 1_000_000, "en");
	assert.match(closedText, /a fixed ratio is closed here too — no legal ratio clears the floor at this window/, `the route is closed, not named: ${closedText}`);
	assert.doesNotMatch(closedText, /\/handoff threshold \d/, "no ratio may be offered when none clears the floor");

	// The reachable half of the same property: a 200K envelope at a 1M window does admit ratios, and the one
	// the receipt names must resolve in exactly this configuration.
	const heavy = { totalTokens: 512_000, surfaceTokens: 300_000, overheadTokens: 200_000 };
	const heavyText = thresholdRefusalText("quality-knee", config({}), heavy, 1_000_000, "en");
	const advised = Number(/\/handoff threshold (\d+(?:\.\d+)?)/.exec(heavyText)[1]);
	assert.notEqual(resolveThreshold(config({ handoffThresholdAuto: false, handoffThresholdRatio: advised }), heavy, 1_000_000), undefined,
		`the named ratio must clear this floor: ${heavyText}`);

	// The fixture that actually catches a written-down ratio: the band where a 0.4 trigger clears neither the
	// knee nor batch K's floor (180_000 under 308_000). A receipt that still says 0.4 is a dead lever here,
	// and the heavy fixture above would not notice because 0.4 does clear *its* 228_000 floor.
	const band = { totalTokens: 600_000, surfaceTokens: 300_000, overheadTokens: 300_000 };
	const bandAuto = config({ handoffBudgetRecentTokens: 0 });
	assert.equal(thresholdRefusal(bandAuto, band, 450_000), "quality-knee");
	const bandText = thresholdRefusalText("quality-knee", bandAuto, band, 450_000, "en");
	const bandAdvised = Number(/\/handoff threshold (\d+(?:\.\d+)?)/.exec(bandText)[1]);
	assert.ok(bandAdvised > 0.4, `the receipt must not repeat the 0.4 this floor refuses: ${bandText}`);
	assert.notEqual(
		resolveThreshold(config({ handoffThresholdAuto: false, handoffThresholdRatio: bandAdvised, handoffBudgetRecentTokens: 0 }), band, 450_000),
		undefined,
		"and the ratio it does name must clear this floor",
	);
});

test("the target-override receipt names a ratio that clears the floor too", () => {
	// The second site of the same defect: honouring an overridden `/handoff budget summary` by switching to a
	// fixed ratio only works above the physical floor, which at the default 65_536-token window is 28_000.
	const def = config({});
	const measurement = { totalTokens: 26_000, surfaceTokens: 20_000 };
	const resolved = resolveThreshold(def, measurement, 65_536);
	assert.equal(resolved?.override?.setting, "target", "this fixture really is an overridden target");
	const text = thresholdOverrideText(resolved.override, def, measurement, 65_536);
	assert.match(text, /only 45152 tokens fit this 65536-token window/);
	const advised = Number(/use \/handoff threshold (\d+(?:\.\d+)?) for a fixed ratio/.exec(text)[1]);
	assert.notEqual(resolveThreshold(config({ handoffThresholdAuto: false, handoffThresholdRatio: advised }), measurement, 65_536), undefined,
		`the ratio the override receipt names must resolve: ${text}`);
});

test("/handoff budget recent is receipted, because it builds the floor", async () => {
	// Batch K put the carried tail into the physical floor, so raising it can take a working fixed ratio
	// below the gate: on a 400_000-token window a 0.4 ratio on a 152_000 tail resolves exactly on the floor,
	// and a 160_000 tail refuses. That write used to answer with a bare confirmation.
	const commands = new Map();
	const ctx = {
		on: () => () => undefined,
		commands: { register: (command) => { commands.set(command.name, command); return () => undefined; } },
		logger: { info: () => undefined, warn: () => undefined },
		llm: { resolveModelInfo: async () => ({ context: { contextWindow: 400_000 } }) },
		get: (service) => (service === "settings"
			? { update: async () => undefined }
			: service === "tokenMeter"
				? { measure: () => ({ totalTokens: 26_000, surfaceTokens: 20_000 }) }
				: undefined),
	};
	apply(ctx, { provider: "test-provider", model: "test-model", handoffThresholdAuto: false, handoffThresholdRatio: 0.4, handoffBudgetRecentTokens: 152_000 });
	const session = { id: "session-floor-write", header: { cwd: process.cwd(), createdAt: Date.now() }, deriveMessages: () => [], requestHeader: () => undefined, snapshotEvents: () => [] };
	const call = (rawInput) => commands.get("handoff").handler({ agent: { session }, rawInput, signal: new AbortController().signal });

	assert.equal(resolveThreshold(config({ handoffThresholdAuto: false, handoffThresholdRatio: 0.4, handoffBudgetRecentTokens: 152_000 }), plain, 400_000)?.tokens, 160_000, "the starting ratio sits exactly on the floor");
	const reply = await call("budget recent 160000");
	assert.equal(reply.kind, "success");
	assert.match(reply.text, /threshold unavailable/, `raising the tail past the floor must be reported: ${reply.text}`);
	assert.match(reply.text, /below the 168000-token floor/, "and it names the floor the write built");
	// A write that cannot move the trigger keeps the short confirmation.
	const untouched = await call("pending wait");
	assert.equal(untouched.text, "Handoff setting updated: pending wait");
});

test("a receipt that cannot be built does not report a landed write as a failure", async () => {
	// The receipt resolves the model to learn the window, so the model registry can fail *after* the write
	// landed. Throwing there would report a successful write as a failed command — the same misattribution
	// in reverse, and `/handoff threshold` never touched the model before batch K.
	const writes = [];
	const commands = new Map();
	const ctx = {
		on: () => () => undefined,
		commands: { register: (command) => { commands.set(command.name, command); return () => undefined; } },
		logger: { info: () => undefined, warn: () => undefined },
		llm: { resolveModelInfo: async () => { throw new Error("model registry offline"); } },
		get: (service) => (service === "settings"
			? { update: async (namespace, patch) => { writes.push({ namespace, patch }); } }
			: service === "tokenMeter"
				? { measure: () => ({ totalTokens: 26_000, surfaceTokens: 20_000 }) }
				: undefined),
	};
	apply(ctx, { provider: "test-provider", model: "test-model" });
	const session = { id: "session-receipt-failure", header: { cwd: process.cwd(), createdAt: Date.now() }, deriveMessages: () => [], requestHeader: () => undefined, snapshotEvents: () => [] };
	const reply = await commands.get("handoff").handler({ agent: { session }, rawInput: "threshold 0.4", signal: new AbortController().signal });
	assert.deepEqual(writes.at(-1).patch, { handoffThresholdAuto: false, handoffThresholdRatio: 0.4 }, "the write landed before the receipt was attempted");
	assert.equal(reply.kind, "success", "a receipt failure must not be reported as a write failure");
	assert.match(reply.text, /Handoff setting updated: threshold 0\.4/);
	assert.match(reply.text, /the status receipt could not be built: model registry offline/, `the missing receipt is named: ${reply.text}`);
});

test("the floor advice never withholds a ratio that clears it", () => {
	// The mirror of the ceil overshoot, and the one a closure review caught: `0.95 × W` can round *up* over a
	// floor just past it, so a candidate pushed past MAX must be pulled back and tested rather than read as
	// "no legal ratio clears the floor". At a 256Ki window with a 42_845 envelope and a 198_192 tail the floor
	// is 249_037 and `round(0.95 × W)` is exactly that, so `/handoff threshold 0.95` clears while a naive
	// `needed > MAX → undefined` told the user the opposite.
	const window = 262_144;
	const measurement = { totalTokens: 0, surfaceTokens: 0, overheadTokens: 42_845 };
	const tail = 198_192;
	const stuck = config({ handoffThresholdAuto: false, handoffThresholdRatio: 0.4, handoffBudgetRecentTokens: tail });
	const text = thresholdRefusalText("fixed-below-floor", stuck, measurement, window, "en");
	assert.equal(
		resolveThreshold(config({ handoffThresholdAuto: false, handoffThresholdRatio: MAX_THRESHOLD_RATIO, handoffBudgetRecentTokens: tail }), measurement, window)?.tokens,
		249_037,
		"MAX really does clear this floor — that is what makes the withholding a lie",
	);
	assert.match(text, new RegExp(`/handoff threshold ${MAX_THRESHOLD_RATIO}\\b`), `the advice must name MAX, not claim none works: ${text}`);
	assert.doesNotMatch(text, /no legal ratio clears the floor/, "that claim is false here");
	// The same window with a floor MAX cannot reach keeps the honest withholding.
	const beyond = { totalTokens: 0, surfaceTokens: 0, overheadTokens: 42_845 + 2_000 };
	const beyondText = thresholdRefusalText("fixed-below-floor", config({ handoffThresholdAuto: false, handoffThresholdRatio: 0.4, handoffBudgetRecentTokens: tail }), beyond, window, "en");
	assert.match(beyondText, /no legal ratio clears the floor at this window/, `past MAX the withholding is right: ${beyondText}`);
});

test("the receipted writes are exactly the ones the trigger resolution reads", () => {
	// `movesThreshold` decides which writes answer with the receipt. The set is the four keys the resolution
	// reads: widening it would over-report (`on`/`off`/`pending`/`lang` cannot move the trigger) and
	// narrowing it re-opens the blind `budget recent` write that batch K's review found.
	for (const verb of ["threshold auto", "threshold 0.4", "budget summary 64k", "budget recent 20k"]) {
		assert.equal(movesThreshold(settingPatch(verb).patch), true, `${verb} must answer with the receipt`);
	}
	for (const verb of ["on", "off", "pending wait", "lang zh"]) {
		assert.equal(movesThreshold(settingPatch(verb).patch), false, `${verb} must keep the short confirmation`);
	}
	assert.equal(movesThreshold(undefined), false, "a verb with no patch moves nothing");
});
