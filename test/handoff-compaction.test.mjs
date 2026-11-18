/**
 * The `/handoff status` compaction line: folding the host's own `compaction/*` records from the
 * durable log.
 *
 * What this pins:
 *  - a count is a log fact, never an inference: distinct `summary` ids, prune events, `end` ids with
 *    an `error`, and only *stated* `shadowedTokenCount`s;
 *  - a record shape we cannot trust is `unavailable` with a named reason, never `0` — the receipt must
 *    not report "no compaction" for a log it failed to read, and a future host event type must not make
 *    every count quietly understate;
 *  - the receipt carries the line even when the route or the meter is what is broken, because that is
 *    the receipt a user opens while handoff is not firing.
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { compactionStats, compactionStatusLine } from "../lib/project-handoff/compaction.js";
import { statusText } from "../lib/project-handoff/command.js";
import { resolvePluginConfig } from "../lib/shared/config.js";

const SUCCESS = (id, tokens, extra = {}) => ({
	type: "compaction/summary",
	data: {
		compactionId: id,
		summary: [{ type: "text", text: "…" }],
		shadowedRange: { start: 1, end: 9 },
		shadowedSeqs: [1, 2, 3],
		shadowedTokenCount: tokens,
		provider: "test-provider",
		model: "test-model",
		...extra,
	},
});

const END = (id, error) => ({ type: "compaction/end", data: { compactionId: id, turn: 2, ...(error === undefined ? {} : { error }) } });
const START = (id) => ({ type: "compaction/start", data: { compactionId: id, turn: 2 } });
const PRUNE = (tokens) => ({ type: "compaction/prune", data: { shadowedRange: { start: 3, end: 3 }, shadowedSeqs: [3], shadowedTokenCount: tokens } });

/** Unrelated events must never contribute, and must never make the fold refuse. */
const NOISE = [
	{ type: "turn/start", data: { turn: 1 } },
	{ type: "user/message", data: { content: [{ type: "text", text: "go" }] } },
	{ type: "session/title", data: { title: "a title" } },
];

test("an empty log is zero compactions, not unavailable", () => {
	const stats = compactionStats([]);
	assert.deepEqual(stats, { available: true, summarized: 0, pruned: 0, failed: 0, reclaimedTokens: 0 });
	assert.equal(compactionStatusLine(stats, "en"), "compactions 0 (no compaction recorded)");
	assert.match(compactionStatusLine(stats, "zh"), /压缩 0 次/);
});

test("one completed compaction counts its id, its shadow price and the route that wrote it", () => {
	const stats = compactionStats([...NOISE, START("c1"), SUCCESS("c1", 12_000), END("c1")]);
	assert.equal(stats.available, true);
	assert.equal(stats.summarized, 1, "counted once, by its summary");
	assert.equal(stats.pruned, 0);
	assert.equal(stats.failed, 0);
	assert.equal(stats.reclaimedTokens, 12_000);
	assert.deepEqual(stats.lastSuccess, { shadowedTokens: 12_000, provider: "test-provider", model: "test-model" });
	assert.equal(compactionStatusLine(stats, "en"), "compactions 1 (summarized 1, pruned 0), last shadowed 12000 tokens, test-provider/test-model");
});

test("a replayed record is the same compaction, not a second one", () => {
	const stats = compactionStats([SUCCESS("c1", 100), END("c1"), SUCCESS("c1", 100), END("c1")]);
	assert.equal(stats.summarized, 1);
	assert.equal(stats.reclaimedTokens, 100, "the shadow price is not added twice");
});

test("prunes are counted separately, because a prune is not a transaction", () => {
	const stats = compactionStats([SUCCESS("c1", 1_000), END("c1"), PRUNE(500), PRUNE(250)]);
	assert.equal(stats.summarized, 1);
	assert.equal(stats.pruned, 2);
	assert.equal(stats.reclaimedTokens, 1_750, "every stated amount adds up");
	assert.equal(stats.lastSuccess.shadowedTokens, 250, "the last replacement in log order");
	assert.match(compactionStatusLine(stats, "en"), /^compactions 3 \(summarized 1, pruned 2\), last shadowed 250 tokens$/);
});

test("a failed attempt is reported by name and never counted as a compaction", () => {
	const stats = compactionStats([START("c1"), END("c1", "summarize failed: 503 upstream\n  at provider")]);
	assert.equal(stats.summarized, 0);
	assert.equal(stats.failed, 1);
	assert.equal(stats.reclaimedTokens, 0);
	assert.equal(
		compactionStatusLine(stats, "en"),
		"compactions 0 (no successful compaction), failed 1: summarize failed: 503 upstream at provider",
		"the error is folded to one line so the receipt stays one line",
	);
});

test("a long failure is clipped instead of wrapping the receipt", () => {
	const stats = compactionStats([END("c1", "x".repeat(400))]);
	assert.equal(stats.lastError.length, 120);
	assert.ok(stats.lastError.endsWith("…"));
	assert.match(compactionStatusLine(stats, "en"), /^compactions 0 \(no successful compaction\), failed 1: x+…$/);
});

test("a record shape the fold cannot trust is unavailable with a reason, never zero", () => {
	assert.deepEqual(compactionStats(undefined), { available: false, reason: "unreadable" });
	assert.deepEqual(compactionStats([{ type: "compaction/summary", data: {} }]), { available: false, reason: "malformed" }, "no id, so replayed and repeated cannot be told apart");
	assert.deepEqual(compactionStats([{ type: "compaction/end", data: { compactionId: "c1" } }]), { available: true, summarized: 0, pruned: 0, failed: 0, reclaimedTokens: 0 }, "an end without an error is a success, not a refusal");
	assert.deepEqual(compactionStats([{ type: "compaction/rollback", data: {} }]), { available: false, reason: "malformed" }, "a future event type must not silently undercount");
	assert.equal(compactionStatusLine({ available: false, reason: "unreadable" }, "en"), "compactions unavailable (session log unreadable)");
	assert.equal(compactionStatusLine({ available: false, reason: "malformed" }, "zh"), "压缩记录不可用（存在无法识别的压缩事件）");
});

test("missing optional fields drop only those fields", () => {
	const stats = compactionStats([SUCCESS("c1", undefined, { provider: undefined, model: undefined })]);
	assert.equal(stats.available, true);
	assert.equal(stats.summarized, 1);
	assert.equal(stats.reclaimedTokens, 0, "a missing amount contributes nothing and is not read as 0");
	assert.deepEqual(stats.lastSuccess, {});
	assert.equal(compactionStatusLine(stats, "en"), "compactions 1 (summarized 1, pruned 0)", "no shadow price and no route to claim");
});

// --- wiring: the receipt carries the line ------------------------------------------------

const WINDOW = 1_000_000;

function fakeSession(id, events) {
	return {
		id,
		header: { cwd: process.cwd(), createdAt: Date.now() },
		deriveMessages: () => [],
		requestHeader: () => undefined,
		snapshotEvents: () => events,
	};
}

function pluginContext({ occupancy, meter = true, window = WINDOW } = {}) {
	return {
		get: (name) =>
			name === "tokenMeter" && meter
				? { measure: () => ({ totalTokens: occupancy, surfaceTokens: occupancy }) }
				: undefined,
		llm: { resolveModelInfo: async () => ({ context: { contextWindow: window } }) },
		logger: { info() {}, warn() {} },
	};
}

test("the status receipt reports the compaction history next to the occupancy", async () => {
	const signal = new AbortController().signal;
	const session = fakeSession("session-compaction-receipt-1", [SUCCESS("c1", 8_000), END("c1"), SUCCESS("c2", 4_000), END("c2")]);
	const config = resolvePluginConfig({ provider: "test-provider", model: "test-model", handoffLang: "en", handoffBudgetRecentTokens: 0 });
	const receipt = await statusText(pluginContext({ occupancy: 900_000 }), session, config, signal);
	const parts = receipt.split(" · ");
	const context = parts.findIndex((part) => part.startsWith("context "));
	const compactions = parts.findIndex((part) => part.startsWith("compactions "));
	assert.ok(compactions > context, "the line follows the occupancy lines it is read with");
	assert.match(parts[compactions], /^compactions 2 \(summarized 2, pruned 0\), last shadowed 4000 tokens, test-provider\/test-model$/);
});

test("the line still renders when there is no route or meter to measure — that is the receipt that matters", async () => {
	const signal = new AbortController().signal;
	const session = fakeSession("session-compaction-receipt-2", [PRUNE(750)]);
	const config = resolvePluginConfig({ handoffLang: "en", handoffBudgetRecentTokens: 0 });
	const receipt = await statusText(pluginContext({ occupancy: 0, meter: false }), session, config, signal);
	assert.ok(!receipt.includes("context "), "the fixture must not have a context line");
	assert.match(receipt, /compactions 1 \(summarized 0, pruned 1\), last shadowed 750 tokens/);
});
