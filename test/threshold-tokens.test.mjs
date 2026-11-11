import assert from "node:assert/strict";
import test from "node:test";

import { resolveThreshold, thresholdRefusal, thresholdRefusalText } from "../lib/project-handoff/threshold.js";
import { resolvePluginConfig } from "../lib/shared/config.js";

/** A resolved config on the test route; `over` drives one field at a time. */
const config = (over) => resolvePluginConfig({ provider: "test-provider", model: "test-model", ...over });
/** No harness envelope, no carried tail: the floor is `MIN_DROP_TOKENS` alone. */
const plain = { totalTokens: 0, surfaceTokens: 0 };

test("an absolute count that fits the window is the trigger, verbatim", () => {
	const ok = config({ handoffThreshold: "40000", handoffBudgetRecentTokens: 0 });
	const resolved = resolveThreshold(ok, plain, 100_000);
	assert.equal(resolved?.tokens, 40_000, "no fraction arithmetic is applied to a count");
	assert.equal(resolved?.label, "40000 tokens");
	assert.equal(resolved?.override, undefined, "nothing was capped, so there is nothing to warn about");
});

test("a count larger than the window is capped and the cap is named", () => {
	// The fence the user asked for: 400k on a 100k window must not be silently kept (the trigger could
	// never fire) and must not be silently dropped either — it is capped to what the window can hold and
	// the receipt says so, with the number the setting asked for.
	const big = config({ handoffThreshold: "400k", handoffBudgetRecentTokens: 0 });
	const resolved = resolveThreshold(big, plain, 100_000);
	assert.equal(resolved?.tokens, 96_000, "W − SAFETY_MARGIN_TOKENS");
	assert.equal(resolved?.label, "400000 tokens (capped to 96000)");
	assert.deepEqual(resolved?.override, { setting: "tokens", asked: 400_000, tokens: 96_000, by: "capacity" });
});

test("a count under the physical floor refuses, and the advice stays in the same spelling", () => {
	const small = config({ handoffThreshold: "2000", handoffBudgetRecentTokens: 0 });
	assert.equal(resolveThreshold(small, plain, 100_000), undefined, "2000 cannot buy a worthwhile drop");
	assert.equal(thresholdRefusal(small, plain, 100_000), "fixed-below-floor");
	const text = thresholdRefusalText("fixed-below-floor", small, plain, 100_000, "en");
	assert.match(text, /the fixed 2000-token trigger/, `the count is quoted, not a percentage: ${text}`);
	assert.match(text, /\/handoff threshold 8000/, "the named control is a count, because that is the mode in force");
	assert.doesNotMatch(text, /0\.1\b|%/, "a user who typed a count is not sent back to fractions");
});

test("the ratio spelling keeps its own label, so the two modes stay distinguishable", () => {
	const ratio = config({ handoffThreshold: "0.4", handoffBudgetRecentTokens: 0 });
	assert.equal(resolveThreshold(ratio, plain, 100_000)?.label, "40% of window");
	// 0.95 × 60 000 = 57 000 is over the 56 000 the window can hold, so the ratio's own cap applies too.
	assert.equal(resolveThreshold(config({ handoffThreshold: "0.95", handoffBudgetRecentTokens: 0 }), plain, 60_000)?.label,
		"95% of window (capped to 56000)", "the ratio's cap keeps the percentage and adds the number");
});
