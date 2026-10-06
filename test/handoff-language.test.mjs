/**
 * Unit tests for the handoff language port: `auto` detection/resolution, the
 * scaffolding, the continuation-prompt predicate, the stale-prompt replay marker,
 * the pending-question continuation block, and the two settings keys.
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { settingPatch } from "../lib/project-handoff/command.js";
import { handoffCarry, handoffSplit, resolveHandoffLanguage, sessionLanguageMessages } from "../lib/project-handoff/conversation.js";
import { outstandingSubagents } from "../lib/project-handoff/guard.js";
import { assertHandoffDroppable, handoffArtifacts } from "../lib/project-handoff/perform.js";
import { continuation } from "../lib/project-handoff/summary.js";
import {
	REPLAY_MARKER,
	SCAFFOLDING,
	detectHandoffLanguage,
	isHandoffContinuationText,
	languageSamples,
	resolveLanguage,
} from "../lib/project-handoff/language.js";
import { DEFAULT_CONFIG, resolvePluginConfig } from "../lib/shared/config.js";
import { PluginSettingsSchema } from "../lib/shared/settings.js";

/** One raw sample message in the shape `handoffSplit` produces. */
function user(text, sourceKind = "user") {
	return { role: "user", sourceKind, text };
}

function assistant(text) {
	return { role: "assistant", sourceKind: "model", text };
}

/** One derived session message in the shape `session.deriveMessages()` returns. */
function message(role, text, sourceKind) {
	return {
		role,
		source: { kind: sourceKind ?? (role === "user" ? "user" : "model") },
		content: [{ type: "text", text }],
	};
}

function fakeSession(messages) {
	return { deriveMessages: () => messages };
}

const ARCHIVE = { log: "logs/session-parent/session.md", index: "logs/INDEX.md" };
/** A realistic file index: what the handoff payload carries now that the summary is gone. */
const FILES = "<read-files>\nsrc/project-handoff/summary.ts\n</read-files>";

test("the resolved language reaches HANDOFF.md and the child's first message", () => {
	// The four wiring points a mutation can silently break: the resolved language must reach the
	// stored document, the mechanical details block and the file index — not just the helpers.
	const session = {
		id: "session-parent-1234",
		header: { cwd: "/project", createdAt: 0 },
		deriveMessages: () => [message("user", "这个记忆整理流程要怎么改？"), message("assistant", "先看 journal，再决定。")],
	};
	const config = { ...DEFAULT_CONFIG, handoffPendingQuestion: "wait" };
	assert.equal(resolveHandoffLanguage(sessionLanguageMessages(session), config), "zh", "auto follows the conversation");

	const args = {
		session,
		config,
		language: "zh",
		fileOperations: FILES,
		archive: ARCHIVE,
		pointers: { log: "/project/logs/session-parent-1234/session.md", index: "/project/logs/INDEX.md" },
		tail: "## user\n继续吧",
	};
	const zh = handoffArtifacts(args);
	assert.ok(zh.document.startsWith(SCAFFOLDING.zh.documentTitle("session-parent-1234")), "the document title is localized");
	assert.ok(zh.document.includes(FILES), "the document carries the file index");
	assert.ok(zh.prompt.startsWith(SCAFFOLDING.zh.continuationPreamble("session-parent-1234")), "the seed prompt is localized");
	assert.ok(zh.prompt.includes(SCAFFOLDING.zh.detailsHeading), "the seed prompt carries the mechanical details block");
	assert.ok(zh.prompt.includes(FILES), "the file index rides into the payload");
	assert.ok(zh.prompt.includes(SCAFFOLDING.zh.continuationArchive("/project/logs/session-parent-1234/session.md", "/project/logs/INDEX.md")));

	// The other language must be just as real: English scaffolding and English details.
	const en = handoffArtifacts({ ...args, language: "en" });
	assert.ok(en.document.startsWith(SCAFFOLDING.en.documentTitle("session-parent-1234")));
	assert.ok(en.prompt.startsWith(SCAFFOLDING.en.continuationPreamble("session-parent-1234")));
	assert.ok(en.prompt.includes(SCAFFOLDING.en.detailsHeading));
	assert.ok(!en.prompt.includes(SCAFFOLDING.zh.detailsHeading), "the resolved language is the only one rendered");
});

test("a freshly built continuation keeps both markers round every closing variant", () => {
	// The predicate is the structural detector `humanUserText` reuses, so a freshly generated prompt
	// must satisfy it for every way the payload can end. The markers now wrap the mechanical
	// "previous session details" block; there is no generated summary section at all.
	const cases = [
		["en", continuation("session-parent", FILES, "tail", ARCHIVE)],
		["zh", continuation("session-parent", FILES, "tail", ARCHIVE, "zh")],
		["en-pending", continuation("session-parent", FILES, "", ARCHIVE, "en", "Which branch?")],
		["zh-pending", continuation("session-parent", FILES, "", ARCHIVE, "zh", "用哪个分支？")],
		["en-decision", continuation("session-parent", FILES, "", ARCHIVE, "en", undefined, { kind: "message", text: "restart", entries: [] })],
		["zh-decision", continuation("session-parent", FILES, "", ARCHIVE, "zh", undefined, { kind: "message", text: "重启", entries: [] })],
	];
	for (const [label, prompt] of cases) {
		assert.equal(isHandoffContinuationText(prompt), true, `${label} must be recognized`);
		assert.ok(prompt.includes("<handoff>") && prompt.includes("</handoff>"), `${label} keeps both markers`);
		assert.ok(
			prompt.startsWith(SCAFFOLDING.en.continuationPrefix) || prompt.startsWith(SCAFFOLDING.zh.continuationPrefix),
			`${label} carries the continuation prefix`,
		);
		// No generated prose: the markers open the details block, and no summary section exists.
		const body = prompt.slice(prompt.indexOf("<handoff>") + "<handoff>".length, prompt.indexOf("</handoff>"));
		assert.ok(body.includes(SCAFFOLDING.en.detailsHeading) || body.includes(SCAFFOLDING.zh.detailsHeading), `${label} wraps the details heading`);
		assert.ok(!prompt.includes("## Handoff Summary") && !prompt.includes("## 交接摘要"), `${label} carries no summary section`);
	}
});

test("the pending question is carried into the continuation only under wait", () => {
	const asking = {
		id: "session-parent-1234",
		header: { cwd: "/project", createdAt: 0 },
		deriveMessages: () => [
			message("user", "帮我改一下"),
			message("assistant", "Which branch should I use?"),
		],
	};
	const wait = { ...DEFAULT_CONFIG, handoffPendingQuestion: "wait" };
	const defer = { ...DEFAULT_CONFIG, handoffPendingQuestion: "defer" };
	const base = {
		session: asking,
		language: "en",
		fileOperations: FILES,
		archive: ARCHIVE,
		pointers: { log: "/p/logs/s.md", index: "/p/logs/INDEX.md" },
		tail: "",
	};

	const carried = handoffArtifacts({ ...base, config: wait });
	assert.match(carried.prompt, /## Pending question \(waiting for the user\)/, "wait adds the pending block");
	assert.match(carried.prompt, /Which branch should I use\?/, "wait carries the question text itself");

	const skipped = handoffArtifacts({ ...base, config: defer });
	assert.doesNotMatch(skipped.prompt, /## Pending question/, "defer adds no pending block");
	assert.doesNotMatch(skipped.prompt, /Which branch should I use\?/);
});

test("auto detection: CJK first, then substantial English, then the carried prompt", () => {
	// CJK wins even next to a sentence with far more than 20 Latin letters.
	assert.equal(detectHandoffLanguage(["中文", "This English sentence is comfortably over twenty letters."]), "zh");
	assert.equal(
		resolveLanguage([user("中文"), user("This English sentence is comfortably over twenty letters.")], "auto"),
		"zh",
	);

	// Latin-only samples resolve to English.
	assert.equal(detectHandoffLanguage(["plain english words"]), "en");
	assert.equal(resolveLanguage([user("plain english words")], "auto"), "en");

	// Substantive English beats an older Chinese continuation prompt.
	const zhPrompt = continuation("session-parent", FILES, "", ARCHIVE, "zh");
	assert.equal(isHandoffContinuationText(zhPrompt), true);
	assert.equal(
		resolveLanguage([user(zhPrompt), user("please continue with the next step of the plan")], "auto"),
		"en",
	);

	// A tiny sample carries the previous continuation prompt's language forward.
	assert.equal(resolveLanguage([user("ok"), user(zhPrompt)], "auto"), "zh");

	// An explicit choice wins outright, in both directions.
	assert.equal(resolveLanguage([user("中文 中文")], "en"), "en");
	assert.equal(resolveLanguage([user("plain english words")], "zh"), "zh");
});

test("a continuation prompt is never a language sample", () => {
	const prompt = continuation("session-parent", FILES, "", ARCHIVE);
	assert.deepEqual(languageSamples([user(prompt), user("injected context", "plugin")]), []);
	assert.deepEqual(languageSamples([user(prompt), assistant("done")]), []);
	// The injected-plugin text must not tip the decision either.
	assert.equal(resolveLanguage([user(prompt), user("this text has many latin letters", "plugin")], "auto"), "en");
});

test("recent samples are preferred only once they are substantial", () => {
	const many = (text) => Array.from({ length: 10 }, () => user(text));
	assert.equal(languageSamples(many("ab")).length, 10, "short recent texts keep every message");
	assert.equal(languageSamples(many("abcdefghij")).length, 8, "substantial recent texts drop the older ones");
});

test("only a complete generated continuation prompt is recognized", () => {
	const legacy = continuation("session-parent", FILES, "tail", ARCHIVE);
	assert.equal(isHandoffContinuationText(legacy), true, "the legacy English prompt is recognized");
	const zh = continuation("session-parent", FILES, "", ARCHIVE, "zh");
	assert.equal(isHandoffContinuationText(zh), true, "the localized prompt is recognized");

	// A quoted prompt, a quote with appended text, and an incomplete prompt are not.
	assert.equal(isHandoffContinuationText(legacy.split("\n").map((line) => `> ${line}`).join("\n")), false);
	assert.equal(isHandoffContinuationText(`${legacy}\n\nAlso, please fix the failing test.`), false);
	const headingsOnly = `${SCAFFOLDING.en.continuationPreamble("session-parent")}\n\n${SCAFFOLDING.en.continuationClosing}`;
	assert.equal(isHandoffContinuationText(headingsOnly), false, "the structural markers are required too");
	assert.equal(isHandoffContinuationText("Please fix the failing test."), false);
	assert.equal(isHandoffContinuationText(""), false);
	assert.equal(isHandoffContinuationText("   \n  "), false);
});

test("the carried tail replaces a stale continuation prompt in place", () => {
	const prompt = continuation("session-parent", FILES, "no tail here", ARCHIVE);
	const session = fakeSession([
		message("user", "first question"),
		message("assistant", "first answer"),
		message("user", prompt),
		message("assistant", "answered in the old session"),
		message("user", "recent real question"),
	]);

	const split = handoffSplit(session, 100_000);
	assert.ok(split.tail.includes(`## user\n${REPLAY_MARKER}`), "the marker stands in for the prompt");
	assert.ok(!split.tail.includes("Handoff from session session-parent."), "the stale preamble is gone");
	assert.ok(!split.tail.includes("Start with the next concrete step"), "the stale closing is gone");
	assert.match(split.tail, /## user\nfirst question/);
	assert.match(split.tail, /## assistant\nfirst answer/);
	assert.match(split.tail, /## assistant\nanswered in the old session/);
	assert.match(split.tail, /## user\nrecent real question/);
});

test("handoffSplit summarizes the older part and only marks the tail", () => {
	const prompt = continuation("session-parent", FILES, "", ARCHIVE);
	const session = fakeSession([
		message("user", "ancient question"),
		message("assistant", "ancient answer"),
		message("user", prompt),
		message("assistant", "after the handoff"),
		message("user", "fresh question"),
	]);

	const split = handoffSplit(session, 40);
	assert.match(split.older, /ancient question/);
	assert.ok(!split.older.includes(REPLAY_MARKER), "the summarized part is not marker-substituted");
	assert.match(split.tail, /fresh question/);
	assert.ok(!split.tail.includes("ancient question"), "the tail starts after the kept window");
});

test("a prompt longer than the 4000-char section clip is still recognized", () => {
	const long = continuation("session-parent", FILES.repeat(120), "", ARCHIVE);
	assert.ok(long.length > 4_000, `the prompt must exceed the clip (${long.length})`);
	const session = fakeSession([
		message("user", "the real opening question"),
		message("assistant", "the real opening answer"),
		message("user", long),
		message("assistant", "and a real reply"),
	]);

	const split = handoffSplit(session, 100_000);
	assert.ok(split.tail.includes(`## user\n${REPLAY_MARKER}`), "the clipped prompt is still replaced");
	assert.ok(!split.tail.includes("Handoff from session"), "no partial prompt text is left behind");
	assert.ok(!split.tail.includes("Start with the next concrete step"));
	assert.match(split.tail, /## user\nthe real opening question/);
	assert.match(split.tail, /## assistant\nand a real reply/);

	// Detection runs on the raw text: the rendered section is clipped, the sample is not.
	const carried = split.languageMessages.find((entry) => entry.text.startsWith("Handoff from session"));
	assert.ok(carried, "the continuation prompt is offered to language resolution");
	assert.equal(carried.text.length, long.length, "language samples carry the unclipped text");
	assert.equal(resolveLanguage(split.languageMessages, "auto"), "en");
});

test("a wait handoff carries the open question into the continuation", () => {
	const question = "Which branch should I push to?";
	const withPending = continuation("session-parent", FILES, "", ARCHIVE, "en", question);
	assert.ok(withPending.includes(question));
	assert.match(withPending, /## Pending question/);
	// The wait line is the last instruction: a trailing "start with the next concrete step" would
	// override it and the child would choose an option the previous session stopped to ask about.
	assert.ok(withPending.endsWith(SCAFFOLDING.en.pendingWait));
	assert.ok(!withPending.includes(SCAFFOLDING.en.continuationClosing));
	// The carried-over prompt must still be recognizable as a handoff prompt on the next handoff.
	assert.equal(isHandoffContinuationText(withPending), true);

	const withoutPending = continuation("session-parent", FILES, "", ARCHIVE);
	assert.ok(!withoutPending.includes("Pending question"));
	assert.ok(withoutPending.endsWith(SCAFFOLDING.en.continuationClosing));
	assert.notEqual(withoutPending, withPending);

	const zh = continuation("session-parent", FILES, "", ARCHIVE, "zh", "推哪个分支？");
	assert.match(zh, /## 待用户回答的问题/);
	assert.ok(zh.includes("推哪个分支？"));
	assert.ok(zh.endsWith(SCAFFOLDING.zh.pendingWait));
	assert.ok(!zh.includes(SCAFFOLDING.zh.continuationClosing));
	assert.equal(isHandoffContinuationText(zh), true);

	// A whitespace-only question is not a question: no empty block, and the usual closing stays.
	const blank = continuation("session-parent", FILES, "", ARCHIVE, "en", "   ");
	assert.ok(!blank.includes("Pending question"));
	assert.ok(blank.endsWith(SCAFFOLDING.en.continuationClosing));
});

test("handoffCarry only carries the question when the config says wait", () => {
	const session = fakeSession([
		message("user", "please pick a branch"),
		message("assistant", "Should I push to main or to the feature branch?"),
	]);
	assert.match(handoffCarry(session, true).pending, /push to main/);
	// `defer` carries no question, and a question newer than the user's input then carries nothing at
	// all rather than the superseded input under a "do not ask again" closing.
	assert.deepEqual(handoffCarry(session, false), {});
	// An input newer than the question is still carried under `defer`.
	const answered = fakeSession([
		message("assistant", "Should I push to main or to the feature branch?"),
		message("user", "please pick a branch"),
	]);
	assert.equal(handoffCarry(answered, false).decision?.text, "please pick a branch");
});

test("/handoff lang accepts auto, zh and en only", () => {
	assert.deepEqual(settingPatch("lang auto"), { patch: { handoffLang: "auto" } });
	assert.deepEqual(settingPatch("lang zh"), { patch: { handoffLang: "zh" } });
	assert.deepEqual(settingPatch("lang en"), { patch: { handoffLang: "en" } });
	assert.equal(settingPatch("lang fr"), undefined);
	assert.equal(settingPatch("lang"), undefined);
	assert.equal(settingPatch("lang zh extra"), undefined);
});

test("handoffLang and maxOutputTokens are wired through every layer", () => {
	assert.equal(DEFAULT_CONFIG.handoffLang, "auto");
	assert.equal(DEFAULT_CONFIG.maxOutputTokens, 32_768);

	const resolved = resolvePluginConfig({});
	assert.equal(resolved.handoffLang, "auto");
	assert.equal(resolved.maxOutputTokens, 32_768);
	assert.equal(resolvePluginConfig({ handoffLang: "zh" }).handoffLang, "zh");
	assert.throws(() => resolvePluginConfig({ handoffLang: "fr" }), /handoffLang/);
	assert.throws(() => resolvePluginConfig({ maxOutputTokens: 12 }), /maxOutputTokens/);

	const schemaDefaults = PluginSettingsSchema({});
	assert.equal(schemaDefaults.handoffLang, "auto");
	assert.equal(schemaDefaults.maxOutputTokens, 32_768);
	assert.equal(PluginSettingsSchema({ handoffLang: "en" }).handoffLang, "en");
});

test("an unsettled continuable background subagent defers the automatic handoff", () => {
	const now = 1_700_000_000_000;
	const events = [
		{ type: "subagent/catalog", time: now - 120_000, data: { childId: "child-settled", mode: "continuable" } },
		{ type: "subagent/catalog", time: now - 60_000, data: { childId: "child-running", mode: "continuable" } },
		{ type: "user/message", time: now - 90_000, data: { source: { kind: "subagent-settled", senderSessionId: "child-settled" } } },
	];
	assert.deepEqual(outstandingSubagents(events, now), ["child-running"]);
	// A one-shot child never reports a settlement, so counting it would defer the handoff for the
	// whole horizon after a delegation that already returned its result.
	assert.deepEqual(
		outstandingSubagents([{ type: "subagent/catalog", time: now - 1_000, data: { childId: "one-shot", mode: "one-shot" } }], now),
		[],
	);
	// A child catalogued again after it settled counts as running once more.
	assert.deepEqual(
		outstandingSubagents([
			{ type: "subagent/catalog", time: now - 120_000, data: { childId: "child-resumed", mode: "continuable" } },
			{ type: "user/message", time: now - 60_000, data: { source: { kind: "subagent-settled", senderSessionId: "child-resumed" } } },
			{ type: "subagent/catalog", time: now - 30_000, data: { childId: "child-resumed", mode: "continuable" } },
		], now),
		["child-resumed"],
	);
	// A child that never reports a settlement stops counting after the horizon, so an abandoned
	// child cannot block handoffs forever.
	assert.deepEqual(outstandingSubagents(events, now + 61 * 60_000), []);
	// Unknown or empty logs mean "nothing pending": the guard fails open.
	assert.deepEqual(outstandingSubagents([], now), []);
	assert.deepEqual(outstandingSubagents([{ type: "user/message", data: {} }], now), []);
});

test("an empty span is refused instead of fabricating a continuation that drops nothing", () => {
	// Whitespace-only covers the empty session; the message names the `budget recent 0` escape because a
	// short conversation that fits the carried window reaches the same guard. The wording is the drop
	// semantics: nothing older than the recent window.
	assert.throws(() => assertHandoffDroppable("   \n\t "), /nothing older than the recent window to drop.*budget recent 0/);
	assert.doesNotThrow(() => assertHandoffDroppable("## user\nhello"));
});

test("tool output reaches the handoff tail, not just the tool name", () => {
	// The carried window is what the child reads: while the transcript walk only understood the
	// pre-rc.2 nested `tool-result` wrapper, every output rendered empty, so a real tail held
	// hundreds of `[tool: …]` stubs and no output at all. rc.2 carries the result as a first-class
	// `role: 'tool'` message whose `text` blocks hold it.
	const session = {
		deriveMessages: () => [
			{ role: "user", source: { kind: "user" }, content: [{ type: "text", text: "run the suite" }] },
			{ role: "assistant", source: { kind: "model" }, content: [{ type: "tool-call", id: "c1", name: "bash", arguments: "{}" }] },
			{ role: "tool", source: { kind: "tool", callId: "c1" }, toolCallId: "c1", content: [{ type: "text", text: "134 passing" }] },
		],
	};
	const split = handoffSplit(session, 100_000);
	assert.match(split.tail, /## assistant\n\[tool: bash\]/);
	assert.match(split.tail, /## tool result\n134 passing/, "the output reaches the child's carried window");
	assert.match(split.tail, /## user\nrun the suite/, "the carried window starts at the user turn");
});
