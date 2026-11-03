/**
 * Pins for reading a handoff's conversation from the append-origin log instead of the surface.
 *
 * The defect this closes: a compaction summarises a span and appends one checkpoint node that
 * *replaces* it on the model-visible surface. A seed built from `deriveMessages()` therefore carried
 * the summary where the conversation had been, and presented it as the conversation — the
 * wrong-cause defect class this repo treats as its worst. pi avoided it by cancelling the compaction
 * beforehand (`session_before_compact`); dsh has no cancellable pre-compaction hook, but its log is
 * append-only and keeps every shadowed event, so the same content is recoverable on the read side.
 *
 * The negative controls carry as much weight as the positive ones. A reader that simply preferred the
 * log would be wrong in the other direction too — the surface still holds in-place edits a producer
 * made deliberately — so these pin that a replacement copy is dropped *instead of* its original, not
 * on top of it, and that a log which projects nothing still reads as the surface.
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { fileOperations, handoffLabel, handoffSplit, pendingQuestion, resolveHandoffLanguage, sessionLanguageMessages } from "../lib/project-handoff/conversation.js";
import { conversationMessageSections } from "../lib/shared/conversation.js";
import { compensatingSessionViews, sessionViews } from "./session-views.mjs";

function userMessage(text) {
	return { role: "user", source: { kind: "user" }, content: [{ type: "text", text }] };
}

function assistantMessage(text) {
	return { role: "assistant", source: { kind: "assistant" }, content: [{ type: "text", text }] };
}

/** An assistant message whose only content is one `tool-call` block. */
function toolCall(name, path) {
	return {
		role: "assistant",
		source: { kind: "assistant" },
		content: [{ type: "tool-call", id: `call-${name}-${path}`, name, arguments: JSON.stringify({ path }) }],
	};
}

const SUMMARY = "SUMMARY-OF-THE-FIRST-TURNS";

test("a compacted span is carried, and the summary that replaced it is not", () => {
	const messages = [userMessage("先看 journal"), assistantMessage("看过了"), userMessage("继续")];
	// The compaction shadowed the first two messages and stood a checkpoint in their place.
	const session = compensatingSessionViews(messages, { shadows: [0, 1], text: SUMMARY });

	const split = handoffSplit(session, 100_000);
	assert.match(split.tail, /先看 journal/, "the summarized conversation is what the successor reads");
	assert.match(split.tail, /看过了/);
	assert.doesNotMatch(split.tail, new RegExp(SUMMARY), "the checkpoint node does not stand in for the span it replaced");
	assert.match(split.tail, /继续/, "the messages outside the span keep their order and content");
});

test("the same fixture read from the surface loses the span — the fixture can fail", () => {
	// The negative control for the test above: if `handoffSplit` regressed to `deriveMessages()`, the
	// conversation it recovered must disappear and the summary must appear. Without this, the positive
	// case would pass on a fixture that never modelled a compaction at all.
	const messages = [userMessage("先看 journal"), assistantMessage("看过了"), userMessage("继续")];
	const session = compensatingSessionViews(messages, { shadows: [0, 1], text: SUMMARY });

	const surface = conversationMessageSections(session)
		.map((section) => section.rendered)
		.join("\n\n");
	assert.match(surface, new RegExp(SUMMARY), "the surface holds the checkpoint");
	assert.doesNotMatch(surface, /先看 journal/, "and no longer holds the span it replaced");
});

test("a replacement copy is dropped instead of the node it replaced, never on top of it", () => {
	// A pruned tool result replaces one node in place. Dropping the copy and keeping the original is
	// the rule; emitting both would duplicate the turn in the seed.
	const bulky = "shell output " + "y".repeat(600);
	const messages = [userMessage("跑测试"), { role: "tool", source: { kind: "tool", callId: "c1" }, toolCallId: "c1", content: [{ type: "text", text: bulky }] }];
	const session = compensatingSessionViews(messages, { shadows: [1], text: "PRUNED" });

	const rendered = conversationMessageSections(session, "append-origin")
		.map((section) => section.rendered)
		.join("\n\n");
	assert.match(rendered, /shell output/, "the original result is readable");
	assert.doesNotMatch(rendered, /PRUNED/, "the replacement copy does not also appear");
	assert.equal(rendered.match(/## tool result/g)?.length, 1, "the node appears exactly once");
});

test("file operations survive a compaction, so the successor is told what the session touched", () => {
	const messages = [toolCall("edit", "src/early.ts"), assistantMessage("改了"), userMessage("继续")];
	const session = compensatingSessionViews(messages, { shadows: [0], text: SUMMARY });

	const index = fileOperations(session);
	assert.match(index, /src\/early\.ts/, "an edit inside the summarized span still reaches the seed");
	assert.match(index, /<modified-files>/, "and is reported as a modification, not a read");
});

test("an open question inside a compacted span still counts as pending", () => {
	// After a compaction the newest user-role node on the surface *is* the checkpoint, so a gate that
	// reads the surface reports "nothing is open" — and the handoff goes through while the user has
	// not answered, which is the one thing `handoffPendingQuestion: defer` exists to prevent.
	const messages = [userMessage("帮我看下该用哪个分支"), assistantMessage("Which branch should I use?")];
	const session = compensatingSessionViews(messages, { shadows: [0, 1], text: SUMMARY });

	assert.equal(pendingQuestion(session), "Which branch should I use?", "the log still holds the question the model asked");

	// The fixture can fail: the surface really does lose it, so a surface reader would see no question.
	const surface = conversationMessageSections(session);
	assert.equal(surface.filter((section) => section.sourceKind === "user").length, 0);
	assert.doesNotMatch(surface.map((section) => section.rendered).join("\n"), /Which branch/);
});

test("the receipt's language is the seed's language after a compaction", () => {
	// The detector samples the whole conversation and `languageSamples` excludes a checkpoint by
	// `sourceKind`, so a surface read can summarize away every message in the user's own language and
	// report `en` while the seed carried Chinese. One conversation, one language.
	const messages = [userMessage("先看 journal 再决定"), userMessage("重启吧"), assistantMessage("好")];
	const session = compensatingSessionViews(messages, { shadows: [0, 1], text: SUMMARY });
	const config = { handoffLang: "auto" };

	assert.equal(resolveHandoffLanguage(sessionLanguageMessages(session), config), "zh");
	assert.deepEqual(sessionLanguageMessages(session), handoffSplit(session, 100_000).languageMessages);

	// The fixture can fail: the surface keeps no message in the user's own language at all.
	assert.equal(conversationMessageSections(session).filter((section) => section.sourceKind === "user").length, 0);
});

test("the continuation is named after the user's own words when a compaction shadowed them", () => {
	// A one-sentence instruction followed by a long tool span can fall out of the retained window, so
	// the last human turn is a realistic thing for a checkpoint to shadow. The seed then quotes that
	// instruction verbatim, and the title must not say `↪ handoff · 9f3c1a2b` beside it.
	const messages = [userMessage("把 handoff 的预算改成 0")];
	const session = compensatingSessionViews(messages, { shadows: [0], text: SUMMARY });

	assert.equal(handoffLabel(session, "9f3c1a2b"), "把 handoff 的预算改成 0");

	// The fixture can fail: the surface's only user-role node is the checkpoint, whose source kind is
	// not `user`, so a surface reader skips every candidate and falls back to the parent id.
	assert.ok(session.deriveMessages().every((message) => message.role !== "user" || message.source.kind !== "user"));
});

test("an event with no surface marker is read, not skipped", () => {
	// Upstream refuses to log a surface-eligible event without a marker (`surfaceOpOf` throws), and a
	// fork copies whole events, so this shape only reaches the plugin from a hand-built object — which
	// it is handed in tests. The reader drops *replacement copies*, not "anything that is not a marked
	// append": the naive predicate would silently shorten such a log.
	//
	// The fixture must keep one marked event: with every event unmarked the log projects nothing, the
	// zero-projection fallback answers with the surface, and the naive predicate would pass here while
	// still dropping the event in any real mixed log.
	const session = sessionViews([userMessage("有标记的一句"), userMessage("没有标记的一句")]);
	const original = session.snapshotEvents;
	session.snapshotEvents = () => original().map((event, index) => (index === 1 ? { ...event, surfaceOp: undefined } : event));

	const tail = handoffSplit(session, 100_000).tail;
	assert.match(tail, /有标记的一句/);
	assert.match(tail, /没有标记的一句/);
});

test("a log that projects nothing reads as the surface, instead of an empty conversation", () => {
	// The degenerate session: no message-producing event yet. Reading it as "the session said
	// nothing" would be a wrong cause for a true statement, so the surface answers instead.
	const messages = [userMessage("只有一句")];
	const session = { ...sessionViews(messages), snapshotEvents: () => [] };

	const split = handoffSplit(session, 100_000);
	assert.match(split.tail, /只有一句/);
});
