/**
 * The `/handoff status` compaction line, in three layers:
 *
 *  - `compaction.ts` is the host-free core: a pure fold over normalized records plus the receipt line;
 *  - `compaction-events.ts` is the dsh shim (`SH-10`): durable `compaction/*` records → those DTOs;
 *  - `command.ts` composes the two into one receipt part.
 *
 * What this pins:
 *  - counts are log facts, never inferences: distinct summary ids, prune records, end ids with an
 *    error, and only *stated* shadow prices;
 *  - a shape we cannot trust is `unavailable` with a named reason, never `0` — a future host event type
 *    must not make every count quietly understate;
 *  - the shim, not the core, is where the host shape is known: the core tests never build a dsh event;
 *  - the receipt carries the line even when the route or the meter is what is broken, because that is
 *    the receipt a user opens while handoff is not firing.
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { compactionStatusLine, foldCompactions } from "../lib/project-handoff/compaction.js";
import { readCompactionFeed } from "../lib/project-handoff/compaction-events.js";
import { statusText } from "../lib/project-handoff/command.js";
import { resolvePluginConfig } from "../lib/shared/config.js";
import { portsOf } from "./host-ports.mjs";

const feed = (...records) => ({ kind: "records", records });
const line = (records, language = "en") => compactionStatusLine(feed(...records), language);
const SUMMARY = (id, tokens, extra = {}) => ({ kind: "summary", id, ...(tokens === undefined ? {} : { shadowedTokens: tokens }), ...extra });
const END = (id, error) => ({ kind: "end", id, ...(error === undefined ? {} : { error }) });

// --- core: the fold and the line -------------------------------------------------------------

test("an empty log is zero compactions, not unavailable", () => {
	assert.deepEqual(foldCompactions([]), { summarized: 0, pruned: 0, failed: 0, reclaimedTokens: 0 });
	assert.equal(line([]), "compactions 0 (no compaction recorded)");
	assert.match(line([], "zh"), /压缩 0 次/);
});

test("one completed compaction counts its id, its shadow price and the route that wrote it", () => {
	assert.equal(
		line([{ kind: "start" }, SUMMARY("c1", 12_000, { provider: "test-provider", model: "test-model" }), END("c1")]),
		"compactions 1 (summarized 1, pruned 0), last shadowed 12000 tokens, test-provider/test-model",
	);
});

test("a replayed record is the same compaction, not a second one", () => {
	const stats = foldCompactions([SUMMARY("c1", 100), END("c1"), SUMMARY("c1", 100), END("c1")]);
	assert.equal(stats.summarized, 1);
	assert.equal(stats.reclaimedTokens, 100, "the shadow price is not added twice");
});

test("prunes are counted separately, because a prune is not a transaction", () => {
	const stats = foldCompactions([SUMMARY("c1", 1_000), END("c1"), { kind: "prune", shadowedTokens: 500 }, { kind: "prune", shadowedTokens: 250 }]);
	assert.equal(stats.summarized, 1);
	assert.equal(stats.pruned, 2);
	assert.equal(stats.reclaimedTokens, 1_750, "every stated amount adds up");
	assert.equal(stats.lastSuccess.shadowedTokens, 250, "the last replacement in log order");
	assert.match(line([SUMMARY("c1", 1_000), END("c1"), { kind: "prune", shadowedTokens: 500 }, { kind: "prune", shadowedTokens: 250 }]), /^compactions 3 \(summarized 1, pruned 2\), last shadowed 250 tokens$/);
});

test("a failed attempt is reported by name and never counted as a compaction", () => {
	assert.equal(
		line([{ kind: "start" }, END("c1", "summarize failed: 503 upstream\n  at provider")]),
		"compactions 0 (no successful compaction), failed 1: summarize failed: 503 upstream at provider",
		"the error is folded to one line so the receipt stays one line",
	);
});

test("a long failure is clipped instead of wrapping the receipt", () => {
	const stats = foldCompactions([END("c1", "x".repeat(400))]);
	assert.equal(stats.lastError.length, 120);
	assert.ok(stats.lastError.endsWith("…"));
	assert.match(line([END("c1", "x".repeat(400))]), /^compactions 0 \(no successful compaction\), failed 1: x+…$/);
});

test("a whitespace-only error states no cause and is not reported by name", () => {
	assert.deepEqual(foldCompactions([END("c1", " \n\t ")]), { summarized: 0, pruned: 0, failed: 0, reclaimedTokens: 0 });
});

test("missing optional fields drop only those fields", () => {
	const stats = foldCompactions([SUMMARY("c1")]);
	assert.deepEqual(stats.lastSuccess, {});
	assert.equal(stats.reclaimedTokens, 0, "a missing amount contributes nothing and is not read as 0");
	assert.equal(line([SUMMARY("c1")]), "compactions 1 (summarized 1, pruned 0)", "no shadow price and no route to claim");
});

test("an unavailable feed is a named gap, never zero", () => {
	assert.equal(compactionStatusLine({ kind: "unavailable", reason: "unreadable" }, "en"), "compactions unavailable (session log unreadable)");
	assert.equal(compactionStatusLine({ kind: "unavailable", reason: "malformed" }, "zh"), "压缩记录不可用（存在无法识别的压缩事件）");
});

// --- shim: the dsh event shapes ---------------------------------------------------------------

/** Unrelated events must never contribute, and must never make the shim refuse. */
const NOISE = [
	{ type: "turn/start", data: { turn: 1 } },
	{ type: "user/message", data: { content: [{ type: "text", text: "go" }] } },
	{ type: "session/title", data: { title: "a title" } },
];

test("the shim reads the four dsh records and ignores everything else", () => {
	const read = readCompactionFeed([
		...NOISE,
		{ type: "compaction/start", data: { compactionId: "c1", turn: 2 } },
		{ type: "compaction/summary", data: { compactionId: "c1", summary: [{ type: "text", text: "…" }], shadowedRange: { start: 1, end: 9 }, shadowedSeqs: [1, 2], shadowedTokenCount: 12_000, provider: "test-provider", model: "test-model" } },
		{ type: "compaction/end", data: { compactionId: "c1", turn: 2 } },
		{ type: "compaction/prune", data: { shadowedRange: { start: 3, end: 3 }, shadowedSeqs: [3], shadowedTokenCount: 750 } },
		{ type: "compaction/end", data: { compactionId: "c2", turn: 3, error: "boom" } },
	]);
	assert.equal(read.kind, "records");
	assert.deepEqual(read.records, [
		{ kind: "start" },
		{ kind: "summary", id: "c1", shadowedTokens: 12_000, provider: "test-provider", model: "test-model" },
		{ kind: "end", id: "c1" },
		{ kind: "prune", shadowedTokens: 750 },
		{ kind: "end", id: "c2", error: "boom" },
	]);
});

test("the shim refuses shapes it cannot trust instead of dropping them", () => {
	assert.deepEqual(readCompactionFeed(undefined), { kind: "unavailable", reason: "unreadable" });
	assert.deepEqual(readCompactionFeed("nope"), { kind: "unavailable", reason: "unreadable" });
	assert.deepEqual(
		readCompactionFeed([{ type: "compaction/summary", data: {} }]),
		{ kind: "unavailable", reason: "malformed" },
		"no transaction id, so a replayed record and a second one cannot be told apart",
	);
	assert.deepEqual(readCompactionFeed([{ type: "compaction/end", data: {} }]), { kind: "unavailable", reason: "malformed" });
	assert.deepEqual(readCompactionFeed([{ type: "compaction/summary" }]), { kind: "unavailable", reason: "malformed" }, "no payload at all");
	assert.deepEqual(
		readCompactionFeed([{ type: "compaction/rollback", data: {} }]),
		{ kind: "unavailable", reason: "malformed" },
		"a future host event type must not silently undercount",
	);
});

test("the shim keeps an end without an error as a success record", () => {
	assert.deepEqual(readCompactionFeed([{ type: "compaction/end", data: { compactionId: "c1", turn: 2 } }]), { kind: "records", records: [{ kind: "end", id: "c1" }] });
});

test("the shim drops a missing shadow price rather than inventing one", () => {
	assert.deepEqual(
		readCompactionFeed([{ type: "compaction/prune", data: { shadowedRange: { start: 1, end: 1 }, shadowedSeqs: [1] } }]),
		{ kind: "records", records: [{ kind: "prune" }] },
	);
	assert.deepEqual(
		readCompactionFeed([{ type: "compaction/summary", data: { compactionId: "c1", shadowedTokenCount: "12000" } }]),
		{ kind: "records", records: [{ kind: "summary", id: "c1" }] },
		"a string is not a count",
	);
});

// --- wiring: the receipt carries the line ----------------------------------------------------

const WINDOW = 1_000_000;

const dshEvents = [
	{ type: "compaction/summary", data: { compactionId: "c1", summary: [], shadowedRange: { start: 1, end: 9 }, shadowedSeqs: [1], shadowedTokenCount: 8_000, provider: "test-provider", model: "test-model" } },
	{ type: "compaction/end", data: { compactionId: "c1", turn: 2 } },
	{ type: "compaction/summary", data: { compactionId: "c2", summary: [], shadowedRange: { start: 10, end: 19 }, shadowedSeqs: [10], shadowedTokenCount: 4_000, provider: "test-provider", model: "test-model" } },
	{ type: "compaction/end", data: { compactionId: "c2", turn: 5 } },
];

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
	const session = fakeSession("session-compaction-receipt-1", dshEvents);
	const config = resolvePluginConfig({ provider: "test-provider", model: "test-model", handoffLang: "en", handoffBudgetRecentTokens: 0 });
	const receipt = await statusText(portsOf(pluginContext({ occupancy: 900_000 })), session, config, signal);
	const parts = receipt.split(" · ");
	const context = parts.findIndex((part) => part.startsWith("context "));
	const compactions = parts.findIndex((part) => part.startsWith("compactions "));
	assert.ok(compactions > context, "the line follows the occupancy lines it is read with");
	assert.match(parts[compactions], /^compactions 2 \(summarized 2, pruned 0\), last shadowed 4000 tokens, test-provider\/test-model$/);
});

test("the line still renders when there is no route or meter to measure — that is the receipt that matters", async () => {
	const signal = new AbortController().signal;
	const session = fakeSession("session-compaction-receipt-2", [{ type: "compaction/prune", data: { shadowedRange: { start: 3, end: 3 }, shadowedSeqs: [3], shadowedTokenCount: 750 } }]);
	const config = resolvePluginConfig({ handoffLang: "en", handoffBudgetRecentTokens: 0 });
	const receipt = await statusText(portsOf(pluginContext({ occupancy: 0, meter: false })), session, config, signal);
	assert.ok(!receipt.includes("context "), "the fixture must not have a context line");
	assert.match(receipt, /compactions 1 \(summarized 0, pruned 1\), last shadowed 750 tokens/);
});
