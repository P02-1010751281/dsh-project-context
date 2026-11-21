/**
 * Pins the single entry-state arbiter (batch AA1).
 *
 * The defect this closes is not a missing detection but a split one: retirement acted on "the cited
 * path is gone" while the staleness bindings only reported "a cited file's content changed", and the
 * two never met. Nothing owned the question "what is this entry's state", so the answer depended on
 * which half you asked. These cases pin the precedence itself, and they are the only place that has
 * to know it: the retirement engine and the receipts both ask this module.
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { countEntryStates, entryStateOf, retiresEntry } from "../lib/project-memory/entry-state.js";

/** Every fact points at the same id, so any test can drop the ones it is not about. */
function saturated(tid) {
	return {
		superseded: new Map([[tid, "aaa"]]),
		drifted: new Map([[tid, ["src/gone.ts does not exist"]]]),
		stale: new Set([tid]),
		unconfirmed: new Set([tid]),
	};
}

test("an entry with no facts is healthy and carries no detail", () => {
	const verdict = entryStateOf("abc", {});
	assert.equal(verdict.state, "healthy");
	assert.equal(verdict.detail, "", "a healthy entry has no reason to print");
	assert.equal(retiresEntry(verdict.state), false);
});

test("the more certain verdict wins, in the documented order", () => {
	const tid = "abc";
	assert.equal(entryStateOf(tid, saturated(tid)).state, "superseded");
	const noSupersede = { ...saturated(tid), superseded: new Map() };
	assert.equal(entryStateOf(tid, noSupersede).state, "anchor-drift");
	const noDrift = { ...noSupersede, drifted: new Map() };
	assert.equal(entryStateOf(tid, noDrift).state, "age-unconfirmed");
	const onlyStale = { ...noDrift, unconfirmed: new Set() };
	assert.equal(entryStateOf(tid, onlyStale).state, "content-stale");
	assert.equal(entryStateOf(tid, { ...onlyStale, stale: new Set() }).state, "healthy");
});

test("content drift is never grounds for a retirement", () => {
	const verdict = entryStateOf("abc", { stale: new Set(["abc"]) });
	assert.equal(verdict.state, "content-stale");
	assert.equal(retiresEntry(verdict.state), false, "a changed file is not a false fact");
	for (const state of ["superseded", "anchor-drift", "age-unconfirmed"]) {
		assert.equal(retiresEntry(state), true, `${state} retires the entry`);
	}
});

test("the detail names the concrete reason, never the category", () => {
	const drift = entryStateOf("abc", { drifted: new Map([["abc", ["src/a.ts does not exist", "src/b.ts:9 is past the end of a 4-line file"]]]) });
	assert.equal(drift.detail, "src/a.ts does not exist; src/b.ts:9 is past the end of a 4-line file");
	const superseded = entryStateOf("abc", { superseded: new Map([["abc", "def"]]) });
	assert.equal(superseded.detail, "def", "the tombstone names the replacement id");
	assert.match(entryStateOf("abc", { unconfirmed: new Set(["abc"]) }).detail, /no mention in the scanned sessions/);
});

test("a fact the caller did not gather cannot win", () => {
	// `/memory status` can afford the bindings but not a filesystem walk or an archive scan; it must not
	// read the missing facts as "healthy", and it must not read them as a verdict either.
	const counts = countEntryStates(["abc", "def"], { stale: new Set(["abc"]) });
	assert.deepEqual(counts, { superseded: 0, "anchor-drift": 0, "age-unconfirmed": 0, "content-stale": 1, healthy: 1 });
});

test("the count covers every state, including the empty ones", () => {
	const facts = {
		superseded: new Map([["a1", "b2"]]),
		drifted: new Map([["a2", ["src/x.ts does not exist"]]]),
		unconfirmed: new Set(["a3"]),
		stale: new Set(["a4"]),
	};
	const counts = countEntryStates(["a1", "a2", "a3", "a4", "a5"], facts);
	assert.deepEqual(counts, { superseded: 1, "anchor-drift": 1, "age-unconfirmed": 1, "content-stale": 1, healthy: 1 });
	assert.deepEqual(countEntryStates([], facts), { superseded: 0, "anchor-drift": 0, "age-unconfirmed": 0, "content-stale": 0, healthy: 0 });
});
