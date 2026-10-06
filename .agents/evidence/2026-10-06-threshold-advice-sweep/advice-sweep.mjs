#!/usr/bin/env node
/**
 * Exhaustive check of `fixedRatioAdvice` — the ratio a `/handoff` receipt may name after batch K's floor
 * gate (`src/project-handoff/threshold.ts`).
 *
 * The receipt's advice is a **control**, so it has to be right in both directions, and this script is the
 * probe that found it wrong in both:
 *
 *  - **over-reach**: `Math.ceil` on a float overshoots an exact boundary (`14 000 / 50 000 × 100` is
 *    `28.000000000000004`, so the honest `0.28` came out as `0.29`) — the advice named a working control
 *    one step past the smallest one.
 *  - **over-withhold**: the same `Math.ceil` pushes the candidate past `MAX_THRESHOLD_RATIO` when
 *    `0.95 × W` rounds *up* over a floor just past it, and an early `needed > MAX → undefined` then told
 *    the user "no legal ratio clears the floor at this window" while `/handoff threshold 0.95` worked
 *    (found on 780 of 2 235 cells by a dense sweep, and 110 004 of 110 000 modellable windows by the
 *    closure review that caught it). `W = 262 144` with a 249 037 floor is the reproducible case.
 *
 * Both are fixed; this script is the regression probe. For every cell it compares what the receipt says
 * against the *ground truth* computed from `resolveThreshold` over the whole legal two-decimal grid:
 *
 *  - advice named  ⇒ it clears the floor, and no smaller two-decimal ratio does;
 *  - advice absent ⇒ no legal two-decimal ratio clears the floor.
 *
 * Read-only: it writes nothing and never greps for a marker.
 *
 * Usage: node advice-sweep.mjs [project-root]   (defaults to the git top level)
 * Exit: 0 when both directions hold everywhere, 1 on the first mismatch reported.
 */

import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(
	process.argv[2] ?? execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim(),
);
const load = (rel) => import(pathToFileURL(join(root, rel)).href);

const { resolveThreshold, thresholdRefusalText } = await load("lib/project-handoff/threshold.js");
const { resolvePluginConfig } = await load("lib/shared/config.js");
const { MAX_THRESHOLD_RATIO, MIN_THRESHOLD_RATIO } = await load("lib/shared/limits.js");
const { MIN_DROP_TOKENS } = await load("lib/project-handoff/threshold.js");

const config = (over) => resolvePluginConfig({ provider: "test-provider", model: "test-model", ...over });
const measurement = (overheadTokens) => ({ totalTokens: 0, surfaceTokens: 0, ...(overheadTokens > 0 ? { overheadTokens } : {}) });
const advisedRatio = (text) => {
	const match = /\/handoff threshold (\d+(?:\.\d+)?)/.exec(text);
	return match === null ? undefined : Number(match[1]);
};

/** The whole legal two-decimal grid — what the receipt can name. */
const GRID = [];
for (let ratio = MIN_THRESHOLD_RATIO; ratio <= MAX_THRESHOLD_RATIO + 1e-9; ratio = Math.round((ratio + 0.01) * 100) / 100) {
	GRID.push(Math.round(ratio * 100) / 100);
}

/** Windows to sweep: the real ones in play, plus a dense arithmetic walk that lands on rounded boundaries. */
const WINDOWS = [
	8_192, 16_384, 24_576, 27_648, 32_768, 40_000, 50_000, 65_536, 98_304, 100_000, 131_072, 200_000,
	262_144, 400_000, 450_000, 500_000, 1_000_000, 2_000_000,
];
for (let window = 20_000; window <= 300_000; window += 1_337) WINDOWS.push(window);

/** Floors to sweep, expressed as the carried tail (the only floor term a user sets): keep + MIN_DROP. */
const TAILS = [0, 1, 5_000, 20_000, 39_000, 68_157, 85_389, 149_000, 198_192, 200_000];

let cells = 0;
let named = 0;
let withheld = 0;
const failures = [];

for (const window of WINDOWS) {
	for (const tail of TAILS) {
		for (const overhead of [0, 1_000, 42_845, 200_000, 900_000, 960_000]) {
			const stuck = config({ handoffThresholdAuto: false, handoffThresholdRatio: 0.4, handoffBudgetRecentTokens: tail });
			const measured = measurement(overhead);
			const text = thresholdRefusalText("fixed-below-floor", stuck, measured, window, "en");
			const advice = advisedRatio(text);
			// Ground truth: which two-decimal ratios really resolve, with the same tail and envelope.
			const works = GRID.filter((ratio) =>
				resolveThreshold(config({ handoffThresholdAuto: false, handoffThresholdRatio: ratio, handoffBudgetRecentTokens: tail }), measured, window) !== undefined);
			cells++;
			const label = `W=${window} tail=${tail} envelope=${overhead}`;
			if (advice === undefined) {
				withheld++;
				if (works.length > 0) failures.push(`${label}: withheld, but ${works[0]} clears (and the receipt says no legal ratio does)`);
				continue;
			}
			named++;
			if (works.length === 0) failures.push(`${label}: named ${advice}, but no legal ratio clears this floor`);
			else if (advice !== works[0]) failures.push(`${label}: named ${advice}, but the smallest that clears is ${works[0]}`);
		}
	}
}

console.log(`windows ${WINDOWS.length} × tails ${TAILS.length} × envelopes 6 = ${cells} cells`);
console.log(`the advice named a ratio in ${named}, withheld in ${withheld}`);
console.log(
	failures.length === 0
		? "VERDICT: both directions hold — every named ratio is the smallest that clears, and every withholding is true"
		: `VERDICT: ${failures.length} failure(s)`,
);
for (const failure of failures.slice(0, 20)) console.log(`  ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);
