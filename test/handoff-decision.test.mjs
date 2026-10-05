/**
 * Pins for carrying the user's own last input into a continuation, whatever channel carried it.
 *
 * The friction this closes: a session had already settled a question, the handoff summarized it into
 * prose, and the successor put the same question back to the user. Two things made that possible.
 * `handoffBudgetRecentTokens: 0` leaves no verbatim tail, and the carried-over state was read from
 * wording (does the last assistant message end in a question?) and from `user` text blocks only — so
 * an answer given through `ask_user_question` was invisible, and a plain typed decision was invisible
 * as soon as the summary prose compressed it away.
 *
 * These tests drive the real reader (`handoffCarry`) and the real generator (`continuation`), so they
 * fail if the two drift apart. The negative control matters as much as the positive one: a carrier
 * that skipped every user message, or that treated the handoff's own banner as a decision, would pass
 * the positive cases while re-introducing the bug.
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { handoffCarry, pendingQuestion } from "../lib/project-handoff/conversation.js";
import { isHandoffContinuationText, SCAFFOLDING } from "../lib/project-handoff/language.js";
import { handoffArtifacts } from "../lib/project-handoff/perform.js";
import { continuation } from "../lib/project-handoff/summary.js";
import { DEFAULT_CONFIG } from "../lib/shared/config.js";

const ARCHIVE = { log: "logs/session-parent/session.md", index: "logs/INDEX.md" };
const ASK = "ask_user_question";

/** One `ask_user_question` call, in the shape the model produces it. */
const ASK_ARGS = {
	questions: [
		{
			id: "next",
			header: "下一步",
			question: "修复已就绪但宿主未加载。接下来怎么做？",
			options: [
				{ label: "我去重启桌面宿主（推荐）", description: "重启后我做加载验收。" },
				{ label: "先不重启，直接跑 /memory update", description: "大概率再次 lossy-refused。" },
			],
		},
	],
};

function userMessage(text, kind = "user") {
	return { role: "user", source: { kind }, content: [{ type: "text", text }] };
}

function assistantMessage(blocks) {
	return { role: "assistant", source: { kind: "model" }, content: blocks };
}

function askCall(id, args = ASK_ARGS) {
	return { type: "tool-call", id, name: ASK, arguments: JSON.stringify(args) };
}

function toolResult(callId, text) {
	return { role: "tool", source: { kind: "tool", callId }, toolCallId: callId, content: [{ type: "text", text }] };
}

function fakeSession(messages) {
	return { deriveMessages: () => messages };
}

test("a typed user message is carried verbatim", () => {
	const session = fakeSession([userMessage("先看 journal，再决定。"), userMessage("重启吧")]);
	assert.deepEqual(handoffCarry(session, true).decision, { kind: "message", text: "重启吧", entries: [] });
});

test("an ask_user_question answer is carried with its question, options and pick", () => {
	const session = fakeSession([
		assistantMessage([askCall("call_1")]),
		toolResult("call_1", JSON.stringify({ answers: [{ id: "next", selected: ["我去重启桌面宿主（推荐）"] }] })),
	]);
	const decision = handoffCarry(session, true).decision;
	assert.equal(decision?.kind, "answer");
	assert.equal(decision.entries.length, 1);
	assert.equal(decision.entries[0].question, "修复已就绪但宿主未加载。接下来怎么做？");
	assert.deepEqual(decision.entries[0].options, ["我去重启桌面宿主（推荐）", "先不重启，直接跑 /memory update"]);
	assert.deepEqual(decision.entries[0].selected, ["我去重启桌面宿主（推荐）"]);
	assert.equal(decision.entries[0].custom, "");
});

test("a typed answer to ask_user_question is carried, not dropped for having no selected label", () => {
	// The tool reports a typed reply as `custom` rather than `selected`; a carrier that read only
	// `selected` would carry an empty answer for exactly the replies a user bothered to write out.
	const session = fakeSession([
		assistantMessage([askCall("call_1")]),
		toolResult("call_1", JSON.stringify({ answers: [{ id: "next", selected: [], custom: "先别动，我还有别的事要说" }] })),
	]);
	const entry = handoffCarry(session, true).decision.entries[0];
	assert.deepEqual(entry.selected, []);
	assert.equal(entry.custom, "先别动，我还有别的事要说");
});

test("a result that is not an answer batch is never carried as the user's words", () => {
	// Upstream has exactly two result shapes and only `answers` is an answer. The timed tool's
	// timeout placeholder, a plain payload and an unreadable result must all contribute nothing:
	// printing a notice the plugin itself copied as "the user answered" is the misattribution class
	// this repo treats as its worst defect.
	const pending = {
		pending: true,
		callId: "call_1",
		message: "No answer batch arrived before the timeout. This is pending, not a skipped answer.",
	};
	for (const text of [JSON.stringify(pending), "重启，其他都别动", JSON.stringify({ ok: true })]) {
		const session = fakeSession([userMessage("先看 journal"), assistantMessage([askCall("call_1")]), toolResult("call_1", text)]);
		const carry = handoffCarry(session, true);
		assert.equal(carry.decision.kind, "message", text.slice(0, 20));
		assert.equal(carry.decision.text, "先看 journal");
	}
	// With no earlier input at all there is simply no decision, and the ordinary closing stays.
	const empty = fakeSession([assistantMessage([askCall("call_1")]), toolResult("call_1", JSON.stringify(pending))]);
	assert.equal(handoffCarry(empty, true).decision, undefined);
	assert.ok(!continuation("session-parent", "summary", "", ARCHIVE).includes(SCAFFOLDING.en.decisionClosing));
});

test("a skipped question is not the user stating something", () => {
	// Upstream: "Empty with no custom means the user explicitly skipped this question." The batch was
	// completed, but nothing was said, so the still-open question stays the current state.
	const session = fakeSession([
		assistantMessage([{ type: "text", text: "接下来怎么做？" }, askCall("call_1")]),
		toolResult("call_1", JSON.stringify({ answers: [{ id: "next", selected: [] }] })),
	]);
	assert.equal(handoffCarry(session, true).decision, undefined);
	assert.match(pendingQuestion(session), /接下来怎么做/);
});

test("a skipped question does not hide a question the user did answer", () => {
	const args = {
		questions: [
			{ id: "a", question: "第一个？", options: [{ label: "A1" }] },
			{ id: "b", question: "第二个？", options: [{ label: "B1" }] },
		],
	};
	const session = fakeSession([
		assistantMessage([askCall("call_1", args)]),
		toolResult("call_1", JSON.stringify({ answers: [{ id: "a", selected: [] }, { id: "b", selected: ["B1"] }] })),
	]);
	const entries = handoffCarry(session, true).decision.entries;
	assert.equal(entries.length, 1);
	assert.equal(entries[0].question, "第二个？");
	assert.deepEqual(entries[0].selected, ["B1"]);
});

test("multiple questions are paired by position, so a repeated id cannot answer twice", () => {
	// Upstream documents `answers` as "one item per question"; the blocking tool does not require
	// unique ids, so looking the id up first would attribute one answer to every question sharing it.
	const repeated = {
		questions: [
			{ id: "same", question: "第一个？", options: [{ label: "a1" }, { label: "a2" }] },
			{ id: "same", question: "第二个？", options: [{ label: "b1" }] },
		],
	};
	const paired = fakeSession([
		assistantMessage([askCall("call_1", repeated)]),
		toolResult("call_1", JSON.stringify({ answers: [{ id: "same", selected: ["a1"] }, { id: "same", selected: ["b1"] }] })),
	]);
	assert.deepEqual(
		handoffCarry(paired, true).decision.entries.map((entry) => [entry.question, [...entry.selected]]),
		[["第一个？", ["a1"]], ["第二个？", ["b1"]]],
	);
	// One answer for two questions sharing an id is ambiguous: it is attributed to the question it is
	// positionally next to and never duplicated onto the other.
	const ambiguous = fakeSession([
		assistantMessage([askCall("call_1", repeated)]),
		toolResult("call_1", JSON.stringify({ answers: [{ id: "same", selected: ["a1"] }] })),
	]);
	assert.deepEqual(handoffCarry(ambiguous, true).decision.entries.map((entry) => entry.question), ["第一个？"]);
});

test("an errored or unmatched tool result leaves a newer open question open", () => {
	const errored = fakeSession([
		assistantMessage([{ type: "text", text: "接下来怎么做？" }, askCall("call_1")]),
		{
			role: "tool",
			source: { kind: "tool", callId: "call_1" },
			toolCallId: "call_1",
			isError: true,
			content: [{ type: "text", text: "cancelled" }],
		},
	]);
	const carry = handoffCarry(errored, true);
	assert.match(carry.pending, /接下来怎么做/);
	assert.equal(carry.decision, undefined);

	const unmatched = fakeSession([
		userMessage("先看 journal"),
		toolResult("call_unknown", JSON.stringify({ answers: [{ id: "next", selected: ["X"] }] })),
	]);
	assert.equal(handoffCarry(unmatched, true).decision.text, "先看 journal");
});

test("an errored result is not an answer even when its text looks like one", () => {
	// The general rule — only an `answers` batch counts — already covers an error whose text is not an
	// answer, which makes the `isError` guard invisible to that input. This separates them: an error
	// payload that happens to carry an answers-shaped body must still not be read as the user speaking,
	// and a mutant that drops the guard has to fail here.
	const session = fakeSession([
		userMessage("先看 journal"),
		assistantMessage([askCall("call_1")]),
		{
			role: "tool",
			source: { kind: "tool", callId: "call_1" },
			toolCallId: "call_1",
			isError: true,
			content: [{ type: "text", text: JSON.stringify({ answers: [{ id: "next", selected: ["我去重启桌面宿主"] }] }) }],
		},
	]);
	const carry = handoffCarry(session, true);
	assert.equal(carry.decision.kind, "message");
	assert.equal(carry.decision.text, "先看 journal");
});

test("an injected user-role block does not close an open question", () => {
	// The comparison is against the last assistant *question*, not the last conversational message:
	// counting an injected block as the terminator would carry the older input and drop the question.
	const session = fakeSession([
		userMessage("先看 journal"),
		assistantMessage([{ type: "text", text: "要重启桌面宿主吗？" }]),
		userMessage("Current runtime context. This snapshot supersedes earlier ones.", "runtime-context"),
	]);
	const carry = handoffCarry(session, true);
	assert.match(carry.pending, /要重启桌面宿主吗/);
	assert.equal(carry.decision, undefined);
});

test("with defer, a question newer than the input carries nothing at all", () => {
	// `defer` deliberately carries no question; carrying the superseded input under a "do not ask
	// again" closing would be worse than carrying nothing.
	const superseded = fakeSession([
		userMessage("随便"),
		assistantMessage([{ type: "text", text: "Which branch should I push to?" }]),
	]);
	assert.deepEqual(handoffCarry(superseded, false), {});
	// An input newer than the question is still carried under `defer`.
	const answered = fakeSession([
		assistantMessage([{ type: "text", text: "Which branch should I push to?" }]),
		userMessage("main"),
	]);
	assert.equal(handoffCarry(answered, false).decision.text, "main");
});

test("only one block is rendered: a pending question wins and the decision is absent", () => {
	const prompt = continuation("session-parent", "summary", "", ARCHIVE, "en", "Which branch?", {
		kind: "message",
		text: "随便",
		entries: [],
	});
	assert.ok(prompt.endsWith(SCAFFOLDING.en.pendingWait));
	assert.ok(!prompt.includes(SCAFFOLDING.en.decisionHeading));
	assert.ok(!prompt.includes("随便"));
});

test("the user's newest input wins, whichever channel it arrived through", () => {
	const answered = [
		assistantMessage([askCall("call_1")]),
		toolResult("call_1", JSON.stringify({ answers: [{ id: "next", selected: ["先不重启"] }] })),
	];
	assert.equal(handoffCarry(fakeSession([...answered, userMessage("算了，还是重启吧")]), true).decision.kind, "message");
	assert.equal(handoffCarry(fakeSession([userMessage("随便"), ...answered]), true).decision.kind, "answer");
});

test("the handoff's own banner and injected context are not user input", () => {
	// The negative control. A banner is injected through the prompt RPC as `{kind:"user"}`, so a
	// carrier that trusted the source kind alone would hand our own prompt back as a decision.
	const banner = continuation("session-parent", "## Goal\n\ncarry on", "", ARCHIVE, "en", undefined, {
		kind: "message",
		text: "restart the host",
		entries: [],
	});
	assert.equal(isHandoffContinuationText(banner), true, "the generator and the predicate must agree");
	const session = fakeSession([
		userMessage(banner),
		userMessage("Current runtime context. This snapshot supersedes earlier ones.", "runtime-context"),
	]);
	assert.equal(handoffCarry(session, true).decision, undefined);
});

test("a question asked after the user's answer stays the current state", () => {
	// Both mixed cases are reachable, so precedence is by position: here the question is newer and
	// must not be dropped in favour of the older input.
	const session = fakeSession([
		userMessage("随便"),
		assistantMessage([{ type: "text", text: "Which branch should I push to?" }]),
	]);
	const carry = handoffCarry(session, true);
	assert.match(carry.pending, /Which branch/);
	assert.equal(carry.decision, undefined);
});

test("an answered question does not read as still pending", () => {
	// The other mixed case: `pendingQuestion` sees the asking text as the last conversational
	// message, so the answer has to outrank it — otherwise the child is told to wait for a decision
	// the user already made.
	const session = fakeSession([
		assistantMessage([
			{ type: "text", text: "接下来怎么做？" },
			askCall("call_1"),
		]),
		toolResult("call_1", JSON.stringify({ answers: [{ id: "next", selected: ["我去重启桌面宿主（推荐）"] }] })),
	]);
	const carry = handoffCarry(session, true);
	assert.equal(carry.pending, undefined);
	assert.deepEqual(carry.decision.entries[0].selected, ["我去重启桌面宿主（推荐）"]);
});

test("a carried decision replaces the closing that invites the same question again", () => {
	const carried = continuation("session-parent", "summary", "", ARCHIVE, "en", undefined, {
		kind: "message",
		text: "我去重启桌面宿主（推荐）",
		entries: [],
	});
	assert.match(carried, /## The user's last input/);
	assert.ok(carried.includes("我去重启桌面宿主（推荐）"));
	assert.ok(carried.endsWith(SCAFFOLDING.en.decisionClosing));
	assert.ok(!carried.includes(SCAFFOLDING.en.continuationClosing), "the 'otherwise ask' closing must not survive");
	// Still recognizable on the next handoff, or the child's own seed would read as a human turn.
	assert.equal(isHandoffContinuationText(carried), true);

	const zh = continuation("session-parent", "摘要", "", ARCHIVE, "zh", undefined, {
		kind: "answer",
		text: "",
		entries: [
			{
				question: "接下来怎么做？",
				options: ["我去重启桌面宿主（推荐）", "先别动"],
				selected: ["我去重启桌面宿主（推荐）"],
				custom: "",
			},
		],
	});
	assert.match(zh, /## 用户最后一次输入/);
	assert.match(zh, /用户被问到：接下来怎么做？/);
	assert.match(zh, /给出的选项：我去重启桌面宿主（推荐） \| 先别动/);
	assert.match(zh, /用户选择：我去重启桌面宿主（推荐）/);
	assert.ok(zh.endsWith(SCAFFOLDING.zh.decisionClosing));
	assert.equal(isHandoffContinuationText(zh), true);

	// Without a decision the usual closing stays: this must not become the only outcome.
	const plain = continuation("session-parent", "summary", "", ARCHIVE);
	assert.ok(plain.endsWith(SCAFFOLDING.en.continuationClosing));
});

test("a failed ask_user_question is not carried as the user's answer", () => {
	// An errored tool result carries the failure text, not the user. Reading it as a decision is the
	// worst kind of wrong here: the child would treat our own error message as something the user said.
	const session = fakeSession([
		userMessage("先看 journal"),
		assistantMessage([askCall("call_1")]),
		{
			role: "tool",
			source: { kind: "tool", callId: "call_1" },
			toolCallId: "call_1",
			isError: true,
			content: [{ type: "text", text: "the question was cancelled" }],
		},
	]);
	const carry = handoffCarry(session, true);
	assert.equal(carry.decision.kind, "message");
	assert.equal(carry.decision.text, "先看 journal");
});

test("the pending half and the defer gate agree except where the carry is deliberately stricter", () => {
	// `auto.ts`'s `defer` gate calls `pendingQuestion`, which counts *every* user-role message as the
	// last conversational one — injected context and our own banner included. The carry compares the
	// last assistant *question* against the user's own last input instead, so the two agree except
	// when an injected user-role block follows an open question: there the gate sees no question
	// while the carry still reports it, which is the safe direction — the child waits for the user.
	const asked = assistantMessage([{ type: "text", text: "Which branch should I push to?" }]);
	const injected = userMessage("Current runtime context. This snapshot supersedes earlier ones.", "runtime-context");
	assert.equal(handoffCarry(fakeSession([asked]), true).pending, pendingQuestion(fakeSession([asked])));
	assert.match(handoffCarry(fakeSession([asked]), true).pending, /Which branch/);
	assert.equal(pendingQuestion(fakeSession([asked, injected])), undefined, "the gate keeps its historical rule");
	assert.match(handoffCarry(fakeSession([asked, injected]), true).pending, /Which branch/);
});

test("the wiring carries the decision into the seed prompt", () => {
	// The unit tests above pass even if `handoffArtifacts` never asks for the carry, so this pins the
	// one call site that actually seeds a child.
	const session = {
		id: "session-parent-1234",
		header: { cwd: "/project", createdAt: 0 },
		deriveMessages: () => [userMessage("我去重启桌面宿主（推荐）")],
	};
	const { prompt } = handoffArtifacts({
		session,
		config: { ...DEFAULT_CONFIG, handoffPendingQuestion: "wait" },
		language: "zh",
		rawSummary: "## 目标\n\n等重启验活",
		archive: ARCHIVE,
		pointers: { log: "/project/logs/session-parent-1234/session.md", index: "/project/logs/INDEX.md" },
		tail: "",
	});
	assert.match(prompt, /## 用户最后一次输入/);
	assert.ok(prompt.includes("我去重启桌面宿主（推荐）"));
	assert.ok(prompt.endsWith(SCAFFOLDING.zh.decisionClosing));
});
