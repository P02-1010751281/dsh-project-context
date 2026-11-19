/**
 * Pins for the carried-state statement of a handoff seed (pi post-J `carryKept` / `carryTrimmed` /
 * `carryNothing`).
 *
 * The friction this closes: with the recent budget raised off zero the seed carries a verbatim tail
 * again, and a tail that contained a message cut at the render cap would still be announced as
 * "carried over verbatim" — a wrong cause, which is the defect class this repo treats as its worst.
 * With a zero budget the seed used to say nothing at all, so a successor could not tell "nothing was
 * carried, read the log" from "there is nothing to know".
 *
 * These drive the real reader (`handoffSplit`) and the real generator (`continuation`), so they fail
 * if the two drift apart. The negative control matters as much as the positive one: a seed that said
 * "trimmed" for every tail, or that rendered the last-input block beside a tail that already contains
 * it, would pass the positive cases while re-introducing the defect in the other direction.
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { handoffSplit } from "../lib/project-handoff/conversation.js";
import { isHandoffContinuationText, SCAFFOLDING } from "../lib/project-handoff/language.js";
import { handoffArtifacts } from "../lib/project-handoff/perform.js";
import { continuation } from "../lib/project-handoff/summary.js";
import { DEFAULT_CONFIG } from "../lib/shared/config.js";
import { sessionViews } from "./session-views.mjs";

const ARCHIVE = { log: "/abs/logs/session-parent/session.md", index: "/abs/logs/INDEX.md" };
const FILES = "<read-files>\nsrc/project-handoff/summary.ts\n</read-files>";
/** A typed decision, the shape `handoffCarry` produces for a plain user message. */
const DECISION = { kind: "message", text: "重启吧", entries: [] };

function userMessage(text, kind = "user") {
	return { role: "user", source: { kind }, content: [{ type: "text", text }] };
}

function assistantMessage(text) {
	return { role: "assistant", source: { kind: "model" }, content: [{ type: "text", text }] };
}

function toolResult(text) {
	return { role: "tool", source: { kind: "tool", callId: "call_1" }, toolCallId: "call_1", content: [{ type: "text", text }] };
}

function fakeSession(messages) {
	// `handoffArtifacts` also renders the archived document, which reads the session header.
	return { id: "session-parent", header: { cwd: "/tmp/dsh-handoff-carry" }, ...sessionViews(messages) };
}

/** A short conversation whose sections all sit under their render caps. */
function plainSession() {
	return fakeSession([userMessage("先看 journal"), assistantMessage("看过了，重启即可。")]);
}

test("a tail with no clipped section is announced as carried verbatim", () => {
	const split = handoffSplit(plainSession(), 100_000);
	assert.equal(split.trimmedTail, false, "no section exceeded its render cap");
	const prompt = continuation("session-parent", FILES, split.tail, ARCHIVE);
	assert.ok(prompt.includes(SCAFFOLDING.en.continuationCarried));
	assert.ok(!prompt.includes(SCAFFOLDING.en.continuationTrimmed), "a clean tail is never announced as trimmed");
	assert.ok(!prompt.includes(SCAFFOLDING.en.continuationNothing), "carried is not nothing");
	// The block now holds the tail alone; the statement lives above it, where a reader meets it first.
	assert.ok(prompt.includes(`<recent-conversation>\n${split.tail}\n</recent-conversation>`));
});

test("a message cut at the render cap makes the tail trimmed, not verbatim", () => {
	const long = "x".repeat(4001);
	const session = fakeSession([userMessage("早期消息"), userMessage(long, "user")]);
	const split = handoffSplit(session, 100_000);
	assert.equal(split.trimmedTail, true, "the 4001-character message is reported as clipped");
	assert.ok(split.tail.includes("[...truncated...]"));
	const prompt = continuation("session-parent", FILES, split.tail, ARCHIVE, "en", undefined, undefined, split.trimmedTail);
	assert.ok(prompt.includes(SCAFFOLDING.en.continuationTrimmed));
	assert.ok(!prompt.includes(SCAFFOLDING.en.continuationCarried), "a clipped tail must not claim verbatim carriage");
});

test("a clipped tool result counts too, at its own smaller cap", () => {
	const session = fakeSession([userMessage("跑一下"), toolResult("y".repeat(1501))]);
	const split = handoffSplit(session, 100_000);
	assert.equal(split.trimmedTail, true);
});

test("a zero budget announces that nothing was carried, instead of saying nothing", () => {
	const split = handoffSplit(plainSession(), 0);
	assert.equal(split.tail, "");
	assert.equal(split.trimmedTail, false, "an empty tail is not a trimmed one");
	const prompt = continuation("session-parent", FILES, split.tail, ARCHIVE);
	assert.ok(prompt.includes(SCAFFOLDING.en.continuationNothing));
	assert.ok(!prompt.includes("<recent-conversation>"), "no block is rendered for an empty tail");
	assert.ok(!prompt.includes(SCAFFOLDING.en.continuationCarried));
	assert.ok(!prompt.includes(SCAFFOLDING.en.continuationTrimmed));
});

test("the last-input block is rendered only when the tail cannot carry it", () => {
	const carried = continuation("session-parent", FILES, "## user\n重启吧", ARCHIVE, "en", undefined, DECISION);
	assert.ok(!carried.includes(SCAFFOLDING.en.decisionHeading), "the tail already carries the user's input");
	assert.ok(!carried.includes(SCAFFOLDING.en.decisionClosing), "and the carried decision's closing would duplicate it");
	assert.ok(carried.endsWith(SCAFFOLDING.en.continuationClosing));

	const empty = continuation("session-parent", FILES, "", ARCHIVE, "en", undefined, DECISION);
	assert.ok(empty.includes(SCAFFOLDING.en.decisionHeading), "with no tail the block is the only carrier");
	assert.ok(empty.includes(DECISION.text));
	assert.ok(empty.endsWith(SCAFFOLDING.en.decisionClosing));
});

test("the pending question is carried whether or not a tail is", () => {
	for (const tail of ["", "## user\n重启吧"]) {
		const prompt = continuation("session-parent", FILES, tail, ARCHIVE, "en", "Which branch?", DECISION);
		assert.ok(prompt.includes(SCAFFOLDING.en.pendingHeading), `pending block missing for tail=${tail.length}`);
		assert.ok(prompt.includes("Which branch?"));
		assert.ok(prompt.endsWith(SCAFFOLDING.en.pendingWait), "a wait handoff ends on the wait line in both shapes");
	}
});

test("every carried-state shape is still recognized as our own seed", () => {
	// `humanUserText` reuses this predicate, so a seed that stopped being recognized would be counted
	// as a human turn and would make the continuation's own title/label read the banner as an input.
	const shapes = [
		continuation("session-parent", FILES, "## user\n重启吧", ARCHIVE),
		continuation("session-parent", FILES, "## user\n重启吧", ARCHIVE, "en", undefined, undefined, true),
		continuation("session-parent", FILES, "", ARCHIVE),
		continuation("session-parent", FILES, "", ARCHIVE, "en", undefined, DECISION),
		continuation("session-parent", FILES, "## user\n重启吧", ARCHIVE, "en", "Which branch?"),
	];
	for (const prompt of shapes) assert.ok(isHandoffContinuationText(prompt), prompt.slice(0, 60));
	// Negative control: the predicate is structural, not "contains a marker somewhere".
	assert.ok(!isHandoffContinuationText(`no banner here\n<handoff></handoff>\n${SCAFFOLDING.en.continuationClosing}`));
});

test("the wiring passes the split's trimmed flag through to the seed", () => {
	const session = fakeSession([userMessage("早期"), userMessage("z".repeat(4001), "user")]);
	const split = handoffSplit(session, 100_000);
	const config = { ...DEFAULT_CONFIG, handoffBudgetRecentTokens: 20_000 };
	const { prompt } = handoffArtifacts({ session, config, language: "en", fileOperations: FILES, archive: ARCHIVE, pointers: ARCHIVE, tail: split.tail, trimmedTail: split.trimmedTail });
	assert.ok(prompt.includes(SCAFFOLDING.en.continuationTrimmed), "handoffArtifacts must forward trimmedTail");
});

const NOTICE = {
	parentId: "session-parent",
	tailMessages: 12,
	carriedTokens: 20_000,
	olderMessages: 143,
	files: 1,
	openQuestion: false,
	log: ARCHIVE.log,
};

test("the seed tells the person what was carried and what stayed behind", () => {
	const prompt = continuation("session-parent", FILES, "## user\n重启吧", ARCHIVE, "en", undefined, undefined, false, NOTICE);
	assert.ok(prompt.startsWith(SCAFFOLDING.en.continuationPrefix), "the notice never displaces the recognized opening");
	assert.ok(prompt.includes("Carried over: the last 12 message(s) (~20000 tokens) and an index of 1 file(s)"), prompt.slice(0, 400));
	assert.ok(prompt.includes("The earlier 143 message(s) are **not** in this session"));
	assert.ok(prompt.includes(ARCHIVE.log), "the transcript path is the one the payload also names");
	assert.ok(isHandoffContinuationText(prompt), "a seed with the note is still recognized as our own prompt");
});

test("the notice states a zero tail as zero, not as a missing field", () => {
	const prompt = continuation("session-parent", FILES, "", ARCHIVE, "en", undefined, undefined, false, { ...NOTICE, tailMessages: 0, carriedTokens: 0, openQuestion: true });
	assert.ok(prompt.includes("No message was carried over verbatim under the current setting"));
	assert.ok(prompt.includes("plus the one open question"));
});

test("a seed rendered without the notice keeps its old shape", () => {
	assert.ok(!continuation("session-parent", FILES, "## user\n重启吧", ARCHIVE).includes("Note for you"));
});

test("the notice follows the seed's language", () => {
	const prompt = continuation("session-parent", FILES, "## user\n重启", ARCHIVE, "zh", undefined, undefined, false, NOTICE);
	assert.ok(prompt.includes("> 说明（给用户）：这是从会话 session-parent 续接的新会话"));
	assert.ok(prompt.includes("更早的 143 条消息**不在本会话里**"));
	assert.ok(isHandoffContinuationText(prompt));
});

test("the wiring renders the notice from the split the seed actually used", () => {
	const session = fakeSession([userMessage("a"), userMessage("b"), userMessage("c")]);
	const split = handoffSplit(session, 13);
	assert.equal(split.olderMessages, 2, "the fixture must actually drop two messages");
	assert.equal(split.tailMessages, 1);
	const { prompt } = handoffArtifacts({
		session,
		config: DEFAULT_CONFIG,
		language: "en",
		fileOperations: FILES,
		archive: ARCHIVE,
		pointers: ARCHIVE,
		tail: split.tail,
		trimmedTail: split.trimmedTail,
		notice: { ...NOTICE, tailMessages: split.tailMessages, olderMessages: split.olderMessages },
	});
	assert.ok(prompt.includes("The earlier 2 message(s)"), "the number is the split's own, not a re-count");
	assert.equal(split.olderMessages + split.tailMessages, 3, "every message is counted exactly once");
});

test("the statement follows the seed's language", () => {
	const zhCarried = continuation("session-parent", FILES, "## user\n重启", ARCHIVE, "zh");
	assert.ok(zhCarried.includes(SCAFFOLDING.zh.continuationCarried));
	const zhNothing = continuation("session-parent", FILES, "", ARCHIVE, "zh");
	assert.ok(zhNothing.includes(SCAFFOLDING.zh.continuationNothing));
	const zhTrimmed = continuation("session-parent", FILES, "## user\n重启", ARCHIVE, "zh", undefined, undefined, true);
	assert.ok(zhTrimmed.includes(SCAFFOLDING.zh.continuationTrimmed));
});
