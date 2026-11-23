/**
 * Batch AA3: the session-log state machine, derived.
 *
 * The core had one implicit state — "the directory exists" — and the four failures an index can have
 * (Missing / Orphan / Stale / Unbaselined, from the AOCI survey) were not checkable because nothing read
 * both sides at once. Every case here pins one failure with its repair in the detail, plus the two healthy
 * states, because a report that cannot say "clean" cannot be trusted when it says "broken".
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { apply as applyContext } from "../lib/project-context/index.js";
import { resolvePluginConfig } from "../lib/shared/config.js";
import { SETTLED_DAYS, sessionStates, sessionStatusReceipt } from "../lib/project-context/session-state.js";
import { measureSessionStates } from "../lib/project-context/session-state-source.js";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-21T00:00:00Z");
const RECENT = NOW - 2 * DAY;
const OLD = NOW - (SETTLED_DAYS + 1) * DAY;

/** A row and the meta that agree, which every healthy fixture starts from. */
const AGREEING = { date: "2026-11-20", title: "a session" };

/** The full input: one fixture per state. */
function fixture() {
	return {
		dirs: new Map([
			["live1", { activityMs: RECENT, meta: { ...AGREEING } }],
			["settled1", { activityMs: OLD, meta: { date: "2026-10-01", title: "a session" } }],
			["stale1", { activityMs: RECENT, meta: { date: "2026-11-19", title: "a different title" } }],
			["nometa", { activityMs: RECENT, meta: undefined }],
			["child", { activityMs: RECENT, meta: { ...AGREEING, parentId: "gone-away" } }],
			["orphan1", { activityMs: RECENT, meta: { ...AGREEING } }],
		]),
		rows: new Map([
			["live1", { ...AGREEING }],
			["settled1", { date: "2026-10-01", title: "a session" }],
			["stale1", { ...AGREEING }],
			["nometa", { ...AGREEING }],
			["child", { ...AGREEING }],
			["missing1", { date: "2026-11-01", title: "the index remembers me" }],
		]),
		indexPresent: true,
		now: NOW,
		settledDays: SETTLED_DAYS,
	};
}

test("every failure the index can have is named, from both sides at once", () => {
	const report = sessionStates(fixture());
	const byId = new Map(report.verdicts.map((verdict) => [verdict.id, verdict]));
	assert.equal(byId.get("missing1").state, "missing", "a row with no directory");
	assert.match(byId.get("missing1").detail, /names missing1|is not on disk/);
	assert.equal(byId.get("orphan1").state, "orphan", "a directory with no row");
	assert.equal(byId.get("nometa").state, "unbaselined", "a directory with no meta.json");
	assert.equal(byId.get("stale1").state, "stale", "the row disagrees with meta.json");
	assert.match(byId.get("stale1").detail, /a different title/, "the detail names the disagreement, not the category");
	assert.equal(byId.get("child").state, "dangling", "it continues a session that is gone");
	assert.match(byId.get("child").detail, /gone-away/);
	assert.equal(byId.get("live1").state, "live");
	assert.equal(byId.get("settled1").state, "settled");
	assert.deepEqual(report.counts, { missing: 1, orphan: 1, unbaselined: 1, stale: 1, abandoned: 0, dangling: 1, live: 1, settled: 1 });
});

test("a handoff continuation nobody wrote in is abandoned, and an unmeasured one never is", () => {
	const settled = NOW - (SETTLED_DAYS + 1) * DAY;
	const base = {
		rows: new Map([["kid", { ...AGREEING }], ["kid2", { ...AGREEING }]]),
		indexPresent: true,
		now: NOW,
		settledDays: SETTLED_DAYS,
	};
	const measured = sessionStates({
		...base,
		dirs: new Map([
			["kid", { activityMs: settled, meta: { ...AGREEING, parentId: "parent", kind: "handoff" }, humanTurns: 0 }],
			// The same shape with no human-turn measurement: absence of a measurement is not a verdict.
			// A handoff child with no parent reference, so `dangling` cannot mask the abandoned check.
			["kid2", { activityMs: settled, meta: { ...AGREEING, kind: "handoff" } }],
		]),
	});
	const byId = new Map(measured.verdicts.map((verdict) => [verdict.id, verdict]));
	assert.equal(byId.get("kid").state, "abandoned");
	assert.match(byId.get("kid").detail, /no human turn/);
	assert.equal(byId.get("kid2").state, "settled", "never read means never called abandoned");

	// A child that got a human turn is a used continuation, not an abandoned one.
	const used = sessionStates({ ...base, dirs: new Map([["kid", { activityMs: settled, meta: { ...AGREEING, kind: "handoff" }, humanTurns: 1 }]]) });
	assert.equal(new Map(used.verdicts.map((verdict) => [verdict.id, verdict.state])).get("kid"), "settled");
});

test("the live/settled boundary is the documented number of days, not a feeling", () => {
	const exactly = NOW - SETTLED_DAYS * DAY;
	const report = sessionStates({
		dirs: new Map([["edge", { activityMs: exactly, meta: { ...AGREEING } }]]),
		rows: new Map([["edge", { ...AGREEING }]]),
		indexPresent: true,
		now: NOW,
		settledDays: SETTLED_DAYS,
	});
	assert.equal(report.verdicts[0].state, "live", "exactly at the boundary is still inside it");
});

test("an absent index is reported, never turned into a wall of orphans", () => {
	// No INDEX file means no rows at all: the two sides cannot disagree when only one was read.
	const report = sessionStates({ dirs: fixture().dirs, rows: new Map(), indexPresent: false, now: NOW, settledDays: SETTLED_DAYS });
	assert.equal(report.counts.orphan, 0, "nothing was compared, so nothing is called orphaned");
	assert.equal(report.counts.unbaselined, report.verdicts.length, "every directory is named as unchecked");
	const receipt = sessionStatusReceipt(report);
	assert.match(receipt, /INDEX\.md is absent/);
});

test("the receipt puts the counts on line one and names the worst states first", () => {
	const report = sessionStates(fixture());
	const receipt = sessionStatusReceipt(report);
	const [first, second] = receipt.split("\n");
	assert.match(first, /^Session log: 7 session\(s\) — 5 needing a repair\.$/, `the payload must survive the collapsed card, got ${first}`);
	assert.match(second, /^2 healthy \(1 live, 1 settled\)\.$/, "the split is the part a reader acts on: what is still moving");
	const order = receipt.split("\n").filter((line) => line.startsWith("  ")).map((line) => line.trim().split(" — ")[0]);
	assert.deepEqual(order.slice(0, 3), ["missing", "orphan", "unbaselined"], "worst first, in the declared order");
});

test("a clean archive says so instead of printing an empty list", () => {
	const report = sessionStates({
		dirs: new Map([["one", { activityMs: RECENT, meta: { ...AGREEING } }]]),
		rows: new Map([["one", { ...AGREEING }]]),
		indexPresent: true,
		now: NOW,
		settledDays: SETTLED_DAYS,
	});
	const receipt = sessionStatusReceipt(report);
	assert.match(receipt, /Nothing to repair/);
});

test("a handoff continuation with no log at all is abandoned, and does not fail the command", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "dsh-session-nolog-"));
	const logs = path.join(root, ".agents", "memory", "session-logs");
	await mkdir(path.join(logs, "empty-kid"), { recursive: true });
	await writeFile(path.join(logs, "empty-kid", "meta.json"), JSON.stringify({ id: "empty-kid", date: "2026-11-01", title: "kid", kind: "handoff" }), "utf8");
	await writeFile(path.join(logs, "INDEX.md"), "# Session Index\n\n- [empty-kid](empty-kid/session.jsonl) — 2026-11-01 — kid\n", "utf8");
	// The clock has to sit past the settled horizon, and the directory is the only artifact to date it.
	const report = await measureSessionStates(root, Date.now() + 30 * DAY);
	assert.equal(report.counts.abandoned, 1, "no log means no human turn: the strongest case, not a crash");
});

test("the I/O half reads both sides of a real archive", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "dsh-session-state-"));
	const logs = path.join(root, ".agents", "memory", "session-logs");
	await mkdir(path.join(logs, "kept"), { recursive: true });
	await writeFile(path.join(logs, "kept", "meta.json"), JSON.stringify({ id: "kept", date: "2026-11-20", title: "kept session" }), "utf8");
	await writeFile(path.join(logs, "kept", "session.jsonl"), "{}\n", "utf8");
	// A directory the index never mentions.
	await mkdir(path.join(logs, "stray"), { recursive: true });
	await writeFile(path.join(logs, "stray", "meta.json"), JSON.stringify({ id: "stray", date: "2026-11-20", title: "stray" }), "utf8");
	await writeFile(path.join(logs, "stray", "session.jsonl"), "{}\n", "utf8");
	// A row whose directory is gone.
	await writeFile(
		path.join(logs, "INDEX.md"),
		["# Session Index", "", "- [kept](kept/session.jsonl) — 2026-11-20 — kept session", "- [gone](gone/session.jsonl) — 2026-11-01 — removed one", ""].join("\n"),
		"utf8",
	);

	// The files were just written, so the clock has to sit past the settled horizon for the fixture to
	// exercise that branch; a clock before the mtime would make every directory look live.
	const report = await measureSessionStates(root, Date.now() + 10 * DAY);
	const byId = new Map(report.verdicts.map((verdict) => [verdict.id, verdict.state]));
	assert.equal(byId.get("kept"), "settled", "the fixture files are old relative to the injected clock");
	assert.equal(byId.get("stray"), "orphan");
	assert.equal(byId.get("gone"), "missing");
});

test("the command judges with the configured day boundary", async () => {
	// The wiring, not the helper: the card's number has to reach the command's verdict. The fixture's
	// files are backdated ten days, so 7 settles it and 30 leaves it live.
	const root = await mkdtemp(path.join(tmpdir(), "dsh-session-days-"));
	const logs = path.join(root, ".agents", "memory", "session-logs");
	await mkdir(path.join(logs, "kept"), { recursive: true });
	await writeFile(path.join(logs, "kept", "meta.json"), JSON.stringify({ id: "kept", date: "2026-11-10", title: "kept session" }), "utf8");
	await writeFile(path.join(logs, "kept", "session.jsonl"), "{}\n", "utf8");
	await writeFile(path.join(logs, "INDEX.md"), "# Session Index\n\n- [kept](kept/session.jsonl) — 2026-11-10 — kept session\n", "utf8");
	const tenDaysAgo = Math.floor(Date.now() / 1000) - 10 * 86_400;
	for (const name of ["meta.json", "session.jsonl"]) {
		const file = path.join(logs, "kept", name);
		const stats = await stat(file);
		await utimes(file, tenDaysAgo, tenDaysAgo);
	}
	await utimes(path.join(logs, "kept"), tenDaysAgo, tenDaysAgo);

	const receiptFor = async (sessionSettledDays) => {
		let handler;
		applyContext(
			{
				get: () => undefined,
				logger: { info() {}, warn() {} },
				effect: (callback) => callback(),
				on: () => () => undefined,
				commands: { register: (registration) => { if (registration.name === "session-log") handler = registration.handler; } },
			},
			resolvePluginConfig({ provider: "test-provider", model: "test-model", sessionSettledDays }),
		);
		return handler({ agent: { session: { header: { cwd: root, id: "session-current" } } }, rawInput: "status" });
	};
	const short = await receiptFor(7);
	assert.match(short.text, /0 live, 1 settled/, "10 days is past a 7-day boundary");
	const wide = await receiptFor(30);
	assert.match(wide.text, /1 live, 0 settled/, "and inside a 30-day one");
});

test("the registered /session-log command routes 'status' to the state report", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "dsh-session-status-"));
	const logs = path.join(root, ".agents", "memory", "session-logs");
	await mkdir(path.join(logs, "kept"), { recursive: true });
	await writeFile(path.join(logs, "kept", "meta.json"), JSON.stringify({ id: "kept", date: "2026-11-20", title: "kept session" }), "utf8");
	await writeFile(path.join(logs, "kept", "session.jsonl"), "{}\n", "utf8");
	await writeFile(path.join(logs, "INDEX.md"), "# Session Index\n\n- [kept](kept/session.jsonl) — 2026-11-20 — kept session\n", "utf8");

	let handler;
	applyContext(
		{
			get: () => undefined,
			logger: { info() {}, warn() {} },
			effect: (callback) => callback(),
			on: () => () => undefined,
			commands: { register: (registration) => { if (registration.name === "session-log") handler = registration.handler; } },
		},
		resolvePluginConfig({ provider: "test-provider", model: "test-model" }),
	);
	assert.equal(typeof handler, "function", "control: the plugin registered the session-log command");

	const agent = { session: { header: { cwd: root, id: "session-current" } } };
	const receipt = await handler({ agent, rawInput: "status" });
	assert.equal(receipt.kind, "success", receipt.text);
	assert.match(receipt.text, /^Session log: 1 session\(s\)/);
	assert.match(receipt.text, /Nothing to repair/);
});

test("the settled and abandoned boundaries follow the configured days", () => {
	// One number, two verdicts: with the default 7 a ten-day-old session is settled and its unread
	// handoff continuation is abandoned; with 30 both are still live. A hard-coded 7 would print the
	// same answer for both settings.
	const tenDays = NOW - 10 * DAY;
	const input = (settledDays) => ({
		dirs: new Map([
			["plain", { activityMs: tenDays, meta: { ...AGREEING } }],
			["kid", { activityMs: tenDays, meta: { ...AGREEING, kind: "handoff" }, humanTurns: 0 }],
		]),
		rows: new Map([["plain", { ...AGREEING }], ["kid", { ...AGREEING }]]),
		indexPresent: true,
		now: NOW,
		settledDays,
	});
	const byId = (settledDays) => new Map(sessionStates(input(settledDays)).verdicts.map((verdict) => [verdict.id, verdict.state]));
	assert.equal(byId(SETTLED_DAYS).get("plain"), "settled");
	assert.equal(byId(SETTLED_DAYS).get("kid"), "abandoned");
	assert.equal(byId(30).get("plain"), "live", "a wider boundary keeps a ten-day-old session live");
	assert.equal(byId(30).get("kid"), "live", "and the same continuation is not called abandoned either");
});
