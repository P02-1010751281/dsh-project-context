/**
 * The todo dimension (batch Z5): the session's todo list folded into its context document.
 *
 * Two halves are pinned here. The pure half owns the line format and the surgical edit: a
 * `- [todo] …` block at the top of Open tasks, every other byte of the document untouched, an
 * unchanged snapshot producing no write at all, and a `null` projection (no todo write this turn)
 * staying distinct from an empty list (the tool saying nothing is left).
 *
 * The wiring half drives the plugin's real `apply()`: a `turn/end` event with a projection folds
 * the unfinished items into `CONTEXT.md`, or into the session's task document when the Z3 binding is
 * in use; the following consolidation pass must not undo it, because that pass runs on the very idle
 * that follows the turn end. Acceptance ① (same todo not written twice) is measured on the file's
 * `mtimeNs`, ② (unfinished items present before the session ends) on the content, ③ (a session that
 * never wrote todos produces no `[todo]` line) with `null` as the negative control.
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { apply as applyMemory, consolidateProject } from "../lib/project-memory/index.js";
import { contextSectionBudgets } from "../lib/project-memory/context-schema.js";
import { todoLines, todoLinesIn, withTodoLines } from "../lib/project-memory/todo.js";
import { setSessionTask } from "../lib/project-context/session-index.js";
import { resolvePluginConfig } from "../lib/shared/config.js";
import { contextFile, memoryFile, taskFile } from "../lib/shared/project-state.js";
import { MAX_LIST_ENTRIES, MAX_LIST_ITEM_CHARS } from "../lib/shared/limits.js";

/** A rendered context document, in the shape the plugin's own renderer produces. */
function document({ openTasks = [], summary = "Doing the thing.", keyPoints = ["a fact"] } = {}) {
	return [
		"# Project Context",
		"",
		"Last updated: 2026-11-10T00:00:00.000Z",
		"",
		"## Summary",
		"",
		summary,
		"",
		"## Key points",
		"",
		...keyPoints.map((point) => `- ${point}`),
		"",
		"## Open tasks",
		"",
		...(openTasks.length === 0 ? ["- None recorded"] : openTasks.map((line) => `- ${line}`)),
		"",
		"<!-- latest-session-title: fixture -->",
		"",
	].join("\n");
}

/** The Open tasks body of a rendered document, for measuring what a write actually produced. */
function openTasksBody(text) {
	const heading = "## Open tasks\n";
	const start = text.indexOf(heading);
	assert.notEqual(start, -1, "the fixture document carries an Open tasks section");
	const rest = text.slice(start + heading.length);
	return rest.slice(0, rest.indexOf("<!-- latest-session-title")).trim();
}

/** The document's own prefix and suffix, compared byte-for-byte around a mechanic write. */
function aroundOpenTasks(text) {
	const heading = "## Open tasks\n";
	const start = text.indexOf(heading);
	const note = text.indexOf("<!-- latest-session-title");
	return { prefix: text.slice(0, start + heading.length), suffix: text.slice(note) };
}

/** A throwaway project with the two documents the memory plugin reads. */
async function project(prefix = "dsh-todo-") {
	const root = await mkdtemp(path.join(tmpdir(), prefix));
	await mkdir(path.join(root, ".agents", "memory"), { recursive: true });
	await writeFile(memoryFile(root), "# Project Memory\n\n## Project\n- a project fact\n\n## Invariants\n- a rule\n\n## Pitfalls\n\n## Index\n");
	return root;
}

/** A session stand-in: only the fields `writeTodoSnapshot` and the archive helpers read. */
function fakeSession(root, id) {
	return { id, header: { cwd: root, createdAt: Date.now() }, snapshotEvents: () => [], deriveMessages: () => [] };
}

/**
 * The plugin's real `apply()` on a minimal Context. `todos` is what the projection read returns:
 * `null` for "no todo write this turn", an array for a snapshot, and `undefined` for a host whose
 * projection is absent.
 */
function pluginFixture(todos) {
	const handlers = new Map();
	const on = (type, handler) => {
		if (!handlers.has(type)) handlers.set(type, []);
		handlers.get(type).push(handler);
		return () => undefined;
	};
	const ctx = {
		logger: { info() {}, warn() {} },
		on,
		get: (name) => (name === "sessionProjections" ? { snapshot: () => ({ values: { todos } }) } : undefined),
		systemPrompt: { context: () => undefined },
		commands: { register: () => undefined },
	};
	return { handlers, ctx };
}

/** Fire one turn end through the plugin's own handler (it is fire-and-forget by design). */
async function fireTurnEnd(handlers, session) {
	for (const handler of handlers.get("session/event") ?? []) await handler(session, { type: "turn/end" });
}

/** Resolve `true` as soon as `probe()` holds, or `false` once `ms` elapse without it. */
async function waitFor(probe, ms = 1000) {
	const deadline = Date.now() + ms;
	for (;;) {
		if (await probe()) return true;
		if (Date.now() >= deadline) return false;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------------------------------
// The line format
// ---------------------------------------------------------------------------------------------------

test("a projection's unfinished items become mechanic lines, and completed ones are dropped", () => {
	assert.deepEqual(
		todoLines([
			{ content: "ship it", status: "in_progress" },
			{ content: "  write   the docs ", status: "pending" },
			{ content: "already done", status: "completed" },
		]),
		["- [todo] (in progress) ship it", "- [todo] write the docs"],
	);
	assert.deepEqual(todoLines([]), [], "an empty list is the tool saying nothing is left");
});

test("a null, absent or malformed projection has no opinion instead of reading as an empty list", () => {
	// The distinction is the whole reason this reader exists: null must not clear a stored block.
	assert.equal(todoLines(null), undefined);
	assert.equal(todoLines(undefined), undefined);
	assert.equal(todoLines({ todos: [] }), undefined);
	// Rows that do not carry both declared fields are skipped, never guessed at.
	assert.deepEqual(todoLines([{ content: "keep" }, { status: "pending" }, { content: "  ", status: "pending" }, { content: "fine", status: "pending" }]), ["- [todo] fine"]);
});

test("an over-long item is clipped at the shared per-item cap instead of breaking the section", () => {
	const [line] = todoLines([{ content: "x".repeat(MAX_LIST_ITEM_CHARS * 2), status: "pending" }]);
	// The bullet prefix (`- `) is the renderer's own; the item after it is the clipped value.
	assert.equal(line.length, 2 + MAX_LIST_ITEM_CHARS);
	assert.ok(line.startsWith("- [todo] xxx"));
});

// ---------------------------------------------------------------------------------------------------
// The surgical edit
// ---------------------------------------------------------------------------------------------------

test("the block goes to the top of Open tasks and every other byte is untouched", () => {
	const before = document({ openTasks: ["model task one", "model task two"] });
	const patch = withTodoLines(before, ["- [todo] ship it"]);
	assert.equal(patch.changed, true);
	assert.equal(patch.droppedItems, 0);
	const { prefix, suffix } = aroundOpenTasks(before);
	assert.ok(patch.text.startsWith(prefix));
	assert.ok(patch.text.endsWith(suffix));
	assert.equal(openTasksBody(patch.text), "- [todo] ship it\n- model task one\n- model task two");
});

test("the same snapshot twice produces no second write", () => {
	const before = document({ openTasks: ["model task"] });
	const first = withTodoLines(before, ["- [todo] ship it", "- [todo] (in progress) review it"]);
	const second = withTodoLines(first.text, ["- [todo] ship it", "- [todo] (in progress) review it"]);
	assert.equal(first.changed, true);
	assert.equal(second.changed, false);
	assert.equal(second.text, first.text);
});

test("the placeholder never stands next to real entries, and comes back when the list empties", () => {
	const placeholder = document();
	const filled = withTodoLines(placeholder, ["- [todo] ship it"]);
	assert.equal(openTasksBody(filled.text), "- [todo] ship it");
	const emptied = withTodoLines(filled.text, []);
	assert.equal(emptied.changed, true);
	assert.equal(openTasksBody(emptied.text), "- None recorded");
	assert.equal(emptied.text, placeholder, "the document returns to the renderer's own empty shape");
});

test("other model-authored entries survive a completed list, only the mechanic lines go", () => {
	const before = document({ openTasks: ["[todo] finished work", "model task"] });
	const patch = withTodoLines(before, []);
	assert.equal(patch.changed, true);
	assert.equal(openTasksBody(patch.text), "- model task");
});

test("a document without an Open tasks section is left byte-identical", () => {
	const before = "# Project Context\n\n## Summary\n\nNo open tasks section here.\n";
	const patch = withTodoLines(before, ["- [todo] ship it"]);
	assert.equal(patch.changed, false);
	assert.equal(patch.text, before);
});

test("a `## Open tasks` line inside a fence is content, not the section", () => {
	const text = [
		"# Project Context",
		"",
		"## Summary",
		"",
		"```text",
		"## Open tasks",
		"- [todo] fake",
		"```",
		"",
		"## Open tasks",
		"",
		"- real task",
		"",
		"<!-- latest-session-title: fixture -->",
		"",
	].join("\n");
	const patch = withTodoLines(text, ["- [todo] genuine"]);
	assert.equal(patch.changed, true);
	assert.match(patch.text, /```text\n## Open tasks\n- \[todo\] fake\n```/);
	assert.match(patch.text, /## Open tasks\n\n- \[todo\] genuine\n- real task/);
});

test("the entry cap bounds the block, and the drop is counted rather than silent", () => {
	const lines = Array.from({ length: MAX_LIST_ENTRIES + 10 }, (_, index) => `- [todo] task ${index}`);
	const patch = withTodoLines(document(), lines);
	assert.equal(patch.droppedItems, 10);
	assert.equal(openTasksBody(patch.text).split("\n").filter((line) => line.startsWith("- [todo]")).length, MAX_LIST_ENTRIES);
});

test("the Open tasks budget bounds the block, so the next pass has no prose to clip", () => {
	const budget = contextSectionBudgets().find((section) => section.heading === "Open tasks").chars;
	const lines = Array.from({ length: 20 }, () => `- [todo] ${"x".repeat(500)}`);
	const patch = withTodoLines(document(), lines);
	assert.ok(patch.droppedItems > 0, "twenty 500-character items cannot fit the section");
	assert.ok(openTasksBody(patch.text).length <= budget);
	const kept = openTasksBody(patch.text).split("\n").filter((line) => line.startsWith("- [todo]")).length;
	assert.equal(kept + patch.droppedItems, 20);
});

// ---------------------------------------------------------------------------------------------------
// The turn/end wiring
// ---------------------------------------------------------------------------------------------------

test("a turn end folds the unfinished items into CONTEXT.md", async () => {
	const root = await project();
	await writeFile(contextFile(root), document({ openTasks: ["model task"] }));
	const { handlers, ctx } = pluginFixture([
		{ content: "ship the batch", status: "pending" },
		{ content: "run the gate", status: "in_progress" },
		{ content: "already done", status: "completed" },
	]);
	applyMemory(ctx, resolvePluginConfig({}));
	const session = fakeSession(root, "session-todo-top");
	await fireTurnEnd(handlers, session);
	assert.ok(await waitFor(async () => (await readFile(contextFile(root), "utf8")).includes("[todo] ship the batch")));

	const written = await readFile(contextFile(root), "utf8");
	const body = openTasksBody(written);
	assert.equal(body.split("\n").slice(0, 2).join("\n"), "- [todo] ship the batch\n- [todo] (in progress) run the gate");
	assert.ok(body.endsWith("- model task"), "the model's own entry is untouched");
	assert.equal(todoLinesIn(written).length, 2);
});

test("the same snapshot on the next turn rewrites nothing", async () => {
	const root = await project();
	await writeFile(contextFile(root), document({ openTasks: ["model task"] }));
	const { handlers, ctx } = pluginFixture([{ content: "ship the batch", status: "pending" }]);
	applyMemory(ctx, resolvePluginConfig({}));
	const session = fakeSession(root, "session-todo-idempotent");
	await fireTurnEnd(handlers, session);
	assert.ok(await waitFor(async () => (await readFile(contextFile(root), "utf8")).includes("[todo] ship the batch")));
	const first = await stat(contextFile(root), { bigint: true });

	await fireTurnEnd(handlers, session);
	await sleep(50);
	const second = await stat(contextFile(root), { bigint: true });
	assert.equal(second.mtimeNs, first.mtimeNs, "an unchanged snapshot does not touch the file");
});

test("a session that never wrote todos produces no [todo] line and no write", async () => {
	const root = await project();
	const before = document({ openTasks: ["model task"] });
	await writeFile(contextFile(root), before);
	const { handlers, ctx } = pluginFixture(null);
	applyMemory(ctx, resolvePluginConfig({}));
	const session = fakeSession(root, "session-todo-never");
	const first = await stat(contextFile(root), { bigint: true });
	await fireTurnEnd(handlers, session);
	await sleep(50);
	const second = await stat(contextFile(root), { bigint: true });
	assert.equal(second.mtimeNs, first.mtimeNs, "null means no write at all");
	assert.equal(await readFile(contextFile(root), "utf8"), before);
});

test("a finished list clears the block at the next turn end", async () => {
	const root = await project();
	await writeFile(contextFile(root), document({ openTasks: ["model task"] }));
	const session = fakeSession(root, "session-todo-finish");
	const pending = pluginFixture([{ content: "ship it", status: "pending" }]);
	applyMemory(pending.ctx, resolvePluginConfig({}));
	await fireTurnEnd(pending.handlers, session);
	assert.ok(await waitFor(async () => (await readFile(contextFile(root), "utf8")).includes("[todo] ship it")));

	// A new turn: the projection is cleared and the tool writes the list again, now completed.
	const finished = pluginFixture([{ content: "ship it", status: "completed" }]);
	applyMemory(finished.ctx, resolvePluginConfig({}));
	await fireTurnEnd(finished.handlers, session);
	assert.ok(await waitFor(async () => !(await readFile(contextFile(root), "utf8")).includes("[todo]")));
	assert.equal(openTasksBody(await readFile(contextFile(root), "utf8")), "- model task");
});

test("a bound session folds the todo block into its own task document", async () => {
	const root = await project();
	await writeFile(contextFile(root), document({ openTasks: ["project task"] }));
	const taskDoc = [
		"# Project Task: release",
		"",
		"> created 2026-11-01 · status active · lastSeen 2026-11-01 · title Release prep",
		"",
		"## Summary",
		"",
		"Shipping the release.",
		"",
		"## Key points",
		"",
		"- a fact",
		"",
		"## Open tasks",
		"",
		"- cut the tag",
		"",
		"<!-- latest-session-title: Release prep -->",
		"",
	].join("\n");
	await mkdir(path.join(root, ".agents", "memory", "tasks"), { recursive: true });
	await writeFile(taskFile(root, "release"), taskDoc);
	const session = fakeSession(root, "session-todo-bound");
	await setSessionTask(root, session, "release");

	const { handlers, ctx } = pluginFixture([{ content: "ship the batch", status: "pending" }]);
	applyMemory(ctx, resolvePluginConfig({}));
	await fireTurnEnd(handlers, session);

	assert.ok(await waitFor(async () => (await readFile(taskFile(root, "release"), "utf8")).includes("[todo] ship the batch")));
	assert.equal(openTasksBody(await readFile(taskFile(root, "release"), "utf8")), "- [todo] ship the batch\n- cut the tag");
	assert.equal(await readFile(contextFile(root), "utf8"), document({ openTasks: ["project task"] }), "the project context is not this session's document");
});

// ---------------------------------------------------------------------------------------------------
// The following consolidation pass must not undo it
// ---------------------------------------------------------------------------------------------------

/** A complete reply: a four-section memory plus a context section whose Open tasks are its own. */
function reply(openTasks) {
	return JSON.stringify({
		memory_markdown: "# Project Memory\n\n## Project\n- a project fact\n\n## Invariants\n- a rule\n\n## Pitfalls\n\n## Index\n",
		context: { title: "fixture", summary: "the pass's summary", key_points: ["a fact"], open_tasks: openTasks },
	});
}

/** One consolidation pass's harness: one text reply and the projection the plugin reads. */
function consolidationFixture({ root, todos, text }) {
	const ctx = {
		logger: { info() {}, warn() {} },
		get: (name) => (name === "sessionProjections" ? { snapshot: () => ({ values: { todos } }) } : undefined),
		llm: {
			resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
			stream: () => (async function* generate() {
				yield { type: "text-delta", index: 0, text };
				yield { type: "finish", reason: { kind: "stop" } };
			})(),
		},
	};
	const agent = {
		options: { provider: "test-provider", model: "test-model" },
		session: {
			id: "session-todo-pass",
			header: { cwd: root, createdAt: Date.now() },
			snapshotEvents: () => [],
			deriveEventMessage: () => null,
			deriveMessages: () => [],
			requestHeader: () => undefined,
		},
	};
	return { ctx, agent };
}

test("the pass keeps the mechanic lines the turn end just wrote", async () => {
	const root = await project();
	await writeFile(contextFile(root), document({ openTasks: ["[todo] ship the batch", "model task"] }));
	const { ctx, agent } = consolidationFixture({
		root,
		todos: [{ content: "ship the batch", status: "pending" }],
		text: reply(["the model's own next step"]),
	});
	const config = resolvePluginConfig({ consolidateTurns: 1, maxMemoryChars: 40_000, forceDedupeMs: 0 });
	const report = await consolidateProject(ctx, config, agent, { force: true, silent: true });

	assert.equal(report.status, "updated");
	const written = await readFile(contextFile(root), "utf8");
	assert.equal(openTasksBody(written), "- [todo] ship the batch\n- the model's own next step");
});

test("a pass with no todo opinion keeps the stored mechanic lines instead of erasing them", async () => {
	const root = await project();
	await writeFile(contextFile(root), document({ openTasks: ["[todo] ship the batch", "model task"] }));
	const { ctx, agent } = consolidationFixture({ root, todos: null, text: reply(["the model's own next step"]) });
	const config = resolvePluginConfig({ consolidateTurns: 1, maxMemoryChars: 40_000, forceDedupeMs: 0 });
	const report = await consolidateProject(ctx, config, agent, { force: true, silent: true });

	assert.equal(report.status, "updated");
	const written = await readFile(contextFile(root), "utf8");
	assert.equal(openTasksBody(written), "- [todo] ship the batch\n- the model's own next step");
});
