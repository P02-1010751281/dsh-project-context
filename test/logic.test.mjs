/**
 * Unit tests for the pure plugin logic: threshold math, ratio/token parsing,
 * conversation splitting, and CONTEXT.md rendering. Run `pnpm test`, which
 * builds `lib/` first and then runs `node --test test/`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { parseRatio, parseTokenCount, resolveThreshold } from "../lib/handoff.js";
import { DEFAULT_CONFIG } from "../lib/shared/config.js";
import { renderContextDocument, sessionIndexLine } from "../lib/shared/context-doc.js";
import { conversationSplit } from "../lib/shared/learn.js";
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
const INDEX_OPTIONS = {
	sessionLine: sessionIndexLine(INDEX_SESSION, "audit"),
	sessionId: "session-abcdef",
	updatedAt: new Date(Date.UTC(2026, 8, 12)).toISOString(),
};

test("renderContextDocument keeps the session index when lists overflow the budget", () => {
	const update = {
		title: "audit",
		summary: "s".repeat(6_000),
		key_points: Array.from({ length: 200 }, () => "p".repeat(800)),
		open_tasks: Array.from({ length: 200 }, () => "t".repeat(800)),
	};
	const document = renderContextDocument("", update, INDEX_OPTIONS);
	assert.ok(document.length <= 32_000, `document is ${document.length} chars`);
	assert.match(document, /## Session index/);
	assert.match(document, /- \[session-abcdef\]\(session-logs\/session-abcdef\/session\.md\)/);
	assert.ok(document.includes("<!-- latest-session-title: audit -->"));
});

test("renderContextDocument preserves short lists verbatim", () => {
	const update = { title: "small", summary: "summary", key_points: ["k1", "k2"], open_tasks: ["o1"] };
	const document = renderContextDocument("", update, INDEX_OPTIONS);
	assert.match(document, /- k1/);
	assert.match(document, /- k2/);
	assert.match(document, /- o1/);
	assert.ok(document.length < 32_000);
});

test("session ids and skill names stay filesystem-safe", () => {
	assert.equal(safeSessionId("session-../../etc"), "session-..-..-etc");
	assert.equal(safeSessionId(""), "ephemeral");
	assert.equal(validSkillName("my-skill"), true);
	assert.equal(validSkillName("../evil"), false);
});
