import assert from "node:assert/strict";
import test from "node:test";

import { formatThresholdSpec, parseThresholdSpec, parseTokenCount, thresholdSpecHelp } from "../lib/shared/threshold-spec.js";

test("the merged setting keeps every ratio spelling the old ratio key accepted", () => {
	assert.deepEqual(parseThresholdSpec("0.4"), { mode: "ratio", ratio: 0.4 });
	assert.deepEqual(parseThresholdSpec("40"), { mode: "ratio", ratio: 0.4 }, "a bare percentage is still a ratio");
	assert.deepEqual(parseThresholdSpec("40%"), { mode: "ratio", ratio: 0.4 });
	assert.deepEqual(parseThresholdSpec("  0.4  "), { mode: "ratio", ratio: 0.4 }, "surrounding space is ignored");
	assert.deepEqual(parseThresholdSpec("0.1"), { mode: "ratio", ratio: 0.1 }, "the lower bound is inclusive");
	assert.deepEqual(parseThresholdSpec("95"), { mode: "ratio", ratio: 0.95 }, "and so is the upper one");
});

test("auto is the third spelling and the only word that means it", () => {
	assert.deepEqual(parseThresholdSpec("auto"), { mode: "auto" });
	assert.deepEqual(parseThresholdSpec("AUTO"), { mode: "auto" });
	assert.equal(parseThresholdSpec("automatic"), undefined);
	assert.equal(parseThresholdSpec(""), undefined);
});

test("a token count is read from k-suffixes and from bare numbers above every legal ratio", () => {
	assert.deepEqual(parseThresholdSpec("400k"), { mode: "tokens", tokens: 400_000 });
	assert.deepEqual(parseThresholdSpec("1.5k"), { mode: "tokens", tokens: 1500 });
	assert.deepEqual(parseThresholdSpec("400000"), { mode: "tokens", tokens: 400_000 }, "above 95 no ratio can be meant");
	assert.deepEqual(parseThresholdSpec("96"), { mode: "tokens", tokens: 96 }, "96 cannot be a percentage");
});

test("an out-of-range fraction stays a refusal instead of becoming a token count", () => {
	// The disambiguation rule must not turn a mistyped ratio into a 5-token trigger that then reads as
	// "legal but below the floor": the two refusals need different remedies.
	for (const text of ["0", "1", "5", "0.05"]) assert.equal(parseThresholdSpec(text), undefined, `${text} is a fraction, not a count`);
	assert.equal(parseThresholdSpec("400000%"), undefined, "an explicit percent stays a fraction however large");
	assert.deepEqual(parseThresholdSpec("2k"), { mode: "tokens", tokens: 2000 }, "a count below the floor still parses; the floor refuses it later");
});

test("the canonical spelling round-trips through the parser", () => {
	for (const text of ["auto", "0.4", "0.95", "400k", "400000", "96"]) {
		const spec = parseThresholdSpec(text);
		assert.notEqual(spec, undefined, `fixture: ${text} parses`);
		assert.deepEqual(parseThresholdSpec(formatThresholdSpec(spec)), spec, `${text} survives format → parse`);
	}
	assert.equal(formatThresholdSpec({ mode: "tokens", tokens: 400_000 }), "400000", "a count is stored without the suffix");
	assert.equal(formatThresholdSpec({ mode: "ratio", ratio: 0.4 }), "0.4");
});

test("one token-count reader serves the budgets and the threshold", () => {
	for (const [text, expected] of [["12k", 12_000], ["12000", 12_000], ["0", 0], ["1.5k", 1500]]) {
		assert.equal(parseTokenCount(text), expected, text);
	}
	assert.equal(parseTokenCount("12kk"), undefined);
});

test("the help line names all three spellings", () => {
	const help = thresholdSpecHelp();
	assert.match(help, /auto/);
	assert.match(help, /fraction/);
	assert.match(help, /token count/);
});
