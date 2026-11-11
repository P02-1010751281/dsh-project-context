/**
 * Pins for the decision seam: the automatic handoff's gate chain as a pure function over plain data.
 *
 * Spec: `docs/batch-w-decision-seam-spec.md`. The seam splits "judge" from "measure" and "act", and the
 * load-bearing part of its contract is §3.1: `GateInputs` carries a whole `MeasuredContext`, never a
 * folded `totalTokens`, because the harness's `contextBreakdown` envelope and the meter's heuristic
 * surface are on different bases — folding them would let three hosts share one threshold with three
 * meanings, which is the wrong-attribution defect class this repo treats as its worst.
 *
 * What these cases pin, in the order they matter:
 *   - the gate *order* (§2): the threshold gate is first, the pending question is before running
 *     subagents, and running subagents are before the nothing-to-drop skip;
 *   - every named outcome of §3.2, so none of them is a silent `return` any more;
 *   - purity: the same `GateInputs` twice gives a deep-equal `Decision` and leaves its inputs alone;
 *   - the two boundaries the chain owns: the trigger itself (`totalTokens >= threshold`) and
 *     `MIN_DROP_TOKENS` (`threshold.ts:16`);
 *   - the measurement block surviving into the decision, per `envelopeSource`.
 *
 * Every case names the fixture edit that sends it down another path — spec §5's mutation table read
 * backwards. That is what makes it discriminating, but it is discriminating *about one thing*: a case
 * that pins gate order says nothing about the threshold's value, and a case that pins the envelope says
 * nothing about gate order. Read each negative control as the single edit that case alone catches; the
 * suite as a whole is the bar, not any one case. Two consequences, both deliberate: the fixtures build
 * `threshold` with the real `resolveThreshold` (so the number is right for the mode, and the cases that
 * *do* compare numbers — the two boundaries — are hand-computed constants, not resolver output), and a
 * case that would pass on a stub which echoes its input is only worth keeping when the echo itself is
 * the contract (the measurement block surviving into the decision).
 *
 * Runs through `lib/`, so `pnpm test` (which builds first) is the way to run it.
 */

import assert from "node:assert/strict";
import test from "node:test";
import * as seam from "../lib/project-handoff/decide.js";
import { DEFAULT_CONFIG } from "../lib/shared/config.js";
import { MIN_DROP_TOKENS, resolveThreshold } from "../lib/project-handoff/threshold.js";

/**
 * The seam's entry point, resolved in one place.
 *
 * §3 fixes `GateInputs` and `Decision` but names neither the exported function nor where a decision's
 * `threshold: Threshold` comes from: it is an **input**, resolved once by the adapter (`gate.ts`) and
 * passed in, because the pressure line the user reads renders that same object — deriving it a second
 * time inside the seam is the drift `gate.ts` exists to prevent. So the fixtures below resolve it
 * through the real `resolveThreshold` and hand it to the seam, which keeps fixed mode hand-checkable
 * (`TRIGGER` below) without reimplementing the resolver.
 */
const decide = seam.decideAutoHandoff;
assert.equal(typeof decide, "function", "the decision seam must export `decideAutoHandoff`");

/**
 * Fixed-ratio mode with an explicit target and no carried tail, so the trigger is hand-computable:
 * `min(round(0.4 × window), window − 4 000)` and the physical floor is `0 + 0 + MIN_DROP_TOKENS`.
 * A threshold the test can predict without reimplementing `threshold.ts` is what keeps the boundary
 * cases discriminating: an expected number that came out of the module under test would be circular.
 * Gate order is mode-independent; production's default (adaptive) mode is exercised in its own case.
 */
const FIXED = { ...DEFAULT_CONFIG, handoffThreshold: { mode: "ratio", ratio: 0.4 }, handoffBudgetRecentTokens: 0 };

const WINDOW = 100_000;
/** `min(round(0.4 × 100 000), 100 000 − 4 000)` — the fixed-mode trigger at {@link WINDOW}. */
const TRIGGER = 40_000;

/** One `MeasuredContext` (spec §3.1); `surfaceTokens` is required, `overheadTokens`/`envelopeSource` optional. */
function measured(totalTokens, extra = {}) {
	return { totalTokens, surfaceTokens: totalTokens, ...extra };
}

/**
 * The default "there is something worth dropping" fixture, deliberately *above* the minimum: the
 * `MIN_DROP_TOKENS` boundary gets exactly one case of its own, so §5 row 3's `<` ↔ `<=` mutant reds
 * that case and not the whole handoff class. A boundary test that every other case also sits on
 * cannot tell "the boundary is wrong" from "the chain is wrong".
 */
const DROPPABLE = MIN_DROP_TOKENS + 4_000;

/**
 * The default occupancy: clearly *over* the trigger, for the same reason {@link DROPPABLE} is above the
 * drop minimum. The trigger's own boundary gets one case, so a one-token comparison flip reds that case
 * instead of every fixture that happens to sit on the line.
 */
const ABOVE_TRIGGER = TRIGGER + 10_000;

/** One `GateInputs`, defaulted to a session over the trigger with clearly enough left to drop. */
function inputs(overrides = {}, config = FIXED) {
	// The trigger is resolved by the adapter's own function and then passed in — the seam compares
	// against it and never derives it (see the note above `decide`). Resolving it here is what makes the
	// envelope cases below meaningful: `resolveThreshold` is where an envelope lifts the floor, so the
	// fixture's trigger varies with its measurement instead of being a constant the seam could ignore.
	const measurement = overrides.measurement ?? measured(ABOVE_TRIGGER);
	const contextWindow = overrides.contextWindow ?? WINDOW;
	return {
		measurement,
		contextWindow,
		threshold: resolveThreshold(config, measurement, contextWindow),
		pendingQuestion: undefined,
		pendingSubagents: [],
		olderTokens: DROPPABLE,
		...overrides,
	};
}

function decideOf(gateInputs, config = FIXED) {
	return decide(gateInputs, config);
}

test("under the trigger, an open question does not defer — the threshold gate is first", () => {
	// The fixture is loaded with every deferral the chain knows: a question, a running child, and
	// nothing worth dropping. None of them may speak while the session is under its trigger.
	const decided = decideOf(
		inputs({
			measurement: measured(TRIGGER - 1),
			pendingQuestion: "Which branch should I use?",
			pendingSubagents: ["child-1"],
			olderTokens: 0,
		}),
	);
	assert.deepEqual(decided, { kind: "below-threshold", tokens: TRIGGER - 1, threshold: TRIGGER });
	// Negative control: putting the question gate *ahead* of the threshold gate turns this into
	// `defer(question)`, and a drop-minimum gate that ran early would turn it into
	// `skip(nothing-to-drop)` — the fixture holds all three, so the threshold alone can answer first.
});

test("under the trigger, a running subagent does not defer either", () => {
	const decided = decideOf(inputs({ measurement: measured(TRIGGER - 1), pendingSubagents: ["child-1"], olderTokens: 0 }));
	assert.deepEqual(decided, { kind: "below-threshold", tokens: TRIGGER - 1, threshold: TRIGGER });
	// Negative control: gate 4 ahead of gate 2 answers `defer(subagents)`; the question is deliberately
	// absent here so the subagent gate is the *only* other path the fixture could take.
});

test("over the trigger, an unanswered question defers before a running subagent", () => {
	const decided = decideOf(
		inputs({ pendingQuestion: "Which branch should I use?", pendingSubagents: ["child-1"], olderTokens: 0 }),
	);
	assert.deepEqual(decided, { kind: "defer", reason: "question" });
	// Negative control: a subagent gate ahead of the question gate answers `defer(subagents)`. `olderTokens:
	// 0` additionally keeps the drop-minimum gate reachable, so the `reason` field is the only thing
	// naming the winner.
});

test("under `wait`, an open question does not defer — the config decides, not the question", () => {
	// Both shipped profiles set `handoffPendingQuestion: wait`, so this is the production branch: the
	// question travels into the child session instead of holding the handoff back. Nothing else in the
	// fixture can withhold it — no running subagent, and 9 000 older tokens clears the 8 000 minimum.
	const waiting = { ...FIXED, handoffPendingQuestion: "wait" };
	const decided = decideOf(inputs({ pendingQuestion: "Which branch should I use?", olderTokens: 9_000 }, waiting), waiting);
	assert.equal(decided.kind, "handoff");

	// Negative control: the same fixture under the shipped default. `handoffPendingQuestion` defaults to
	// `defer`, so the question holds it back — the pair is the only thing pinning "a question defers
	// only when the config says so". Drop the config check from `decide.ts` and *this* half turns into
	// `handoff`, which is why the case needs both sides rather than the `wait` side alone.
	const deferred = decideOf(inputs({ pendingQuestion: "Which branch should I use?", olderTokens: 9_000 }));
	assert.deepEqual(deferred, { kind: "defer", reason: "question" });
});

test("over the trigger, a running subagent defers before the nothing-to-drop skip", () => {
	const decided = decideOf(inputs({ pendingSubagents: ["child-1"], olderTokens: MIN_DROP_TOKENS - 1 }));
	assert.deepEqual(decided, { kind: "defer", reason: "subagents" });
	// Negative control: run gate 5 before gate 4 and this becomes `skip(nothing-to-drop)` — the fixture
	// is deliberately one token short of the drop minimum, so both outcomes are genuinely reachable.
});

test("something to drop that is too small is a skip, named apart from a deferral", () => {
	const decided = decideOf(inputs({ olderTokens: 7_999 }));
	assert.deepEqual(decided, { kind: "skip", reason: "nothing-to-drop" });
	// Negative control: `olderTokens: 8_000` (next case) hands off instead; and reporting this as
	// `defer` with reason "nothing-to-drop" fails here, because §3.2 separates `skip` from `defer`.
});

test("the drop minimum is inclusive: exactly MIN_DROP_TOKENS hands off", () => {
	// The constant from `threshold.ts:16` is the boundary's single source of truth; assert it once so a
	// silent change to it is visible here rather than absorbed by the fixtures below.
	assert.equal(MIN_DROP_TOKENS, 8_000, "MIN_DROP_TOKENS moved — the boundary cases below need re-deriving");
	const gateInputs = inputs({ olderTokens: MIN_DROP_TOKENS });
	const decided = decideOf(gateInputs);

	assert.deepEqual(
		Object.keys(decided).sort(),
		["kind", "measurement", "olderTokens", "threshold"],
		"a handoff decision carries exactly §3.2's four fields",
	);
	assert.equal(decided.kind, "handoff");
	assert.equal(decided.olderTokens, 8_000, "the decision echoes the drop size it judged");
	assert.deepEqual(decided.measurement, gateInputs.measurement, "and the whole measurement block it judged, not a folded number");
	assert.equal(typeof decided.threshold, "object", "§3.2's `threshold: Threshold` is the resolved block, not a number");
	assert.equal(decided.threshold.tokens, TRIGGER, "the threshold the decision used is the whole point of carrying it");
	// Negative control: `olderTokens: 7_999` (previous case) skips; §5 row 3's `<` ↔ `<=` flip at the
	// drop minimum turns exactly this case red while leaving 7_999 green — the boundary is pinned from
	// both sides, so neither half can be right by accident.
});

test("the trigger is inclusive: exactly `threshold` hands off", () => {
	// Case 1 is the other side of this pair (39 999 → below-threshold); together they pin the comparison
	// as `totalTokens >= threshold` rather than `>` — a one-token window either way.
	const decided = decideOf(inputs({ measurement: measured(TRIGGER) }));
	assert.equal(decided.kind, "handoff");
	assert.equal(decided.threshold.tokens, TRIGGER);
	// Negative control: 39 999 in case 1 answers `below-threshold`; a `>` comparison or a threshold
	// rounded up by one flips this case alone.
});

test("the same GateInputs decides the same Decision twice, and is left untouched", () => {
	// Two fixtures, because the trigger's old bookkeeping sits on two different paths: a handoff (the
	// one-shot `handedOff` flag, the skip throttle, `failedUntil`) and a deferral (`recordHandoffDeferral`).
	// The seam's inputs are plain data, so nothing about a second answer may legitimately differ.
	const fixtures = [inputs(), inputs({ pendingQuestion: "Which branch?", olderTokens: 0 })];
	for (const gateInputs of fixtures) {
		const before = structuredClone(gateInputs);
		const first = decideOf(gateInputs);
		const second = decideOf(gateInputs);
		assert.deepEqual(second, first, `a pure seam cannot answer differently on the second call (${first.kind})`);
		assert.deepEqual(gateInputs, before, "and cannot rewrite the inputs it was given");
	}
	// Negative control: a seam that memoised a decided `GateInputs` and answered `skip` on the second
	// call, or that annotated `measurement` in place, fails here while every single-call case stays green.
});

test("a session with no resolvable trigger is `unmeasurable`, and the same session with a window is not", () => {
	// §3.2 gives the old `if (!gate) return` its own name. A zero window is unambiguous under every
	// routing of that exit, and at this layer only one of them is reachable: the seam never reads
	// `contextWindow` (it is carried for the caller), so what makes `blind` unmeasurable is
	// `resolveThreshold` refusing at that window — `round(0 × 0.4) − 4 000` is not positive — while the
	// adapter's own non-positive-window exit is `gate.ts:56-57`, upstream of this call.
	const blind = decideOf(inputs({ measurement: measured(1_000), contextWindow: 0 }));
	assert.deepEqual(blind, { kind: "unmeasurable" });

	const sighted = decideOf(inputs({ measurement: measured(1_000) }));
	assert.deepEqual(sighted, { kind: "below-threshold", tokens: 1_000, threshold: TRIGGER });
	// Negative control: the control half is the same measurement and the same config with only the window
	// restored, so a seam that rendered every under-trigger session as `unmeasurable` — or every
	// unmeasurable one as `below-threshold` — cannot pass both halves.
});

test("production's adaptive mode reaches the same seam through the same config", () => {
	// The default config is the one users actually run: adaptive, a 20 000-token carried tail. Its
	// trigger is the quality knee, so these numbers are asserted as an interval around the documented
	// floor rather than as the knee's own value — the knee belongs to `threshold.ts`, not to this seam.
	const auto = { ...DEFAULT_CONFIG };
	// `auto` goes to both: the fixture resolves the trigger under the same config the seam is called with.
	const over = decideOf(inputs({ measurement: measured(200_000), contextWindow: 1_000_000 }, auto), auto);
	assert.equal(over.kind, "handoff");
	assert.ok(
		over.threshold.tokens >= 28_000 && over.threshold.tokens < 200_000,
		`adaptive trigger outside the interval between its floor (20 000 + ${MIN_DROP_TOKENS}) and the fixture's 200 000: ${over.threshold.tokens}`,
	);

	const under = decideOf(inputs({ measurement: measured(100_000), contextWindow: 1_000_000 }, auto), auto);
	assert.equal(under.kind, "below-threshold");
	assert.equal(under.tokens, 100_000);
	assert.equal(under.threshold, over.threshold.tokens, "one config, one trigger — the two calls cannot disagree");
	// Negative control: a seam that hardcoded fixed-mode arithmetic (or ignored the config's mode) puts
	// the 100 000 call over a 40 000 trigger and turns the second half red, while every fixed-mode case
	// above stays green.
});

test("a handoff decision carries the envelope it judged on, including where the envelope came from", () => {
	// `envelopeSource: "meter"` is the degraded-but-labelled case (§3.3): the envelope the meter
	// volunteered is not the harness's composition, so it must be named, not silently blended in.
	const gateInputs = inputs({
		measurement: { totalTokens: 50_000, surfaceTokens: 50_000, overheadTokens: 12_000, envelopeSource: "meter" },
	});
	const decided = decideOf(gateInputs);

	assert.equal(decided.kind, "handoff");
	assert.deepEqual(decided.measurement, gateInputs.measurement, "the decision reports the measurement it used");
	assert.equal(decided.measurement.envelopeSource, "meter", "the provenance survives the decision");
	assert.equal(decided.measurement.overheadTokens, 12_000);
	// Negative control: folding the reported block to a bare `totalTokens` keeps this case's `kind` and
	// loses exactly the two fields above — the fold is invisible to every assertion that only reads `kind`.
});

test("two measurements with the same totalTokens but different envelope blocks do not share a conclusion", () => {
	// The floor is `envelope + keep + MIN_DROP_TOKENS`, so a 40 000-token envelope puts it at 48 000,
	// past the 40 000 fixed trigger: nothing can be resolved, hence nothing to decide. The bare
	// measurement at the same `totalTokens` hands off. Same number, two conclusions, by basis.
	const bare = inputs();
	const enveloped = inputs({
		measurement: { totalTokens: ABOVE_TRIGGER, surfaceTokens: ABOVE_TRIGGER, overheadTokens: 40_000, envelopeSource: "projection" },
	});

	assert.equal(decideOf(bare).kind, "handoff");
	assert.equal(decideOf(enveloped).kind, "unmeasurable");
	// Negative control: drop the envelope from the floor — `thresholdFloor` ignoring `overheadTokens`, or
	// resolving the threshold from `totalTokens` alone — and the enveloped call resolves the same 40 000
	// trigger as the bare one and answers `handoff`, making the two indistinguishable. Note what is *not*
	// the difference here: the two inputs differ in their `threshold` too (40 000 vs `undefined`), so a
	// mutation that only folds the decision's *output* measurement leaves this case green — that fold is
	// what the case above catches.
});

test("the envelope is never derived by subtracting the meter's two bases", () => {
	// `wall-clock` invariant, `threshold.ts`: `totalTokens` sits on the provider's usage while
	// `surfaceTokens` is the meter's fixed-density heuristic, and the difference is `envelope + density
	// error`. `surfaceTokens` is pinned far below here so a subtraction would invent a 36 000-token
	// envelope and lift the 8 000 floor to 44 000, above the trigger.
	const gateInputs = inputs({ measurement: { totalTokens: ABOVE_TRIGGER, surfaceTokens: ABOVE_TRIGGER - 36_000 } });
	const decided = decideOf(gateInputs);

	assert.equal(decided.kind, "handoff");
	assert.deepEqual(decided.measurement, gateInputs.measurement);
	// Negative control: derive `overheadTokens` as `totalTokens − surfaceTokens` and this becomes
	// `unmeasurable` while the previous case (an explicitly reported envelope) stays green — the two
	// cases separate "reported" from "computed", which is the whole invariant.
});
