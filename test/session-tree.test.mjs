/**
 * `/session-log tree` — the handoff lineage, read back from `meta.json`.
 *
 * The archive has recorded `parentId`/`kind` since the handoff started writing them, and until this
 * command existed no surface read them: the graph was on disk and every reader showed a flat list. The
 * pins here are the shapes a tree has to survive rather than assume away — an orphan whose parent was
 * pruned, a cycle that only hand-edited metadata can produce, and subagent archives that `INDEX.md`
 * deliberately never lists — plus the real command wiring, because a builder that only a test calls
 * would leave the user with the same flat list.
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { apply as applyContext } from "../lib/project-context/index.js";
import { buildSessionTree, renderSessionTree, readSessionTree } from "../lib/project-context/session-tree.js";
import { writeSessionMeta } from "../lib/project-context/session-meta.js";

/** One archived session's metadata, with only what the tree reads. */
function meta(id, { date = "2026-01-01", title = id, kind, parentId, task } = {}) {
	return { id, date, title, ...(kind === undefined ? {} : { kind }), ...(parentId === undefined ? {} : { parentId }), ...(task === undefined ? {} : { task }) };
}

/** A project root with an empty memory directory, realpath-resolved (the plugin resolves cwd itself). */
async function projectRoot(prefix) {
	const root = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
	await mkdir(path.join(root, ".agents", "memory", "session-logs"), { recursive: true });
	return root;
}

/** How many rows a rendered tree carries. */
function rows(text) {
	return [...text.matchAll(/\]\([^)]*\/session\.jsonl\)/g)].length;
}

test("a continuation hangs under the session it continued, and the root is the oldest", () => {
	const tree = buildSessionTree([
		meta("session-child", { date: "2026-01-02", kind: "handoff", parentId: "session-parent", title: "continued" }),
		meta("session-parent", { date: "2026-01-01", title: "started" }),
		meta("session-sibling", { date: "2026-01-03", title: "another workflow" }),
	]);
	assert.equal(tree.sessionCount, 3);
	assert.equal(tree.handoffCount, 1);
	assert.deepEqual(tree.roots.map((node) => node.meta.id), ["session-parent", "session-sibling"], "archive order, and the child is not a root");
	const parent = tree.roots[0];
	assert.deepEqual(parent.children.map((node) => node.meta.id), ["session-child"]);

	const text = renderSessionTree(tree);
	assert.match(text, /^# Session tree\n\n3 session\(s\) · 2 root\(s\) · 1 handoff continuation\(s\)\n/);
	assert.match(text, /^- \[session-parent\]\(session-parent\/session\.jsonl\) — 2026-01-01 — started$/m);
	assert.match(text, /^ {2}- \[session-child\]\(session-child\/session\.jsonl\) — 2026-01-02 — continued$/m);
	assert.doesNotMatch(text, /· handoff/, "indentation already says a child continues something");
});

test("an orphan names the parent it could not be hung under, and is still a root", () => {
	const tree = buildSessionTree([meta("session-orphan", { kind: "handoff", parentId: "session-gone", title: "continued" })]);
	assert.equal(tree.roots.length, 1);
	assert.equal(tree.roots[0].missingParentId, "session-gone");
	const text = renderSessionTree(tree);
	assert.match(text, /^- \[session-orphan\]\(session-orphan\/session\.jsonl\) — .* — continued · handoff · parent session-gone not archived$/m);
});

test("a cycle and a self-parent terminate, and every session is rendered exactly once", () => {
	const tree = buildSessionTree([
		meta("session-a", { date: "2026-01-01", parentId: "session-b" }),
		meta("session-b", { date: "2026-01-02", parentId: "session-a" }),
		meta("session-self", { date: "2026-01-03", parentId: "session-self" }),
	]);
	const text = renderSessionTree(tree);
	assert.equal(tree.sessionCount, 3);
	assert.equal(rows(text), 3, "a malformed link must not lose or duplicate a session");
	for (const id of ["session-a", "session-b", "session-self"]) assert.ok(text.includes(`[${id}]`), `${id} must be in the tree`);
	assert.equal(tree.roots.some((node) => node.meta.id === "session-self"), true, "a self-parent is a root, not a missing child");
});

test("subagent archives are hidden but counted, so their absence is explained", () => {
	const tree = buildSessionTree([meta("session-parent"), meta("session-child", { kind: "subagent", parentId: "session-parent" })]);
	assert.equal(tree.sessionCount, 1);
	assert.equal(tree.hiddenSubagents, 1);
	assert.equal(tree.roots[0].children.length, 0, "a delegated child is not a continuation node");
	const text = renderSessionTree(tree);
	assert.match(text, /1 subagent archive\(s\) hidden/);
	assert.ok(!text.includes("[session-child]"));
});

test("a bound session's task rides on the row; a missing archive is an empty tree, not an error", async () => {
	const root = await projectRoot("dsh-session-tree-empty-");
	const empty = await readSessionTree(root);
	assert.equal(empty, "# Session tree\n\nNo archived sessions yet.");

	await writeSessionMeta(path.join(root, ".agents", "memory", "session-logs", "session-bound"), meta("session-bound", { task: "release" }));
	const bound = await readSessionTree(root);
	assert.match(bound, /— session-bound · task release$/m, "the task annotation is on the row");
});

test("one receipt carries at most 500 rows and says where the rest is", () => {
	const many = Array.from({ length: 600 }, (_, index) => meta(`session-row-${String(index).padStart(3, "0")}`, { date: `2026-01-${String((index % 28) + 1).padStart(2, "0")}` }));
	const text = renderSessionTree(buildSessionTree(many));
	assert.equal(rows(text), 500, "the render is bounded");
	assert.match(text, /… and 100 more session\(s\) — INDEX\.md lists every row\./);
});

test("the real command: /session-log tree reads the archive through the registered handler", async () => {
	const root = await projectRoot("dsh-session-tree-command-");
	const logs = path.join(root, ".agents", "memory", "session-logs");
	await writeSessionMeta(path.join(logs, "session-aaa"), meta("session-aaa", { date: "2026-02-01", title: "first" }));
	await writeSessionMeta(path.join(logs, "session-bbb"), meta("session-bbb", { date: "2026-02-02", title: "second", kind: "handoff", parentId: "session-aaa" }));
	// A stray file in the archive directory is what the index already tolerates; the tree must too.
	await writeFile(path.join(logs, "notes.txt"), "not a session\n", "utf8");

	const commands = new Map();
	const disposers = [];
	const session = { id: "session-tree-command", header: { cwd: root, createdAt: Date.parse("2026-02-01T00:00:00Z") }, snapshotEvents: () => [], deriveMessages: () => [] };
	const ctx = {
		on: () => () => undefined,
		effect: (fn) => {
			const dispose = fn();
			if (typeof dispose === "function") disposers.push(dispose);
			return () => undefined;
		},
		commands: { register: (command) => { commands.set(command.name, command); return () => undefined; } },
		get: () => undefined,
		logger: { info: () => undefined, warn: () => undefined },
	};
	try {
		applyContext(ctx, {});
		const command = commands.get("session-log");
		assert.ok(command, "/session-log is registered");
		assert.match(command.input.hint, /tree/, "the hint names the new read");
		const reply = await command.handler({ agent: { session }, rawInput: "tree" });
		assert.equal(reply.kind, "success", JSON.stringify(reply));
		assert.match(reply.text, /2 session\(s\) · 1 root\(s\) · 1 handoff continuation\(s\)/);
		assert.match(reply.text, /^- \[session-aaa\]\(session-aaa\/session\.jsonl\) — 2026-02-01 — first$/m);
		assert.match(reply.text, /^ {2}- \[session-bbb\]\(session-bbb\/session\.jsonl\) — 2026-02-02 — second$/m);
		assert.ok(!reply.text.includes("notes.txt"), "a stray file is not a session");
	} finally {
		for (const dispose of disposers) dispose();
	}
});
