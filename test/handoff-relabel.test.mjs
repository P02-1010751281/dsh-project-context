/**
 * Pins for the deferred title: a continuation names itself after its own first input.
 *
 * The friction: `handoffLabel` writes the child's title at handoff time, when the only input that
 * exists is the parent's — so a parent with no human message (every link of the automatic
 * continuation chain this repo runs on) leaves the child titled with the parent's id for the rest of
 * its life. The child's own log is where a real label shows up later, so this path reads it and
 * rewrites the single `session/title` the handoff pinned.
 *
 * The property that makes the rewrite safe is idempotence without state: the label is the child's
 * *first* naming input, so it never changes, and the write is skipped once the stored title reads
 * that way. The first test pins that directly — a second event costs nothing — and the rest pin what
 * must not be named: an injected runtime-context snapshot, a legacy `kind=user` seed banner, an
 * input with no visible character, and a title the user renamed themselves.
 *
 * Every negative keeps its positive control in the same test: a fixture that simply cannot write
 * would satisfy the negatives on its own. The last test drives the module's real `apply()` rather
 * than the helper, because the event filter is where this feature would silently never run.
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { deferredHandoffLabel } from "../lib/project-handoff/conversation.js";
import { apply as applyHandoff } from "../lib/project-handoff/index.js";
import { isHandoffContinuationText, SCAFFOLDING } from "../lib/project-handoff/language.js";
import { relabelHandoffChild, storedHandoffLabel } from "../lib/project-handoff/relabel.js";
import { resolvePluginConfig } from "../lib/shared/config.js";

const P = "↪ handoff · ";
/** A legacy seed banner: written by the prompt RPC, which hardcoded `source.kind = "user"`. */
const BANNER = `${SCAFFOLDING.zh.continuationPrefix}9f80b44-1c2d 交接。\n<handoff>\n上一会话信息…\n</handoff>\n${SCAFFOLDING.zh.continuationClosing}`;

function userMessage(text, kind = "user") {
	return { role: "user", source: { kind }, content: [{ type: "text", text }] };
}

/** A continuation as this reader sees it: the messages are what the label is derived from. */
function fakeSession(messages, id = "session-child-1") {
	return { id, header: { cwd: "/project" }, deriveMessages: () => messages };
}

/**
 * The title service as `relabel.ts` reads it: `get` folds the stored title, `rename` records the ask
 * and stores whatever `accept` returns. `accept` defaults to the identity; the arms that matter model
 * only the host normalizer's *outcome*, exactly as the `retitleAfterRename` pins do, rather than
 * copying its cleaner.
 */
function fakeTitles(start, accept = (title) => title) {
	const calls = [];
	const state = { stored: start };
	return {
		calls,
		get: () => ({ title: state.stored }),
		rename: (_session, title) => {
			calls.push(title);
			state.stored = accept(title);
			return { title: state.stored };
		},
	};
}

/** A context with just the two services this path touches. */
function fakeContext(titles, warnings = []) {
	return {
		get: (name) => (name === "sessionTitle" ? titles : undefined),
		logger: { info() {}, warn: (...args) => warnings.push(args.join(" ")) },
	};
}

test("a continuation is named after its own first input, and a later input does not move it", () => {
	const titles = fakeTitles(`${P}a099c90d`);
	const child = fakeSession([userMessage("把交接子会话的标题修好"), userMessage("顺手把 v0.4.4 也打了")]);
	relabelHandoffChild(fakeContext(titles), child);
	assert.deepEqual(titles.calls, [`${P}把交接子会话的标题修好`]);
	// The label is the first naming input and the stored title now reads that way, so the next input
	// is free and the sidebar entry stays put — the whole of the "write once" rule, with no state.
	relabelHandoffChild(fakeContext(titles), child);
	assert.deepEqual(titles.calls, [`${P}把交接子会话的标题修好`]);
});

test("an input the label may not be read from leaves the title alone, and a visible one does not", () => {
	const label = (messages) => deferredHandoffLabel(fakeSession(messages));
	assert.equal(label([userMessage("按档 5 动手")]), "按档 5 动手");
	assert.equal(
		label([userMessage("Current runtime context. This snapshot supersedes earlier ones.", "runtime-context"), userMessage("按档 5 动手")]),
		"按档 5 动手",
		"an injected snapshot is not something the user said",
	);
	assert.equal(label([userMessage("按档 5 动手", "dsh-project-context")]), undefined, "the plugin's own seed is not the user");
	assert.equal(label([]), undefined, "a continuation nobody has typed into yet keeps the title it was given");
	// An input with no visible character names nothing, and the search continues past it rather than
	// spending the continuation's one chance on it: "\u200B \u200B" is the case the host's cleaner
	// would strip down to the prefix's own space (see the eager path's `hasVisibleText`).
	assert.equal(label([userMessage("\u200B \u200B"), userMessage("第二句才算")]), "第二句才算");
	assert.equal(label([userMessage("真的 \u200B 有字")]), "真的 \u200B 有字", "a label is not stripped, only judged");

	const titles = fakeTitles(`${P}a099c90d`);
	const child = fakeSession([userMessage("\u200B \u200B")]);
	relabelHandoffChild(fakeContext(titles), child);
	assert.deepEqual(titles.calls, [], "nothing names it, so nothing is written");
});

test("a legacy kind=user seed banner does not name the continuation", () => {
	// Seeding used to go through the prompt RPC, which hardcodes `source.kind = "user"`, so an old
	// child's own banner is a *human* message by kind and the kind filter alone lets it through —
	// naming the continuation after the session its own parent was continued from, which is worse
	// than the parent id it would replace. Counted on the real store: 27 of 99 archived handoff
	// children have such a banner as their first `kind=user` message
	// (`.agents/evidence/2026-10-07-handoff-title-label-survey/`).
	assert.ok(isHandoffContinuationText(BANNER), "the fixture is a banner the shared predicate recognizes");
	assert.equal(deferredHandoffLabel(fakeSession([userMessage(BANNER), userMessage("按档 5 动手")])), "按档 5 动手");

	const titles = fakeTitles(`${P}a099c90d`);
	relabelHandoffChild(fakeContext(titles), fakeSession([userMessage(BANNER)]));
	assert.deepEqual(titles.calls, [], "a banner-only continuation keeps the title it was given");
});

test("a title that is not a continuation's is never overwritten", () => {
	// The prefix is what tells the two apart, and it is the same criterion the browser watcher uses.
	assert.equal(storedHandoffLabel(`${P}a099c90d`), "a099c90d");
	assert.equal(storedHandoffLabel("按档 5 动手"), undefined, "a plain title is not a continuation's");
	assert.equal(storedHandoffLabel(P.trimEnd()), undefined, "the prefix-less form the service can store is not re-adopted here");
	assert.equal(storedHandoffLabel(undefined), undefined, "a title that has not landed yet is not a continuation's");
	assert.equal(storedHandoffLabel(42), undefined, "a non-string title is not a continuation's");

	const child = () => fakeSession([userMessage("按档 5 动手")]);
	// Positive control first: the same input on a title this plugin wrote is renamed.
	const mine = fakeTitles(`${P}a099c90d`);
	relabelHandoffChild(fakeContext(mine), child());
	assert.deepEqual(mine.calls, [`${P}按档 5 动手`]);
	const renamed = fakeTitles("用户自己起的名字");
	relabelHandoffChild(fakeContext(renamed), child());
	assert.deepEqual(renamed.calls, [], "a user's own rename wins");
	const untitled = fakeTitles(undefined);
	relabelHandoffChild(fakeContext(untitled), child());
	assert.deepEqual(untitled.calls, [], "a title that has not landed yet is left for a later event");
});

test("a label the service strips restores the title the continuation already had", () => {
	// An escape sequence with a printable body passes `hasVisibleText` but is removed whole by the
	// host's `cleanTitleText`, which would leave the prefix one space short of the literal the watcher
	// matches. The service reports what it accepted, so the previous label is written back instead —
	// the same backstop the handoff's own write carries, with the title this session already had.
	const titles = fakeTitles(`${P}a099c90d`, () => P.trimEnd());
	const warnings = [];
	relabelHandoffChild(fakeContext(titles, warnings), fakeSession([userMessage("\u001B[31m")]));
	assert.deepEqual(titles.calls, [`${P}\u001B[31m`, `${P}a099c90d`]);
	assert.deepEqual(warnings, [], "the restore is not a failure and must not be reported as one");
});

test("a refusing title service is logged, not thrown", () => {
	// `rename` throws by contract when the session is no longer live in the store, and this runs on
	// the event path of a turn: a display nicety must never fail the turn that carried the input.
	const warnings = [];
	const titles = {
		get: () => ({ title: `${P}a099c90d` }),
		rename: () => {
			throw new Error('session "session-child-1" is not live in this store');
		},
	};
	assert.doesNotThrow(() => relabelHandoffChild(fakeContext(titles, warnings), fakeSession([userMessage("按档 5 动手")])));
	assert.equal(warnings.length, 1);
	assert.match(warnings[0], /not live/);
});

/** One `user/message` through the plugin's real `apply()` wiring; returns the titles it wrote. */
function relabelThroughApply({ origin, kind = "user", title = `${P}a099c90d`, text = "按档 5 动手", config = {} } = {}) {
	const titles = fakeTitles(title);
	const handlers = new Map();
	let modelCalls = 0;
	const register = (type, handler) => {
		(handlers.get(type) ?? handlers.set(type, []).get(type)).push(handler);
		return () => undefined;
	};
	applyHandoff(
		{
			logger: { info() {}, warn() {} },
			on: register,
			effect: () => () => undefined,
			inject: () => () => undefined,
			commands: { register: () => () => undefined },
			// The pressure-line contribution registers here; this case is about the event filter.
			systemPrompt: { context: () => undefined },
			get: (name) => (name === "sessionTitle" ? titles : undefined),
			llm: {
				resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
				stream: () => {
					modelCalls += 1;
					throw new Error("the deferred title must not call a model");
				},
			},
		},
		resolvePluginConfig({ provider: "test-provider", model: "test-model", ...config }),
	);
	const listener = handlers.get("session/event")?.[0];
	assert.ok(listener, "apply registers a session/event listener");
	const header = { cwd: "/project" };
	if (origin !== undefined) header.origin = origin;
	const session = { id: "session-child-1", header, deriveMessages: () => [userMessage(text)], snapshotEvents: () => [], ownEvents: () => [], requestHeader: () => undefined };
	listener(session, { type: "user/message", seq: 2, time: Date.now(), data: { source: { kind }, content: [{ type: "text", text }] } });
	assert.equal(modelCalls, 0, "the deferred title must not call a model");
	return titles.calls;
}

test("the wiring renames on a human message only, and only while the handoff is on", () => {
	// The positive control is what makes the four negatives evidence: the same event, with each
	// single condition restored, writes exactly once.
	const written = [`${P}按档 5 动手`];
	assert.deepEqual(relabelThroughApply(), written, "a human message on a continuation renames it");
	assert.deepEqual(relabelThroughApply({ kind: "runtime-context" }), [], "an injected user-role snapshot is not a human message");
	assert.deepEqual(relabelThroughApply({ kind: "dsh-project-context" }), [], "the plugin's own seed is not a human message");
	assert.deepEqual(relabelThroughApply({ origin: "subagent" }), [], "a delegated child is never a continuation");
	assert.deepEqual(relabelThroughApply({ config: { handoffEnabled: false } }), [], "the handoff is off, so it writes no titles");
	assert.deepEqual(relabelThroughApply({ title: "用户自己起的名字" }), [], "a title the user chose is left alone");
});
