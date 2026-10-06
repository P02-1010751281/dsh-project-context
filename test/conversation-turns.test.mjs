/**
 * Pins for reading a session's *human* turns.
 *
 * A handoff's continuation banner is injected through the prompt RPC, which carries no source
 * kind, so it lands in the log as `{kind:"user"}` — identical to a person's message. Both
 * `userTurnCount` and `firstUserText` must skip it: before this, every handoff child counted one
 * turn it never drove, and its first user text was the whole banner instead of what the
 * person actually opened with. A person who quotes a banner must still count.
 *
 * The banners here are built by the real generator (`continuation`), not hand-written strings, so
 * these pins fail if the predicate and the generator drift apart.
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { SCAFFOLDING } from "../lib/project-handoff/language.js";
import { continuation } from "../lib/project-handoff/summary.js";
import { fallbackUpdate } from "../lib/project-memory/consolidate.js";
import { firstUserText, userTurnCount } from "../lib/shared/conversation.js";

const ARCHIVE = { log: "logs/session-parent/session.md", index: "logs/INDEX.md" };
/** The mechanical file index the payload carries now that no generated summary exists. */
const FILES = "<read-files>\nsrc/project-handoff/summary.ts\n</read-files>";
/** A real generated continuation banner, in either language, optionally on a pending question. */
const banner = (language = "en", pending) => continuation("session-parent", FILES, "", ARCHIVE, language, pending);

/** One `user/message` event in the shape the host writes it. */
function userMessage(text, kind = "user") {
	return { type: "user/message", data: { source: { kind }, content: [{ type: "text", text }] } };
}

function fakeSession(events) {
	return { id: "session-child", header: { createdAt: 0 }, snapshotEvents: () => events };
}

test("a handoff banner is not a human turn and not the first user text", () => {
	const session = fakeSession([userMessage(banner()), userMessage("把 journal 写完"), userMessage("继续")]);
	assert.equal(userTurnCount(session), 2, "the banner must not count as a turn");
	assert.equal(firstUserText(session), "把 journal 写完", "the banner must not be the first user text");
});

test("both scaffolding languages and the wait variant are recognized", () => {
	// A `wait` handoff ends on the pending-question line instead of the usual closing, so a
	// predicate that accepted only the closing would count all four of these banners.
	for (const text of [banner("en"), banner("zh"), banner("en", "Which branch should I use?"), banner("zh", "用哪个分支？")]) {
		assert.equal(userTurnCount(fakeSession([userMessage(text)])), 0);
		assert.equal(firstUserText(fakeSession([userMessage(text)])), "");
	}
});

test("injected user-role context still does not count, and real turns still do", () => {
	const session = fakeSession([
		userMessage("Current runtime context. This snapshot supersedes earlier ones.", "runtime-context"),
		userMessage("第一个问题"),
		userMessage("第二个问题"),
	]);
	assert.equal(userTurnCount(session), 2);
	assert.equal(firstUserText(session), "第一个问题");
});

test("a quoted or extended banner is still a person's message", () => {
	// The negative control: the fix must not pass by skipping every `user/message`. Someone who
	// quotes the banner, or quotes it and adds their own question, is still a human turn.
	const original = banner();
	const quoted = original.split("\n").map((line) => `> ${line}`).join("\n");
	const extended = `${original}\n\nAlso fix the failing test.`;
	for (const text of [quoted, extended]) {
		assert.equal(userTurnCount(fakeSession([userMessage(text)])), 1);
		assert.equal(firstUserText(fakeSession([userMessage(text)])), text);
	}
});

test("an incomplete banner is not recognized", () => {
	const headingsOnly = `${SCAFFOLDING.en.continuationPreamble("session-parent")}\n\n${SCAFFOLDING.en.continuationClosing}`;
	assert.equal(userTurnCount(fakeSession([userMessage(headingsOnly)])), 1);
});

test("the consolidation fallback summarizes what the person actually opened with", () => {
	// `fallbackUpdate` is the observable consumer of `firstUserText`: before the fix it stored the
	// banner's opening characters as the session summary.
	const update = fallbackUpdate(fakeSession([userMessage(banner()), userMessage("把 journal 写完")]));
	assert.equal(update.summary, "把 journal 写完");
	assert.equal(update.title, "Session recorded");
});
