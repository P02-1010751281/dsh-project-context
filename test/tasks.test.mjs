/**
 * Batch Z3 — the task dimension.
 *
 * Four contracts are pinned here, because each one fails invisibly on its own:
 *  - the state machine (active / dormant / archived) is derived, so its boundaries are dates;
 *  - a session's binding lives in `meta.json` and survives the archive write that rewrites that
 *    very file every settle;
 *  - the document a bound session writes is its task's, never `CONTEXT.md`, and an unbound
 *    session's bytes are unchanged;
 *  - an archived task is not injected, and is not written, so a pass cannot reopen it by accident.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DEFAULT_CONFIG, resolvePluginConfig } from "../lib/shared/config.js";
import { buildContextInjection, buildTaskInjection, buildTaskListInjection, taskInjectionPath } from "../lib/project-memory/injection.js";
import { renderTaskDocument } from "../lib/project-memory/context-doc.js";
import {
	boundTaskSync,
	dateStamp,
	deriveTaskStatus,
	listTasks,
	parseTaskMeta,
	readSessionTaskSync,
	readTask,
	taskMetaLine,
	taskViews,
	validTaskSlug,
	withTaskStatus,
} from "../lib/project-memory/tasks.js";
import { apply as applyMemory, consolidateProject } from "../lib/project-memory/index.js";
import { apply as applyContext } from "../lib/project-context/index.js";
import { queueSessionIndexEntry, setSessionTask } from "../lib/project-context/session-index.js";
import { getProjectRoot } from "../lib/shared/project-state.js";

/** A project root with the memory directory in place. */
async function memoryRoot(prefix, memory) {
	const root = await mkdtemp(path.join(tmpdir(), prefix));
	await mkdir(path.join(root, ".agents", "memory"), { recursive: true });
	if (memory !== undefined) await writeFile(path.join(root, ".agents", "memory", "MEMORY.md"), memory, "utf8");
	return root;
}

/** A task document as the renderer writes one, with the given status and activity date. */
function taskDocument(slug, { created = "2026-01-01", status = "active", lastSeen = dateStamp(), title = slug, summary = "" } = {}) {
	return renderTaskDocument(
		{ title, summary, key_points: ["a point"], open_tasks: ["a task"] },
		{ updatedAt: "2026-01-01T00:00:00.000Z", slug, meta: { created, status, lastSeen, title } },
	).text;
}

/** One consolidation pass's harness: one text reply, one captured call. */
function consolidationFixture({ root, reply, modelInfo }) {
	const calls = [];
	const ctx = {
		logger: { info() {}, warn() {} },
		llm: {
			resolveModelInfo: async () => modelInfo ?? { context: { contextWindow: 200_000 } },
			stream(options) {
				calls.push(options);
				return (async function* generate() {
					yield { type: "text-delta", index: 0, text: reply };
					yield { type: "finish", reason: { kind: "stop" } };
				})();
			},
		},
	};
	const agent = {
		options: { provider: "test-provider", model: "test-model" },
		session: {
			id: "session-task-fixture",
			header: { cwd: root, createdAt: Date.now() },
			snapshotEvents: () => [],
			deriveEventMessage: () => null,
			deriveMessages: () => [],
			requestHeader: () => undefined,
		},
	};
	return { calls, ctx, agent };
}

/** A reply that survives every gate: a four-section memory plus a context section. */
function replyWith(summary) {
	return JSON.stringify({
		memory_markdown: "# Project Memory\n\n## Project\n- a project fact\n\n## Invariants\n- a rule\n\n## Pitfalls\n\n## Index\n",
		context: { title: "task title", summary, key_points: [], open_tasks: [] },
	});
}

// ---------------------------------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------------------------------

test("a task's metadata line round-trips, and a title may contain the field separator", () => {
	const meta = { created: "2026-10-01", status: "dormant", lastSeen: "2026-11-09", title: "release · prep" };
	const line = taskMetaLine(meta);
	assert.deepEqual(parseTaskMeta(`# Project Task: release\n\n${line}\n\n## Summary\n`), meta);
	assert.deepEqual(parseTaskMeta(taskMetaLine({ ...meta, title: "" })), { ...meta, title: "" });
	// A body line quoting the format is still that document's metadata line (the first one found), and
	// the parse is identical either way.
	const bare = { created: "2026-01-01", status: "active", lastSeen: "2026-01-01", title: "" };
	assert.deepEqual(parseTaskMeta("## Summary\n\n> created 2026-01-01 · status active · lastSeen 2026-01-01\n"), bare);
	assert.deepEqual(parseTaskMeta("> created 2026-01-01 · status active · lastSeen 2026-01-01"), bare);
	assert.equal(parseTaskMeta("# Project Task: x\n\nno metadata here\n"), undefined);
	assert.equal(parseTaskMeta("> created 2026-01-01 · status bogus · lastSeen 2026-01-01\n"), undefined);
});

test("the dormant and archived boundaries are the dates the acceptance criterion names", () => {
	const base = { created: "2026-01-01", status: "active", lastSeen: "2026-08-01", title: "t" };
	const at = (days, mode = "assisted") => deriveTaskStatus(base, { mode, today: `2026-${days === 30 ? "08-31" : "11-01"}` });
	assert.equal(at(30), "active", "exactly 30 days is still active");
	// 2026-08-01 + 31 days = 2026-09-01.
	assert.equal(deriveTaskStatus(base, { mode: "assisted", today: "2026-09-01" }), "dormant", "31 days is dormant");
	// 2026-08-01 + 91 days = 2026-10-31; + 90 days = 2026-10-30.
	assert.equal(deriveTaskStatus(base, { mode: "assisted", today: "2026-10-30" }), "dormant", "90 days is still dormant under assisted");
	assert.equal(deriveTaskStatus(base, { mode: "assisted", today: "2026-10-31" }), "dormant", "assisted never auto-archives");
	assert.equal(deriveTaskStatus(base, { mode: "delegated", today: "2026-10-30" }), "dormant", "90 days is dormant under delegated too");
	assert.equal(deriveTaskStatus(base, { mode: "delegated", today: "2026-10-31" }), "archived", "91 days archives under delegated");
	// Activity reopens a dormant task; that is what `active` means.
	assert.equal(deriveTaskStatus({ ...base, lastSeen: "2026-10-20" }, { mode: "delegated", today: "2026-11-01" }), "active");
	// An authored archived is a decision, and no later date reopens it.
	assert.equal(deriveTaskStatus({ ...base, status: "archived", lastSeen: "2026-10-30" }, { mode: "delegated", today: "2026-11-01" }), "archived");
	// `manual` never derives: the stored value is the answer at every age.
	assert.equal(deriveTaskStatus(base, { mode: "manual", today: "2027-11-01" }), "active");
	assert.equal(deriveTaskStatus({ ...base, status: "dormant" }, { mode: "manual", today: "2026-08-02" }), "dormant");
	// A malformed date cannot age: report what is stored instead of inventing activity or decay.
	assert.equal(deriveTaskStatus({ ...base, lastSeen: "not-a-date" }, { mode: "delegated", today: "2026-11-01" }), "active");
});

test("a status rewrite touches the metadata line and nothing else", () => {
	const text = taskDocument("probe", { created: "2026-01-02", status: "active", lastSeen: "2026-01-02", summary: "the body" });
	const archived = withTaskStatus(text, "archived", "2026-03-04");
	assert.deepEqual(parseTaskMeta(archived), { created: "2026-01-02", status: "archived", lastSeen: "2026-03-04", title: "probe" });
	assert.match(archived, /the body/, "the body survives a status change");
	assert.equal(archived.split("\n").length, text.split("\n").length, "one line was replaced, not added");
	// A document with no metadata line is returned unchanged rather than gaining one.
	assert.equal(withTaskStatus("## Summary\n\ntext\n", "archived", "2026-03-04"), "## Summary\n\ntext\n");
});

test("a slug is a file name, so only the kebab-case shape is accepted", () => {
	assert.equal(validTaskSlug("release"), true);
	assert.equal(validTaskSlug("batch-z3"), true);
	assert.equal(validTaskSlug("Batch Z3"), false);
	assert.equal(validTaskSlug("-leading"), false);
	assert.equal(validTaskSlug("../escape"), false);
	assert.equal(validTaskSlug(""), false);
});

// ---------------------------------------------------------------------------------------------------
// Storage and binding
// ---------------------------------------------------------------------------------------------------

test("a task document in the plural directory is the unit, and one broken file hides no other", async () => {
	const root = await memoryRoot("dsh-tasks-list-");
	await mkdir(path.join(root, ".agents", "memory", "tasks"), { recursive: true });
	await writeFile(path.join(root, ".agents", "memory", "tasks", "beta.md"), taskDocument("beta", { title: "Beta" }), "utf8");
	await writeFile(path.join(root, ".agents", "memory", "tasks", "alpha.md"), taskDocument("alpha", { title: "Alpha" }), "utf8");
	// Not a task: no metadata line, and a name that is not a slug.
	await writeFile(path.join(root, ".agents", "memory", "tasks", "notes.md"), "# notes\n", "utf8");
	await writeFile(path.join(root, ".agents", "memory", "tasks", "Bad Name.md"), taskDocument("ignored"), "utf8");
	await writeFile(path.join(root, ".agents", "memory", "tasks", "readme.txt"), "not markdown", "utf8");

	const tasks = await listTasks(root);
	assert.deepEqual(tasks.map((task) => task.slug), ["alpha", "beta"], "sorted, valid, parseable only");
	assert.equal((await readTask(root, "notes")), undefined, "a document without metadata is not a task");
	assert.equal((await readTask(root, "missing")), undefined);
	assert.deepEqual(taskViews(tasks, { mode: "assisted", today: dateStamp() }).map((view) => view.status), ["active", "active"]);
});

test("the binding is read from meta.json, and an archived or missing task is not in use", async () => {
	const root = await memoryRoot("dsh-tasks-bind-");
	const session = {
		id: "session-bound",
		header: { cwd: root, createdAt: Date.parse("2026-01-01T00:00:00Z") },
		snapshotEvents: () => [],
	};
	const dir = path.join(root, ".agents", "memory", "session-logs", "session-bound");
	await mkdir(dir, { recursive: true });
	await mkdir(path.join(root, ".agents", "memory", "tasks"), { recursive: true });

	assert.equal(readSessionTaskSync(root, "session-bound"), undefined, "no metadata means unbound");
	await writeFile(path.join(dir, "meta.json"), `${JSON.stringify({ id: "session-bound", date: "2026-01-01", title: "t", task: "release" })}\n`, "utf8");
	assert.equal(readSessionTaskSync(root, "session-bound"), "release");
	await writeFile(path.join(dir, "meta.json"), `${JSON.stringify({ id: "session-bound", date: "2026-01-01", title: "t", task: "Bad Slug" })}\n`, "utf8");
	assert.equal(readSessionTaskSync(root, "session-bound"), undefined, "an invalid slug is not a binding");
	await writeFile(path.join(dir, "meta.json"), "{ not json", "utf8");
	assert.equal(readSessionTaskSync(root, "session-bound"), undefined, "a malformed file reads as unbound");

	// A task that exists but has been archived is bound, yet not in use: the session falls back to the
	// project-level document, which is also where its next pass will write.
	await writeFile(path.join(root, ".agents", "memory", "tasks", "release.md"), taskDocument("release", { status: "archived" }), "utf8");
	await writeFile(path.join(dir, "meta.json"), `${JSON.stringify({ id: "session-bound", date: "2026-01-01", title: "t", task: "release" })}\n`, "utf8");
	const today = dateStamp();
	assert.equal(boundTaskSync(root, "session-bound", { mode: "assisted", today }), undefined, "archived is not injected");
	await writeFile(path.join(root, ".agents", "memory", "tasks", "release.md"), taskDocument("release"), "utf8");
	assert.equal(boundTaskSync(root, "session-bound", { mode: "assisted", today })?.slug, "release");
	// A binding whose file was deleted is bound but unusable; it must not throw.
	assert.equal(boundTaskSync(root, "session-other", { mode: "assisted", today }), undefined);
	void session;
});

test("the archive write preserves the binding it did not author", async () => {
	const root = await memoryRoot("dsh-tasks-preserve-");
	const session = {
		id: "session-preserve",
		header: { cwd: root, createdAt: Date.parse("2026-01-01T00:00:00Z") },
		snapshotEvents: () => [],
		deriveMessages: () => [],
	};
	// The archive path rebuilds metadata from the live session on every settle, so a binding written by
	// the command would be erased on the next turn without this merge.
	await setSessionTask(root, session, "release");
	const metaFile = path.join(root, ".agents", "memory", "session-logs", "session-preserve", "meta.json");
	assert.equal(JSON.parse(await readFile(metaFile, "utf8")).task, "release");
	await queueSessionIndexEntry(root, session);
	assert.equal(JSON.parse(await readFile(metaFile, "utf8")).task, "release", "a settle does not unbind the session");
	// An explicit unbind is authored too: the merge must not resurrect it.
	await setSessionTask(root, session, undefined);
	assert.equal(JSON.parse(await readFile(metaFile, "utf8")).task, undefined);
	await queueSessionIndexEntry(root, session);
	assert.equal(JSON.parse(await readFile(metaFile, "utf8")).task, undefined, "an unbind survives the next settle");
});

// ---------------------------------------------------------------------------------------------------
// Injection
// ---------------------------------------------------------------------------------------------------

test("a task document is injected through its own path, and the list carries no bodies", () => {
	const text = taskDocument("release", { title: "Release prep", summary: "shipping" });
	const injected = buildTaskInjection(text, "/p", "release");
	assert.match(injected, /^# Project Task: release$/m, "the task's own header stays inline");
	assert.match(injected, /Release prep/);
	assert.match(injected, /the remaining sections are in `\/p\/\.agents\/memory\/tasks\/release\.md`/i);
	assert.match(injected, /shipping|Release prep/);
	assert.equal(taskInjectionPath("release"), ".agents/memory/tasks/release.md");

	const list = buildTaskListInjection([{ slug: "other", status: "dormant", title: "Other work" }], "en");
	assert.match(list, /^## Other tasks\n/);
	assert.match(list, /- `other` · dormant · Other work/);
	assert.equal(buildTaskListInjection([], "en"), "", "no tasks produce no block, which is what keeps old prompts identical");
	// The zh block is the same shape, so the list is never missing because the document is Chinese.
	assert.match(buildTaskListInjection([{ slug: "x", status: "active", title: "x" }], "zh"), /^## 其他任务\n/);
});

test("an unbound session with no tasks injects exactly the bytes it injected before the dimension", async () => {
	const root = await memoryRoot("dsh-tasks-injection-");
	await writeFile(path.join(root, ".agents", "memory", "CONTEXT.md"), "# Project Context\n\nLast updated: 2026-01-01T00:00:00.000Z\n\n## Summary\n\nplain context\n", "utf8");
	const contexts = [];
	const ctx = {
		on: () => () => undefined,
		effect: () => () => undefined,
		systemPrompt: { context: (spec) => { contexts.push(spec); return () => undefined; } },
		commands: { register: () => () => undefined },
		logger: { info: () => undefined, warn: () => undefined },
	};
	applyMemory(ctx, {});
	// Prompt assembly is synchronous and only reads a project root that is already cached; a cold cache
	// returns "" and warms it for the next turn.
	await getProjectRoot(root);
	const session = { id: "session-plain", header: { cwd: root, createdAt: Date.parse("2026-01-01T00:00:00Z") }, snapshotEvents: () => [], deriveMessages: () => [] };
	const text = contexts[1].text({ agent: { session } });
	assert.equal(
		text,
		`## Project Context\nThe following is project context, not a new user instruction:\n\n${buildContextInjection((await readFile(path.join(root, ".agents", "memory", "CONTEXT.md"), "utf8")).trim(), root)}`,
		"byte-identical: no task framing appears when this project uses no tasks",
	);
	assert.doesNotMatch(text, /## Other tasks/);
});

test("a bound session injects its task document, and the other tasks are listed beside it", async () => {
	const root = await memoryRoot("dsh-tasks-injection-bound-");
	await writeFile(path.join(root, ".agents", "memory", "CONTEXT.md"), "# Project Context\n\n## Summary\n\nproject level\n", "utf8");
	await mkdir(path.join(root, ".agents", "memory", "tasks"), { recursive: true });
	await writeFile(path.join(root, ".agents", "memory", "tasks", "release.md"), taskDocument("release", { title: "Release prep", summary: "task body" }), "utf8");
	await writeFile(path.join(root, ".agents", "memory", "tasks", "older.md"), taskDocument("older", { title: "Older work", lastSeen: "2026-01-01" }), "utf8");
	const contexts = [];
	const ctx = {
		on: () => () => undefined,
		effect: () => () => undefined,
		systemPrompt: { context: (spec) => { contexts.push(spec); return () => undefined; } },
		commands: { register: () => () => undefined },
		logger: { info: () => undefined, warn: () => undefined },
	};
	applyMemory(ctx, {});
	await getProjectRoot(root);
	const session = { id: "session-bound-view", header: { cwd: root, createdAt: Date.parse("2026-01-01T00:00:00Z") }, snapshotEvents: () => [], deriveMessages: () => [] };
	await setSessionTask(root, session, "release");
	const text = contexts[1].text({ agent: { session } });
	assert.match(text, /## Project Task \(release\)/, "the task document is what the session is shown");
	// The metadata line is preamble, so it stays inline: that is what proves the source is the task's
	// own document rather than CONTEXT.md (whose stamp line reads differently).
	assert.match(text, /created 2026-01-01 · status active/);
	assert.match(text, /## (Other tasks|其他任务)/, "the other tasks are still visible");
	assert.match(text, /- `older` · \w+ · Older work/, "one line per other task, no body");
	assert.doesNotMatch(text, /- `release`/, "the session's own task is not listed as another task");
});

test("an archived task is not injected, so a bound session reads the project context", async () => {
	const root = await memoryRoot("dsh-tasks-injection-archived-");
	await writeFile(path.join(root, ".agents", "memory", "CONTEXT.md"), "# Project Context\n\n## Key points\n\n- PROJECT-LEVEL-MARKER\n", "utf8");
	await mkdir(path.join(root, ".agents", "memory", "tasks"), { recursive: true });
	await writeFile(path.join(root, ".agents", "memory", "tasks", "release.md"), taskDocument("release", { status: "archived", summary: "ARCHIVED-BODY" }), "utf8");
	const contexts = [];
	const ctx = {
		on: () => () => undefined,
		effect: () => () => undefined,
		systemPrompt: { context: (spec) => { contexts.push(spec); return () => undefined; } },
		commands: { register: () => () => undefined },
		logger: { info: () => undefined, warn: () => undefined },
	};
	applyMemory(ctx, {});
	await getProjectRoot(root);
	const session = { id: "session-archived-view", header: { cwd: root, createdAt: Date.parse("2026-01-01T00:00:00Z") }, snapshotEvents: () => [], deriveMessages: () => [] };
	await setSessionTask(root, session, "release");
	const text = contexts[1].text({ agent: { session } });
	assert.doesNotMatch(text, /## Project Task/, "an archived task is not injected");
	assert.match(text, /PROJECT-LEVEL-MARKER/, "the session reads the project-level document instead");
	assert.doesNotMatch(text, /ARCHIVED-BODY/);
});

// ---------------------------------------------------------------------------------------------------
// The write path
// ---------------------------------------------------------------------------------------------------

test("a bound session's pass writes its task file and does not touch CONTEXT.md", async () => {
	const root = await memoryRoot("dsh-tasks-write-");
	const before = "# Project Context\n\n## Summary\n\nuntouched\n";
	await writeFile(path.join(root, ".agents", "memory", "CONTEXT.md"), before, "utf8");
	const { ctx, agent } = consolidationFixture({ root, reply: replyWith("the task's own state") });
	await setSessionTask(root, agent.session, "release");
	await mkdir(path.join(root, ".agents", "memory", "tasks"), { recursive: true });
	// An old activity date, so the write's own `lastSeen` refresh is observable: a fixture created today
	// would pass whether or not the pass bumped it.
	await writeFile(path.join(root, ".agents", "memory", "tasks", "release.md"), taskDocument("release", { created: "2026-02-02", lastSeen: "2026-02-02", title: "Release prep" }), "utf8");

	const report = await consolidateProject(ctx, resolvePluginConfig({ consolidateTurns: 1, maxMemoryChars: 40_000, forceDedupeMs: 0 }), agent, { force: true, silent: true });

	assert.equal(report.status, "updated", JSON.stringify(report));
	assert.equal(report.contextWritten, true);
	assert.equal(report.contextTarget, ".agents/memory/tasks/release.md", "the receipt names the file that landed");
	assert.equal(await readFile(path.join(root, ".agents", "memory", "CONTEXT.md"), "utf8"), before, "the project-level document is not touched");
	const task = await readFile(path.join(root, ".agents", "memory", "tasks", "release.md"), "utf8");
	assert.match(task, /the task's own state/);
	assert.match(task, /`?created 2026-02-02`?/, "the authored creation date survives the pass");
	const meta = parseTaskMeta(task);
	assert.equal(meta.created, "2026-02-02");
	assert.equal(meta.status, "active");
	assert.equal(meta.lastSeen, dateStamp(), "a landed write is proof of activity");
	assert.equal(meta.title, "task title", "the pass refreshes the label the task list shows");
});

test("an unbound session's pass writes CONTEXT.md and leaves the tasks directory alone", async () => {
	const root = await memoryRoot("dsh-tasks-write-unbound-");
	const { ctx, agent } = consolidationFixture({ root, reply: replyWith("project level state") });
	const report = await consolidateProject(ctx, resolvePluginConfig({ consolidateTurns: 1, maxMemoryChars: 40_000, forceDedupeMs: 0 }), agent, { force: true, silent: true });

	assert.equal(report.status, "updated", JSON.stringify(report));
	assert.equal(report.contextTarget, undefined, "no task file is named");
	assert.match(await readFile(path.join(root, ".agents", "memory", "CONTEXT.md"), "utf8"), /project level state/);
	assert.equal(existsSync(path.join(root, ".agents", "memory", "tasks")), false, "nothing created a task directory");
});

test("a binding to an archived task writes the project context, so the pass cannot reopen it", async () => {
	const root = await memoryRoot("dsh-tasks-write-archived-");
	await mkdir(path.join(root, ".agents", "memory", "tasks"), { recursive: true });
	const archived = taskDocument("release", { status: "archived", lastSeen: "2026-01-01", summary: "closed work" });
	await writeFile(path.join(root, ".agents", "memory", "tasks", "release.md"), archived, "utf8");
	const { ctx, agent } = consolidationFixture({ root, reply: replyWith("the pass wrote the project document") });
	await setSessionTask(root, agent.session, "release");

	const report = await consolidateProject(ctx, resolvePluginConfig({ consolidateTurns: 1, maxMemoryChars: 40_000, forceDedupeMs: 0 }), agent, { force: true, silent: true });

	assert.equal(report.status, "updated", JSON.stringify(report));
	assert.equal(report.contextTarget, undefined);
	assert.equal(await readFile(path.join(root, ".agents", "memory", "tasks", "release.md"), "utf8"), archived, "the archived task is byte-identical: no lastSeen refresh");
	assert.match(await readFile(path.join(root, ".agents", "memory", "CONTEXT.md"), "utf8"), /the pass wrote the project document/);
});

test("the task file itself is what the next pass reads as its existing context", async () => {
	// A bound session must be shown its own workflow, not the project-level document: the prompt's
	// `<existing-context>` is the input the model regenerates from.
	const root = await memoryRoot("dsh-tasks-prompt-");
	await writeFile(path.join(root, ".agents", "memory", "CONTEXT.md"), "# Project Context\n\nPROJECT-LEVEL-MARKER\n", "utf8");
	await mkdir(path.join(root, ".agents", "memory", "tasks"), { recursive: true });
	await writeFile(path.join(root, ".agents", "memory", "tasks", "release.md"), taskDocument("release", { summary: "TASK-MARKER" }), "utf8");
	const { calls, ctx, agent } = consolidationFixture({ root, reply: replyWith("state") });
	await setSessionTask(root, agent.session, "release");

	await consolidateProject(ctx, resolvePluginConfig({ consolidateTurns: 1, maxMemoryChars: 40_000, forceDedupeMs: 0 }), agent, { force: true, silent: true });

	const prompt = calls[0].messages[0].content.map((block) => block.text ?? "").join("\n");
	assert.match(prompt, /TASK-MARKER/, "the prompt carries the task's document");
	assert.doesNotMatch(prompt, /PROJECT-LEVEL-MARKER/, "and not the project-level one");
});

// ---------------------------------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------------------------------

/** The archive plugin's command surface, over a fresh project. */
async function contextFixture(prefix) {
	const root = await memoryRoot(prefix);
	const commands = new Map();
	const disposers = [];
	const ctx = {
		on: () => () => undefined,
		effect: (fn) => {
			const dispose = fn();
			if (typeof dispose === "function") disposers.push(dispose);
			return () => undefined;
		},
		commands: { register: (command) => { commands.set(command.name, command); return () => undefined; } },
		logger: { info: () => undefined, warn: () => undefined },
	};
	applyContext(ctx, {});
	const session = {
		id: "session-task-command",
		header: { cwd: root, createdAt: Date.parse("2026-01-01T00:00:00Z") },
		snapshotEvents: () => [],
		deriveMessages: () => [],
	};
	return { root, commands, disposers, agent: { session } };
}

test("the bare /context still reads, and now names the session's task", async () => {
	const { root, commands, disposers, agent } = await contextFixture("dsh-tasks-cmd-read-");
	try {
		const command = commands.get("context");
		assert.ok(command, "/context is registered");
		assert.match(command.input.hint, /task/);
		const reply = await command.handler({ agent, rawInput: "" });
		assert.equal(reply.kind, "success");
		assert.match(reply.text, /Project context: /);
		assert.match(reply.text, /Session index: /);
		assert.match(reply.text, /Task: unbound/);
		const list = await command.handler({ agent, rawInput: "task" });
		assert.equal(list.kind, "success");
		assert.match(list.text, /No tasks yet/);
		assert.match(list.text, /\/context task <slug> new/);
	} finally {
		for (const dispose of disposers) dispose();
	}
});

test("`new` creates and binds; a bare slug refuses to invent a task under assisted", async () => {
	const { root, commands, disposers, agent } = await contextFixture("dsh-tasks-cmd-new-");
	try {
		const command = commands.get("context");
		const created = await command.handler({ agent, rawInput: "task release new" });
		assert.equal(created.kind, "success", JSON.stringify(created));
		assert.match(created.text, /created \.agents\/memory\/tasks\/release\.md/);
		assert.equal(readSessionTaskSync(root, "session-task-command"), "release");
		const task = await readFile(path.join(root, ".agents", "memory", "tasks", "release.md"), "utf8");
		assert.match(task, /^# Project Task: release/);
		assert.deepEqual(parseTaskMeta(task), { created: dateStamp(), status: "active", lastSeen: dateStamp(), title: "release" });

		// Assisted is the default: a typo must not silently create a task, and the refusal names the verb
		// that would.
		const refused = await command.handler({ agent, rawInput: "task tpyo" });
		assert.equal(refused.kind, "error");
		assert.match(refused.text, /does not exist/);
		assert.match(refused.text, /\/context task tpyo new/);
		assert.equal(existsSync(path.join(root, ".agents", "memory", "tasks", "tpyo.md")), false);

		const duplicate = await command.handler({ agent, rawInput: "task release new" });
		assert.equal(duplicate.kind, "error", "`new` refuses to overwrite an existing task");
		assert.match(duplicate.text, /already exists/);

		const bad = await command.handler({ agent, rawInput: "task Bad Slug new" });
		assert.equal(bad.kind, "error");
		assert.match(bad.text, /not a task slug/);

		const unknown = await command.handler({ agent, rawInput: "widget" });
		assert.equal(unknown.kind, "error");
		assert.match(unknown.text, /Usage: \/context/);
	} finally {
		for (const dispose of disposers) dispose();
	}
});

test("under delegated a bare slug creates its task; `none` unbinds", async () => {
	const { root, commands, disposers, agent } = await contextFixture("dsh-tasks-cmd-delegated-");
	try {
		// A second apply publishes this project's config; the published reader is module state, so the
		// disposer in the `finally` below is what keeps other tests from seeing it.
		const delegated = new Map();
		const ctx = {
			on: () => () => undefined,
			effect: (fn) => { const dispose = fn(); if (typeof dispose === "function") disposers.push(dispose); return () => undefined; },
			commands: { register: (command) => { delegated.set(command.name, command); return () => undefined; } },
			logger: { info: () => undefined, warn: () => undefined },
		};
		applyContext(ctx, { taskMode: "delegated" });
		const command = delegated.get("context");
		const created = await command.handler({ agent, rawInput: "task release" });
		assert.equal(created.kind, "success", JSON.stringify(created));
		assert.match(created.text, /taskMode delegated/);
		assert.equal(readSessionTaskSync(root, "session-task-command"), "release");

		const unbound = await command.handler({ agent, rawInput: "task none" });
		assert.equal(unbound.kind, "success");
		assert.match(unbound.text, /unbound/);
		assert.equal(readSessionTaskSync(root, "session-task-command"), undefined);
		void commands;
	} finally {
		for (const dispose of disposers) dispose();
	}
});

test("archive removes a task from the injection; activate brings it back; binding a closed task is refused", async () => {
	const { root, commands, disposers, agent } = await contextFixture("dsh-tasks-cmd-lifecycle-");
	try {
		const command = commands.get("context");
		await command.handler({ agent, rawInput: "task release new" });
		await command.handler({ agent, rawInput: "task none" });

		const archived = await command.handler({ agent, rawInput: "task release archive" });
		assert.equal(archived.kind, "success");
		assert.match(archived.text, /archived release/);
		assert.equal(parseTaskMeta(await readFile(path.join(root, ".agents", "memory", "tasks", "release.md"), "utf8")).status, "archived");

		const refused = await command.handler({ agent, rawInput: "task release" });
		assert.equal(refused.kind, "error");
		assert.match(refused.text, /is archived/);
		assert.match(refused.text, /\/context task release activate/);

		const listed = await command.handler({ agent, rawInput: "task" });
		assert.match(listed.text, /- release · archived · release/);

		const activated = await command.handler({ agent, rawInput: "task release activate" });
		assert.equal(activated.kind, "success");
		const meta = parseTaskMeta(await readFile(path.join(root, ".agents", "memory", "tasks", "release.md"), "utf8"));
		assert.equal(meta.status, "active");
		assert.equal(meta.lastSeen, dateStamp(), "activation is activity");

		const bound = await command.handler({ agent, rawInput: "task release" });
		assert.equal(bound.kind, "success", JSON.stringify(bound));
		assert.match(bound.text, /bound this session to release \(active\)/);
		assert.equal(readSessionTaskSync(root, "session-task-command"), "release");

		const missing = await command.handler({ agent, rawInput: "task ghost archive" });
		assert.equal(missing.kind, "error");
		assert.match(missing.text, /does not exist/);
	} finally {
		for (const dispose of disposers) dispose();
	}
});
