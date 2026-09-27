/**
 * The `isTopLevel` gate: project-wide work must not run once per delegated child.
 *
 * Four plugins schedule per-project work from session lifecycle events — `project-memory` and
 * `project-autolearn` on `agent/status`/`agent/disposed`, `project-handoff` on `session/event`
 * (`turn/end`), and `project-context` on all four of those (it writes the session archive and its
 * index line). Each refuses a session whose header carries `origin: "subagent"`, the single origin
 * upstream writes on its one child-creation path (one-shot subagents and continuable Agent Team
 * members alike). Without the gate every child would consolidate the same `MEMORY.md`, distil the
 * same skills from the same index, try to hand itself off, and archive itself into the project's
 * `session-logs/` — that last one was missing until 2026-09-27, by which time a census found 67 of
 * the 113 archive directories were children (the purged originals are kept in
 * `/mnt/Data/Backups/dsh-project-context/session-logs-subagent-2026-09-27.tar.gz`), and they were
 * already a majority of the newest-50 window autolearn reads (`MAX_INDEX_ENTRIES` in
 * project-autolearn).
 *
 * Every case drives the plugin's real `apply()` wiring twice on its own throwaway project: once as
 * a delegated session (nothing happens) and once as a top-level one (the very same event does the
 * work). The positive half is what makes the negative half evidence — a fixture that simply cannot
 * schedule any work would satisfy the negative half on its own.
 *
 * `project-context`'s fifth lifecycle point, `agent/created`, stays ungated on purpose and is not
 * covered here: it only warms a cache the parent already warmed and writes nothing, so a gate there
 * would be an untestable branch.
 *
 * This file also owns the sibling refusal that is not about delegation: `archiveEnabled: false` must
 * stop every automatic write too. Three of `project-context`'s four points honoured that flag;
 * `session/disposed` wrote anyway (a session.jsonl + session.md + index line on dispose) until
 * 2026-09-27, against `README.md`'s "关掉后不再自动写会话存档与索引".
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { apply as applyAutolearn } from "../lib/project-autolearn/index.js";
import { apply as applyContext } from "../lib/project-context/index.js";
import { apply as applyHandoff } from "../lib/project-handoff/index.js";
import { apply as applyMemory } from "../lib/project-memory/index.js";
import { resolvePluginConfig } from "../lib/shared/config.js";
import { contextFile, logsDir, memoryFile, sessionIndexFile } from "../lib/shared/project-state.js";

/** A complete consolidation reply: a memory rewrite plus a context update. */
const COMPLETE_REPLY = '{"memory_markdown":"# Project Memory\\n\\n- keep the suite green\\n","context":{"title":"t","summary":"s","key_points":[],"open_tasks":[]}}';

/**
 * A throwaway project both learn passes can run against: the two documents they read, plus one
 * archived session and its index line so the autolearn evidence path has something to cite.
 */
async function project(prefix) {
	const root = await mkdtemp(path.join(tmpdir(), prefix));
	await mkdir(path.join(root, ".agents", "memory"), { recursive: true });
	await writeFile(memoryFile(root), "# Project Memory\n\n- keep the suite green\n");
	await writeFile(contextFile(root), "# Project Context\n\nLast updated: 2026-09-13\n\n## Summary\n\nA fixture project.\n");
	await mkdir(path.join(logsDir(root), "session-archived"), { recursive: true });
	await writeFile(
		path.join(logsDir(root), "session-archived", "session.jsonl"),
		`${JSON.stringify({ type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "run the release checklist" }] } })}\n`,
	);
	await writeFile(sessionIndexFile(root), "# Session Index\n\n- [session-archived](session-archived/session.md) — 2026-09-13 — Fixture\n");
	return root;
}

/** A minimal Agent stand-in; `origin` is written into the header only when the case asks for it. */
function fakeAgent(cwd, { id, origin, turns = 3 } = {}) {
	const events = Array.from({ length: turns }, (_, index) => ({
		type: "user/message",
		seq: index + 1,
		time: Date.now(),
		data: { source: { kind: "user" }, content: [{ type: "text", text: `turn ${index + 1}` }] },
	}));
	const header = { cwd, createdAt: Date.now() };
	if (origin !== undefined) header.origin = origin;
	return {
		options: { provider: "test-provider", model: "test-model" },
		session: {
			id,
			header,
			snapshotEvents: () => events,
			ownEvents: () => events,
			// Derived messages carry a `source.kind`; the conversation renderer reads it to tell a
			// tool result from a human turn.
			deriveMessages: () => [
				{ role: "user", source: { kind: "user" }, content: [{ type: "text", text: "turn 1" }] },
				{ role: "assistant", source: { kind: "assistant" }, content: [{ type: "text", text: "done" }] },
			],
			requestHeader: () => undefined,
		},
	};
}

/** A Context stand-in that records the handlers `apply()` registers, in registration order. */
function handlerContext(extra = {}) {
	const handlers = new Map();
	const on = (type, handler) => {
		(handlers.get(type) ?? handlers.set(type, []).get(type)).push(handler);
		return () => undefined;
	};
	return { handlers, on, ...extra };
}

/** Fire one lifecycle event through the registered handler(s), then drain the plugin's flush hook. */
async function fire(handlers, type, agent) {
	for (const handler of handlers.get(type)) await handler({ agent, status: "idle" });
	const flush = handlers.get("session/flush")?.[0];
	if (flush) await flush(agent.session);
}

/** Model calls the memory plugin makes for one event on one fresh project. */
async function memoryCalls(event, origin) {
	const root = await project("dsh-gate-memory-");
	const calls = [];
	const { handlers, on } = handlerContext();
	applyMemory(
		{
			logger: { info() {}, warn() {} },
			systemPrompt: { context: () => undefined },
			on,
			commands: { register: () => undefined },
			llm: {
				resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
				stream: (options) => {
					calls.push(options);
					return (async function* generate() {
						yield { type: "text-delta", text: COMPLETE_REPLY };
						yield { type: "finish", reason: { kind: "stop" } };
					})();
				},
			},
		},
		resolvePluginConfig({ consolidateTurns: 1, consolidateIntervalMs: 1000, provider: "test-provider", model: "test-model" }),
	);
	const agent = fakeAgent(root, { id: `session-${event}-${origin ?? "top"}`, origin });
	await fire(handlers, event, agent);
	return calls.length;
}

/** Model calls the autolearn plugin makes for one event on one fresh project. */
async function autolearnCalls(event, origin) {
	const root = await project("dsh-gate-autolearn-");
	const calls = [];
	const { handlers, on } = handlerContext();
	applyAutolearn(
		{
			logger: { info() {}, warn() {} },
			effect: (callback) => callback(),
			inject: (_deps, callback) => callback({ settings: { installSection: () => undefined } }),
			on,
			commands: { register: () => undefined },
			llm: {
				resolveModelInfo: async () => ({ provider: "test-provider", id: "test-model", name: "test-model" }),
				stream: (options) => {
					calls.push(options);
					return (async function* generate() {
						yield { type: "text-delta", text: '{"skill": null}' };
					})();
				},
			},
		},
		resolvePluginConfig({ autolearnTurns: 1, autolearnIntervalMs: 1000, provider: "test-provider", model: "test-model" }),
	);
	const agent = fakeAgent(root, { id: `session-${event}-${origin ?? "top"}`, origin });
	await fire(handlers, event, agent);
	return calls.length;
}

/** Children the handoff plugin creates for one `turn/end` on one fresh project. */
async function handoffCreates(origin) {
	const root = await project("dsh-gate-handoff-");
	const created = [];
	const { handlers, on } = handlerContext();
	const own = [{ type: "turn/end", seq: 10, time: Date.now() }];
	const conversation = Array.from({ length: 40 }, (_, index) => ({
		role: index % 2 === 0 ? "user" : "assistant",
		source: { kind: index % 2 === 0 ? "user" : "assistant" },
		content: [{ type: "text", text: "x".repeat(1500) }],
	}));
	const agent = fakeAgent(root, { id: `session-handoff-${origin ?? "top"}`, origin });
	// A conversation far past the threshold with a settled trailing turn: the only thing that can
	// keep this from handing off is the gate under test.
	agent.session.deriveMessages = () => conversation;
	agent.session.snapshotEvents = () => own;
	agent.session.ownEvents = () => own;
	applyHandoff(
		{
			logger: { info() {}, warn() {} },
			on,
			effect: () => () => undefined,
			inject: () => () => undefined,
			commands: { register: () => () => undefined },
			get: (name) =>
				name === "sessionController"
					? {
							create: async () => {
								created.push(1);
								return { sessionId: "child-1" };
							},
							rename: async () => undefined,
							prompt: async () => undefined,
						}
					: name === "tokenMeter"
						? { measure: () => ({ totalTokens: 190_000, surfaceTokens: 100_000 }) }
						: undefined,
			llm: {
				resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
				stream: () => (async function* generate() { yield { type: "text-delta", text: "## Goal\n\ncontinue" }; })(),
			},
		},
		resolvePluginConfig({ provider: "test-provider", model: "test-model", handoffKeepTokens: 0 }),
	);
	const listener = handlers.get("session/event")?.[0];
	assert.ok(listener, "apply registers a session/event listener");
	listener(agent.session, { type: "turn/end", seq: 10, time: Date.now() });
	// The positive control below proves this window is long enough for a child to appear, so an
	// empty result here means the event was refused rather than that it had not finished yet.
	for (let i = 0; i < 400 && created.length === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
	return created.length;
}

test("project-memory: a delegated session runs no consolidation on either lifecycle event", async () => {
	for (const event of ["agent/status", "agent/disposed"]) {
		assert.equal(await memoryCalls(event, "subagent"), 0, `${event}: a delegated session must not consolidate the project`);
		assert.equal(await memoryCalls(event), 1, `${event}: the same event on a top-level session consolidates once`);
	}
});

test("project-autolearn: a delegated session runs no distill pass on either lifecycle event", async () => {
	for (const event of ["agent/status", "agent/disposed"]) {
		assert.equal(await autolearnCalls(event, "subagent"), 0, `${event}: a delegated session must not distil project skills`);
		assert.equal(await autolearnCalls(event), 1, `${event}: the same event on a top-level session distils once`);
	}
});

test("project-handoff: a delegated session's settled turn end starts no handoff", async () => {
	assert.equal(await handoffCreates("subagent"), 0, "a delegated session must not hand itself off");
	assert.equal(await handoffCreates(), 1, "the same settled turn end hands a top-level session off once");
});

/** Session directories this fixture's own archive produced (the pre-seeded one does not count). */
async function archivedChildren(root) {
	const entries = await readdir(logsDir(root), { withFileTypes: true });
	return entries.filter((entry) => entry.isDirectory() && entry.name !== "session-archived").map((entry) => entry.name);
}

/** Archive directories the context plugin writes for one lifecycle event on one fresh project. */
async function contextArchives(event, origin, overrides = {}) {
	const root = await project("dsh-gate-context-");
	const { handlers, on } = handlerContext();
	applyContext(
		{
			logger: { info() {}, warn() {} },
			// `publishProjectContextSettings` registers a disposer through `ctx.effect`.
			effect: (callback) => callback(),
			on,
			commands: { register: () => () => undefined },
		},
		resolvePluginConfig({ provider: "test-provider", model: "test-model", ...overrides }),
	);
	const agent = fakeAgent(root, { id: `session-${event.replace(/\W/g, "-")}-${origin ?? "top"}`, origin });
	// The real payload shapes, not `fire()`'s generic one: `agent/disposed` carries the agent and
	// `session/disposed` the session itself.
	const dispatch = {
		"agent/status": () => handlers.get("agent/status")[0]({ agent, status: "idle" }),
		"agent/disposed": () => handlers.get("agent/disposed")[0]({ agent }),
		"session/disposed": () => handlers.get("session/disposed")[0](agent.session),
		"session/event": () => handlers.get("session/event")[0](agent.session, { type: "turn/end", seq: 10, time: Date.now() }),
	};
	dispatch[event]();
	const flush = handlers.get("session/flush")?.[0];
	if (flush) await flush(agent.session);
	// Only the `markdown: true` writes are tracked, so the other two points get a bounded window; the
	// positive control (same write, no gate) proves it is long enough. Measured on this machine: the
	// archive write resolves in 6–8 ms, so 200 ms is ~25× the latency being waited for.
	for (let i = 0; i < 40 && (await archivedChildren(root)).length === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
	return (await archivedChildren(root)).length;
}

test("project-context: a delegated session is not archived on any lifecycle event", async () => {
	for (const event of ["agent/status", "agent/disposed", "session/disposed", "session/event"]) {
		assert.equal(await contextArchives(event, "subagent"), 0, `${event}: a delegated session must not archive itself into the project`);
		assert.equal(await contextArchives(event), 1, `${event}: the same event on a top-level session archives once`);
	}
});

test("project-context: archiving disabled writes nothing on any lifecycle event", async () => {
	// `archiveEnabled: false` is the user turning the feature off, and the README promises no
	// automatic archive or index write — `/session-log` is the documented escape hatch, which is why
	// the commands are not covered here. Each negative keeps its own positive control.
	for (const event of ["agent/status", "agent/disposed", "session/disposed", "session/event"]) {
		assert.equal(await contextArchives(event, undefined, { archiveEnabled: false }), 0, `${event}: archiving is off, so nothing may be written automatically`);
		assert.equal(await contextArchives(event), 1, `${event}: the same event with archiving on writes once`);
	}
});
