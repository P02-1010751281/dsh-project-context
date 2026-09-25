/**
 * Unit tests for the handoff language port: `auto` detection/resolution, the
 * scaffolding, the continuation-prompt predicate, the stale-prompt replay marker,
 * heading localization, the pending-question continuation block, and the two new
 * settings keys.
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { settingPatch } from "../lib/project-handoff/command.js";
import { handoffSplit, pendingQuestionFor, resolveHandoffLanguage, sessionLanguageMessages } from "../lib/project-handoff/conversation.js";
import { outstandingSubagents } from "../lib/project-handoff/guard.js";
import { assertHandoffSummarizable, handoffArtifacts } from "../lib/project-handoff/perform.js";
import { continuation, handoffPrompt, summaryAttemptBudgets } from "../lib/project-handoff/summary.js";
import {
	REPLAY_MARKER,
	SCAFFOLDING,
	detectHandoffLanguage,
	isHandoffContinuationText,
	languageSamples,
	localizeSummaryHeadings,
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

test("the resolved language reaches HANDOFF.md and the child's first message", () => {
	// The four wiring points a mutation can silently break: the resolved language must reach the
	// stored document, the localized headings and the seed prompt — not just the helper functions.
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
		rawSummary: "## Goal\n\n把 journal 写完\n\n## Next steps\n\n补测试",
		archive: ARCHIVE,
		pointers: { log: "/project/logs/session-parent-1234/session.md", index: "/project/logs/INDEX.md" },
		tail: "## user\n继续吧",
	};
	const zh = handoffArtifacts(args);
	assert.ok(zh.document.startsWith(SCAFFOLDING.zh.documentTitle("session-parent-1234")), "the document title is localized");
	assert.match(zh.document, /## 目标/);
	assert.doesNotMatch(zh.document, /## Goal/);
	assert.ok(zh.prompt.startsWith(SCAFFOLDING.zh.continuationPreamble("session-parent-1234")), "the seed prompt is localized");
	assert.match(zh.prompt, /## 目标/, "the seed prompt carries the same localized summary");
	assert.match(zh.prompt, /## 下一步/);

	// The other language must be just as real: English scaffolding and English headings.
	const en = handoffArtifacts({ ...args, language: "en", rawSummary: "## Goal\n\nfinish the journal" });
	assert.ok(en.document.startsWith(SCAFFOLDING.en.documentTitle("session-parent-1234")));
	assert.match(en.document, /## Goal/);
	assert.doesNotMatch(en.document, /## 目标/);
	assert.ok(en.prompt.startsWith(SCAFFOLDING.en.continuationPreamble("session-parent-1234")));
	assert.match(en.prompt, /## Goal/);
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
		rawSummary: "## Goal\n\nswitch branches",
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
	const zhPrompt = continuation("session-parent", "摘要", "", ARCHIVE, "zh");
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
	const prompt = continuation("session-parent", "summary", "", ARCHIVE);
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
	const legacy = continuation("session-parent", "summary", "tail", ARCHIVE);
	assert.equal(isHandoffContinuationText(legacy), true, "the legacy English prompt is recognized");
	const zh = continuation("session-parent", "摘要", "", ARCHIVE, "zh");
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
	const prompt = continuation("session-parent", "old summary", "no tail here", ARCHIVE);
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
	const prompt = continuation("session-parent", "old summary", "", ARCHIVE);
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
	const long = continuation("session-parent", "summary ".repeat(700), "", ARCHIVE);
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

const EN_SUMMARY = [
	"## Goal",
	"ship the port",
	"",
	"## Current state",
	"half done",
	"",
	"## Decisions",
	"follow the reference implementation",
	"",
	"## Files",
	"- src/project-handoff/index.ts",
	"",
	"## Next steps",
	"1. write tests",
	"",
	"## Open questions",
	"none",
].join("\n");

test("summary headings localize both ways and leave fenced text alone", () => {
	const zh = localizeSummaryHeadings(EN_SUMMARY, "zh");
	assert.match(zh, /^## 目标$/m);
	assert.match(zh, /^## 当前状态$/m);
	assert.match(zh, /^## 决策$/m);
	assert.match(zh, /^## 文件$/m);
	assert.match(zh, /^## 下一步$/m);
	assert.match(zh, /^## 未决问题$/m);
	assert.equal(localizeSummaryHeadings(zh, "en"), EN_SUMMARY, "zh -> en round-trips");
	assert.equal(localizeSummaryHeadings(EN_SUMMARY, "en"), EN_SUMMARY, "an English summary is unchanged");

	const fenced = ["```md", "## Goal", "```", "## Goal"].join("\n");
	const localized = localizeSummaryHeadings(fenced, "zh");
	assert.equal(localized, ["```md", "## Goal", "```", "## 目标"].join("\n"));
	assert.equal(localizeSummaryHeadings(localized, "en"), fenced, "the fenced heading round-trips untouched");
});

test("a wait handoff carries the open question into the continuation", () => {
	const question = "Which branch should I push to?";
	const withPending = continuation("session-parent", "summary", "", ARCHIVE, "en", question);
	assert.ok(withPending.includes(question));
	assert.match(withPending, /## Pending question/);
	// The wait line is the last instruction: a trailing "start with the next concrete step" would
	// override it and the child would choose an option the previous session stopped to ask about.
	assert.ok(withPending.endsWith(SCAFFOLDING.en.pendingWait));
	assert.ok(!withPending.includes(SCAFFOLDING.en.continuationClosing));
	// The carried-over prompt must still be recognizable as a handoff prompt on the next handoff.
	assert.equal(isHandoffContinuationText(withPending), true);

	const withoutPending = continuation("session-parent", "summary", "", ARCHIVE);
	assert.ok(!withoutPending.includes("Pending question"));
	assert.ok(withoutPending.endsWith(SCAFFOLDING.en.continuationClosing));
	assert.notEqual(withoutPending, withPending);

	const zh = continuation("session-parent", "摘要", "", ARCHIVE, "zh", "推哪个分支？");
	assert.match(zh, /## 待用户回答的问题/);
	assert.ok(zh.includes("推哪个分支？"));
	assert.ok(zh.endsWith(SCAFFOLDING.zh.pendingWait));
	assert.ok(!zh.includes(SCAFFOLDING.zh.continuationClosing));
	assert.equal(isHandoffContinuationText(zh), true);

	// A whitespace-only question is not a question: no empty block, and the usual closing stays.
	const blank = continuation("session-parent", "summary", "", ARCHIVE, "en", "   ");
	assert.ok(!blank.includes("Pending question"));
	assert.ok(blank.endsWith(SCAFFOLDING.en.continuationClosing));
});

test("pendingQuestionFor only carries the question when the config says wait", () => {
	const session = fakeSession([
		message("user", "please pick a branch"),
		message("assistant", "Should I push to main or to the feature branch?"),
	]);
	assert.match(pendingQuestionFor({ ...DEFAULT_CONFIG, handoffPendingQuestion: "wait" }, session), /push to main/);
	assert.equal(pendingQuestionFor({ ...DEFAULT_CONFIG, handoffPendingQuestion: "defer" }, session), undefined);
});

test("/handoff lang accepts auto, zh and en only", () => {
	assert.deepEqual(settingPatch("lang auto"), { patch: { handoffLanguage: "auto" } });
	assert.deepEqual(settingPatch("lang zh"), { patch: { handoffLanguage: "zh" } });
	assert.deepEqual(settingPatch("lang en"), { patch: { handoffLanguage: "en" } });
	assert.equal(settingPatch("lang fr"), undefined);
	assert.equal(settingPatch("lang"), undefined);
	assert.equal(settingPatch("lang zh extra"), undefined);
});

test("the summarizer prompt carries the resolved language next to its section list", () => {
	const en = handoffPrompt("/repo", "memory", "older", "", "en");
	assert.match(en, /Use exactly these sections: ## Goal, ## Current state, ## Decisions, ## Files, ## Next steps, ## Open questions\./);
	assert.ok(en.includes(SCAFFOLDING.en.summaryDirective));
	assert.ok(!en.includes(SCAFFOLDING.zh.summaryDirective));

	const zh = handoffPrompt("/repo", "memory", "older", "", "zh");
	assert.ok(zh.includes(SCAFFOLDING.zh.summaryDirective));
	assert.match(zh, /Write the whole summary in Simplified Chinese/);
	assert.ok(!zh.includes(SCAFFOLDING.en.summaryDirective));
});

test("handoffLanguage and maxOutputTokens are wired through every layer", () => {
	assert.equal(DEFAULT_CONFIG.handoffLanguage, "auto");
	assert.equal(DEFAULT_CONFIG.maxOutputTokens, 32_768);

	const resolved = resolvePluginConfig({});
	assert.equal(resolved.handoffLanguage, "auto");
	assert.equal(resolved.maxOutputTokens, 32_768);
	assert.equal(resolvePluginConfig({ handoffLanguage: "zh" }).handoffLanguage, "zh");
	assert.throws(() => resolvePluginConfig({ handoffLanguage: "fr" }), /handoffLanguage/);
	assert.throws(() => resolvePluginConfig({ maxOutputTokens: 12 }), /maxOutputTokens/);

	const schemaDefaults = PluginSettingsSchema({});
	assert.equal(schemaDefaults.handoffLanguage, "auto");
	assert.equal(schemaDefaults.maxOutputTokens, 32_768);
	assert.equal(PluginSettingsSchema({ handoffLanguage: "en" }).handoffLanguage, "en");
});

test("headings are localized only outside a code fence that really closes", () => {
	const doc = ["```bash", "## Goal", "```", "## Goal"].join("\n");
	const localized = localizeSummaryHeadings(doc, "zh");
	assert.ok(localized.includes("```bash\n## Goal\n```"), "fenced code content stays as written");
	assert.ok(localized.endsWith("## 目标"), "the heading after the fence is translated");

	// A closer repeats the opener's character and length; a shorter ``` must not end a ```` block.
	const mismatched = ["````", "## Goal", "```", "## Next steps", "````"].join("\n");
	const stillInside = localizeSummaryHeadings(mismatched, "zh");
	assert.ok(!stillInside.includes("目标"));
	assert.ok(!stillInside.includes("下一步"));

	// An info string is not a closer either, so the block stays open to the real one.
	const infoString = ["```", "## Goal", "```js", "## Next steps", "```"].join("\n");
	const infoLocalized = localizeSummaryHeadings(infoString, "zh");
	assert.ok(!infoLocalized.includes("目标"));
	assert.ok(!infoLocalized.includes("下一步"));

	// A four-space indent is an indented code block, not a fence, so it cannot swallow the rest.
	assert.ok(localizeSummaryHeadings(["    ```", "## Goal", "    ```"].join("\n"), "zh").includes("## 目标"));
	assert.equal(localizeSummaryHeadings("    ## Goal", "zh"), "    ## Goal");

	// A properly closed fence still protects its content in both directions.
	assert.equal(localizeSummaryHeadings("~~~\n## 目标\n~~~\n## 目标", "en"), "~~~\n## 目标\n~~~\n## Goal");
	// A backtick in an opening backtick fence's info string makes it not a fence at all (CommonMark),
	// so the heading after it is ordinary text and is localized.
	assert.ok(localizeSummaryHeadings(["```a`b", "## Goal"].join("\n"), "zh").includes("## 目标"));
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

test("an empty span is refused instead of summarized into a fabricated handoff", () => {
	// Whitespace-only covers the empty session; the message names the `keep` escape because a short
	// conversation that fits the carried window reaches the same guard.
	assert.throws(() => assertHandoffSummarizable("   \n\t "), /nothing to hand off.*keep 0/);
	assert.doesNotThrow(() => assertHandoffSummarizable("## user\nhello"));
});

test("the summary retry grows but never passes the configured growth boundary", () => {
	// The default pair: the fixed floor wins, exactly as before the boundary existed.
	assert.deepEqual(summaryAttemptBudgets(DEFAULT_CONFIG), [8192, 32_768]);
	// A lowered boundary bounds the retry instead of the fixed floor overriding the user's choice.
	assert.deepEqual(summaryAttemptBudgets({ ...DEFAULT_CONFIG, maxOutputTokens: 12_000 }), [8192, 12_000]);
	// A user-raised starting cap is never lowered by a smaller boundary, and a big cap still retries
	// at double its own size rather than at the small floor.
	assert.deepEqual(summaryAttemptBudgets({ ...DEFAULT_CONFIG, maxOutputTokens: 4_000 }), [8192]);
	assert.deepEqual(summaryAttemptBudgets({ ...DEFAULT_CONFIG, maxTokens: 20_000 }), [20_000, 32_768]);
});

test("tool output reaches the handoff tail, not just the tool name", () => {
	// The carried window is what the child reads: before the `textOf` fix every `tool-result` block
	// rendered empty, so a real tail held hundreds of `[tool: …]` stubs and no output at all.
	const session = {
		deriveMessages: () => [
			{ role: "user", source: { kind: "user" }, content: [{ type: "text", text: "run the suite" }] },
			{ role: "assistant", source: { kind: "model" }, content: [{ type: "tool-call", id: "c1", name: "bash", arguments: "{}" }] },
			{ role: "user", source: { kind: "tool", callId: "c1" }, content: [{ type: "tool-result", toolCallId: "c1", content: [{ type: "text", text: "134 passing" }] }] },
		],
	};
	const split = handoffSplit(session, 100_000);
	assert.match(split.tail, /## assistant\n\[tool: bash\]/);
	assert.match(split.tail, /## tool result\n134 passing/, "the output reaches the child's carried window");
	assert.match(split.tail, /## user\nrun the suite/, "the carried window starts at the user turn");
});
