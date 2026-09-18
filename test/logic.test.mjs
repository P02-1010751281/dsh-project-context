/**
 * Unit tests for the pure plugin logic: threshold math, ratio/token parsing,
 * conversation splitting, CONTEXT.md rendering, the mechanical session index,
 * the consolidation/autolearn parsers, the handoff watcher, config validation,
 * the atomic writers and the session-log append path. Run `pnpm test`, which
 * builds `lib/` first and then runs `node --test test/*.test.mjs`.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	apply,
	continuation,
	createChildSession,
	HandoffDeferred,
	parseRatio,
	maybeAutoHandoff,
	parseTokenCount,
	pendingQuestion,
	resolveThreshold,
	runManual,
	setPressureCheckIntervalMs,
	settingPatch,
	statusText,
	textAsksQuestion,
	turnStartedAfter,
} from "../lib/handoff.js";
import { DEFAULT_CONFIG, resolvePluginConfig } from "../lib/shared/config.js";
import { renderContextDocument } from "../lib/shared/context-doc.js";
import {
	adaptiveOutputTokens,
	clip,
	clipText,
	conversationText,
	fallbackUpdate,
	fitMemoryInput,
	parseConsolidation,
	replyHead,
	replyTokenRate,
	textOf,
	truncateMiddle,
} from "../lib/shared/learn.js";
import { approveCandidate, listCandidates, parseAutolearn, rejectCandidate } from "../lib/shared/autolearn.js";
import { HANDOFF_TITLE_PREFIX, handoffSwitchDeferred, planHandoffWatch } from "../lib/shared/handoff-marker.js";
import { watchHandoffSwitch } from "../lib/shared/handoff-watch.js";
import { archivedConversationText, readArchivedConversation } from "../lib/shared/archive.js";
import { parseSessionIndex, queueIndexLine, queueSessionIndexEntry, sessionIndexLine } from "../lib/shared/session-index.js";
import {
	diagnosticMessage,
	invalidateTextCache,
	logError,
	migrateProjectState,
	readTextCachedSync,
	redactSecrets,
	safeSessionId,
	validSkillName,
	writeAtomic,
} from "../lib/shared/project-state.js";
import { releaseSessionQueue, writeSessionArtifacts } from "../lib/shared/session-log.js";
import { installProjectContextSettings } from "../lib/shared/settings.js";
import { contextUpdateReply } from "../lib/memory.js";

function message(role, text) {
	return { role, source: { kind: role }, content: [{ type: "text", text }] };
}

function fakeSession(messages) {
	return { deriveMessages: () => messages };
}

test("fixed threshold is a window share, clamped below the safety margin", () => {
	const config = { ...DEFAULT_CONFIG, handoffAdaptive: false };
	assert.equal(resolveThreshold(config, { totalTokens: 0, surfaceTokens: 0 }, 100_000)?.tokens, 40_000);
	assert.equal(resolveThreshold(config, { totalTokens: 0, surfaceTokens: 0 }, 8_000)?.tokens, 3_200);
});

test("adaptive threshold reserves room for the summary and the carried tail", () => {
	const config = { ...DEFAULT_CONFIG, handoffKeepTokens: 1_000, handoffTargetTokens: 8_000 };
	const threshold = resolveThreshold(config, { totalTokens: 20_000, surfaceTokens: 18_000 }, 32_000);
	assert.ok(threshold);
	assert.equal(threshold.tokens, 11_000);
	assert.match(threshold.label, /^auto /);

	// Window headroom below the reserve cannot fit a pass.
	assert.equal(resolveThreshold(config, { totalTokens: 5_000, surfaceTokens: 1_000 }, 16_000), undefined);
});

test("parseRatio accepts only the range the settings schema persists", () => {
	assert.equal(parseRatio("0.4"), 0.4);
	assert.equal(parseRatio("40%"), 0.4);
	assert.equal(parseRatio("40"), 0.4);
	assert.equal(parseRatio("0.1"), 0.1);
	assert.equal(parseRatio("0.95"), 0.95);
	assert.equal(parseRatio("0.08"), undefined);
	assert.equal(parseRatio("0.96"), undefined);
	assert.equal(parseRatio("nope"), undefined);
});

test("parseTokenCount parses plain and k-suffixed counts", () => {
	assert.equal(parseTokenCount("12000"), 12_000);
	assert.equal(parseTokenCount("12k"), 12_000);
	assert.equal(parseTokenCount("1.5k"), 1_500);
	assert.equal(parseTokenCount("0"), 0);
	assert.equal(parseTokenCount("-5"), undefined);
	assert.equal(parseTokenCount("abc"), undefined);
});

const INDEX_SESSION = { id: "session-abcdef", header: { createdAt: Date.UTC(2026, 8, 12) } };

test("renderContextDocument keeps the summary and sheds list items past the budget", () => {
	const update = {
		title: "audit",
		summary: "s".repeat(6_000),
		key_points: Array.from({ length: 200 }, () => "p".repeat(800)),
		open_tasks: Array.from({ length: 200 }, () => "t".repeat(800)),
	};
	const document = renderContextDocument(update, { updatedAt: new Date(Date.UTC(2026, 8, 12)).toISOString() });
	assert.ok(document.length <= 32_000, `document is ${document.length} chars`);
	// 400 items of 800 chars would be far past the budget, so both lists must have
	// been shed; the summary is capped separately and must survive.
	const items = (document.match(/^- /gm) ?? []).length;
	assert.ok(items > 0 && items < 400, `list items were shed to fit the budget (${items})`);
	assert.ok(document.includes("s".repeat(1_000)), "the capped summary survives the shedding");
	assert.ok(document.includes("<!-- latest-session-title: audit -->"));
});

test("renderContextDocument preserves short lists verbatim", () => {
	const update = { title: "small", summary: "summary", key_points: ["k1", "k2"], open_tasks: ["o1"] };
	const document = renderContextDocument(update, { updatedAt: new Date().toISOString() });
	assert.match(document, /- k1/);
	assert.match(document, /- k2/);
	assert.match(document, /- o1/);
	assert.ok(document.length < 32_000);
});

test("a legacy session-index.md is adopted once and its links are normalized", async () => {
	const project = await mkdtemp(path.join(tmpdir(), "dsh-index-legacy-"));
	const memory = path.join(project, ".agents", "memory");
	await mkdir(memory, { recursive: true });
	await writeFile(
		path.join(memory, "session-index.md"),
		"# Session Index\n\n- [11111111-2222-3333-4444-555555555555](session-logs/11111111-2222-3333-4444-555555555555/session.md) — 2026-09-12 — old session\n",
		"utf8",
	);

	await queueIndexLine(project, "session-new", "- [session-new](session-new/session.md) — 2026-09-14 — new session");

	const index = await readFile(path.join(memory, "session-logs", "INDEX.md"), "utf8");
	assert.match(index, /\]\(11111111-2222-3333-4444-555555555555\/session\.md\)/, "the pre-move link is converted");
	assert.doesNotMatch(index, /session-logs\/11111111/);
	assert.match(index, /- \[session-new\]\(session-new\/session\.md\) — 2026-09-14 — new session/);
	assert.equal(existsSync(path.join(memory, "session-index.md")), false, "the adopted legacy file is removed");
});

test("adoption never removes the legacy index before the new one exists", async () => {
	const project = await mkdtemp(path.join(tmpdir(), "dsh-index-adopt-"));
	const memory = path.join(project, ".agents", "memory");
	await mkdir(memory, { recursive: true });
	// Already in the current form: re-queueing the same line produces a byte-identical document,
	// so a "write only when it changed" rule would leave nothing behind after the legacy file goes.
	const canonical = "# Session Index\n\n- [abc](abc/session.md) — 2026-09-12 — t\n";
	await writeFile(path.join(memory, "session-index.md"), canonical, "utf8");

	await queueIndexLine(project, "abc", "- [abc](abc/session.md) — 2026-09-12 — t");

	const index = path.join(memory, "session-logs", "INDEX.md");
	assert.ok(existsSync(index), "the new index exists even when the legacy bytes already match");
	assert.equal(await readFile(index, "utf8"), canonical);
	assert.equal(existsSync(path.join(memory, "session-index.md")), false, "the source is removed only after the write");
});

test("a legacy index that appears after the new one exists is still adopted", async () => {
	// Two hosts can straddle the `<memory>/` → `<memory>/session-logs/` move: an updated build
	// writes the new index while an older one keeps appending to the legacy file. Adoption ran only
	// while the new index was still empty, so those entries were stranded — archived on disk,
	// missing from the one list autolearn navigates by.
	const project = await mkdtemp(path.join(tmpdir(), "dsh-index-late-legacy-"));
	const memory = path.join(project, ".agents", "memory");
	const logs = path.join(memory, "session-logs");
	await mkdir(logs, { recursive: true });
	await writeFile(
		path.join(logs, "INDEX.md"),
		[
			"# Session Index",
			"",
			"- [11111111-2222-3333-4444-555555555555](11111111-2222-3333-4444-555555555555/session.md) — 2026-09-12 — current title",
			"- [session-keep](session-keep/session.md) — 2026-09-14 — kept",
			"",
		].join("\n"),
		"utf8",
	);
	await writeFile(
		path.join(memory, "session-index.md"),
		[
			"# Session Index",
			"",
			"- [11111111-2222-3333-4444-555555555555](session-logs/11111111-2222-3333-4444-555555555555/session.md) — 2026-09-12 — stale title",
			"- [99999999-8888-7777-6666-555555555555](session-logs/99999999-8888-7777-6666-555555555555/session.md) — 2026-09-13 — late arrival",
			"",
		].join("\n"),
		"utf8",
	);

	await queueIndexLine(project, "session-keep", "- [session-keep](session-keep/session.md) — 2026-09-14 — kept");

	const index = await readFile(path.join(logs, "INDEX.md"), "utf8");
	assert.match(
		index,
		/- \[99999999-8888-7777-6666-555555555555\]\(99999999-8888-7777-6666-555555555555\/session\.md\) — 2026-09-13 — late arrival/,
		"the late legacy entry is adopted and its link normalized",
	);
	assert.equal(
		index.split("\n").filter((current) => current.includes("11111111-2222-3333-4444-555555555555")).length,
		1,
		"a session the new index already lists is not duplicated",
	);
	assert.match(index, /— current title/, "the current index's line wins over the stale legacy one");
	assert.doesNotMatch(index, /stale title/);
	assert.doesNotMatch(index, /session-logs\/99999999/);
	assert.equal(existsSync(path.join(memory, "session-index.md")), false, "the adopted legacy file is removed");
});

test("an adopted legacy entry newer than the current lines lands at the newest end", async () => {
	// A straddling legacy file holds what an older host archived after the move, so its lines can be
	// the NEWEST ones. Ordering the merge by source instead of by date would put them at the head,
	// where a reader taking the newest lines — autolearn, via `slice(-MAX_INDEX_ENTRIES)` — never looks.
	const project = await mkdtemp(path.join(tmpdir(), "dsh-index-late-newest-"));
	const memory = path.join(project, ".agents", "memory");
	const logs = path.join(memory, "session-logs");
	await mkdir(logs, { recursive: true });
	await writeFile(
		path.join(logs, "INDEX.md"),
		[
			"# Session Index",
			"",
			"- [session-a](session-a/session.md) — 2026-09-01 — a",
			"- [session-b](session-b/session.md) — 2026-09-02 — b",
			"",
		].join("\n"),
		"utf8",
	);
	await writeFile(path.join(memory, "session-index.md"), "# Session Index\n\n- [session-z](session-logs/session-z/session.md) — 2026-09-18 — z\n", "utf8");

	await queueIndexLine(project, "session-a", "- [session-a](session-a/session.md) — 2026-09-01 — a");

	const ids = (await readFile(path.join(logs, "INDEX.md"), "utf8"))
		.split("\n")
		.filter((line) => line.startsWith("- ["))
		.map((line) => /^- \[([^\]]+)\]/.exec(line)[1]);
	assert.deepEqual(ids, ["session-a", "session-b", "session-z"], "the adopted line takes its date position, not the head");
	assert.equal(existsSync(path.join(memory, "session-index.md")), false, "the adopted legacy file is removed");
});

test("the cap never deletes a legacy entry it could not keep", async () => {
	// MAX_INDEX_LINES drops the oldest lines. A legacy entry too old to survive that cap has no other
	// copy, so the file must stay on disk; once an entry does survive, its source is released. Deleting
	// the file in the first case would destroy the line outright.
	const project = await mkdtemp(path.join(tmpdir(), "dsh-index-cap-"));
	const memory = path.join(project, ".agents", "memory");
	const logs = path.join(memory, "session-logs");
	const legacy = path.join(memory, "session-index.md");
	await mkdir(logs, { recursive: true });
	const current = Array.from({ length: 200 }, (_, index) => `- [session-${index}](session-${index}/session.md) — 2026-09-20 — t${index}`);
	await writeFile(path.join(logs, "INDEX.md"), ["# Session Index", "", ...current, ""].join("\n"), "utf8");

	// Older than every current line: 201 entries against a 200-line cap, so this one drops off.
	await writeFile(legacy, "# Session Index\n\n- [session-old](session-logs/session-old/session.md) — 2026-09-01 — ancient\n", "utf8");
	await queueIndexLine(project, "session-199", current[199]);
	let index = await readFile(path.join(logs, "INDEX.md"), "utf8");
	assert.ok(!index.includes("[session-old]"), "the oldest line is the one the cap drops");
	assert.equal(index.split("\n").filter((line) => line.startsWith("- [")).length, 200);
	assert.ok(existsSync(legacy), "the only copy of a dropped legacy entry is not deleted");

	// Newer than every current line: it survives the cap, so the adopted source can go.
	await writeFile(legacy, "# Session Index\n\n- [session-new](session-logs/session-new/session.md) — 2026-09-21 — brand new\n", "utf8");
	await queueIndexLine(project, "session-199", current[199]);
	index = await readFile(path.join(logs, "INDEX.md"), "utf8");
	assert.ok(index.includes("[session-new]"), "the newest line is kept");
	assert.equal(index.split("\n").filter((line) => line.startsWith("- [")).length, 200);
	assert.equal(existsSync(legacy), false, "an entry that survived the cap releases its source");
});

test("a legacy file holding no index line is left alone", async () => {
	// The pre-move path could hold a hand-written note. Adopting it would delete the note and index
	// nothing in its place.
	const project = await mkdtemp(path.join(tmpdir(), "dsh-index-note-"));
	const memory = path.join(project, ".agents", "memory");
	const logs = path.join(memory, "session-logs");
	await mkdir(logs, { recursive: true });
	await writeFile(path.join(logs, "INDEX.md"), "# Session Index\n\n- [session-a](session-a/session.md) — 2026-09-01 — a\n", "utf8");
	const note = "# Session Index\n\nkeep this note: hand-written, no entries\n";
	await writeFile(path.join(memory, "session-index.md"), note, "utf8");

	await queueIndexLine(project, "session-b", "- [session-b](session-b/session.md) — 2026-09-02 — b");

	assert.equal(await readFile(path.join(memory, "session-index.md"), "utf8"), note, "a file without entries is not consumed");
	const index = await readFile(path.join(logs, "INDEX.md"), "utf8");
	assert.match(index, /session-b/);
	assert.doesNotMatch(index, /keep this note/);
});

test("a FIFO at the legacy index path cannot stall the index write", { timeout: 15_000 }, async (t) => {
	// Reading a FIFO with no writer blocks forever, and because index writes are chained per project
	// every later write would queue behind this one, stalling the archive step for good.
	const project = await mkdtemp(path.join(tmpdir(), "dsh-index-fifo-"));
	const memory = path.join(project, ".agents", "memory");
	await mkdir(memory, { recursive: true });
	try {
		execFileSync("mkfifo", [path.join(memory, "session-index.md")]);
	} catch {
		t.skip("mkfifo is unavailable on this platform");
		return;
	}

	await queueIndexLine(project, "session-a", "- [session-a](session-a/session.md) — 2026-09-01 — a");

	assert.match(await readFile(path.join(memory, "session-logs", "INDEX.md"), "utf8"), /session-a/);
});

test("a directory at the legacy index path does not break the write", async () => {
	const project = await mkdtemp(path.join(tmpdir(), "dsh-index-dir-"));
	const memory = path.join(project, ".agents", "memory");
	await mkdir(path.join(memory, "session-index.md"), { recursive: true });

	await queueIndexLine(project, "session-a", "- [session-a](session-a/session.md) — 2026-09-01 — a");

	assert.match(await readFile(path.join(memory, "session-logs", "INDEX.md"), "utf8"), /session-a/);
	assert.ok(existsSync(path.join(memory, "session-index.md")), "the directory is not removed");
});

test("session index lines are mechanical and relative to the logs directory", () => {
	const line = sessionIndexLine(INDEX_SESSION, "audit");
	assert.equal(line, "- [session-abcdef](session-abcdef/session.md) — 2026-09-12 — audit");
});

test("parseSessionIndex reads new and legacy link forms", () => {
	const text = [
		"# Session Index",
		"",
		"- [session-abcdef](session-abcdef/session.md) — 2026-09-12 — audit",
		"- [session-123](session-logs/session-123/session.md) — 2026-09-11 — old layout",
		"garbage",
	].join("\n");
	const entries = parseSessionIndex(text);
	assert.equal(entries.length, 2);
	assert.deepEqual(entries[0], { id: "session-abcdef", date: "2026-09-12", title: "audit" });
	assert.equal(entries[1].id, "session-123");
});

test("queueSessionIndexEntry upserts one line per session and refreshes the title", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "dsh-index-"));
	const session = { id: "session-abcdef", header: { createdAt: Date.UTC(2026, 8, 12) }, snapshotEvents: () => [] };
	await queueSessionIndexEntry(root, session);
	await queueSessionIndexEntry(root, { ...session, id: "session-other" });
	await queueSessionIndexEntry(root, {
		...session,
		snapshotEvents: () => [{ type: "session/title", seq: 1, time: 0, data: { title: "renamed" } }],
	});
	const text = await readFile(path.join(root, ".agents", "memory", "session-logs", "INDEX.md"), "utf8");
	const entries = parseSessionIndex(text);
	assert.equal(entries.length, 2);
	assert.equal(entries.find((entry) => entry.id === "session-abcdef").title, "renamed");
	assert.ok(text.startsWith("# Session Index"));
});

test("parseConsolidation reads memory and context and never a skill", () => {
	const result = parseConsolidation(JSON.stringify({
		memory_markdown: "# Project Memory\n\nfact",
		context: { title: "t", summary: "s", key_points: ["k"], open_tasks: ["o"] },
		skill: { name: "x", description: "y", body: "z" },
	}));
	assert.match(result.memory, /fact/);
	assert.equal(result.context.summary, "s");
	assert.deepEqual(result.context.open_tasks, ["o"]);
	assert.equal("skill" in result, false);
	assert.deepEqual(parseConsolidation("plain markdown"), { memory: "plain markdown" });
});

test("parseConsolidation recovers memory from a malformed reply and fails closed otherwise", () => {
	// The reply that used to poison MEMORY.md: a stray member made JSON.parse fail and the
	// raw object was stored as memory.
	const corrupted = '{"memory_markdown":"# Project Memory\\n\\n## Project\\n- kept.","context":"# Project Context","stray\\n\\n- tail"}';
	assert.deepEqual(parseConsolidation(corrupted), { memory: "# Project Memory\n\n## Project\n- kept." });
	assert.equal(parseConsolidation('{"memory_markdown":"# Project Memory\\n\\n- cut'), undefined);
	assert.equal(parseConsolidation('{"memory_markdown": 17, "context": {'), undefined);
});

test("parseAutolearn separates a skill from a backtrack request", () => {
	const direct = parseAutolearn(JSON.stringify({ skill: { name: "n", description: "d", body: "b" }, need_sessions: [] }));
	assert.equal(direct.skill.name, "n");
	assert.deepEqual(direct.needSessions, []);

	const backlog = parseAutolearn('```json\n{"skill": null, "need_sessions": ["session-a", "", "session-b", "session-c", "session-d"]}\n```');
	assert.equal(backlog.skill, null);
	assert.deepEqual(backlog.needSessions, ["session-a", "session-b", "session-c"]);

	assert.deepEqual(parseAutolearn("not json"), { skill: null, needSessions: [] });
});

test("parseAutolearn reads evidence, candidate and reason", () => {
	const parsed = parseAutolearn(JSON.stringify({
		skill: { name: "n", description: " d ", body: " b ", evidence: ["a", "b"], candidate: true, reason: "why" },
	}));
	assert.equal(parsed.skill.name, "n");
	assert.equal(parsed.skill.description, "d");
	assert.deepEqual(parsed.skill.evidence, ["a", "b"]);
	assert.equal(parsed.skill.candidate, true);
	assert.equal(parsed.skill.reason, "why");
});

test("candidates list, approve and reject", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "dsh-candidates-"));
	try {
		await mkdir(path.join(root, ".agents/memory/skill-candidates"), { recursive: true });
		const body = `## When to use\n\n${"step ".repeat(60)}\n`;
		await writeFile(
			path.join(root, ".agents/memory/skill-candidates/beta-workflow.md"),
			`---\nname: beta-workflow\ndescription: "beta candidate"\ncandidate: true\n---\n\n<!-- evidence: sess-a -->\n\n${body}`,
		);
		assert.deepEqual(await listCandidates(root), ["beta-workflow"]);

		const approved = await approveCandidate(root, "beta-workflow");
		assert.equal(approved.ok, true);
		const live = await readFile(path.join(root, ".agents/skills/beta-workflow/SKILL.md"), "utf8");
		assert.match(live, /description: "beta candidate"/);
		assert.doesNotMatch(live, /candidate: true/);
		assert.doesNotMatch(live, /<!-- evidence/);
		assert.deepEqual(await listCandidates(root), []);

		await writeFile(
			path.join(root, ".agents/memory/skill-candidates/gamma.md"),
			`---\nname: gamma\ndescription: "gamma"\ncandidate: true\n---\n\n${body}`,
		);
		assert.equal((await rejectCandidate(root, "gamma")).ok, true);
		assert.deepEqual(await listCandidates(root), []);

		// Missing/unsafe names fail cleanly instead of throwing.
		assert.equal((await approveCandidate(root, "nope")).ok, false);
		assert.equal((await rejectCandidate(root, "bad name")).ok, false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("the session index dedupes by id and keeps the newest 200", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "dsh-index-"));
	try {
		for (let index = 0; index < 205; index += 1) {
			await queueIndexLine(root, `session-${index}`, `- [session-${index}](session-${index}/session.md) — 2026-09-01 — t${index}`);
		}
		const file = path.join(root, ".agents/memory/session-logs/INDEX.md");
		const text = await readFile(file, "utf8");
		assert.equal(text.split("\n").filter((line) => line.startsWith("- [")).length, 200);
		assert.ok(!text.includes("[session-0]"), "oldest line drops off");
		assert.ok(text.includes("[session-204]"), "newest line stays");

		// Refreshing an id replaces its line instead of appending a duplicate.
		await queueIndexLine(root, "session-100", "- [session-100](session-100/session.md) — 2026-09-02 — updated");
		const refreshed = (await readFile(file, "utf8")).split("\n").filter((line) => line.startsWith("- [session-100]"));
		assert.equal(refreshed.length, 1);
		assert.match(refreshed[0], /updated/);

		// A duplicate id left behind by a backfill collapses on the next write too.
		await writeFile(file, `${await readFile(file, "utf8")}- [session-100](session-100/session.md) — 2026-09-03 — duplicate\n`);
		await queueIndexLine(root, "session-50", "- [session-50](session-50/session.md) — 2026-09-04 — fifty");
		assert.equal((await readFile(file, "utf8")).split("\n").filter((line) => line.startsWith("- [session-100]")).length, 1);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("archivedConversationText renders dsh JSONL without stream payloads", () => {
	const lines = [
		JSON.stringify({ type: "session", harness: "dsh", id: "s1" }),
		JSON.stringify({ type: "user/message", seq: 1, time: 0, data: { source: { kind: "user" }, content: [{ type: "text", text: "build release" }] } }),
		JSON.stringify({
			type: "assistant/message",
			seq: 2,
			time: 0,
			data: {
				message: { role: "assistant", content: [{ type: "text", text: "run pnpm build" }, { type: "tool-call", name: "bash" }] },
				stream: [{ type: "chunk", chunk: { type: "text", text: "x".repeat(5_000) } }],
			},
		}),
		JSON.stringify({
			type: "tool/result",
			seq: 3,
			time: 0,
			data: {
				turn: 1,
				step: 1,
				message: {
					role: "user",
					id: "m1",
					source: { kind: "tool", callId: "c1" },
					content: [{ type: "tool-result", toolCallId: "c1", content: [{ type: "text", text: "ok" }] }],
				},
			},
		}),
	];
	const text = archivedConversationText(lines.join("\n"), 50_000);
	assert.match(text, /## user\nbuild release/);
	assert.match(text, /## assistant\nrun pnpm build\n\[tool: bash\]/);
	assert.match(text, /## tool result\nok/);
	assert.doesNotMatch(text, /x{100}/);
	assert.ok(text.length < 4_000);
});

test("the handoff continuation points at the archive and index", () => {
	const text = continuation("session-abcdef", "summary", "tail", {
		log: ".agents/memory/session-logs/session-abcdef/session.md",
		index: ".agents/memory/session-logs/INDEX.md",
	});
	assert.match(text, /session-abcdef\/session\.md/);
	assert.match(text, /session-logs\/INDEX\.md/);
	assert.match(text, /<handoff>\nsummary\n<\/handoff>/);
	assert.match(text, /<recent-conversation>/);
});

test("session ids and skill names stay filesystem-safe", () => {
	assert.equal(safeSessionId("session-../../etc"), "session-..-..-etc");
	assert.equal(safeSessionId(""), "ephemeral");
	assert.equal(validSkillName("my-skill"), true);
	assert.equal(validSkillName("../evil"), false);
});

/** A handoff context whose workspace registry is whatever the test passes. */
function handoffContext(registry) {
	const warnings = [];
	return {
		ctx: {
			get: (name) => (name === "workspaceRegistry" ? registry : undefined),
			logger: { warn: (...args) => warnings.push(args) },
		},
		warnings,
	};
}

/** A session controller that records every create request. */
function recordingController(requests) {
	return {
		create: async (request) => {
			requests.push(request);
			return { sessionId: "session-child" };
		},
	};
}

test("the handoff child is created inside the parent's workspace", async () => {
	const requests = [];
	const { ctx } = handoffContext({ resolveByPath: async (cwd) => (cwd === "/project" ? { id: "ws-1" } : undefined) });

	const childId = await createChildSession(ctx, recordingController(requests), "/project");

	assert.equal(childId, "session-child");
	assert.deepEqual(requests, [{ workspaceId: "ws-1" }], "workspaceId replaces cwd on the wire");
});

test("the handoff child falls back to the parent cwd outside any workspace", async () => {
	const requests = [];
	const { ctx } = handoffContext({ resolveByPath: async () => undefined });

	await createChildSession(ctx, recordingController(requests), "/elsewhere");

	assert.deepEqual(requests, [{ cwd: "/elsewhere" }]);
});

test("the handoff child survives a missing or failing workspace registry", async () => {
	const requests = [];
	const controller = recordingController(requests);

	await createChildSession({ get: () => undefined, logger: { warn() {} } }, controller, "/project");
	const { ctx, warnings } = handoffContext({ resolveByPath: async () => { throw new Error("lookup exploded"); } });
	await createChildSession(ctx, controller, "/project");
	await createChildSession(ctx, controller, undefined);

	assert.deepEqual(requests, [{ cwd: "/project" }, { cwd: "/project" }, {}]);
	assert.equal(warnings.length, 1, "a failing lookup warns without failing the handoff");
});

test("the handoff child keeps the parent's agent preset", async () => {
	// Without the preset the child is composed from the deployment default, so a
	// handoff from a custom-preset session would resume with different tools.
	const requests = [];
	const { ctx } = handoffContext({ resolveByPath: async () => ({ id: "ws-1" }) });

	await createChildSession(ctx, recordingController(requests), "/project", "anchored-standard");
	await createChildSession({ get: () => undefined, logger: { warn() {} } }, recordingController(requests), "/project", "anchored-standard");
	await createChildSession({ get: () => undefined, logger: { warn() {} } }, recordingController(requests), undefined);

	assert.deepEqual(requests, [
		{ workspaceId: "ws-1", agentPreset: "anchored-standard" },
		{ cwd: "/project", agentPreset: "anchored-standard" },
		{}, // a session without a preset keeps the previous create shape
	]);
});

test("readArchivedConversation streams a file and tolerates a missing one", async () => {
	const project = await mkdtemp(path.join(tmpdir(), "dsh-archive-read-"));
	const file = path.join(project, "session.jsonl");
	await writeFile(file, [
		"null",
		JSON.stringify({ type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "streamed question" }] } }),
		JSON.stringify({ type: "assistant/message", data: { message: { content: [{ type: "text", text: "streamed answer" }] } } }),
		"",
	].join("\n"));

	const text = await readArchivedConversation(file, 10_000);
	assert.match(text, /## user\nstreamed question/);
	assert.match(text, /## assistant\nstreamed answer/);
	assert.equal(await readArchivedConversation(path.join(project, "missing.jsonl"), 10_000), "", "a missing log renders empty instead of throwing");
});

test("archivedConversationText skips JSONL lines that are not event objects", () => {
	// `null`, arrays and scalars all parse as valid JSON; one such line used to
	// throw and fail the whole autolearn backtrack pass.
	const lines = [
		"null",
		"[1,2]",
		'"text"',
		"42",
		JSON.stringify({ type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "kept" }] } }),
	];
	const text = archivedConversationText(`${lines.join("\n")}\n`, 10_000);
	assert.match(text, /## user\nkept/);
});

test("a legacy path whose type conflicts with the new layout is left in place", async () => {
	const project = await mkdtemp(path.join(tmpdir(), "dsh-migrate-conflict-"));
	const memory = path.join(project, ".agents", "memory");
	await mkdir(path.join(memory, "session-logs"), { recursive: true });
	await writeFile(path.join(memory, "MEMORY.md"), "# New memory\n");
	// Legacy mirror image: MEMORY.md is a directory, session-logs is a file.
	await mkdir(path.join(project, ".pi", "MEMORY.md", "nested"), { recursive: true });
	await writeFile(path.join(project, ".pi", "MEMORY.md", "nested", "old.md"), "old\n");
	await writeFile(path.join(project, ".pi", "session-logs"), "legacy file\n");

	// Neither side may be deleted to "resolve" the conflict, and `cp` must not throw.
	const result = await migrateProjectState(project);

	assert.deepEqual(result.conflicts.sort(), [".agents/memory/MEMORY.md", ".agents/memory/session-logs"]);
	assert.equal(result.moved.length, 0);
	assert.equal(await readFile(path.join(memory, "MEMORY.md"), "utf8"), "# New memory\n");
	assert.equal(await readFile(path.join(project, ".pi", "MEMORY.md", "nested", "old.md"), "utf8"), "old\n");
	assert.equal(await readFile(path.join(project, ".pi", "session-logs"), "utf8"), "legacy file\n");
});

test("the shared settings namespace is installable again after a plugin reload", () => {
	let installs = 0;
	const cleanups = [];
	const fakeContext = () => ({
		inject: (_deps, callback) => callback({ settings: { installSection: () => { installs += 1; } } }),
		effect: (callback) => { cleanups.push(callback()); },
	});

	installProjectContextSettings(fakeContext(), DEFAULT_CONFIG);
	installProjectContextSettings(fakeContext(), DEFAULT_CONFIG);
	assert.equal(installs, 1, "one loaded plugin installs the shared namespace once");

	cleanups[0](); // the owning fiber unloads
	installProjectContextSettings(fakeContext(), DEFAULT_CONFIG);
	assert.equal(installs, 2, "a reload re-registers the namespace instead of silently skipping it");

	// An update can dispose the old fiber after the new one installed: that stale
	// cleanup must not release the live installation's guard.
	cleanups[0]();
	installProjectContextSettings(fakeContext(), DEFAULT_CONFIG);
	assert.equal(installs, 2, "a stale fiber must not release a newer installation");
});

test("a dirty or in-flight composer defers the auto handoff switch", () => {
	assert.equal(handoffSwitchDeferred(undefined), false, "an absent facade never blocks the switch");
	assert.equal(handoffSwitchDeferred({ draft: "", phase: "plain" }), false);
	assert.equal(handoffSwitchDeferred({ draft: "   ", phase: "plain" }), false);
	assert.equal(handoffSwitchDeferred({ draft: "/caveman-help", phase: "plain" }), true);
	assert.equal(handoffSwitchDeferred({ draft: "", phase: "submitting" }), true);
	assert.equal(handoffSwitchDeferred({ draft: "text", phase: "claimed" }), true);
});

test("no plugin source appends a custom session event (dsh refuses to load such logs)", async () => {
	// A downstream event type is outside dsh's KNOWN_SESSION_EVENT_TYPES, and
	// `Session.append` cannot set the `ignorable: true` marker the persistence read
	// path requires, so one such record makes the whole session unloadable. The
	// scan covers both halves of the package, not just the host sources.
	for (const root of ["../src", "../client"]) {
		for (const entry of await readdir(new URL(root, import.meta.url), { recursive: true })) {
			if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue;
			const source = await readFile(new URL(`${root}/${entry}`, import.meta.url), "utf8");
			assert.doesNotMatch(source, /\.append\(/, `${root}/${entry} appends a session event`);
			assert.doesNotMatch(source, /interface SessionEventMap/, `${root}/${entry} declares a custom session event`);
		}
	}
});

/**
 * A fake client context exposing the two services the handoff watcher reads.
 *
 * `conversation` selects the facade the watcher must survive: `"absent"` (no
 * service), `"throwing"` (a session with no shell), `"no-subscribe"` (a snapshot
 * without a subscriber), or the default complete facade. Composer snapshots are
 * keyed by session id, like the real input hub.
 */
function handoffWatchContext(options = {}) {
	const listListeners = new Set();
	const composerListeners = new Map();
	const opened = [];
	const titles = { ...(options.titles ?? {}) };
	const composers = new Map(Object.entries(options.composers ?? {}));
	const state = {
		ids: [...(options.ids ?? [])],
		byId: { ...(options.byId ?? {}) },
		current: options.current,
		phase: options.phase ?? "ready",
	};
	const composerOf = (id) => composers.get(id) ?? { draft: "", phase: "plain" };
	const mode = options.conversation ?? "normal";
	const sessions = {
		list: {
			getSnapshot: () => state,
			subscribe: (listener) => {
				listListeners.add(listener);
				return () => listListeners.delete(listener);
			},
		},
		// The real service returns undefined for a session that is neither listed nor scoped.
		binding: (id) => (options.bindingMissing === true ? undefined : { session: { projections: { faceOf: () => ({ getSnapshot: () => titles[String(id)] }) } } }),
		open: (id) => {
			opened.push(String(id));
		},
	};
	const conversation = mode === "absent" ? undefined : {
		input: {
			shell: (id) => {
				if (mode === "throwing") throw new Error(`conversation.input: session "${String(id)}" resolved no binding`);
				const key = String(id);
				return {
					state: {
						getSnapshot: () => ({ ...composerOf(key) }),
						...(mode === "no-subscribe" ? {} : {
							subscribe: (listener) => {
								const set = composerListeners.get(key) ?? new Set();
								set.add(listener);
								composerListeners.set(key, set);
								return () => set.delete(listener);
							},
						}),
					},
				};
			},
		},
	};
	return {
		ctx: {
			get: (name) => {
				if (options.sessionsMissing === true && name === "sessions") return undefined;
				return name === "sessions" ? sessions : name === "conversation" ? conversation : undefined;
			},
		},
		opened,
		state,
		titles,
		addSession(id, summary, title) {
			state.ids.push(id);
			state.byId[id] = summary;
			// An absent title models a projection that has not landed yet.
			if (title !== undefined) titles[id] = title;
		},
		notifyList: () => {
			for (const listener of listListeners) listener();
		},
		settleComposer: (id, next) => {
			composers.set(id, { ...composerOf(id), ...next });
			for (const listener of composerListeners.get(id) ?? []) listener();
		},
		composerWatchers: (id) => composerListeners.get(id)?.size ?? 0,
	};
}

test("planHandoffWatch waits for a landed list and a landed title", () => {
	const handoffRow = { id: "s2", cwd: "/p", title: `${HANDOFF_TITLE_PREFIX}abc123` };

	// A `pending` list is empty because nothing arrived, not because nothing exists.
	assert.equal(planHandoffWatch({ phase: "pending", seeded: false, rows: [handoffRow] }).seed, false);
	assert.equal(planHandoffWatch({ phase: "pending", seeded: false, rows: [handoffRow] }).open, undefined);
	assert.equal(planHandoffWatch({ phase: "ready", seeded: false, rows: [handoffRow] }).seed, true, "the first landed list is adopted");
	assert.equal(planHandoffWatch({ phase: "ready", seeded: true, rows: [{ id: "s2", cwd: "/p" }], current: "s1" }).open, undefined, "a title that has not landed is retried, never settled");
	assert.equal(planHandoffWatch({ phase: "ready", seeded: true, rows: [handoffRow], current: "s1" }).open, "s2");
	assert.equal(planHandoffWatch({ phase: "ready", seeded: true, rows: [handoffRow], current: "s1" }).deferred, false);
});

test("the handoff watcher adopts an already-listed session instead of opening it", () => {
	const harness = handoffWatchContext({ phase: "pending" });
	const dispose = watchHandoffSwitch(harness.ctx);
	assert.deepEqual(harness.opened, [], "a pending list never triggers a switch");

	// The first pull lands carrying an old handoff session plus an ordinary one.
	harness.state.ids = ["old-handoff", "ordinary"];
	harness.state.byId = { "old-handoff": { cwd: "/p" }, ordinary: { cwd: "/p" } };
	harness.state.current = "ordinary";
	harness.titles["old-handoff"] = `${HANDOFF_TITLE_PREFIX}old12345`;
	harness.titles.ordinary = "work";
	harness.state.phase = "ready";
	harness.notifyList();

	assert.deepEqual(harness.opened, [], "sessions present before the list landed are never opened");
	dispose();
});

test("the handoff watcher opens exactly one newly listed handoff session", () => {
	const harness = handoffWatchContext({ ids: ["s1"], byId: { s1: { cwd: "/p" } }, current: "s1", titles: { s1: "work" } });
	const dispose = watchHandoffSwitch(harness.ctx);

	harness.addSession("s2", { cwd: "/p" }, `${HANDOFF_TITLE_PREFIX}abc12345`);
	harness.notifyList();
	assert.deepEqual(harness.opened, ["s2"]);

	harness.notifyList();
	assert.deepEqual(harness.opened, ["s2"], "an opened session is not opened again");

	// Neither a delegated child, another cwd, nor an ordinary title is a target.
	harness.addSession("s3", { cwd: "/p", origin: "subagent" }, `${HANDOFF_TITLE_PREFIX}child`);
	harness.addSession("s4", { cwd: "/other" }, `${HANDOFF_TITLE_PREFIX}elsewhere`);
	harness.addSession("s5", { cwd: "/p" }, "an ordinary session");
	harness.notifyList();
	assert.deepEqual(harness.opened, ["s2"]);
	dispose();
});

test("the handoff watcher waits for the composer to settle before switching", () => {
	// The 2026-09-13 incident: the switch stole a `/caveman-help` draft and it was
	// submitted into the fresh handoff session instead.
	const harness = handoffWatchContext({
		ids: ["s1"],
		byId: { s1: { cwd: "/p" } },
		current: "s1",
		titles: { s1: "work" },
		composers: { s1: { draft: "/caveman-help", phase: "plain" } },
	});
	const dispose = watchHandoffSwitch(harness.ctx);
	assert.equal(harness.composerWatchers("s1"), 0, "a clean composer needs no watch");

	harness.addSession("s2", { cwd: "/p" }, `${HANDOFF_TITLE_PREFIX}abc12345`);
	harness.notifyList();
	assert.deepEqual(harness.opened, [], "a draft the user has not surrendered blocks the switch");
	assert.equal(harness.composerWatchers("s1"), 1, "the watcher subscribes to the composer so it can retry");

	harness.settleComposer("s1", { draft: "", phase: "plain" });
	assert.deepEqual(harness.opened, ["s2"], "clearing the draft retries the switch without waiting for list traffic");
	assert.equal(harness.composerWatchers("s1"), 0, "the composer subscription is released after the switch");
	dispose();
});

test("the composer retry follows the active session", () => {
	// Deferral can outlive a move to another session: the retry must re-bind to the
	// composer that is now active, or clearing that draft would not retry at all.
	const harness = handoffWatchContext({
		ids: ["s1", "s9"],
		byId: { s1: { cwd: "/p" }, s9: { cwd: "/p" } },
		current: "s1",
		titles: { s1: "work", s9: "other work" },
		composers: { s1: { draft: "typing", phase: "plain" }, s9: { draft: "also typing", phase: "plain" } },
	});
	const dispose = watchHandoffSwitch(harness.ctx);

	harness.addSession("s2", { cwd: "/p" }, `${HANDOFF_TITLE_PREFIX}abc12345`);
	harness.notifyList();
	assert.equal(harness.composerWatchers("s1"), 1, "the deferral watches the then-active session");

	harness.state.current = "s9";
	harness.notifyList();
	assert.equal(harness.composerWatchers("s1"), 0, "the stale subscription is released");
	assert.equal(harness.composerWatchers("s9"), 1, "the retry re-binds to the new active session");

	harness.settleComposer("s9", { draft: "", phase: "plain" });
	assert.deepEqual(harness.opened, ["s2"], "settling the active composer retries the switch");
	dispose();
});

test("the handoff watcher survives an unavailable composer facade", () => {
	// These are exactly the paths that must not throw inside the list listener.
	for (const [mode, composers, expected] of [
		["absent", {}, ["s2"]],
		["throwing", {}, ["s2"]],
		["no-subscribe", { s1: { draft: "typing", phase: "plain" } }, []],
	]) {
		const harness = handoffWatchContext({
			ids: ["s1"],
			byId: { s1: { cwd: "/p" } },
			current: "s1",
			titles: { s1: "work" },
			composers,
			conversation: mode,
		});
		const dispose = watchHandoffSwitch(harness.ctx);
		harness.addSession("s2", { cwd: "/p" }, `${HANDOFF_TITLE_PREFIX}abc12345`);
		harness.notifyList();
		harness.notifyList();
		assert.deepEqual(harness.opened, expected, `conversation mode ${mode}`);
		dispose();
	}
});

test("defensive handoff-watcher branches never break the switcher", () => {
	// A runtime without the `phase` field keeps the previous (ungated) behavior.
	const handoffRow = { id: "s2", cwd: "/p", title: `${HANDOFF_TITLE_PREFIX}abc123` };
	assert.equal(planHandoffWatch({ seeded: true, rows: [handoffRow], current: "s1" }).open, "s2", "an absent phase is not treated as pending");

	// A snapshot whose draft/phase are not the strings the composer contract promises
	// must not throw inside the list listener: an unknown composer never blocks.
	const hostile = handoffWatchContext({
		ids: ["s1"],
		byId: { s1: { cwd: "/p" } },
		current: "s1",
		titles: { s1: "work" },
		composers: { s1: { draft: 42, phase: "plain" } },
	});
	const disposeHostile = watchHandoffSwitch(hostile.ctx);
	hostile.addSession("s2", { cwd: "/p" }, `${HANDOFF_TITLE_PREFIX}abc12345`);
	hostile.notifyList();
	assert.deepEqual(hostile.opened, ["s2"]);
	disposeHostile();

	// Disposing while a switch is deferred releases the composer retry for good.
	const deferred = handoffWatchContext({
		ids: ["s1"],
		byId: { s1: { cwd: "/p" } },
		current: "s1",
		titles: { s1: "work" },
		composers: { s1: { draft: "typing", phase: "plain" } },
	});
	const disposeDeferred = watchHandoffSwitch(deferred.ctx);
	deferred.addSession("s2", { cwd: "/p" }, `${HANDOFF_TITLE_PREFIX}abc12345`);
	deferred.notifyList();
	assert.equal(deferred.composerWatchers("s1"), 1);
	disposeDeferred();
	assert.equal(deferred.composerWatchers("s1"), 0, "dispose releases the composer subscription");
	deferred.settleComposer("s1", { draft: "", phase: "plain" });
	assert.deepEqual(deferred.opened, [], "nothing fires after dispose");

	// Without the sessions service the watcher is a no-op, not a crash.
	const missing = handoffWatchContext({ sessionsMissing: true });
	const disposeMissingSessions = watchHandoffSwitch(missing.ctx);
	assert.equal(typeof disposeMissingSessions, "function");
	disposeMissingSessions();
});

test("the handoff watcher retries a session whose title has not landed", () => {
	const harness = handoffWatchContext({ ids: ["s1"], byId: { s1: { cwd: "/p" } }, current: "s1", titles: { s1: "work" } });
	const dispose = watchHandoffSwitch(harness.ctx);

	harness.addSession("s2", { cwd: "/p" }); // listed, title projection still pending
	harness.notifyList();
	assert.deepEqual(harness.opened, [], "an unlanded title is neither opened nor settled");

	harness.titles.s2 = `${HANDOFF_TITLE_PREFIX}abc12345`;
	harness.notifyList();
	assert.deepEqual(harness.opened, ["s2"], "the switch happens once the title lands");

	// A binding that resolves to nothing is the same "not landed yet" case.
	const missing = handoffWatchContext({ ids: ["s1"], byId: { s1: { cwd: "/p" } }, current: "s1", titles: { s1: "work" }, bindingMissing: true });
	const disposeMissing = watchHandoffSwitch(missing.ctx);
	missing.addSession("s2", { cwd: "/p" }, `${HANDOFF_TITLE_PREFIX}abc12345`);
	missing.notifyList();
	assert.deepEqual(missing.opened, [], "a missing binding never opens a session");
	assert.deepEqual(missing.state.ids, ["s1", "s2"]);
	dispose();
	disposeMissing();
});

test("the handoff watcher releases its subscriptions when the plugin unloads", () => {
	const harness = handoffWatchContext({ ids: [], byId: {} });
	const dispose = watchHandoffSwitch(harness.ctx);
	dispose();

	harness.addSession("s2", { cwd: "/p" }, `${HANDOFF_TITLE_PREFIX}abc12345`);
	harness.notifyList();
	assert.deepEqual(harness.opened, [], "a disposed watcher stops scanning");
});

test("the /context-update reply reflects what the consolidation pass did", () => {
	// The pass swallows its own failure, so the reply is the only signal the user gets.
	assert.equal(contextUpdateReply("failed").kind, "error");
	assert.match(contextUpdateReply("failed").text, /errors\.log/);
	assert.equal(contextUpdateReply("updated").kind, "success");
	assert.match(contextUpdateReply("updated").text, /updated/);
	assert.match(contextUpdateReply("deduped").text, /already up to date/);
	assert.match(contextUpdateReply("unchanged").text, /no new memory/);
	assert.match(contextUpdateReply("clipped").text, /shortened to fit the model output budget/);
	assert.notEqual(contextUpdateReply("deduped").text, contextUpdateReply("updated").text, "a deduped no-op must not read as a successful rewrite");
});

test("resolvePluginConfig validates every documented bound", () => {
	assert.deepEqual(resolvePluginConfig(undefined), { ...DEFAULT_CONFIG });
	assert.throws(() => resolvePluginConfig({ nope: 1 }), /unknown config key/);
	assert.throws(() => resolvePluginConfig({ archiveEnabled: "yes" }), /archiveEnabled must be a boolean/);
	assert.throws(() => resolvePluginConfig({ consolidateTurns: 0 }), /consolidateTurns must be a number >= 1/);
	assert.throws(() => resolvePluginConfig({ handoffThresholdRatio: 0.96 }), /between 0.1 and 0.95/);
	assert.throws(() => resolvePluginConfig({ handoffTargetTokens: 7_999 }), /between 8000 and 200000/);
	assert.throws(() => resolvePluginConfig({ handoffSummaryThinking: "high" }), /handoffSummaryThinking/);
	assert.throws(() => resolvePluginConfig({ handoffPendingQuestion: "skip" }), /handoffPendingQuestion/);
	assert.equal(resolvePluginConfig({ handoffPendingQuestion: "wait" }).handoffPendingQuestion, "wait");
	assert.throws(() => resolvePluginConfig("nope"), /config must be an object/);
	assert.throws(() => resolvePluginConfig({ provider: "p" }), /provider and model must be set together/);

	const parsed = resolvePluginConfig({ consolidateTurns: 9.6, provider: "p", model: "m", handoffSummaryThinking: "session" });
	assert.equal(parsed.consolidateTurns, 10, "whole-number fields round");
	assert.equal(parsed.provider, "p");
	assert.equal(parsed.model, "m");
	assert.equal(parsed.handoffSummaryThinking, "session");
	assert.equal(parsed.autoConsolidate, DEFAULT_CONFIG.autoConsolidate);
});

test("clip and truncateMiddle keep the head and the tail inside the budget", () => {
	assert.equal(clip("  short  ", 20), "short");
	assert.match(clip("x".repeat(50), 10), /^x{10}\n\[\.\.\.truncated\.\.\.\]$/);

	const text = `${"h".repeat(60)}MIDDLE${"t".repeat(60)}`;
	const cut = truncateMiddle(text, 40);
	assert.match(cut, /^h+\n\n\[\.\.\.middle of conversation omitted\.\.\.\]\n\nt+$/);
	assert.ok(cut.length <= 40 + 50, `truncated length ${cut.length}`);
	assert.equal(truncateMiddle("short", 40), "short");
});

test("the output budget is raised to fit the reply and bounded by the ceiling", () => {
	// Dense scripts cost about a token per character; ASCII prose costs well under one.
	assert.ok(replyTokenRate("汉字" .repeat(10)) > 0.95);
	assert.ok(replyTokenRate("plain ascii prose") < 0.5);
	assert.equal(replyTokenRate(""), 0.4);

	// Configured wins unless more room is needed; the model's own limit and the ceiling bound it.
	assert.equal(adaptiveOutputTokens(8192, 100, {}, 32_768), 8192);
	assert.equal(adaptiveOutputTokens(8192, 20_000, {}, 32_768), 20_000);
	assert.equal(adaptiveOutputTokens(8192, 100_000, {}, 32_768), 32_768);
	assert.equal(adaptiveOutputTokens(8192, 100_000, { maxTokens: 12_000 }, 32_768), 12_000);
	assert.equal(adaptiveOutputTokens(8192, 100_000, { maxTokens: 0 }, 32_768), 32_768);

	// A small input passes through untouched and is not reported as clipped.
	const small = fitMemoryInput("# Project Memory\n\nsmall", "## Summary\nsmall", 8192, {}, 32_768);
	assert.equal(small.clipped, false);
	assert.equal(small.text, "# Project Memory\n\nsmall");
	assert.equal(small.maxTokens, 8192);

	// A huge input is shortened on both sides, and the estimate stays inside the budget.
	const memory = "m".repeat(400_000);
	const context = "c".repeat(400_000);
	const fitted = fitMemoryInput(memory, context, 8192, {}, 32_768);
	assert.equal(fitted.clipped, true);
	assert.ok(fitted.text.length < memory.length && fitted.contextText.length < context.length);
	const estimate = fitted.text.length * replyTokenRate(fitted.text) + fitted.contextText.length * replyTokenRate(fitted.contextText);
	// The real invariant: the reply must still have room for its own JSON scaffolding.
	assert.ok(estimate <= fitted.maxTokens - 64, `estimate ${estimate} leaves no margin inside ${fitted.maxTokens}`);
	assert.ok(fitted.maxTokens >= 8192, "the adaptive cap never drops below the configured maxTokens");
	assert.equal(fitted.maxTokens <= 32_768, true, "and never exceeds the ceiling");
	// Head and tail survive, the middle is what is dropped.
	assert.ok(fitted.text.startsWith("m") && fitted.text.endsWith("m"));
	assert.match(fitted.text, /\n\n/);
});

test("clipText never splits a surrogate pair and replyHead fences the raw reply", () => {
	const emoji = "a".repeat(50) + "🎉".repeat(50);
	const cut = clipText(emoji, 60);
	assert.ok(cut.length <= 60);
	// Re-encoding must not produce a replacement character.
	assert.equal(Buffer.from(cut, "utf8").toString("utf8"), cut);
	assert.match(cut, /\n\n/);

	// Sweep every limit: a clip must never end or start on half of a surrogate pair.
	for (let limit = 0; limit <= 70; limit += 1) {
		const piece = clipText(emoji, limit);
		assert.ok(piece.length <= limit, `limit ${limit} produced ${piece.length} chars`);
		assert.equal(Buffer.from(piece, "utf8").toString("utf8"), piece, `limit ${limit} split a character`);
	}

	const short = replyHead("{}");
	assert.match(short, /^--- raw reply ---\n\{\}$/);
	const long = replyHead("x".repeat(5000));
	assert.match(long, /\[\.\.\.reply omitted after 4000 of 5000 chars\.\.\.\]/);

	// This excerpt is embedded in an error that reaches `ctx.logger.warn`, which writes verbatim, so
	// the redaction has to happen here at the source — not only on the `errors.log` append path.
	const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signaturepart";
	const key = "sk-abcdefghijklmnop";
	const leaking = replyHead(`{"memory_markdown": "apiKey = ${key}", "note": "authorization: Bearer ${jwt}"}`);
	assert.ok(!leaking.includes(jwt), "the raw-reply excerpt must not carry a JWT");
	assert.ok(!leaking.includes(key), "the raw-reply excerpt must not carry a key");
	assert.match(leaking, /\[redacted/);
	// A caller may pass a shorter budget; the cap and its notice still apply.
	const bounded = replyHead("y".repeat(500), 100);
	assert.match(bounded, /\[\.\.\.reply omitted after 100 of 500 chars\.\.\.\]/);
});

test("fallbackUpdate summarizes a session from its first user message alone", () => {
	const session = fakeEventSession([
		{ type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "整理 log" }] } },
		{ type: "assistant/message", data: { message: { content: [{ type: "text", text: "好" }] } } },
	]);
	const update = fallbackUpdate(session);
	assert.equal(update.title, "Session recorded");
	assert.equal(update.summary, "整理 log");
	assert.deepEqual(update.key_points, []);

	const empty = fallbackUpdate(fakeEventSession([]));
	assert.match(empty.summary, /without a model summary/);
});

/** A fake session carrying only what the event-level helpers read. */
function fakeEventSession(events, id = "session-abcdef", cwd = "/tmp/fake-project") {
	return {
		id,
		header: { version: 3, createdAt: Date.UTC(2026, 8, 13), cwd, isSeeded: false },
		snapshotEvents: () => events,
		deriveMessages: () => [],
	};
}

test("writeAtomic and the synchronous text cache agree on the file they serve", async () => {
	const project = await mkdtemp(path.join(tmpdir(), "dsh-atomic-"));
	const file = path.join(project, "nested", "MEMORY.md");
	await writeAtomic(file, "first\n");
	assert.equal(await readFile(file, "utf8"), "first\n");
	assert.equal(readTextCachedSync(file), "first\n");

	// Rewrite through the same helper: the cache must not keep serving the old text.
	await writeAtomic(file, "second\n");
	// Pin a whole-second mtime so the external write below can restore it exactly.
	const stamp = new Date(1_700_000_000_000);
	await utimes(file, stamp, stamp);
	assert.equal(readTextCachedSync(file), "second\n");

	// An external write of the same size with its mtime restored is exactly what the
	// invalidator is for: the cache cannot notice it on its own.
	await writeFile(file, "third!\n"); // same byte count as "second\n"
	await utimes(file, stamp, stamp);
	assert.equal(readTextCachedSync(file), "second\n", "the cache keeps serving the primed text until it is invalidated");
	invalidateTextCache(file);
	assert.equal(readTextCachedSync(file), "third!\n");
	assert.equal(existsSync(file), true);

	// No temp file may survive a successful write.
	assert.deepEqual((await readdir(path.dirname(file))).sort(), ["MEMORY.md"]);
});

test("resolvePluginConfig, settingPatch and the pending-question check behave", () => {
	assert.deepEqual(settingPatch("on"), { patch: { handoffEnabled: true } });
	assert.deepEqual(settingPatch("thinking session"), { patch: { handoffSummaryThinking: "session" } });
	assert.deepEqual(settingPatch("pending wait"), { patch: { handoffPendingQuestion: "wait" } });
	assert.equal(settingPatch("pending sometimes"), undefined);
	assert.deepEqual(settingPatch("target 64k"), { patch: { handoffTargetTokens: 64_000 } });
	assert.match(settingPatch("target 1k").error, /8000–200000/);
	assert.deepEqual(settingPatch("keep 0"), { patch: { handoffKeepTokens: 0 } });
	assert.match(settingPatch("keep 300k").error, /0–200000/);
	assert.deepEqual(settingPatch("0.5"), { patch: { handoffAdaptive: false, handoffThresholdRatio: 0.5 } });
	assert.equal(settingPatch("status"), undefined);

	assert.equal(textAsksQuestion("Done. What next?"), true);
	assert.equal(textAsksQuestion("Done. What next？"), true);
	assert.equal(textAsksQuestion("All set.\n\n```\nconst q = '?';\n```\nDone."), false);
	assert.equal(textAsksQuestion("Everything is committed."), false);

	const asking = {
		id: "s1",
		header: {},
		snapshotEvents: () => [],
		deriveMessages: () => [
			{ role: "user", content: [{ type: "text", text: "go on" }] },
			{ role: "assistant", content: [{ type: "text", text: "Which branch should I use?" }] },
		],
	};
	assert.match(pendingQuestion(asking), /Which branch/);
	const answered = { ...asking, deriveMessages: () => [...asking.deriveMessages(), { role: "user", content: [{ type: "text", text: "main" }] }] };
	assert.equal(pendingQuestion(answered), undefined);
});

test("the session log appends incrementally and rebuilds after an external rewrite", async () => {
	const project = await mkdtemp(path.join(tmpdir(), "dsh-session-log-"));
	const session = fakeEventSession([{ type: "user/message", seq: 0, data: { source: { kind: "user" }, content: [{ type: "text", text: "one" }] } }], "session-log-1", project);
	const raw = path.join(project, ".agents", "memory", "session-logs", "session-log-1", "session.jsonl");

	await writeSessionArtifacts(session, { markdown: false });
	assert.equal((await readFile(raw, "utf8")).trimEnd().split("\n").length, 2, "header plus one event");

	// A second flush appends only the new entry.
	const grown = [session.snapshotEvents()[0], { type: "user/message", seq: 1, data: { source: { kind: "user" }, content: [{ type: "text", text: "two" }] } }];
	session.snapshotEvents = () => grown;
	await writeSessionArtifacts(session, { markdown: false });
	assert.equal((await readFile(raw, "utf8")).trimEnd().split("\n").length, 3);

	// `scripts/import-archives.mjs --replace` (or any external tool) rewrites the
	// file behind the process: the next flush must rebuild, not concatenate.
	await writeFile(raw, '{"type":"session","id":"replaced"}\n');
	await writeSessionArtifacts(session, { markdown: false });
	const rebuilt = (await readFile(raw, "utf8")).trimEnd().split("\n");
	assert.equal(rebuilt.length, 3, "the external rewrite is repaired from the full snapshot");
	assert.match(rebuilt[0], /"session-log-1"/);
	assert.match(rebuilt[2], /"two"/);

	// The subtle case: an external rewrite of exactly the same length, which a
	// size-only comparison would accept and then append onto foreign bytes.
	const current = await readFile(raw, "utf8");
	await writeFile(raw, `${"f".repeat(current.length - 1)}\n`);
	await writeSessionArtifacts(session, { markdown: false });
	const again = (await readFile(raw, "utf8")).trimEnd().split("\n");
	assert.equal(again.length, 3, "a same-length external rewrite is rebuilt too");
	assert.match(again[0], /"session-log-1"/);

	releaseSessionQueue(session);
});

test("a flush with no new events writes nothing at all", async () => {
	const project = await mkdtemp(path.join(tmpdir(), "dsh-session-noop-"));
	const session = fakeEventSession([{ type: "user/message", seq: 0, data: { source: { kind: "user" }, content: [{ type: "text", text: "one" }] } }], "session-noop", project);
	const dir = path.join(project, ".agents", "memory", "session-logs", "session-noop");

	await writeSessionArtifacts(session, {});
	const rawBefore = await readFile(path.join(dir, "session.jsonl"), "utf8");
	const markdownBefore = await readFile(path.join(dir, "session.md"), "utf8");

	// `/session-log` re-writes the live session on demand, so a no-growth flush is
	// routine: it must not append a bare newline on every call.
	await writeSessionArtifacts(session, {});
	await writeSessionArtifacts(session, {});
	assert.equal(await readFile(path.join(dir, "session.jsonl"), "utf8"), rawBefore);
	assert.equal(await readFile(path.join(dir, "session.md"), "utf8"), markdownBefore);
	releaseSessionQueue(session);
});

test("errors.log is truncated past its cap and single records are bounded", async () => {
	const project = await mkdtemp(path.join(tmpdir(), "dsh-errors-log-"));
	const file = path.join(project, ".agents", "memory", "errors.log");
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, "old detail\n".repeat(100_000)); // ~1.1 MB, past the rotation cap

	await logError(project, "rotation-test", new Error("x".repeat(20_000)));

	const text = await readFile(file, "utf8");
	assert.ok(text.length < 200_000, `rotated log is ${text.length} chars`);
	assert.match(text, /\[\.\.\.truncated; newest entries kept\.\.\.\]/);
	assert.match(text, /\[rotation-test\]/, "the newest entry survives the rotation");
	assert.match(text, /\[\.\.\.detail truncated\.\.\.\]/, "one huge record is capped, not kept whole");
});

test("the streaming reader matches the string reader line for line", async () => {
	const project = await mkdtemp(path.join(tmpdir(), "dsh-archive-parity-"));
	const line = (text) => JSON.stringify({ type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text }] } });
	const cases = {
		lf: `${line("one")}\n${line("two")}\n`,
		crlf: `${line("one")}\r\n${line("two")}\r\n`,
		cr: `${line("one")}\r${line("two")}\r`,
		"no-eol": line("one"),
	};
	for (const [name, content] of Object.entries(cases)) {
		const file = path.join(project, `${name}.jsonl`);
		await writeFile(file, content);
		assert.equal(
			await readArchivedConversation(file, 10_000),
			archivedConversationText(content, 10_000),
			`${name} renders differently through the two readers`,
		);
	}
});

test("migration keeps the newer of two colliding files", async () => {
	const project = await mkdtemp(path.join(tmpdir(), "dsh-migrate-newest-"));
	const memory = path.join(project, ".agents", "memory");
	await mkdir(memory, { recursive: true });
	await writeFile(path.join(memory, "MEMORY.md"), "# new\n");

	await mkdir(path.join(project, ".pi"), { recursive: true });
	await writeFile(path.join(project, ".pi", "MEMORY.md"), "# legacy\n");
	const old = new Date(Date.now() - 60_000);
	await utimes(path.join(project, ".pi", "MEMORY.md"), old, old);

	const result = await migrateProjectState(project);
	assert.equal(await readFile(path.join(memory, "MEMORY.md"), "utf8"), "# new\n", "the newer destination wins");
	assert.equal(existsSync(path.join(project, ".pi", "MEMORY.md")), false, "the consumed legacy file is gone");
	assert.deepEqual(result.conflicts, []);
});

test("maxOutputTokens bounds adaptive growth without capping the starting budget", () => {
	// The ceiling only bounds how far a request may grow (pi's rule); it never forces the request
	// below the configured starting cap, so a contradictory pair is used as written instead of
	// being rejected — an existing settings file must not stop the plugin from loading.
	assert.equal(resolvePluginConfig({ maxTokens: 8192, maxOutputTokens: 256 }).maxTokens, 8192);
	assert.equal(resolvePluginConfig({ maxTokens: 4096, maxOutputTokens: 4096 }).maxOutputTokens, 4096);
	assert.equal(resolvePluginConfig({}).maxOutputTokens, 32_768);

	// The ceiling wins over the model's own (larger) limit and over a request that would need more.
	assert.equal(adaptiveOutputTokens(4096, 100_000, { maxTokens: 1_000_000 }, 4096), 4096);
	// A ceiling below the starting cap is ignored rather than lowering the request below it.
	assert.equal(adaptiveOutputTokens(8192, 100, { maxTokens: 1_000_000 }, 256), 8192);
});

test("credentials are masked before a diagnostic reaches the project log", () => {
	const text = [
		'authorization: Bearer abcdefghijklmnop',
		"apiKey = sk-abcdefghijklmnop",
		"github token ghp_abcdefghijklmnop",
		"aws AKIAIOSFODNN7EXAMPLE",
		"jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signaturepart",
	].join("\n");
	const safe = redactSecrets(text);
	for (const secret of ["abcdefghijklmnop", "sk-abcdefghijklmnop", "ghp_abcdefghijklmnop", "AKIAIOSFODNN7EXAMPLE", "eyJhbGciOiJIUzI1NiJ9"]) {
		assert.ok(!safe.includes(secret), `${secret} must be masked`);
	}
	assert.match(safe, /\[redacted/);
	// Ordinary prose is left alone.
	assert.equal(redactSecrets("the token budget is 8192 tokens"), "the token budget is 8192 tokens");
});

test("a console diagnostic is masked, flattened and bounded", () => {
	// `ctx.logger.warn` writes verbatim and one consolidation failure can carry thousands of chars of
	// raw model reply, so the console helper must do both jobs — the mask is useless if the line is
	// unbounded, and the cap is useless if the secret survives it.
	const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signaturepart";
	const long = diagnosticMessage(new Error(`line one\n  apiKey = sk-abcdefghijklmnop\nthen ${"z".repeat(2000)}\nBearer ${jwt}`));
	assert.ok(!long.includes("sk-abcdefghijklmnop"), "the key must be masked");
	assert.ok(!long.includes(jwt), "the JWT must be masked");
	assert.ok(!/\n/.test(long), "the console line must be flattened to one line");
	assert.ok(long.length <= 420, `the console line must be bounded, got ${long.length} chars`);
	assert.match(long, /\[…truncated\]$/, "the bound is visible in the line");

	// A short diagnostic is passed through unchanged (after masking), and a non-Error value works.
	assert.equal(diagnosticMessage("nothing sensitive here"), "nothing sensitive here");
	assert.equal(diagnosticMessage(new Error("token: abcdefghij")).includes("[redacted]"), true);
});

test("the automatic handoff waits for background subagents to settle", async () => {
	// A session over the threshold whose last turn ended while a subagent is still running: when
	// that subagent settles, dsh wakes this session again, so handing off now would leave parent and
	// child working the same project.
	const conversation = Array.from({ length: 40 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", "x".repeat(1500)));
	const makeSession = (events) => ({
		id: "session-parent-000000000000",
		header: { cwd: process.cwd(), createdAt: Date.now() },
		deriveMessages: () => conversation,
		requestHeader: () => undefined,
		snapshotEvents: () => events,
	});
	const spawned = { type: "subagent/catalog", time: Date.now() - 60_000, data: { childId: "child-live", mode: "continuable" } };
	const settledEvent = { type: "user/message", time: Date.now() - 30_000, data: { source: { kind: "subagent-settled", senderSessionId: "child-live" } } };

	const created = [];
	const controller = { create: async () => { created.push(1); return { sessionId: "child-1" }; }, rename: async () => undefined, prompt: async () => undefined };
	const ctxFor = () => ({
		get: (name) => (name === "sessionController" ? controller : name === "tokenMeter" ? { measure: () => ({ totalTokens: 199_000, surfaceTokens: 199_000 }) } : undefined),
		llm: { resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }) },
		logger: { info() {}, warn() {} },
	});
	const config = resolvePluginConfig({ provider: "test-provider", model: "test-model", handoffPendingQuestion: "wait", handoffKeepTokens: 0 });

	const running = makeSession([spawned]);
	// Resolves without a model call: the guard returns before the summary is attempted.
	await maybeAutoHandoff(ctxFor(), running, config);
	assert.equal(created.length, 0, "no child session is created while a subagent is still running");

	// The same session with the child settled proceeds past the guard and reaches the summary call,
	// which this fake cannot serve — the rejection is the proof that only the guard stopped it above.
	const done = makeSession([spawned, settledEvent]);
	await assert.rejects(() => maybeAutoHandoff(ctxFor(), done, config), /async iterable/, "the run reached the summary call");
	assert.equal(created.length, 0);
});

test("the live subagent registry is preferred over the event log", async () => {
	const conversation = Array.from({ length: 40 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", "x".repeat(1500)));
	// Each case needs its own session id: the pressure check is throttled per session for 15 s
	// process-wide, so a second call on the same id would return before reaching any guard.
	let caseId = 0;
	const session = (events) => ({
		id: `session-registry-${caseId}`,
		header: { cwd: process.cwd(), createdAt: Date.now() },
		deriveMessages: () => conversation,
		requestHeader: () => undefined,
		snapshotEvents: () => events,
	});
	const created = [];
	const controller = { create: async () => { created.push(1); return { sessionId: "child-1" }; }, rename: async () => undefined, prompt: async () => undefined };
	const ctxWith = (subagents) => ({
		get: (name) => (name === "sessionController" ? controller : name === "tokenMeter" ? { measure: () => ({ totalTokens: 199_000, surfaceTokens: 199_000 }) } : name === "subagents" ? subagents : undefined),
		llm: { resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }) },
		logger: { info() {}, warn() {} },
	});
	const config = resolvePluginConfig({ provider: "test-provider", model: "test-model", handoffPendingQuestion: "wait", handoffKeepTokens: 0 });
	const runningChild = (mode) => ({ listChildren: async () => [{ kind: "child", id: "child-live", mode, activity: "running", hasChildren: false }] });

	// The registry knows about work the log cannot show at all (here: no events).
	caseId += 1;
	await maybeAutoHandoff(ctxWith(runningChild("continuable")), session([]), config);
	assert.equal(created.length, 0, "a running continuable child defers before any child session is created");

	// It also outlives the log fallback's one-hour horizon: that entry alone would have proceeded.
	caseId += 1;
	const ancient = [{ type: "subagent/catalog", time: Date.now() - 3 * 60 * 60_000, data: { childId: "child-live", mode: "continuable" } }];
	await maybeAutoHandoff(ctxWith(runningChild("continuable")), session(ancient), config);
	assert.equal(created.length, 0);

	// And its `mode` wins over a contradicting log: a one-shot child never settles, so the log
	// fallback would defer forever, while the run must reach the summary call and reject here.
	caseId += 1;
	const looksContinuable = [{ type: "subagent/catalog", time: Date.now() - 1_000, data: { childId: "child-live", mode: "continuable" } }];
	await assert.rejects(() => maybeAutoHandoff(ctxWith(runningChild("one-shot")), session(looksContinuable), config), /async iterable/);

	// A registry that cannot answer falls back to the log, which still sees the running child.
	caseId += 1;
	await maybeAutoHandoff(
		ctxWith({ listChildren: async () => { throw new Error("projections unavailable"); } }),
		session(looksContinuable),
		config,
	);
	assert.equal(created.length, 0);

	// An inactive continuable child cannot wake this session, so it must not hold the handoff.
	caseId += 1;
	await assert.rejects(
		() => maybeAutoHandoff(ctxWith({ listChildren: async () => [{ kind: "child", id: "child-live", mode: "continuable", activity: "inactive", hasChildren: false }] }), session([]), config),
		/async iterable/,
	);
});

test("a skipped automatic handoff says why in the server log", async () => {
	// The conversation fits the recent window, so there is nothing to summarize: dsh has no host-side
	// notification channel, so the reason is a log line (findable with `/handoff status` next to it).
	const logs = [];
	const controller = { create: async () => ({ sessionId: "child-1" }), rename: async () => undefined, prompt: async () => undefined };
	const ctx = {
		get: (name) => (name === "sessionController" ? controller : name === "tokenMeter" ? { measure: () => ({ totalTokens: 199_000, surfaceTokens: 199_000 }) } : undefined),
		llm: { resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }) },
		logger: { info: (...args) => { logs.push(args.join(" ")); }, warn() {} },
	};
	const session = {
		id: "session-skip-000000000000",
		header: { cwd: process.cwd(), createdAt: Date.now() },
		deriveMessages: () => [message("user", "hello"), message("assistant", "hi")],
		requestHeader: () => undefined,
		snapshotEvents: () => [],
	};
	const config = resolvePluginConfig({ provider: "test-provider", model: "test-model", handoffPendingQuestion: "wait" });

	await maybeAutoHandoff(ctx, session, config);
	assert.equal(logs.filter((line) => line.includes("automatic handoff skipped")).length, 1);
	assert.match(logs.join("\n"), /handoffKeepTokens/, "the log names the setting that decides it");

	// The log is not a surface the user can read, so the same skip is reported by `/handoff status`.
	const signal = new AbortController().signal;
	const status = await statusText(ctx, session, config, signal);
	assert.match(status, /auto skipped since \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, "status reports when the skip started");
	assert.match(status, /nothing older than keep ~/, "status names the reason, not just the fact");

	// The skip repeats on every idle; the receipt must keep the first occurrence rather than
	// reporting a session that looks skipped "just now" at every read.
	setPressureCheckIntervalMs(0);
	try {
		await new Promise((resolve) => setTimeout(resolve, 5));
		await maybeAutoHandoff(ctx, session, config);
		assert.equal(await statusText(ctx, session, config, signal), status, "a repeated skip keeps the first timestamp");

		// Once an idle finds something to summarize, the marker is cleared: the receipt describes the
		// session as it is now, not a condition it has left. Every rendered message is clipped to
		// 4000 chars, so the older span has to clear MIN_SUMMARIZE_TOKENS on its own.
		const grown = resolvePluginConfig({ provider: "test-provider", model: "test-model", handoffPendingQuestion: "wait", handoffKeepTokens: 0 });
		const many = Array.from({ length: 12 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", "x".repeat(4_000)));
		const grownSession = { ...session, deriveMessages: () => many };
		await assert.rejects(() => maybeAutoHandoff(ctx, grownSession, grown), "the summarizable idle reaches the summary call");
		assert.doesNotMatch(await statusText(ctx, grownSession, grown, signal), /auto skipped since/, "a summarizable idle clears the skip report");
	} finally {
		setPressureCheckIntervalMs(15_000);
	}
});

test("a manual handoff on a conversation that fits the carried window is refused, not fabricated", async () => {
	const cwd = await mkdtemp(path.join(tmpdir(), "dsh-handoff-empty-"));
	const created = [];
	const controller = { create: async () => { created.push(1); return { sessionId: "child-1" }; }, rename: async () => undefined, prompt: async () => undefined };
	let modelCalls = 0;
	const ctx = {
		get: (name) => (name === "sessionController" ? controller : undefined),
		llm: {
			resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
			stream: () => { modelCalls += 1; throw new Error("the model must not be called"); },
		},
		logger: { info() {}, warn() {} },
	};
	// Three short messages fit entirely inside the default `handoffKeepTokens`, so `older` is empty
	// even though the conversation is not: the reply must say why instead of summarizing nothing.
	const session = {
		id: "session-short-000000000000",
		header: { cwd, createdAt: Date.now() },
		deriveMessages: () => [message("user", "hello"), message("assistant", "hi"), message("user", "again")],
		snapshotEvents: () => [],
		requestHeader: () => undefined,
	};
	const entry = resolvePluginConfig({ provider: "test-provider", model: "test-model" });
	const reply = await runManual(ctx, session, entry, new AbortController().signal);
	assert.equal(reply.kind, "error");
	assert.match(reply.text, /nothing to hand off/);
	assert.match(reply.text, /keep 0/, "the reply names the escape hatch");
	assert.equal(created.length, 0);
	assert.equal(modelCalls, 0);
});

test("a handoff child inherits the parent's session-local model and permission preset", async () => {
	// `sessionController.create` takes neither a model nor a permission preset, so the child would
	// start on the deployment defaults and drop whatever the user had switched to — pi's 8a2e6e4 in
	// dsh terms. Both carries must land before the seed prompt, or the child's first turn is already
	// routed to the default and asks for approval the parent no longer required.
	const root = await mkdtemp(path.join(tmpdir(), "dsh-handoff-model-"));
	const conversation = Array.from({ length: 40 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", "x".repeat(1500)));
	const summaryStream = () => (async function* generate() { yield { type: "text-delta", text: "## Goal\n\ncontinue the work" }; })();

	const run = async ({ selectModel, requestHeader, preset, resident = true, setThrows = false, presetsAbsent = false }) => {
		const calls = [];
		const childSession = { id: "child-1" };
		const controller = {
			create: async () => { calls.push(["create"]); return { sessionId: "child-1" }; },
			rename: async () => undefined,
			prompt: async () => { calls.push(["prompt"]); },
			...(selectModel === undefined ? {} : { selectModel: async (request) => { calls.push(["selectModel", request]); if (selectModel === "throw") throw new Error("selection rejected"); } }),
		};
		const presets = {
			current: (session) => { calls.push(["current", session?.id]); return preset; },
			set: (session, name) => { calls.push(["setPreset", name, session === childSession]); if (setThrows) throw new Error("switch rejected"); },
		};
		const ctx = {
			get: (name) => (name === "sessionController" ? controller
				: name === "permissionPresets" ? (presetsAbsent ? undefined : presets)
					: name === "sessions" ? { get: (id) => (resident && id === "child-1" ? childSession : undefined) }
						: undefined),
			llm: { resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }), stream: summaryStream },
			logger: { info() {}, warn() {} },
		};
		const session = {
			id: `session-model-${calls.length}${Math.random().toString(16).slice(2, 8)}`,
			header: { cwd: root, createdAt: Date.now() },
			deriveMessages: () => conversation,
			requestHeader,
			snapshotEvents: () => [],
		};
		const entry = resolvePluginConfig({ provider: "test-provider", model: "test-model", handoffPendingQuestion: "wait", handoffKeepTokens: 0 });
		const reply = await runManual(ctx, session, entry, new AbortController().signal);
		return { calls, reply, sessionId: session.id };
	};

	const routed = () => ({ config: { provider: "parent-provider", model: "parent-model", reasoningEffort: "high" } });
	const carried = await run({ selectModel: true, requestHeader: routed, preset: "danger-full-access" });
	assert.equal(carried.reply.kind, "success");
	assert.deepEqual(carried.calls.map(([kind]) => kind), ["create", "current", "setPreset", "selectModel", "prompt"], "both carries land before the seed prompt");
	assert.deepEqual(carried.calls[1], ["current", carried.sessionId], "the preset is read from the parent session");
	assert.deepEqual(carried.calls[2], ["setPreset", "danger-full-access", true], "the switch lands on the child session");
	assert.deepEqual(carried.calls[3][1], { sessionId: "child-1", provider: "parent-provider", model: "parent-model", reasoningEffort: "high" });

	// A parent that never routed a request has no selection to carry, and the handoff is unchanged.
	// These four exercise the model carry on a profile without the permission service, so the
	// permission cases below stay independent of them.
	const unrouted = await run({ selectModel: true, requestHeader: () => undefined, presetsAbsent: true });
	assert.equal(unrouted.reply.kind, "success");
	assert.deepEqual(unrouted.calls.map(([kind]) => kind), ["create", "prompt"]);

	// An empty pair in the header is not a selection either: installing it would break the route.
	const blank = await run({ selectModel: true, requestHeader: () => ({ config: { provider: "", model: "" } }), presetsAbsent: true });
	assert.equal(blank.reply.kind, "success");
	assert.deepEqual(blank.calls.map(([kind]) => kind), ["create", "prompt"]);

	// Fail-open: a rejected selection, or a runtime without the call, must not fail a handoff whose
	// child already exists.
	const rejected = await run({ selectModel: "throw", requestHeader: routed, presetsAbsent: true });
	assert.equal(rejected.reply.kind, "success");
	assert.deepEqual(rejected.calls.map(([kind]) => kind), ["create", "selectModel", "prompt"]);
	const absent = await run({ selectModel: undefined, requestHeader: routed, presetsAbsent: true });
	assert.equal(absent.reply.kind, "success");
	assert.deepEqual(absent.calls.map(([kind]) => kind), ["create", "prompt"]);

	// The permission half, which the user reported as missing: a parent switched to full access must
	// not hand off into a child that asks for approval again.
	const permissive = await run({ selectModel: undefined, requestHeader: () => undefined, preset: "danger-full-access" });
	assert.equal(permissive.reply.kind, "success");
	assert.deepEqual(permissive.calls.map(([kind]) => kind), ["create", "current", "setPreset", "prompt"]);

	// `custom` means the effective knobs match no preset and is never a switch target.
	const custom = await run({ selectModel: undefined, requestHeader: () => undefined, preset: "custom" });
	assert.deepEqual(custom.calls.map(([kind]) => kind), ["create", "current", "prompt"]);

	// A child that is not resident, a profile without the service, and a rejected switch are all
	// fail-open: the handoff still completes with the child that was already created.
	const gone = await run({ selectModel: undefined, requestHeader: () => undefined, preset: "danger-full-access", resident: false });
	assert.deepEqual(gone.calls.map(([kind]) => kind), ["create", "prompt"], "no child session, nothing to switch");
	const noService = await run({ selectModel: undefined, requestHeader: () => undefined, preset: "danger-full-access", presetsAbsent: true });
	assert.deepEqual(noService.calls.map(([kind]) => kind), ["create", "prompt"]);
	const refused = await run({ selectModel: undefined, requestHeader: () => undefined, preset: "danger-full-access", setThrows: true });
	assert.equal(refused.reply.kind, "success");
	assert.deepEqual(refused.calls.map(([kind]) => kind), ["create", "current", "setPreset", "prompt"]);
});

test("the automatic handoff yields to a session that is already on its next turn", async () => {
	// `turn/end` is the trigger, but the harness pumps a queued user message into the next turn as
	// soon as the current one closes. On 2026-09-17 that turned an auto handoff into two sessions
	// editing this repo at once: the trigger fired at `turn/end` of turn 9, the queued message opened
	// turn 10 in the same second, and the child was created 8 seconds later — while the parent went on
	// to do the same fix. Both checks below must abandon the handoff *before* a child exists.
	const root = await mkdtemp(path.join(tmpdir(), "dsh-handoff-settle-"));
	const conversation = Array.from({ length: 40 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", "x".repeat(1500)));

	const run = async ({ events, startTurnOnSummary, startTurnOnCreate, startTurnOnPrompt, promptThrows, cancelThrows, cancelAbsent, emptySummary }) => {
		const calls = [];
		const renames = [];
		const cancels = [];
		const archives = [];
		const logs = [];
		const own = [...events];
		const controller = {
			create: async () => {
				calls.push("create");
				if (startTurnOnCreate) own.push({ type: "turn/start", seq: 11, time: Date.now() });
				return { sessionId: "child-1" };
			},
			rename: async (request) => { renames.push(request.title); },
			...(cancelAbsent ? {} : {
				cancel: async (request) => {
					cancels.push(request.sessionId);
					if (cancelThrows) throw new Error("cancel transport down");
				},
			}),
			prompt: async () => {
				calls.push("prompt");
				if (startTurnOnPrompt) own.push({ type: "turn/start", seq: 11, time: Date.now() });
				if (promptThrows) throw new Error("seed rejected");
			},
		};
		let summaryCalls = 0;
		const ctx = {
			get: (name) => (name === "sessionController" ? controller
				: name === "tokenMeter" ? { measure: () => ({ totalTokens: 150_000, surfaceTokens: 100_000 }) }
					: name === "workspaceRegistry" ? { resolveByPath: async () => undefined, archiveSession: async (id) => { archives.push(id); } }
						: undefined),
			llm: {
				resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
				stream: () => {
					summaryCalls += 1;
					return (async function* generate() {
						if (startTurnOnSummary) own.push({ type: "turn/start", seq: 11, time: Date.now() });
						if (emptySummary) return;
						yield { type: "text-delta", text: "## Goal\n\ncontinue the work" };
					})();
				},
			},
			logger: {
				info: (format, ...args) => { logs.push(`${format} ${args.join(" ")}`); },
				warn: (format, ...args) => { logs.push(`warn ${format} ${args.join(" ")}`); },
			},
		};
		const session = {
			id: `session-settle-${Math.random().toString(16).slice(2, 10)}`,
			header: { cwd: root, createdAt: Date.now() },
			deriveMessages: () => conversation,
			requestHeader: () => undefined,
			ownEvents: () => own,
			snapshotEvents: () => own,
		};
		let error;
		try {
			await maybeAutoHandoff(ctx, session, resolvePluginConfig({ provider: "test-provider", model: "test-model", handoffKeepTokens: 0 }), 10);
		} catch (caught) {
			error = caught;
		}
		return { calls, error, summaryCalls, renames, cancels, archives, logs };
	};

	const turnEnd = { type: "turn/end", seq: 10, time: Date.now() };

	// The session already opened the next turn before the auto path even started: defer without
	// paying for a summary call.
	const early = await run({ events: [turnEnd, { type: "turn/start", seq: 11, time: Date.now() }] });
	assert.ok(early.error instanceof HandoffDeferred, `expected a deferral, got ${early.error}`);
	assert.equal(early.summaryCalls, 0, "a session that is already working gets no summary call");
	assert.deepEqual(early.calls, []);

	// The turn opens *while* the summary runs — the race that actually happened. The summary is
	// already paid for, but the child must not be created and nothing must be left behind.
	const late = await run({ events: [turnEnd], startTurnOnSummary: true });
	assert.ok(late.error instanceof HandoffDeferred, `expected a deferral, got ${late.error}`);
	assert.equal(late.summaryCalls, 1);
	assert.deepEqual(late.calls, [], "no session is created once the parent moved on");
	assert.ok(!existsSync(path.join(root, ".agents", "memory", "HANDOFF.md")), "the check precedes the document write");

	// A moved-on session whose summary came back empty is still a *deferral*: the settle check
	// precedes the empty-summary verdict so the next attempt is not booked as a 5-minute failure.
	const emptyAndBusy = await run({ events: [turnEnd], startTurnOnSummary: true, emptySummary: true });
	assert.ok(emptyAndBusy.error instanceof HandoffDeferred, `expected a deferral, got ${emptyAndBusy.error}`);

	// The turn opens after the child was created but before it was seeded (the create RPC plus the
	// two carries are a wide window): the child must not be seeded, and it must not carry the switch
	// marker, or the browser half would follow the parent into a duplicate continuation.
	const duringCreate = await run({ events: [turnEnd], startTurnOnCreate: true });
	assert.ok(duringCreate.error instanceof HandoffDeferred, `expected a deferral, got ${duringCreate.error}`);
	assert.deepEqual(duringCreate.calls, ["create"], "the child is created but never seeded");
	assert.match(duringCreate.renames[0] ?? "", /^handoff deferred · /, "the switch marker is stripped");
	assert.ok(!existsSync(path.join(root, ".agents", "memory", "HANDOFF.md")), "the pre-prompt deferral writes no document either");
	assert.deepEqual(duringCreate.archives, ["child-1"], "the empty child is hidden from the workspace list");
	assert.deepEqual(duringCreate.cancels, [], "nothing was seeded, so there is no turn to cancel");

	// The turn opens inside the *prompt* RPC — the last window. The seed is already durable, so it is
	// cancelled, retitled and archived rather than left to run the duplicate continuation.
	const duringPrompt = await run({ events: [turnEnd], startTurnOnPrompt: true });
	assert.ok(duringPrompt.error instanceof HandoffDeferred, `expected a deferral, got ${duringPrompt.error}`);
	assert.deepEqual(duringPrompt.calls, ["create", "prompt"]);
	assert.deepEqual(duringPrompt.cancels, ["child-1"], "the admitted seed is cancelled");
	assert.match(duringPrompt.renames[0] ?? "", /^handoff deferred · /);
	assert.deepEqual(duringPrompt.archives, ["child-1"]);
	assert.ok(!existsSync(path.join(root, ".agents", "memory", "HANDOFF.md")), "the document is written only after the last check");

	// A child whose seed could not be cancelled may still be running the duplicate continuation, so
	// it must stay visible instead of being quietly archived.
	const cancelBroke = await run({ events: [turnEnd], startTurnOnPrompt: true, cancelThrows: true });
	assert.ok(cancelBroke.error instanceof HandoffDeferred, `expected a deferral, got ${cancelBroke.error}`);
	assert.deepEqual(cancelBroke.cancels, ["child-1"]);
	assert.match(cancelBroke.renames[0] ?? "", /^handoff deferred · /);
	assert.deepEqual(cancelBroke.archives, [], "an uncancelled child stays visible");
	assert.ok(cancelBroke.logs.some((line) => line.startsWith("warn")), "the failed cancel is reported");

	// A runtime without `cancel` cannot prove the child is idle: same rule, no warning to log.
	const noCancel = await run({ events: [turnEnd], startTurnOnPrompt: true, cancelAbsent: true });
	assert.ok(noCancel.error instanceof HandoffDeferred, `expected a deferral, got ${noCancel.error}`);
	assert.deepEqual(noCancel.cancels, []);
	assert.deepEqual(noCancel.archives, [], "an uncancelled child stays visible");
	// …while a child that was never sent a prompt needs no cancel to be safely hidden.
	const noCancelUnseeded = await run({ events: [turnEnd], startTurnOnCreate: true, cancelAbsent: true });
	assert.deepEqual(noCancelUnseeded.archives, ["child-1"], "an unseeded child is hidden without a cancel");

	// A genuine failure is not a deferral: the child stays visible under a failed title instead of
	// being archived, so the user can see that a handoff was attempted and broke.
	const broken = await run({ events: [turnEnd], promptThrows: true });
	assert.ok(!(broken.error instanceof HandoffDeferred) && broken.error !== undefined, `expected a failure, got ${broken.error}`);
	assert.deepEqual(broken.calls, ["create", "prompt"]);
	assert.match(broken.renames[0] ?? "", /^handoff failed · /);
	assert.deepEqual(broken.archives, [], "a failure stays visible");
	assert.deepEqual(broken.cancels, ["child-1"], "a rejected prompt may still have admitted the seed");

	// Control: a settled session still hands off, so the guard cannot pass by disabling the feature.
	const settled = await run({ events: [turnEnd, { type: "turn/start", seq: 4, time: Date.now() }] });
	assert.equal(settled.error, undefined);
	assert.deepEqual(settled.calls, ["create", "prompt"]);
	assert.equal(settled.renames.length, 1, "a successful handoff publishes the switch marker");
	assert.ok(settled.renames[0].startsWith("↪ handoff · "), `expected the switch marker, got ${settled.renames[0]}`);
	assert.deepEqual(settled.cancels, [], "a successful handoff cancels nothing");
	assert.deepEqual(settled.archives, [], "a successful handoff archives nothing");

	// The predicate itself: only a turn that started *after* the trigger defers.
	const session = { ownEvents: () => [{ type: "turn/start", seq: 4 }, { type: "turn/end", seq: 10 }], snapshotEvents: () => [] };
	assert.equal(turnStartedAfter(session, 10), false);
	assert.equal(turnStartedAfter(session, 3), true);
	assert.equal(turnStartedAfter({ ownEvents: () => [{ type: "turn/end", seq: 10 }], snapshotEvents: () => [] }, 10), false);
	// The trigger's own offset is not "after" the trigger.
	assert.equal(turnStartedAfter({ ownEvents: () => [{ type: "turn/start", seq: 10 }], snapshotEvents: () => [] }, 10), false);
	// A runtime without `ownEvents` falls back to the snapshot (the inherited prefix is older, so it
	// cannot read as this session's own later turn).
	assert.equal(turnStartedAfter({ snapshotEvents: () => [{ type: "turn/start", seq: 11 }] }, 10), true);
	assert.equal(turnStartedAfter({ snapshotEvents: () => [{ type: "turn/start", seq: 4 }] }, 10), false);
});

test("the auto-handoff listener passes the trigger offset through to the settle guard", async () => {
	// The listener is the only place that knows *which* `turn/end` fired, so an untested call site
	// could drop it and silently disable the guard (the mutated `event.seq` is invisible to the
	// direct `maybeAutoHandoff` tests above).
	const root = await mkdtemp(path.join(tmpdir(), "dsh-handoff-listener-"));
	const conversation = Array.from({ length: 40 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", "x".repeat(1500)));
	const own = [
		{ type: "turn/end", seq: 10, time: Date.now() },
		{ type: "turn/start", seq: 11, time: Date.now() },
	];
	const created = [];
	const logs = [];
	const handlers = {};
	let measures = 0;
	const session = {
		id: `session-listener-${Math.random().toString(16).slice(2, 10)}`,
		header: { cwd: root, createdAt: Date.now() },
		deriveMessages: () => conversation,
		requestHeader: () => undefined,
		ownEvents: () => own,
		snapshotEvents: () => own,
	};
	const ctx = {
		on: (name, handler) => { (handlers[name] ??= []).push(handler); return () => undefined; },
		effect: () => () => undefined,
		inject: () => () => undefined,
		commands: { register: () => () => undefined },
		logger: {
			info: (format, ...args) => { logs.push(`${format} ${args.join(" ")}`); },
			warn: (format, ...args) => { logs.push(`warn ${format} ${args.join(" ")}`); },
		},
		get: (name) => (name === "sessionController" ? {
			create: async () => { created.push(1); return { sessionId: "child-1" }; },
			rename: async () => undefined,
			prompt: async () => undefined,
		} : name === "tokenMeter" ? { measure: () => { measures += 1; return { totalTokens: 150_000, surfaceTokens: 100_000 }; } } : undefined),
		llm: {
			resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
			stream: () => (async function* generate() { yield { type: "text-delta", text: "## Goal\n\ncontinue" }; })(),
		},
	};
	apply(ctx, { provider: "test-provider", model: "test-model", handoffKeepTokens: 0 });
	const listener = handlers["session/event"]?.[0];
	assert.ok(listener, "apply registers a session/event listener");
	const waitFor = async (predicate) => {
		for (let i = 0; i < 400 && !predicate(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
	};
	const deferrals = () => logs.filter((line) => line.includes("automatic handoff deferred")).length;

	// Round 1: the session is already on its next turn — the guard must defer.
	listener(session, { type: "turn/end", seq: 10, time: Date.now() });
	await waitFor(() => deferrals() > 0);
	assert.equal(deferrals(), 1, `expected one deferral log, got ${JSON.stringify(logs)}`);
	assert.deepEqual(created, [], "a session that is already on its next turn gets no child");
	assert.ok(!logs.some((line) => line.startsWith("warn")), "a deferral is not a failure");

	// Round 2: still busy. The rate limit keeps this from spamming the log, and the offset must be
	// the *triggering* one — a constant would make a settled session defer too (round 3). Reaching
	// the measurement again also proves the deferral released the pressure throttle.
	own.push({ type: "turn/end", seq: 12, time: Date.now() }, { type: "turn/start", seq: 13, time: Date.now() });
	listener(session, { type: "turn/end", seq: 12, time: Date.now() });
	await waitFor(() => measures >= 2);
	assert.ok(measures >= 2, "the deferral released the pressure throttle");
	assert.equal(deferrals(), 1, "a second deferral inside the interval is not logged again");
	assert.deepEqual(created, []);

	// Round 3: the session truly settled (no `turn/start` after the trigger). The deferral must not
	// have wedged the session — no failure backoff, no stale in-flight marker, no spent throttle.
	own.push({ type: "turn/end", seq: 14, time: Date.now() });
	listener(session, { type: "turn/end", seq: 14, time: Date.now() });
	await waitFor(() => created.length > 0);
	assert.equal(created.length, 1, "the next settled turn/end hands off normally");
	assert.ok(!logs.some((line) => line.startsWith("warn")), "no deferral was recorded as a failure");
	assert.ok(!existsSync(path.join(root, ".agents", "memory", "errors.log")), "a deferral writes no errors.log");
});

test("a turn/end that lands while an attempt is in flight is re-evaluated, not lost", async () => {
	// One attempt runs per session. A `turn/end` arriving mid-attempt used to be dropped outright, so
	// a *settled* turn could pass unevaluated — and if the user then stopped, the session never handed
	// off at all. The finished attempt must re-run against that trigger.
	const root = await mkdtemp(path.join(tmpdir(), "dsh-handoff-pending-"));
	const conversation = Array.from({ length: 40 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", "x".repeat(1500)));
	const own = [
		{ type: "turn/end", seq: 10, time: Date.now() },
		{ type: "turn/start", seq: 11, time: Date.now() },
		{ type: "turn/end", seq: 12, time: Date.now() },
		{ type: "turn/start", seq: 13, time: Date.now() },
		{ type: "turn/end", seq: 14, time: Date.now() },
	];
	const created = [];
	const logs = [];
	const handlers = {};
	const session = {
		id: `session-pending-${Math.random().toString(16).slice(2, 10)}`,
		header: { cwd: root, createdAt: Date.now() },
		deriveMessages: () => conversation,
		requestHeader: () => undefined,
		ownEvents: () => own,
		snapshotEvents: () => own,
	};
	const ctx = {
		on: (name, handler) => { (handlers[name] ??= []).push(handler); return () => undefined; },
		effect: () => () => undefined,
		inject: () => () => undefined,
		commands: { register: () => () => undefined },
		logger: { info: (format, ...args) => { logs.push(`${format} ${args.join(" ")}`); }, warn: (format, ...args) => { logs.push(`warn ${format} ${args.join(" ")}`); } },
		get: (name) => (name === "sessionController" ? {
			create: async () => { created.push(1); return { sessionId: "child-1" }; },
			rename: async () => undefined,
			prompt: async () => undefined,
		} : name === "tokenMeter" ? { measure: () => ({ totalTokens: 150_000, surfaceTokens: 100_000 }) } : undefined),
		llm: {
			resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
			stream: () => (async function* generate() { yield { type: "text-delta", text: "## Goal\n\ncontinue" }; })(),
		},
	};
	apply(ctx, { provider: "test-provider", model: "test-model", handoffKeepTokens: 0 });
	const listener = handlers["session/event"]?.[0];
	assert.ok(listener, "apply registers a session/event listener");

	// seq 10 is busy (turn/start 11 follows); seq 12 is busy too; seq 14 is the settled turn. All
	// fire before the first attempt can finish, and the *newest* trigger is the one that matters —
	// keeping the oldest would stall on a busy turn and never hand off.
	listener(session, { type: "turn/end", seq: 10, time: Date.now() });
	listener(session, { type: "turn/end", seq: 12, time: Date.now() });
	listener(session, { type: "turn/end", seq: 14, time: Date.now() });
	for (let i = 0; i < 400 && created.length === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(created.length, 1, "the settled turn/end was evaluated after the in-flight attempt");
	assert.equal(logs.filter((line) => line.includes("automatic handoff deferred")).length, 1);
	assert.ok(!logs.some((line) => line.startsWith("warn")), `unexpected failure log: ${JSON.stringify(logs)}`);

	// A session disposed while an attempt is in flight must not be resurrected by the retry: the
	// dispose handler clears the pending trigger.
	const disposedOwn = [
		{ type: "turn/end", seq: 20, time: Date.now() },
		{ type: "turn/start", seq: 21, time: Date.now() },
		{ type: "turn/end", seq: 22, time: Date.now() },
	];
	const disposedSession = { ...session, id: `session-disposed-${Math.random().toString(16).slice(2, 10)}`, ownEvents: () => disposedOwn, snapshotEvents: () => disposedOwn };
	const dispose = handlers["session/disposed"]?.[0];
	assert.ok(dispose, "apply registers a session/disposed handler");
	listener(disposedSession, { type: "turn/end", seq: 20, time: Date.now() });
	listener(disposedSession, { type: "turn/end", seq: 22, time: Date.now() });
	dispose(disposedSession);
	for (let i = 0; i < 40 && !logs.some((line) => line.includes("deferred")); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert.equal(created.length, 1, "the disposed session was not handed off after disposal");
});

test("the in-flight retry honours the same gates as a fresh attempt", async () => {
	// The retry runs through `attempt()`, so it must re-check `handedOff`, `handoffEnabled` and the
	// failure backoff instead of blindly handing off again.
	const root = await mkdtemp(path.join(tmpdir(), "dsh-handoff-retry-"));
	const conversation = Array.from({ length: 40 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", "x".repeat(1500)));
	const make = (stream) => {
		const created = [];
		const prompts = [];
		const logs = [];
		const handlers = {};
		const session = {
			id: `session-retry-${Math.random().toString(16).slice(2, 10)}`,
			header: { cwd: root, createdAt: Date.now() },
			deriveMessages: () => conversation,
			requestHeader: () => undefined,
			ownEvents: () => [{ type: "turn/end", seq: 10, time: Date.now() }],
			snapshotEvents: () => [],
		};
		const ctx = {
			on: (name, handler) => { (handlers[name] ??= []).push(handler); return () => undefined; },
			effect: () => () => undefined,
			inject: () => () => undefined,
			commands: { register: () => () => undefined },
			logger: { info: (format, ...args) => { logs.push(`${format} ${args.join(" ")}`); }, warn: (format, ...args) => { logs.push(`warn ${format} ${args.join(" ")}`); } },
			get: (name) => (name === "sessionController" ? {
				create: async () => { created.push(1); return { sessionId: "child-1" }; },
				rename: async () => undefined,
				prompt: async () => { prompts.push(1); },
			} : name === "tokenMeter" ? { measure: () => ({ totalTokens: 150_000, surfaceTokens: 100_000 }) } : undefined),
			llm: {
				resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
				stream: stream ?? (() => (async function* generate() { yield { type: "text-delta", text: "## Goal\n\ncontinue" }; })()),
			},
		};
		apply(ctx, { provider: "test-provider", model: "test-model", handoffKeepTokens: 0 });
		return { created, prompts, logs, listener: handlers["session/event"]?.[0], session };
	};
	const waitFor = async (predicate) => {
		for (let i = 0; i < 400 && !predicate(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
	};

	// A settled trigger recorded during a *successful* attempt must not hand the same session off
	// twice, and a *failed* attempt keeps its backoff: both retries go through `attempt()`. The
	// interval is 0 so the pressure throttle cannot hide a missing re-check (a retry within the
	// production interval would be dropped by the throttle before either gate could be observed).
	setPressureCheckIntervalMs(0);
	try {
		const twice = make();
		twice.listener(twice.session, { type: "turn/end", seq: 10, time: Date.now() });
		twice.listener(twice.session, { type: "turn/end", seq: 12, time: Date.now() });
		await waitFor(() => twice.created.length > 0);
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.equal(twice.created.length, 1, "one handoff per session, even with a pending trigger");
		assert.equal(twice.prompts.length, 1);

		const failed = make(() => { throw new Error("summary exploded"); });
		failed.listener(failed.session, { type: "turn/end", seq: 10, time: Date.now() });
		failed.listener(failed.session, { type: "turn/end", seq: 12, time: Date.now() });
		await waitFor(() => failed.logs.some((line) => line.startsWith("warn")));
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.equal(failed.logs.filter((line) => line.startsWith("warn")).length, 1, "the backoff suppresses the retry");
		assert.deepEqual(failed.created, []);
	} finally {
		setPressureCheckIntervalMs(15_000);
	}
});

test("a disabled automatic handoff ignores turn/end entirely", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "dsh-handoff-off-"));
	const conversation = Array.from({ length: 40 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", "x".repeat(1500)));
	const created = [];
	const handlers = {};
	let summaryCalls = 0;
	const session = {
		id: `session-off-${Math.random().toString(16).slice(2, 10)}`,
		header: { cwd: root, createdAt: Date.now() },
		deriveMessages: () => conversation,
		requestHeader: () => undefined,
		ownEvents: () => [{ type: "turn/end", seq: 10, time: Date.now() }],
		snapshotEvents: () => [],
	};
	const ctx = {
		on: (name, handler) => { (handlers[name] ??= []).push(handler); return () => undefined; },
		effect: () => () => undefined,
		inject: () => () => undefined,
		commands: { register: () => () => undefined },
		logger: { info() {}, warn() {} },
		get: (name) => (name === "sessionController" ? {
			create: async () => { created.push(1); return { sessionId: "child-1" }; },
			rename: async () => undefined,
			prompt: async () => undefined,
		} : name === "tokenMeter" ? { measure: () => ({ totalTokens: 150_000, surfaceTokens: 100_000 }) } : undefined),
		llm: {
			resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
			stream: () => { summaryCalls += 1; return (async function* generate() { yield { type: "text-delta", text: "## Goal\n\ncontinue" }; })(); },
		},
	};
	setPressureCheckIntervalMs(0);
	try {
		apply(ctx, { provider: "test-provider", model: "test-model", handoffEnabled: false, handoffKeepTokens: 0 });
		handlers["session/event"]?.[0](session, { type: "turn/end", seq: 10, time: Date.now() });
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.deepEqual(created, [], "the switch is off");
		assert.equal(summaryCalls, 0, "a disabled handoff never reaches the model");
	} finally {
		setPressureCheckIntervalMs(15_000);
	}
});

test("a nothing-to-summarize skip and a deferral have separate log gates", async () => {
	// Both logs are rate-limited per session, but they answer different questions: whichever fires
	// first must not silence the other for the next ten minutes.
	const root = await mkdtemp(path.join(tmpdir(), "dsh-handoff-logs-"));
	const conversation = Array.from({ length: 40 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", "x".repeat(1500)));
	const own = [{ type: "turn/end", seq: 10, time: Date.now() }, { type: "turn/start", seq: 11, time: Date.now() }];
	const logs = [];
	const handlers = {};
	const session = {
		id: `session-logs-${Math.random().toString(16).slice(2, 10)}`,
		header: { cwd: root, createdAt: Date.now() },
		deriveMessages: () => conversation,
		requestHeader: () => undefined,
		ownEvents: () => own,
		snapshotEvents: () => own,
	};
	const ctx = {
		on: (name, handler) => { (handlers[name] ??= []).push(handler); return () => undefined; },
		effect: () => () => undefined,
		inject: () => () => undefined,
		commands: { register: () => () => undefined },
		logger: { info: (format, ...args) => { logs.push(`${format} ${args.join(" ")}`); }, warn: (format, ...args) => { logs.push(`warn ${format} ${args.join(" ")}`); } },
		get: (name) => (name === "sessionController" ? {
			create: async () => ({ sessionId: "child-1" }),
			rename: async () => undefined,
			prompt: async () => undefined,
		} : name === "tokenMeter" ? { measure: () => ({ totalTokens: 150_000, surfaceTokens: 100_000 }) } : undefined),
		llm: {
			resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
			stream: () => (async function* generate() { yield { type: "text-delta", text: "## Goal\n\ncontinue" }; })(),
		},
	};
	apply(ctx, { provider: "test-provider", model: "test-model", handoffKeepTokens: 1_000 });
	const listener = handlers["session/event"]?.[0];
	const waitFor = async (predicate) => {
		for (let i = 0; i < 400 && !predicate(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
	};

	// Round 1: the turn is already running, so the attempt defers (and logs it).
	listener(session, { type: "turn/end", seq: 10, time: Date.now() });
	await waitFor(() => logs.some((line) => line.includes("deferred")));
	assert.equal(logs.filter((line) => line.includes("automatic handoff deferred")).length, 1, `expected a deferral log, got ${JSON.stringify(logs)}`);

	// Round 2: the conversation now fits the carried window, so the attempt reports a skip instead.
	conversation.length = 0;
	conversation.push(message("user", "hello"), message("assistant", "hi"));
	own.push({ type: "turn/end", seq: 12, time: Date.now() });
	listener(session, { type: "turn/end", seq: 12, time: Date.now() });
	await waitFor(() => logs.some((line) => line.includes("fits the recent window")));
	assert.equal(logs.filter((line) => line.includes("fits the recent window")).length, 1, `the deferral must not mute the skip, got ${JSON.stringify(logs)}`);
});

test("the manual handoff stays exempt from the settle guard", async () => {
	// `/handoff now` executes *inside* its own turn, so a `turn/start` in the log can never mean the
	// user moved on; applying the guard there would make the command useless.
	const root = await mkdtemp(path.join(tmpdir(), "dsh-handoff-manual-settle-"));
	const conversation = Array.from({ length: 40 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", "x".repeat(1500)));
	const calls = [];
	const session = {
		id: `session-manual-settle-${Math.random().toString(16).slice(2, 10)}`,
		header: { cwd: root, createdAt: Date.now() },
		deriveMessages: () => conversation,
		requestHeader: () => undefined,
		ownEvents: () => [{ type: "turn/start", seq: 5, time: Date.now() }, { type: "turn/end", seq: 6, time: Date.now() }],
		snapshotEvents: () => [],
	};
	const ctx = {
		get: (name) => (name === "sessionController" ? {
			create: async () => { calls.push("create"); return { sessionId: "child-1" }; },
			rename: async () => undefined,
			prompt: async () => { calls.push("prompt"); },
		} : undefined),
		llm: {
			resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
			stream: () => (async function* generate() { yield { type: "text-delta", text: "## Goal\n\ncontinue" }; })(),
		},
		logger: { info() {}, warn() {} },
	};
	const reply = await runManual(ctx, session, resolvePluginConfig({ provider: "test-provider", model: "test-model", handoffKeepTokens: 0 }), new AbortController().signal);
	assert.equal(reply.kind, "success", `expected a handoff, got ${JSON.stringify(reply)}`);
	assert.deepEqual(calls, ["create", "prompt"]);
	assert.equal(turnStartedAfter(session, 0), true, "the fixture really does look busy");
});

test("tool results reach the live transcript, not just the tool name", () => {
	// The live renderer reads `deriveMessages()`, where a tool result is a user-role message whose
	// single block is a `tool-result` wrapper. `textOf` used to read only `text` blocks, so every
	// output rendered empty and the section was dropped — the handoff tail carried 355 `[tool: …]`
	// stubs with zero results, and the consolidation prompt never saw a command's output.
	const toolResult = { type: "tool-result", toolCallId: "c1", content: [{ type: "text", text: "all green" }] };
	assert.equal(textOf([toolResult]), "all green");
	assert.equal(textOf([{ type: "image", attachment: {} }, toolResult]), "all green");

	const session = {
		deriveMessages: () => [
			{ role: "user", source: { kind: "user" }, content: [{ type: "text", text: "run the suite" }] },
			{ role: "assistant", source: { kind: "model" }, content: [{ type: "tool-call", id: "c1", name: "bash", arguments: "{}" }] },
			{ role: "user", source: { kind: "tool", callId: "c1" }, content: [toolResult] },
		],
	};
	const transcript = conversationText(session);
	assert.match(transcript, /## assistant\n\[tool: bash\]/);
	assert.match(transcript, /## tool result\nall green/, "the output is in the transcript the summarizer reads");
});
