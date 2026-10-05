/**
 * The config vocabulary: one spelling per fact across the card, the command and the stored profile.
 *
 * Batch H renamed seven keys so each mirrors the command path that changes it (pi's
 * `vocabulary-conventions.md` rule). The ruling for this repo is **no compatibility reader** (option
 * b): the platform persists these keys into each profile's own `cordis.patch.yml`, dsh cannot rewrite
 * that file, so an alias would never retire. The consequence is the point of this file — an old name
 * is now an *unknown* key, and `resolvePluginConfig` throws on it, so the profile edit and the host
 * restart have to happen in the same step.
 *
 * The data flow this pins, in order: `cordis.patch.yml` → the Loader entry's config →
 * `resolvePluginConfig` → `PluginConfig` → the four `apply()` calls → the card's field table and the
 * patches the `/handoff` verbs write back. Every layer has to agree, because a key written back that
 * the schema does not know is the same `unknown config key` throw a stale profile produces — except
 * it is self-inflicted and would only surface on the *next* read.
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { apply as applyAutolearn } from "../lib/project-autolearn/index.js";
import { apply as applyContext } from "../lib/project-context/index.js";
import { apply as applyHandoff } from "../lib/project-handoff/index.js";
import { settingPatch } from "../lib/project-handoff/command.js";
import { apply as applyMemory } from "../lib/project-memory/index.js";
import { DEFAULT_CONFIG, resolvePluginConfig } from "../lib/shared/config.js";
import { PluginSettingsSchema } from "../lib/shared/settings.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/** pi's rename table at `ca71fd3`; the new name wins nowhere because there is no reader (option b). */
const RENAMED_KEYS = {
	autoConsolidate: "memoryEnabled",
	autoLearn: "autolearnEnabled",
	handoffTargetTokens: "handoffBudgetSummaryTokens",
	handoffKeepTokens: "handoffBudgetRecentTokens",
	handoffSummaryThinking: "handoffThinking",
	handoffAdaptive: "handoffThresholdAuto",
	handoffLanguage: "handoffLang",
};

/** The values the two profiles persist, keyed by the retired spelling so the shape cannot drift. */
const PROFILE_SHAPES = {
	desktop: { maxMemoryChars: 40_000, handoffThresholdAuto: true, handoffBudgetRecentTokens: 0, handoffPendingQuestion: "wait" },
	web: { maxMemoryChars: 40_000, handoffBudgetRecentTokens: 0, handoffPendingQuestion: "wait" },
};

const PLUGINS = {
	"project-context": applyContext,
	"project-memory": applyMemory,
	"project-autolearn": applyAutolearn,
	"project-handoff": applyHandoff,
};

/** Every `.ts`/`.tsx` file under one directory, so an unfinished rename cannot hide in a comment. */
function sourceFiles(dir) {
	const out = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...sourceFiles(full));
		else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(full);
	}
	return out;
}

/**
 * A ctx that answers exactly what the four `apply()` calls reach for during registration.
 *
 * Every one of them resolves the config *before* it touches the ctx, which is why a stub is enough
 * here: the paths under test are the config resolution and the registration that follows it, not any
 * lifecycle work (that is `top-level-gate.test.mjs`' job).
 */
function stubCtx() {
	const noop = () => undefined;
	const ctx = {
		on: () => noop,
		effect: (callback) => callback(),
		inject: (_deps, callback) => (typeof callback === "function" ? callback(ctx) : noop),
		get: () => undefined,
		commands: { register: () => noop },
		systemPrompt: { context: () => noop },
		logger: { info: noop, warn: noop, error: noop, debug: noop },
	};
	return ctx;
}

test("every renamed key keeps its value and its type", () => {
	assert.equal(resolvePluginConfig({ memoryEnabled: false }).memoryEnabled, false);
	assert.equal(resolvePluginConfig({ autolearnEnabled: false }).autolearnEnabled, false);
	assert.equal(resolvePluginConfig({ handoffBudgetSummaryTokens: 12_000 }).handoffBudgetSummaryTokens, 12_000);
	assert.equal(resolvePluginConfig({ handoffBudgetRecentTokens: 1_000 }).handoffBudgetRecentTokens, 1_000);
	assert.equal(resolvePluginConfig({ handoffThinking: "session" }).handoffThinking, "session");
	assert.equal(resolvePluginConfig({ handoffThresholdAuto: false }).handoffThresholdAuto, false);
	assert.equal(resolvePluginConfig({ handoffLang: "zh" }).handoffLang, "zh");

	// The defaults moved with the names: a missing key still falls back to the same value.
	assert.equal(DEFAULT_CONFIG.memoryEnabled, true);
	assert.equal(DEFAULT_CONFIG.autolearnEnabled, true);
	assert.equal(DEFAULT_CONFIG.handoffBudgetSummaryTokens, 64_000);
	assert.equal(DEFAULT_CONFIG.handoffBudgetRecentTokens, 20_000);
	assert.equal(DEFAULT_CONFIG.handoffThinking, "off");
	assert.equal(DEFAULT_CONFIG.handoffThresholdAuto, true);
	assert.equal(DEFAULT_CONFIG.handoffLang, "auto");
});

test("the settings schema exposes the new spellings and none of the old ones", () => {
	const keys = Object.keys(PluginSettingsSchema({}));
	const missing = Object.values(RENAMED_KEYS).filter((name) => !keys.includes(name));
	assert.deepEqual(missing, [], "every renamed field must still project a card field");
	for (const old of Object.keys(RENAMED_KEYS)) {
		assert.equal(keys.includes(old), false, `${old} must not survive in the schema`);
	}
});

test("a retired spelling is an unknown key, not a silent fallback to the default", () => {
	// This is the contract of option (b), and it is why the profile edit and the restart are one step:
	// the failure is loud and lands at plugin apply, where nothing catches it.
	for (const [old, value] of [
		["autoConsolidate", true],
		["autoLearn", true],
		["handoffTargetTokens", 64_000],
		["handoffKeepTokens", 0],
		["handoffSummaryThinking", "off"],
		["handoffAdaptive", true],
		["handoffLanguage", "auto"],
	]) {
		assert.throws(
			() => resolvePluginConfig({ [old]: value }),
			new RegExp(`unknown config key "${old}"`),
			`${old} must throw rather than resolve`,
		);
	}
	// The negative control: the guard is the key set, not "any unknown word throws anyway".
	assert.doesNotThrow(() => resolvePluginConfig({ handoffBudgetRecentTokens: 0 }));
});

test("both profiles' persisted shapes resolve, and every apply() accepts them", () => {
	for (const [profile, shape] of Object.entries(PROFILE_SHAPES)) {
		const resolved = resolvePluginConfig(shape);
		assert.equal(resolved.maxMemoryChars, 40_000, `${profile}: maxMemoryChars survives`);
		assert.equal(resolved.handoffBudgetRecentTokens, 0, `${profile}: the recent budget survives`);
		assert.equal(resolved.handoffPendingQuestion, "wait", `${profile}: the pending-question gate survives`);
		for (const [name, apply] of Object.entries(PLUGINS)) {
			assert.doesNotThrow(() => apply(stubCtx(), shape), `${name} accepts the ${profile} profile shape`);
			// The positive control: the same ctx and the same call site do surface a stale key, so the
			// line above is evidence about the shape rather than about a fixture that cannot throw.
			assert.throws(
				() => apply(stubCtx(), { handoffKeepTokens: 0 }),
				/unknown config key "handoffKeepTokens"/,
				`${name} would reject a profile that was not renamed`,
			);
		}
	}
});

test("every key the handoff verbs write back is a schema key", () => {
	// The write path and the read path have to agree: a patch key the schema does not know would throw
	// on the next read, which is the same failure as a stale profile but self-inflicted and deferred.
	const verbs = [
		"on",
		"off",
		"threshold auto",
		"threshold 0.5",
		"threshold 50%",
		"budget summary 64k",
		"budget recent 0",
		"thinking off",
		"thinking session",
		"pending defer",
		"pending wait",
		"lang auto",
		"lang zh",
		"lang en",
	];
	const written = new Set();
	for (const verb of verbs) {
		const patch = settingPatch(verb)?.patch;
		for (const key of Object.keys(patch ?? {})) written.add(key);
	}
	assert.ok(written.size > 0, "the fixture must reach at least one setter");
	for (const key of written) {
		assert.ok(Object.keys(DEFAULT_CONFIG).includes(key), `${key} is written back but is not a schema key`);
	}
});

test("no source file still spells a retired key", () => {
	// A half-done rename is the failure this pins: a reader left on an old name compiles, and its test
	// keeps passing until someone passes the new key and wonders why nothing changed.
	const old = Object.keys(RENAMED_KEYS);
	for (const dir of ["src", "client"]) {
		for (const file of sourceFiles(path.join(repoRoot, dir))) {
			const text = readFileSync(file, "utf8");
			for (const name of old) {
				assert.equal(
					text.includes(name),
					false,
					`${path.relative(repoRoot, file)} still spells the retired key ${name}`,
				);
			}
		}
	}
});
