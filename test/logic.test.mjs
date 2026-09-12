/**
 * Unit tests for the pure plugin logic: threshold math, ratio/token parsing,
 * conversation splitting, CONTEXT.md rendering, the mechanical session index,
 * and the consolidation/autolearn parsers. Run `pnpm test`, which builds
 * `lib/` first and then runs `node --test test/*.test.mjs`.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { continuation, parseRatio, parseTokenCount, resolveThreshold } from "../lib/handoff.js";
import { DEFAULT_CONFIG } from "../lib/shared/config.js";
import { renderContextDocument } from "../lib/shared/context-doc.js";
import { conversationSplit, parseConsolidation } from "../lib/shared/learn.js";
import { parseAutolearn } from "../lib/shared/autolearn.js";
import { parseSessionIndex, queueSessionIndexEntry, sessionIndexLine } from "../lib/shared/session-index.js";
import { safeSessionId, validSkillName } from "../lib/shared/project-state.js";

function message(role, text) {
	return { role, source: { kind: role }, content: [{ type: "text", text }] };
}

function fakeSession(messages) {
	return { deriveMessages: () => messages };
}

test("conversationSplit keeps the tail whole and summarizes the rest", () => {
	const session = fakeSession([
		message("user", "first question"),
		message("assistant", "first answer"),
		message("user", "second question"),
	]);

	const everything = conversationSplit(session, 0);
	assert.equal(everything.tail, "");
	assert.match(everything.older, /first question/);
	assert.match(everything.older, /second question/);

	const split = conversationSplit(session, 10);
	assert.match(split.tail, /second question/);
	assert.doesNotMatch(split.tail, /first question/);
	assert.match(split.older, /first question/);
	assert.doesNotMatch(split.older, /second question/);
});

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
	assert.doesNotMatch(document, /## Session index/);
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

test("parseAutolearn separates a skill from a backtrack request", () => {
	const direct = parseAutolearn(JSON.stringify({ skill: { name: "n", description: "d", body: "b" }, need_sessions: [] }));
	assert.equal(direct.skill.name, "n");
	assert.deepEqual(direct.needSessions, []);

	const backlog = parseAutolearn('```json\n{"skill": null, "need_sessions": ["session-a", "", "session-b", "session-c", "session-d"]}\n```');
	assert.equal(backlog.skill, null);
	assert.deepEqual(backlog.needSessions, ["session-a", "session-b", "session-c"]);

	assert.deepEqual(parseAutolearn("not json"), { skill: null, needSessions: [] });
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
