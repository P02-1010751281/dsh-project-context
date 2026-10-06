/**
 * Re-runnable offline probe for the injected pressure line (batch M).
 *
 * It drives the built `lib/` only — no host, no restart — and asserts the two properties the design
 * rests on: the frozen text does not move while a crossing holds (the cost bound: a change costs one
 * ~37 KB runtime-context snapshot append), and nothing is rendered below the threshold. It also
 * prints the exact line for the numbers that motivated the batch, so the wording can be read without
 * waiting for a live crossing.
 *
 * Run: `node .agents/evidence/2026-10-06-batchM-pressure-line/probe.mjs`
 * Exit code 0 = all checks passed; any failure prints `FAIL <check>` and exits 1.
 */

import assert from "node:assert/strict";
import { clearHandoffPressure, handoffPressureIsOver, handoffPressureText, recordHandoffDeferral, recordHandoffGate } from "../../../lib/project-handoff/display.js";

const checks = [];
/** Run one named check; a throw is recorded and reported rather than aborting the rest. */
function check(name, body) {
	try {
		body();
		checks.push([name, true]);
	} catch (error) {
		checks.push([name, false]);
		console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

const session = (id) => ({ id, header: {} });
const gate = (tokens, threshold, contextWindow = 1_000_000) => ({
	contextWindow,
	measurement: { totalTokens: tokens, surfaceTokens: 1 },
	threshold: threshold === undefined ? undefined : { tokens: threshold, label: "probe" },
	refusal: threshold === undefined ? "drop-floor" : undefined,
});

// The numbers the batch was opened for: 54cdf479 at 316,189 / 1,000,000 against a 157,000 threshold.
const ID = "session-probe-batch-m";
const CROSSED = gate(316_189, 157_000);

check("a crossing produces a line carrying its own numbers", () => {
	recordHandoffGate(session(ID), CROSSED);
	const text = handoffPressureText(session(ID), "zh");
	assert.notEqual(text, "", "expected a line");
	for (const needle of ["316189", "1000000", "157000"]) assert.ok(text.includes(needle), `line must carry ${needle}`);
});

check("the text does not move as occupancy grows (the ~37 KB-per-change bound)", () => {
	const first = handoffPressureText(session(ID), "zh");
	for (const grown of [320_000, 340_000, 400_000, 500_000]) {
		recordHandoffGate(session(ID), gate(grown, 157_000));
		assert.equal(handoffPressureText(session(ID), "zh"), first, `occupancy ${grown} must not re-render`);
	}
});

check("below the threshold nothing is rendered, and the next crossing speaks again", () => {
	recordHandoffGate(session(ID), gate(1_000, 157_000));
	assert.equal(handoffPressureText(session(ID), "zh"), "", "below the threshold must contribute nothing");
	assert.equal(handoffPressureIsOver(ID), false, "the marker must be released");
	recordHandoffGate(session(ID), gate(200_000, 157_000));
	assert.ok(handoffPressureText(session(ID), "zh").includes("200000"), "the new crossing carries its own numbers");
});

check("a reason re-renders once, and repeating it does not", () => {
	const before = handoffPressureText(session(ID), "zh");
	recordHandoffDeferral(ID, "question");
	const after = handoffPressureText(session(ID), "zh");
	assert.notEqual(after, before, "the reason must reach the reader");
	recordHandoffDeferral(ID, "question");
	assert.equal(handoffPressureText(session(ID), "zh"), after, "the same reason must not re-render");
});

check("a refusal (no threshold) never renders a crossing", () => {
	recordHandoffGate(session(ID), gate(999_999, undefined));
	assert.equal(handoffPressureText(session(ID), "zh"), "", "no resolved threshold means no line");
});

clearHandoffPressure(ID);

console.log("\n--- the shipped line, for the numbers that opened this batch ---");
recordHandoffGate(session(ID), CROSSED);
console.log(`zh: ${handoffPressureText(session(ID), "zh")}`);
console.log(`en: ${handoffPressureText(session(ID), "en")}`);
clearHandoffPressure(ID);

const failed = checks.filter(([, ok]) => !ok);
console.log(`\nchecks: ${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
