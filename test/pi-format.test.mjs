/**
 * Pi-format compatibility: pi's harness writes session logs into the same
 * `.agents/` layout as dsh, with a different schema. These tests pin the three
 * places that used to be dsh-only, each with the real shape taken from a pi
 * archive (`.agents/memory/session-logs/01a095f7-…/session.jsonl`):
 *
 * 1. the archive reader recognized only dsh event names, so a pi archive
 *    rendered zero characters — and autolearn silently skips an empty extract,
 *    making every pi session invisible to automatic skill consolidation;
 * 2. the import read only a numeric `createdAt` and fell back to `Date.now()`,
 *    so a pi session was indexed (and rendered) as having started on the day it
 *    was imported;
 * 3. the Markdown header called `new Date(createdAt).toISOString()` directly,
 *    which aborts the whole render on a missing timestamp.
 *
 * A fourth gap is pinned here too: the index title recognized only dsh's
 * `user/message` event, so a pi session imported by dsh was indexed as
 * "Untitled session" — the one label autolearn navigates the index by.
 *
 * A fifth: that title fallback took the handoff's own continuation prompt — a
 * `user`-role message with no marker distinguishing it from a person's — as the
 * session's first user message. dsh's prompt RPC carries no source kind, and a
 * pi archive stores pi's seed the same way, so each harness's own structural
 * detector is applied here: dsh's is prefix + `<handoff>`/`</handoff>` markers +
 * closing (no heading), pi's is prefix + a section heading + closing line.
 *
 * Fixtures are inlined on purpose: `.agents/` is this machine's data, not a
 * repository asset.
 *
 * Run `pnpm test` (builds lib/ first).
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { archivedConversationText } from "../lib/project-context/archive.js";
import { importSessionJsonl } from "../lib/project-context/import.js";
import { parseSessionJsonl } from "../lib/project-context/session-jsonl.js";
import { renderSessionMarkdown } from "../lib/project-context/session-log.js";
import { readSessionIndex, sessionTitleFromEntries } from "../lib/project-context/session-index.js";
import { SCAFFOLDING, isHandoffContinuationText } from "../lib/project-handoff/language.js";

/** Header of a real pi archive: `timestamp` (ISO string), no `harness`, no `createdAt`. */
const PI_HEADER = {
	type: "session",
	version: 3,
	id: "01a095f7-073b-730b-b213-29cf2c28e27c",
	timestamp: "2026-09-12T14:13:09.563Z",
	cwd: "/mnt/Data/Projects/dsh-project-context",
};

/** One pi `message` event per entry; the body is the message itself (dsh nests it under `data`). */
const piMessage = (message) => ({ type: "message", id: "86e3cc65", parentId: "7c00c7c5", timestamp: "2026-09-12T14:13:27.661Z", message });

/** Verbatim shapes from the archive: thinking + toolCall assistant turn, then a toolResult. */
const PI_EVENTS = [
	piMessage({ role: "user", content: [{ type: "text", text: "dsh没有反应卡住，debug" }] }),
	piMessage({
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "The user says dsh is stuck. Let me look at the project first." },
			{ type: "toolCall", id: "call_00_ZkpgEVY5sJeSyoRQph6l8249", name: "bash", arguments: { command: "ls -la" } },
			{ type: "toolCall", id: "call_01_W343KEx3mDmOuXZPVeTU1024", name: "read", arguments: { path: "README.md" } },
		],
	}),
	piMessage({
		role: "toolResult",
		toolCallId: "call_00_ZkpgEVY5sJeSyoRQph6l8249",
		toolName: "bash",
		content: [{ type: "text", text: "总计 84\ndrwxr-xr-x 1 user users 4096  9月12日 22:06 ." }],
		isError: false,
	}),
	piMessage({ role: "assistant", content: [{ type: "text", text: "服务器在 3080 上响应 401。" }] }),
];

const PI_LOG = [JSON.stringify(PI_HEADER), ...PI_EVENTS.map((event) => JSON.stringify(event))].join("\n");

test("archivedConversationText renders a pi JSONL into the dsh section shape", () => {
	const text = archivedConversationText(PI_LOG, 50_000);

	assert.match(text, /## user\ndsh没有反应卡住，debug/);
	// pi spells the tool-call block `toolCall`; only its `name` is rendered, as on the dsh side.
	assert.match(text, /## assistant\n\[tool: bash\] \[tool: read\]/);
	assert.match(text, /## tool result\n总计 84/);
	// Thinking is dropped, exactly as dsh drops `assistant/message.stream`.
	assert.doesNotMatch(text, /The user says dsh is stuck/);
	assert.doesNotMatch(text, /"arguments"/);
	// A pi log carries no dsh event, so nothing may render the dsh-side labels twice.
	assert.equal(text.match(/## user/g)?.length, 1);
});

test("the pi branch keeps the budget, the block order and the empty-message rules", () => {
	// Text and tools of one assistant turn stay in one section, text first.
	const withText = archivedConversationText(PI_LOG, 50_000);
	assert.match(withText, /## assistant\n服务器在 3080 上响应 401。/);

	// Only `role` matters: a non-message event (model_change, thinking_level_change,
	// the session header) renders nothing rather than aborting the backtrack.
	const noisy = [
		JSON.stringify(PI_HEADER),
		JSON.stringify({ type: "model_change", id: "b3a5ee5a", timestamp: "2026-09-12T14:13:10.894Z", provider: "deepseek" }),
		JSON.stringify({ type: "message", id: "x", message: { role: "assistant", content: [{ type: "thinking", thinking: "only thoughts" }] } }),
		JSON.stringify({ type: "message", id: "y", message: "not an object" }),
		JSON.stringify({ type: "message", id: "z", message: { role: "user", content: "not an array" } }),
	];
	assert.equal(archivedConversationText(noisy.join("\n"), 50_000), "");

	// The same 4000/1500-character budgets the dsh branches use.
	const long = archivedConversationText(
		[
			JSON.stringify(piMessage({ role: "user", content: [{ type: "text", text: "u".repeat(5_000) }] })),
			JSON.stringify(piMessage({ role: "toolResult", content: [{ type: "text", text: "t".repeat(2_000) }] })),
		].join("\n"),
		50_000,
	);
	assert.match(long, /\[\.\.\.truncated\.\.\.\]/);
	assert.equal(long.match(/\[\.\.\.truncated\.\.\.\]/g)?.length, 2, "both pi branches clip to their own budget");
	assert.ok(!long.includes("u".repeat(4_100)), "user text is clipped at 4000 characters");
	assert.ok(!long.includes("t".repeat(1_600)), "tool output is clipped at 1500 characters");
});

test("archivedConversationText still renders dsh events and ignores a dsh message without source", () => {
	const lines = [
		JSON.stringify({ type: "session", harness: "dsh", id: "s1" }),
		JSON.stringify({ type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "build release" }] } }),
		// A dsh event named `message` would be pi's event name; dsh never emits one, and this
		// shape must not make a dsh log render anything extra.
		JSON.stringify({ type: "user/message", data: { source: { kind: "tool" }, content: [{ type: "text", text: "hidden" }] } }),
	];
	const text = archivedConversationText(lines.join("\n"), 50_000);
	assert.equal(text, "## user\nbuild release");
});

test("parseSessionJsonl takes the start time from a pi ISO timestamp, not from the import clock", async () => {
	const before = Date.now();
	const parsed = parseSessionJsonl(PI_LOG);
	assert.equal(parsed.createdAt, Date.parse("2026-09-12T14:13:09.563Z"));
	assert.equal(new Date(parsed.createdAt).toISOString().slice(0, 10), "2026-09-12");
	assert.ok(parsed.createdAt < before, "the header timestamp wins over the import time");
	// pi's header names no harness; the ISO `timestamp` is only a positive signal for
	// the *date*, so the label stays honest rather than guessing "pi".
	assert.equal(parsed.harness, "unknown");
});

test("importSessionJsonl writes a pi archive with its own date in the index and the Markdown header", async () => {
	const project = await mkdtemp(path.join(tmpdir(), "dsh-pi-import-"));
	try {
		const outcome = await importSessionJsonl(PI_LOG, { projectRoot: project });
		assert.equal(outcome.status, "created", outcome.error);

		const logs = path.join(project, ".agents", "memory", "session-logs");
		const index = await readFile(path.join(logs, "INDEX.md"), "utf8");
		assert.match(index, /— 2026-09-12 —/, "the index line carries the session's own date");
		const markdown = await readFile(path.join(logs, PI_HEADER.id, "session.md"), "utf8");
		assert.match(markdown, /- Started: 2026-09-12T14:13:09\.563Z/);
		assert.doesNotMatch(markdown, /- Started: unknown time/);
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});

test("a dsh header keeps its numeric createdAt, and a bare harness field still decides the label", () => {
	const dsh = parseSessionJsonl(`${JSON.stringify({ type: "session", harness: "dsh", id: "s1", createdAt: 1_700_000_000_000 })}\n`);
	assert.equal(dsh.createdAt, 1_700_000_000_000);
	assert.equal(dsh.harness, "dsh");

	// The numeric branch is the signal for a header that predates `harness` (dsh always wrote one).
	const legacy = parseSessionJsonl(`${JSON.stringify({ type: "session", harness: "dsh", id: "s2", createdAt: 1_700_000_000_000 })}\n`.replace('"harness":"dsh",', ""));
	assert.equal(legacy.harness, "dsh");

	// A header with neither a usable `createdAt` nor a `timestamp` falls back to now, as before.
	const now = Date.now();
	const undated = parseSessionJsonl(`${JSON.stringify({ type: "session", harness: "dsh", id: "s3" })}\n`);
	assert.ok(Math.abs(undated.createdAt - now) < 5_000, "an undated archive still imports");
	assert.equal(undated.harness, "dsh");
});

test("renderSessionMarkdown degrades a missing header timestamp instead of throwing", () => {
	const header = { type: "session", harness: "dsh", id: "s1", version: 3, createdAt: undefined, cwd: "/p", isSeeded: false };
	const markdown = renderSessionMarkdown(header, [{ type: "user/message", time: undefined }]);
	assert.match(markdown, /- Started: unknown time/);
	assert.match(markdown, /### 1\. user\/message — unknown time/);

	// A zero createdAt is the corrupt-archive case the entry-sections path already labels.
	assert.match(
		renderSessionMarkdown({ ...header, createdAt: 0 }, []),
		/- Started: unknown time/,
	);
	// Out-of-range values are the `RangeError: Invalid time value` case, not a crash.
	assert.match(
		renderSessionMarkdown({ ...header, createdAt: 1e21 }, []),
		/- Started: unknown time/,
	);
	// A usable timestamp is untouched.
	assert.match(
		renderSessionMarkdown({ ...header, createdAt: Date.UTC(2026, 8, 12, 14, 13, 9, 563) }, []),
		/- Started: 2026-09-12T14:13:09\.563Z/,
	);
});

test("sessionTitleFromEntries reads a pi user message, so an imported pi session is not Untitled", () => {
	// The whole point of the fix: dsh names its user event `user/message`, pi names it `message`
	// and nests the body under `message`. Before this branch the title fell through to the
	// fallback on every pi archive imported by dsh.
	assert.equal(sessionTitleFromEntries(PI_EVENTS), "dsh没有反应卡住，debug");

	// A `session/title` still wins over the first user message (dsh's own precedence).
	assert.equal(
		sessionTitleFromEntries([{ type: "session/title", data: { title: "assigned" } }, ...PI_EVENTS]),
		"assigned",
	);
	// The first user message wins over a later one.
	assert.equal(
		sessionTitleFromEntries([
			piMessage({ role: "user", content: [{ type: "text", text: "first" }] }),
			piMessage({ role: "user", content: [{ type: "text", text: "second" }] }),
		]),
		"first",
	);
	// Only `role: "user"` counts: an assistant or tool result is not a title, and neither is a
	// malformed body (a non-object message, or a non-array content).
	assert.equal(
		sessionTitleFromEntries([
			piMessage({ role: "assistant", content: [{ type: "text", text: "assistant text" }] }),
			piMessage({ role: "toolResult", content: [{ type: "text", text: "tool text" }] }),
			{ type: "message", message: "not an object" },
			{ type: "message", message: { role: "user", content: "not an array" } },
			{ type: "message", message: null },
		]),
		"Untitled session",
	);
	// Every text block of the pi message contributes, joined pi's way — the same `piTextOf` the
	// archive reader uses, so the title and the rendered transcript agree on one string. This is a
	// deliberate semantic unification, not an accident of which helper was at hand: a
	// space-joining variant would produce "a b" here while `archivedConversationText` renders
	// "ab" for the very same message, and `clip` cannot reconcile the two (it collapses
	// whitespace but never supplies a separator that was never there). Thinking blocks are not text.
	assert.equal(
		sessionTitleFromEntries([
			piMessage({ role: "user", content: [{ type: "thinking", thinking: "hidden" }, { type: "text", text: "a" }, { type: "text", text: "b" }] }),
		]),
		"ab",
	);
	// The cross-check that makes the pin meaningful: the title equals what the archive reader
	// extracts from the same message, so the two paths cannot drift apart again unnoticed.
	const multiBlock = piMessage({ role: "user", content: [{ type: "text", text: "hello" }, { type: "text", text: "world" }] });
	assert.equal(sessionTitleFromEntries([multiBlock]), "helloworld");
	assert.match(archivedConversationText(JSON.stringify(multiBlock), 50_000), /## user\nhelloworld$/);
});

test("the title fallback skips a handoff's own continuation prompt, dsh's and pi's", () => {
	// Regression: the fallback took the first `user`-role message, but a handoff seeds its
	// successor with one and nothing marks it as generated (dsh's prompt RPC carries no source
	// kind; a pi archive stores pi's seed the same way). `01a09821` was therefore indexed under an
	// 11,384-character pi banner instead of the user's own first message.
	const piMessageOf = (text) => piMessage({ role: "user", content: [{ type: "text", text }] });
	// pi's real shape, taken from its `handoff/prompt.ts`: preamble, carry note, both headings, closing.
	const piSeed = [
		"This session continues work handed off from a previous session (35% of its context window had been used).",
		"The handoff summary below covers the earlier part of that session; its most recent messages were carried over verbatim.",
		"",
		"## Handoff Summary",
		"…",
		"",
		"## Previous session details",
		"- Previous session id: 01a09620-b50e-730b-b213-29d5a68358bf",
		"",
		"Continue the task from where it left off.",
	].join("\n");
	assert.equal(sessionTitleFromEntries([piMessageOf(piSeed), piMessageOf("旧的删掉，继续")]), "旧的删掉，继续");
	assert.equal(sessionTitleFromEntries([piMessageOf(piSeed)]), "Untitled session", "a seed-only session is not titled by the banner");

	const dshMessage = (text) => ({
		type: "user/message",
		data: { source: { kind: "user", rpcId: "4f0f7006-a02d-41a6-9cdd-e38586fa47d7" }, content: [{ type: "text", text }] },
	});
	const dshSeed = [
		SCAFFOLDING.en.continuationPreamble("session-parent-1234"),
		"",
		"<handoff>",
		"…",
		"</handoff>",
		"",
		SCAFFOLDING.en.continuationClosing,
	].join("\n");
	// The cross-check that keeps the fixture honest: this really is a prompt dsh's own detector
	// recognizes, so the assertion below cannot pass by the fixture having drifted into prose.
	assert.equal(isHandoffContinuationText(dshSeed), true);
	assert.equal(sessionTitleFromEntries([dshMessage(dshSeed), dshMessage("fix the failing test")]), "fix the failing test");
	assert.equal(sessionTitleFromEntries([dshMessage(dshSeed)]), "Untitled session");
	// A `session/title` still outranks whatever the user messages say (dsh's own precedence).
	assert.equal(
		sessionTitleFromEntries([{ type: "session/title", data: { title: "↪ handoff · parent" } }, dshMessage(dshSeed)]),
		"↪ handoff · parent",
	);

	// The conjunction is the discriminator: dropping one part of the shape makes the message a
	// person's again, so a user who quotes a handoff (or pastes its opening) keeps their title.
	// Matching the prefix alone would swallow exactly the messages this guard exists to preserve.
	const quoted = piSeed.replace(/\nContinue the task from where it left off\.$/, "\n\nAlso, please fix the failing test.");
	const quotedTitle = sessionTitleFromEntries([piMessageOf(quoted)]);
	assert.equal(quotedTitle.startsWith("This session continues work handed off"), true, "a quoted prompt is still a user message");
	assert.notEqual(quotedTitle, "Untitled session");
	// Both headings must go: the set is a membership test, so leaving either one in still satisfies
	// the shape (the first attempt at this assertion replaced only one and was wrong).
	const headingsGone = piSeed.replace("## Handoff Summary", "## Notes").replace("## Previous session details", "## More notes");
	assert.equal(sessionTitleFromEntries([piMessageOf(headingsGone)]).startsWith("This session continues work handed off"), true, "a heading is required");
	// The prefix is the third part and the one a test can most easily leave unpinned: an adversarial
	// review's mutant deleted this check and the whole suite stayed green (11/11), because every other
	// fixture still carried the prefix. A paste that starts at `## Handoff Summary` and ends on pi's
	// closing line is all prosaic English, so that gap was reachable, not theoretical.
	const prefixGone = piSeed.slice(piSeed.indexOf("\n") + 1);
	assert.equal(prefixGone.startsWith("The handoff summary"), true, "the fixture really has the preamble removed");
	assert.equal(
		sessionTitleFromEntries([piMessageOf(prefixGone)]).startsWith("The handoff summary below"),
		true,
		"the preamble prefix is required",
	);
	// A message that is exactly the prefix is not a prompt either (no heading, no closing).
	assert.equal(
		sessionTitleFromEntries([piMessageOf("This session continues work handed off from a previous session (")]).startsWith(
			"This session continues work handed off",
		),
		true,
		"the prefix alone is not a prompt",
	);
	// One prompt can arrive as several text blocks — pi joins them with no separator — and the guard
	// runs on the joined text, so the shape has to survive the split.
	const splitSeed = piMessage({
		role: "user",
		content: [{ type: "text", text: piSeed.slice(0, 60) }, { type: "text", text: piSeed.slice(60) }],
	});
	assert.equal(sessionTitleFromEntries([splitSeed, piMessageOf("next")]), "next", "a seed split across blocks is still one prompt");
});

test("a pi session imported by dsh gets its first user message as the index title", async () => {
	const project = await mkdtemp(path.join(tmpdir(), "dsh-pi-title-"));
	try {
		const outcome = await importSessionJsonl(PI_LOG, { projectRoot: project });
		assert.equal(outcome.status, "created", outcome.error);
		const index = await readFile(path.join(project, ".agents", "memory", "session-logs", "INDEX.md"), "utf8");
		assert.match(index, /— 2026-09-12 — dsh没有反应卡住，debug$/m);
		assert.doesNotMatch(index, /Untitled session/);
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});

test("readSessionIndex keeps the index oldest-first, so a newest-lines window is not inverted", async () => {
	// The order is a contract, not an incidental: autolearn reads `index.slice(-MAX_INDEX_ENTRIES)`
	// to get the *newest* sessions, so a `reverse()` here silently hands it the oldest ones instead.
	// Written by hand in the same shape `orderIndexLines` produces (oldest first).
	const project = await mkdtemp(path.join(tmpdir(), "dsh-pi-order-"));
	try {
		const dir = path.join(project, ".agents", "memory", "session-logs");
		await mkdir(dir, { recursive: true });
		await writeFile(
			path.join(dir, "INDEX.md"),
			[
				"# Session Index",
				"",
				"- [old](old/session.md) — 2026-01-01 — oldest",
				"- [mid](mid/session.md) — 2026-06-01 — middle",
				"- [new](new/session.md) — 2026-12-01 — newest",
				"",
			].join("\n"),
			{ encoding: "utf8" },
		);
		const entries = await readSessionIndex(project);
		assert.deepEqual(
			entries.map((entry) => entry.id),
			["old", "mid", "new"],
			"the parsed order is the file's order (oldest first)",
		);
		assert.equal(entries.at(-1).title, "newest", "the last entry is the newest session");
		// The paths are resolved against `session-logs/`, which is what makes the window usable.
		assert.equal(entries[0].file, path.join(dir, "old", "session.md"));
		assert.equal(entries[2].raw, path.join(dir, "new", "session.jsonl"));
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});
