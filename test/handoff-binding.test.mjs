/**
 * Pins the continuation's identity in the session store: which session a handoff child continues,
 * and which task it belongs to.
 *
 * The friction this closes is the one the task dimension exists for. A session bound to one task
 * reads `tasks/<slug>.md`; a handoff forks a session, and dsh's header has no parent field, so the
 * child used to start unbound and read the project-wide `CONTEXT.md` — the pack of unrelated open
 * tasks Z3 separated. Nothing in the seed says otherwise: the memory plugin resolves the slice from
 * the session's own `meta.json` at request admission, which is why the binding has to be on disk
 * *before* the seed is admitted (one test below reads the file from inside the seed delivery).
 *
 * The negative controls matter as much as the positive one: a child of an unbound session must stay
 * unbound (an inherited empty task would make `boundTaskSync` fall back anyway but would leave a
 * misleading field), and an abandoned handoff must take its metadata back — a `meta.json` with no
 * archive becomes an index row whose link goes nowhere, which is exactly the state Z1 removed.
 *
 * These drive the real transaction (`performHandoff`) against a real temp project, a fake controller
 * and a fake Agent registry, so they fail if the wiring moves — not only if `binding.ts` changes.
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { reconcileSessionIndexOnce } from "../lib/project-context/session-index.js";
import { readSessionMeta } from "../lib/project-context/session-meta.js";
import { bindHandoffChild, discardHandoffBinding } from "../lib/project-handoff/binding.js";
import { boundTaskSync, readSessionTaskSync } from "../lib/project-memory/tasks.js";
import { performHandoff } from "../lib/project-handoff/perform.js";
import { DEFAULT_CONFIG } from "../lib/shared/config.js";
import { logsDir, sessionIndexFile, sessionMetaFileFor, taskFile } from "../lib/shared/project-state.js";
import { sessionViews } from "./session-views.mjs";

const PARENT = "session-parent-0001";
const CHILD = "session-child-0001";
const TODAY = "2026-11-10";

async function tempRoot() {
	return realpath(await mkdtemp(path.join(tmpdir(), "dsh-handoff-binding-")));
}

function userMessage(text) {
	return { role: "user", source: { kind: "user" }, content: [{ type: "text", text }] };
}

function assistantMessage(text) {
	return { role: "assistant", source: { kind: "model" }, content: [{ type: "text", text }] };
}

/** The parent being handed off: one typed input, so `handoffLabel` has something to name it with. */
function parentSession(root, id = PARENT) {
	const messages = [userMessage("把 release 收尾"), assistantMessage("好，接着做。")];
	return { id, header: { cwd: root }, ...sessionViews(messages) };
}

/** Bind the parent to a task the way `/context task <slug>` does, and give that task a document. */
async function bindParent(root, slug = "release") {
	const dir = path.join(logsDir(root), PARENT);
	await mkdir(dir, { recursive: true });
	const meta = { id: PARENT, date: TODAY, title: "release 收尾", task: slug };
	await writeFile(path.join(dir, "meta.json"), `${JSON.stringify(meta, undefined, "\t")}\n`);
	await mkdir(path.dirname(taskFile(root, slug)), { recursive: true });
	await writeFile(
		taskFile(root, slug),
		`# Project Task: ${slug}\n\n> created ${TODAY} · status active · lastSeen ${TODAY} · title Release prep\n\n## Summary\n\nrelease 收尾\n`,
	);
}

/**
 * A fake host: the controller creates the child, the Agent registry admits the seed.
 *
 * The seed delivery reads the child's metadata synchronously — that is the one place where the
 * "binding lands before the seed" order is observable, because the real request admission resolves
 * the child's context from the same file at the same moment.
 */
function fakeHost(state, options) {
	return {
		get: (name) => {
			if (name === "sessionController") {
				return {
					create: async () => {
						state.created = true;
						return { sessionId: CHILD };
					},
					rename: async (request) => {
						state.renames.push(request);
						return { title: request.title };
					},
					cancel: async () => {
						state.cancelled = true;
					},
				};
			}
			if (name === "agents") {
				return {
					get: (id) =>
						id === CHILD
							? {
									followup: (message) => {
										state.seeded.push(message);
										if (options.refuseSeed === true) throw new Error("the seed was refused");
										try {
											state.metaAtSeed = readFileSync(sessionMetaFileFor(state.root, CHILD), "utf8");
										} catch (error) {
											state.seedError = error;
										}
									},
								}
							: undefined,
				};
			}
			return undefined;
		},
		logger: { info: () => {}, warn: (message) => state.warnings.push(String(message)) },
	};
}

async function runHandoff(root, options = {}) {
	const state = { root, created: false, renames: [], seeded: [], warnings: [], metaAtSeed: undefined, seedError: undefined, cancelled: false };
	const ctx = fakeHost(state, options);
	const session = parentSession(root, options.parentId ?? PARENT);
	const split = {
		older: "较早的对话",
		tail: "## user\n把 release 收尾",
		languageMessages: [{ role: "user", sourceKind: "user", text: "把 release 收尾" }],
		trimmedTail: false,
	};
	try {
		await performHandoff(ctx, session, DEFAULT_CONFIG, "manual", undefined, split);
		return { state, error: undefined };
	} catch (error) {
		return { state, error };
	}
}

test("a bound session's continuation inherits the task, written before the seed is admitted", async () => {
	const root = await tempRoot();
	await bindParent(root);
	const { state, error } = await runHandoff(root);
	assert.equal(error, undefined, "the handoff completed");

	assert.equal(state.created, true, "the transaction reached the child creation");
	assert.equal(state.seeded.length, 1, "the seed was admitted once");

	// The order claim: the child's first request admits its context from this file.
	assert.equal(state.seedError, undefined, "the metadata existed when the seed was admitted");
	const atSeed = JSON.parse(state.metaAtSeed);
	assert.equal(atSeed.task, "release", "the binding was already on disk at admission");
	assert.equal(atSeed.id, CHILD);

	const meta = JSON.parse(await readFile(sessionMetaFileFor(root, CHILD), "utf8"));
	assert.deepEqual(
		{ id: meta.id, kind: meta.kind, parentId: meta.parentId, task: meta.task },
		{ id: CHILD, kind: "handoff", parentId: PARENT, task: "release" },
	);
	assert.match(meta.title, /^↪ handoff · /, "the seeded title names the switch until the archive refreshes it");
	assert.match(meta.date, /^\d{4}-\d{2}-\d{2}$/);

	// What the memory side actually reads: the child resolves the parent's task, not the project pack.
	assert.equal(readSessionTaskSync(root, CHILD), "release");
	assert.equal(boundTaskSync(root, CHILD, { mode: DEFAULT_CONFIG.taskMode, today: TODAY })?.slug, "release");
});

test("an unbound session's continuation stays unbound", async () => {
	const root = await tempRoot();
	// No parent metadata at all: the session never archived, which is the ordinary pre-first-write state.
	const { state, error } = await runHandoff(root);
	assert.equal(error, undefined, "the handoff completed");

	const meta = JSON.parse(await readFile(sessionMetaFileFor(root, CHILD), "utf8"));
	assert.equal(meta.kind, "handoff", "the tree link is written even without a task");
	assert.equal(meta.parentId, PARENT);
	assert.equal("task" in meta, false, "no task is invented for a session that owns none");
	assert.equal(readSessionTaskSync(root, CHILD), undefined);
	assert.equal(boundTaskSync(root, CHILD, { mode: DEFAULT_CONFIG.taskMode, today: TODAY }), undefined);
});

test("an abandoned handoff takes its metadata back, so no row links at a missing archive", async () => {
	const root = await tempRoot();
	await bindParent(root);
	const { state, error } = await runHandoff(root, { refuseSeed: true });

	assert.ok(error instanceof Error, "the refused seed fails the handoff");
	assert.equal(state.cancelled, true, "the abandoned child was cancelled");
	assert.ok(
		state.renames.some((request) => request.title.startsWith("handoff failed · ")),
		"the visible title says the handoff failed",
	);
	assert.equal(await readSessionMeta(path.join(logsDir(root), CHILD)), undefined, "the provisional metadata is gone");

	// Positive control: the parent's own metadata still produces a row, so the index ran.
	await reconcileSessionIndexOnce(root);
	const index = await readFile(sessionIndexFile(root), "utf8");
	assert.ok(index.includes(`[${PARENT}](`), "the parent row is present");
	assert.ok(!index.includes(CHILD), "and no row points at the child's missing archive");
});

test("the cleanup never deletes metadata the child's own archive has claimed", async () => {
	// The guard is what keeps an abort from erasing a real session's row: once the archive wrote
	// `session.jsonl`, the directory is no longer this attempt's to take back.
	const root = await tempRoot();
	const binding = await bindHandoffChild(root, PARENT, CHILD, "↪ handoff · release");
	await writeFile(path.join(binding.dir, "session.jsonl"), "{}\n");
	await discardHandoffBinding(binding);
	assert.notEqual(await readSessionMeta(binding.dir), undefined, "the claimed metadata survived");
});
