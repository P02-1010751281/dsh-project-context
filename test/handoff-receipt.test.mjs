/**
 * The `/handoff status` **seed receipt**: what the continuation was actually seeded with.
 *
 * Three numbers a successor's own transcript cannot show: how many messages travelled verbatim, how
 * many files the index named, and what happened to a question that was open when the handoff ran.
 *
 * What these pin:
 *  - the numbers come from the artifacts themselves (`handoffSplit`'s own `tailMessages`, the index
 *    string both `HANDOFF.md` and the seed carry, `questionDisposition`'s one read of the session) —
 *    never a second estimate at render time;
 *  - the receipt belongs to the **child**: the parent that was replaced keeps its `already handed off`
 *    line and must not print the child's numbers;
 *  - a refused (pending question) or transiently failed attempt records nothing, so "already handed
 *    off" can never be a claim about a handoff that did not happen;
 *  - an empty tail prints `0`, not a missing field.
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { maybeAutoHandoff } from "../lib/project-handoff/auto.js";
import { statusText, runManual } from "../lib/project-handoff/command.js";
import { handoffCarry, handoffSplit, questionDisposition } from "../lib/project-handoff/conversation.js";
import { apply as applyHandoffEntry } from "../lib/project-handoff/index.js";
import { cardApplied } from "./card-config.mjs";

/** The handoff entry, fed only the keys its card owns (batch AC split the schema). */
const apply = cardApplied(applyHandoffEntry, "handoff");
import { performHandoff } from "../lib/project-handoff/perform.js";
import { countFileIndex, seedReceiptLine } from "../lib/project-handoff/receipt.js";
import { handoffReceipts } from "../lib/project-handoff/state.js";
import { resolvePluginConfig } from "../lib/shared/config.js";
import { sessionViews } from "./session-views.mjs";
import { portsOf } from "./host-ports.mjs";

const PARENT = "session-receipt-parent-1";
const CHILD = "session-receipt-child-1";
const WINDOW = 1_000_000;

const userMessage = (text) => ({ role: "user", source: { kind: "user" }, content: [{ type: "text", text }] });
const assistantMessage = (text) => ({ role: "assistant", source: { kind: "model" }, content: [{ type: "text", text }] });
/** An assistant turn whose only content is one file tool call, the shape the file index reads. */
const fileCall = (name, file) => ({
	role: "assistant",
	source: { kind: "model" },
	content: [{ type: "tool-call", id: `call-${name}-${file}`, name, arguments: JSON.stringify({ path: file }) }],
});
const QUESTION = assistantMessage("要我去重启桌面宿主吗？");

async function tempRoot() {
	return realpath(await mkdtemp(path.join(tmpdir(), "dsh-handoff-receipt-")));
}

function parentSession(root, messages) {
	return { id: PARENT, header: { cwd: root }, requestHeader: () => undefined, ...sessionViews(messages) };
}

/** A session shaped like a continuation: no log of its own, and no routed pair to resolve. */
function childSession(root, id = CHILD) {
	return { id, header: { cwd: root }, requestHeader: () => undefined, snapshotEvents: () => [], deriveMessages: () => [] };
}

/** A fake host: the controller creates the child, the registry admits the seed. */
function fakeHost(state) {
	const childId = state.childId ?? CHILD;
	return {
		get: (name) => {
			if (name === "sessionController") {
				return {
					create: async () => ({ sessionId: childId }),
					rename: async (request) => ({ title: request.title }),
					cancel: async () => undefined,
				};
			}
			if (name === "agents") {
				return {
					get: (id) =>
						id === childId
							? {
									followup: (message) => {
										state.seeded += 1;
										state.seed = message;
										if (state.refuseSeed !== undefined) throw state.refuseSeed;
									},
								}
							: undefined,
				};
			}
			return undefined;
		},
		logger: { info: () => {}, warn: () => {} },
	};
}

async function handoff(root, messages, config, options = {}) {
	const state = { seeded: 0, seed: undefined, refuseSeed: options.refuseSeed, childId: options.childId };
	const ctx = fakeHost(state);
	const session = parentSession(root, messages);
	const split = options.split ?? handoffSplit(session, options.keep ?? 0);
	await performHandoff(portsOf(ctx), session, config, "manual", undefined, split);
	return { state, session, ctx };
}

const CONFIG = (extra = {}) => resolvePluginConfig({ handoffPendingQuestion: "wait", handoffBudgetRecentTokens: 0, handoffLang: "en", ...extra });

// --- the pure core -------------------------------------------------------------------------

test("the file index is counted from the artifact both HANDOFF.md and the seed carry", () => {
	assert.equal(countFileIndex(""), 0, "no qualifying call is 0 entries, not a missing field");
	assert.equal(countFileIndex("<read-files>\na.ts\n</read-files>"), 1);
	assert.equal(
		countFileIndex("<read-files>\na.ts\nb.ts\n</read-files>\n\n<modified-files>\nc.ts\n</modified-files>"),
		3,
		"both blocks count, the tag lines do not",
	);
	assert.equal(countFileIndex("<read-files>\n</read-files>"), 0, "an empty block is 0");
});

test("the seed line renders every field, including zeros, in both languages", () => {
	assert.equal(
		seedReceiptLine({ tailMessages: 12, files: 3, question: "answered" }, "en"),
		"seed: tail 12 message(s), 3 file(s), question answered",
	);
	assert.equal(seedReceiptLine({ tailMessages: 0, files: 0, question: "nothing" }, "en"), "seed: tail 0 message(s), 0 file(s), question nothing");
	assert.equal(
		seedReceiptLine({ tailMessages: 1, files: 2, question: "deferred" }, "zh"),
		"种子：尾料 1 条消息、文件 2 个、问题处置 待答",
	);
});

test("the split counts the messages it actually carried", () => {
	const messages = [userMessage("先说一句"), assistantMessage("好"), userMessage("再说一句")];
	const session = parentSession(process.cwd(), messages);
	const none = handoffSplit(session, 0);
	assert.equal(none.tail, "", "a zero budget carries no tail");
	assert.equal(none.tailMessages, 0, "and reports 0 rather than omitting the fact");
	const one = handoffSplit(session, 1);
	assert.equal(one.tailMessages, 1, "the forced one-message floor is one message");
	assert.equal(one.tail.split("\n\n").length, 1, "the count matches the rendered sections");
});

test("the seed's own paragraph names the open question it carried", async () => {
	const root = await tempRoot();
	const { state } = await handoff(root, [userMessage("把 release 收尾"), QUESTION], CONFIG({ handoffLang: "en" }));
	assert.equal(state.seeded, 1);
	const text = state.seed.content.map((block) => block.text ?? "").join("");
	assert.match(text, /No message was carried over verbatim under the current setting, plus the one open question/);
	assert.match(text, /The earlier 2 message\(s\) are \*\*not\*\* in this session/);
});

// --- the three dispositions ---------------------------------------------------------------

test("no assistant question means there is nothing to dispose of", () => {
	const session = parentSession(process.cwd(), [userMessage("接着做"), assistantMessage("好")]);
	assert.equal(questionDisposition(session), "nothing");
});

test("a question followed by the user's own input is answered", () => {
	const session = parentSession(process.cwd(), [userMessage("接着做"), QUESTION, userMessage("用 A")]);
	assert.equal(questionDisposition(session), "answered");
});

test("a question the user never came back to is deferred — even when the seed carries nothing", () => {
	const session = parentSession(process.cwd(), [userMessage("接着做"), QUESTION]);
	assert.equal(questionDisposition(session), "deferred", "the answer is still with the user");
	// The control that makes this a claim about the *question*, not about the carry: under `defer` a
	// manual handoff carries nothing at all, and the disposition must still not become "nothing".
	assert.deepEqual(handoffCarry(session, false), {}, "defer carries nothing");
	assert.equal(questionDisposition(session), "deferred", "yet the question is still open");
});

// --- the receipt in the transaction -------------------------------------------------------

test("a real handoff records the seed for the continuation, and `/handoff status` reads it back", async () => {
	const root = await tempRoot();
	const childId = "session-receipt-child-deferred";
	const messages = [userMessage("把 release 收尾"), fileCall("read", "src/a.ts"), fileCall("write", "src/b.ts"), QUESTION];
	const { session } = await handoff(root, messages, CONFIG(), { childId });
	assert.equal(handoffReceipts.get(childId)?.tailMessages, 0, "the zero budget carried no tail");
	assert.equal(handoffReceipts.get(childId)?.files, 2, "one read and one write are two index entries");
	assert.equal(handoffReceipts.get(childId)?.question, "deferred");

	const receipt = await statusText(portsOf(fakeHost({ seeded: 0 })), childSession(root, childId), CONFIG(), new AbortController().signal);
	assert.match(receipt, /seed: tail 0 message\(s\), 2 file\(s\), question deferred/);
	// The parent that was replaced must not inherit the child's numbers.
	const parent = await statusText(portsOf(fakeHost({ seeded: 0 })), session, CONFIG(), new AbortController().signal);
	assert.match(parent, /already handed off in this process/);
	assert.doesNotMatch(parent, /seed: /, "the receipt is the child's, not the parent's");
});

test("a carried tail reports the count the split used, not a re-count of the rendered string", async () => {
	const root = await tempRoot();
	const messages = [userMessage("第一句"), assistantMessage("好"), userMessage("第二句")];
	// Keep exactly one message: the split's own floor, which a re-scan could not reproduce without
	// re-deciding the cut.
	const childId = "session-receipt-child-tail";
	await handoff(root, messages, CONFIG({ handoffBudgetRecentTokens: 20_000 }), { keep: 1, childId });
	assert.equal(handoffReceipts.get(childId)?.tailMessages, 1);
	const receipt = await statusText(portsOf(fakeHost({ seeded: 0 })), childSession(root, childId), CONFIG({ handoffBudgetRecentTokens: 20_000 }), new AbortController().signal);
	assert.match(receipt, /seed: tail 1 message\(s\)/);
});

test("the receipt is rendered in the session's own language", async () => {
	const root = await tempRoot();
	const childId = "session-receipt-child-zh";
	await handoff(root, [userMessage("把 release 收尾"), QUESTION], CONFIG({ handoffLang: "zh" }), { childId });
	const receipt = await statusText(portsOf(fakeHost({ seeded: 0 })), childSession(root, childId), CONFIG({ handoffLang: "zh" }), new AbortController().signal);
	assert.match(receipt, /种子：尾料 0 条消息、文件 0 个、问题处置 待答/);
});

test("a real apply() wiring answers `/handoff status` with the recorded seed", async () => {
	const root = await tempRoot();
	const childId = "session-receipt-child-apply";
	await handoff(root, [userMessage("把 release 收尾"), fileCall("read", "src/a.ts")], CONFIG(), { childId });

	const commands = [];
	const handlers = new Map();
	const ctx = {
		...fakeHost({ seeded: 0 }),
		on: (type, handler) => {
			handlers.set(type, handler);
			return () => undefined;
		},
		systemPrompt: { context: () => () => undefined },
		commands: { register: (command) => {
			commands.push(command);
			return () => undefined;
		} },
	};
	apply(ctx, { handoffPendingQuestion: "wait", handoffBudgetRecentTokens: 0, handoffLang: "en" });
	const handoffCommand = commands.find((command) => command.name === "handoff");
	assert.notEqual(handoffCommand, undefined, "the command must be registered");

	const reply = await handoffCommand.handler({ agent: { session: childSession(root, childId) }, rawInput: "status", signal: new AbortController().signal });
	assert.equal(reply.kind, "success");
	assert.match(reply.text, /seed: tail 0 message\(s\), 1 file\(s\), question nothing/);
});

// --- refusals and deferrals must not claim a handoff ---------------------------------------

test("a pending question under `defer` defers the handoff and records no seed", async () => {
	const root = await tempRoot();
	const session = parentSession(root, [userMessage("把 release 收尾"), QUESTION]);
	const before = handoffReceipts.size;
	const ctx = {
		get: (name) =>
			name === "tokenMeter"
				? { measure: () => ({ totalTokens: 900_000, surfaceTokens: 900_000 }) }
				: name === "sessionController"
					? { create: async () => ({ sessionId: "session-deferred-child" }), rename: async () => undefined }
					: undefined,
		llm: { resolveModelInfo: async () => ({ context: { contextWindow: WINDOW } }) },
		logger: { info: () => {}, warn: () => {} },
	};
	const config = resolvePluginConfig({ provider: "test-provider", model: "test-model", handoffPendingQuestion: "defer", handoffBudgetRecentTokens: 20_000 });
	// A deferral is a silent *skip*, not a rejected promise: the trigger records why and returns, so the
	// assertion is about the metric that matters — no receipt, and no `seed:` line to read as a handoff.
	await maybeAutoHandoff(portsOf(ctx), session, config, 1);
	assert.equal(handoffReceipts.size, before, "a deferral writes no receipt");
	const receipt = await statusText(portsOf(ctx), session, config, new AbortController().signal);
	assert.doesNotMatch(receipt, /seed: /, "and the session still reads as un-handed-off");
});

test("a transient failure abandons the attempt and records no seed", async () => {
	const root = await tempRoot();
	const state = { seeded: 0, refuseSeed: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }) };
	const ctx = fakeHost(state);
	const session = parentSession(root, [userMessage("把 release 收尾"), assistantMessage("好")]);
	const before = handoffReceipts.size;
	const reply = await runManual(portsOf(ctx), session, CONFIG(), new AbortController().signal);
	assert.equal(reply.kind, "error", "the attempt is reported as a failure");
	assert.match(reply.text, /safe to retry/, "a transient cause is named as transient");
	assert.equal(handoffReceipts.size, before, "a failed attempt leaves no receipt behind");
});

test("a manual handoff computes its own split and still states the dropped count", async () => {
	// `runManual` is the production entry and passes no split, so this is the only place the
	// `split ?? handoffSplit(...)` branch is exercised with real messages.
	const root = await tempRoot();
	const state = { seeded: 0, seed: undefined };
	const ctx = fakeHost(state);
	const session = parentSession(root, [userMessage("第一步"), userMessage("第二步")]);
	const reply = await runManual(portsOf(ctx), session, CONFIG({ handoffBudgetRecentTokens: 0 }), new AbortController().signal);
	assert.equal(reply.kind, "success");
	const text = state.seed.content.map((block) => block.text ?? "").join("");
	assert.match(text, /The earlier 2 message\(s\) are \*\*not\*\* in this session/);
});

// --- the parent boundary ------------------------------------------------------------------

test("the receipt lives and dies with the process, exactly like the handed-off marker", async () => {
	// Documented lifetime: process memory keyed by the child, nothing persisted. A fresh id simply has
	// no entry, which is how a restarted host (and any other session) reads.
	assert.equal(handoffReceipts.get("session-never-seeded"), undefined);
	const receipt = await statusText(portsOf(fakeHost({ seeded: 0 })), childSession(process.cwd(), "session-never-seeded"), CONFIG(), new AbortController().signal);
	assert.doesNotMatch(receipt, /seed: /);
	assert.match(receipt, /Auto handoff ON/, "the rest of the receipt is unaffected");
});
