/**
 * Pins for the deferred title: a continuation names itself after its own first input, once.
 *
 * The friction: `handoffLabel` writes the child's title at handoff time, when the only input that
 * exists is the parent's — so a parent with no human message (every link of the automatic
 * continuation chain this repo runs on) leaves the child titled with the parent's id for the rest of
 * its life. The child's own log is where a real label shows up later, so this path reads it and
 * rewrites the single `session/title` the handoff pinned.
 *
 * The two properties that make the rewrite safe are both pinned against a fixture that would catch
 * their absence:
 *
 *  - it reads the **durable log**, not `deriveMessages()`: a compaction replaces surface nodes (4 of
 *    the 99 archived handoff children carry a compaction event, 6 a ranged surface replace), so the
 *    derived "first" message can become a different one and the rule would relabel again later;
 *  - it writes only while the event being handled is the one that carried that first input. The
 *    service stores its *normalized* title, so a comparison against the stored text never settles for
 *    a label the service rewrites — the fake service in that test models exactly that outcome, and the
 *    write count is what proves the point.
 *
 * Every negative keeps its positive control in the same test: a fixture that simply cannot write
 * would satisfy the negatives on its own. The last test drives the module's real `apply()` rather
 * than the helper, because the event filter is where this feature would silently never run.
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { firstHandoffInput } from "../lib/project-handoff/conversation.js";
import { apply as applyHandoff } from "../lib/project-handoff/index.js";
import { isHandoffContinuationText, SCAFFOLDING } from "../lib/project-handoff/language.js";
import { relabelHandoffChild, storedHandoffLabel } from "../lib/project-handoff/relabel.js";
import { resolvePluginConfig } from "../lib/shared/config.js";

const P = "↪ handoff · ";
/** A legacy seed banner: written by the prompt RPC, which hardcoded `source.kind = "user"`. */
const BANNER = `${SCAFFOLDING.zh.continuationPrefix}9f80b44-1c2d 交接。\n<handoff>\n上一会话信息…\n</handoff>\n${SCAFFOLDING.zh.continuationClosing}`;

/** One `user/message` log event, the shape `session.snapshotEvents()` returns. */
function userEvent(seq, text, kind = "user") {
	return { type: "user/message", seq, time: seq, data: { source: { kind }, content: [{ type: "text", text }] } };
}

/** A session whose derived conversation can differ from its log, as a compaction makes it. */
function fakeSession(events, derived = events) {
	return {
		id: "session-child-1",
		header: { cwd: "/project" },
		snapshotEvents: () => events,
		deriveMessages: () => derived.map((event) => ({ role: "user", source: { kind: event.data.source.kind }, content: event.data.content })),
	};
}

/**
 * The title service as `relabel.ts` reads it: `get` folds the stored title, `rename` records the ask
 * and stores whatever `accept` returns. `accept` defaults to the identity; the arm that matters models
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

test("a continuation is named after its own first input, read from the durable log", () => {
	const label = (events, derived) => firstHandoffInput(fakeSession(events, derived));
	assert.deepEqual(label([userEvent(13, "把交接子会话的标题修好"), userEvent(20, "顺手把 v0.4.4 也打了")]), { seq: 13, label: "把交接子会话的标题修好" });
	assert.equal(label([]), undefined, "a continuation nobody has typed into yet keeps the title it was given");
	// A compaction replaces the surface nodes: the derived conversation no longer holds the first
	// message, but the log does — and the log is what decides, because a label that changes under the
	// user is the very thing this rule exists to avoid.
	assert.deepEqual(
		label([userEvent(13, "压掉之前的那句"), userEvent(721, "压过之后的话")], [userEvent(721, "压过之后的话")]),
		{ seq: 13, label: "压掉之前的那句" },
		"the durable log names it, not the compacted surface",
	);
	// One line, clipped, and never skipped for being long.
	const long = label([userEvent(4, `第一行\n\n第二行 ${"很长".repeat(120)}`)]);
	assert.ok(long !== undefined && long.label.length <= 20, "a long input is clipped, not passed over");
	assert.ok(long.label.endsWith("…") && !long.label.includes("\n"), "and the clip says so, on one line");
});

test("an input the label may not be read from leaves the title alone, and a visible one does not", () => {
	const label = (events) => firstHandoffInput(fakeSession(events));
	assert.deepEqual(
		label([userEvent(5, "Current runtime context. This snapshot supersedes earlier ones.", "runtime-context"), userEvent(6, "按档 5 动手")]),
		{ seq: 6, label: "按档 5 动手" },
		"an injected snapshot is not something the user said",
	);
	assert.equal(label([userEvent(7, "按档 5 动手", "dsh-project-context")]), undefined, "the plugin's own seed is not the user");
	// An input with no visible character names nothing, and the search continues past it rather than
	// spending the continuation's single chance on it: "\u200B \u200B" is the case the host's cleaner
	// would strip down to the prefix's own space (see the eager path's `hasVisibleText`).
	assert.deepEqual(label([userEvent(8, "\u200B \u200B"), userEvent(9, "第二句才算")]), { seq: 9, label: "第二句才算" });
	assert.deepEqual(label([userEvent(10, "真的 \u200B 有字")]), { seq: 10, label: "真的 \u200B 有字" }, "a label is not stripped, only judged");

	const titles = fakeTitles(`${P}a099c90d`);
	relabelHandoffChild(fakeContext(titles), fakeSession([userEvent(8, "\u200B \u200B")]), 8);
	assert.deepEqual(titles.calls, [], "nothing names it, so nothing is written");
});

test("a legacy kind=user seed banner does not name the continuation", () => {
	// Seeding used to go through the prompt RPC, which hardcodes `source.kind = "user"`, so an old
	// child's own banner is a *human* message by kind and the kind filter alone lets it through —
	// naming the continuation after the session its own parent was continued from, which is worse than
	// the parent id it would replace. Counted on the real store: 27 of 99 archived handoff children
	// have such a banner as their first `kind=user` message
	// (`.agents/evidence/2026-10-07-handoff-title-label-survey/`).
	assert.ok(isHandoffContinuationText(BANNER), "the fixture is a banner the shared predicate recognizes");
	assert.deepEqual(firstHandoffInput(fakeSession([userEvent(11, BANNER), userEvent(12, "按档 5 动手")])), { seq: 12, label: "按档 5 动手" });

	const titles = fakeTitles(`${P}a099c90d`);
	relabelHandoffChild(fakeContext(titles), fakeSession([userEvent(11, BANNER)]), 11);
	assert.deepEqual(titles.calls, [], "a banner-only continuation keeps the title it was given");
});

test("a title that is not a continuation's is never overwritten", () => {
	// The prefix is what tells the two apart, and it is the same criterion the browser watcher uses.
	assert.equal(storedHandoffLabel(`${P}a099c90d`), "a099c90d");
	assert.equal(storedHandoffLabel("按档 5 动手"), undefined, "a plain title is not a continuation's");
	assert.equal(storedHandoffLabel(P.trimEnd()), undefined, "the prefix-less form the service can store is not re-adopted here");
	assert.equal(storedHandoffLabel(undefined), undefined, "a title that has not landed yet is not a continuation's");
	assert.equal(storedHandoffLabel(42), undefined, "a non-string title is not a continuation's");

	const child = () => fakeSession([userEvent(13, "按档 5 动手")]);
	// Positive control first: the same input on a title this plugin wrote is renamed.
	const mine = fakeTitles(`${P}a099c90d`);
	relabelHandoffChild(fakeContext(mine), child(), 13);
	assert.deepEqual(mine.calls, [`${P}按档 5 动手`]);
	const renamed = fakeTitles("用户自己起的名字");
	relabelHandoffChild(fakeContext(renamed), child(), 13);
	assert.deepEqual(renamed.calls, [], "a user's own rename wins");
	const untitled = fakeTitles(undefined);
	relabelHandoffChild(fakeContext(untitled), child(), 13);
	assert.deepEqual(untitled.calls, [], "a title that has not landed yet is left for a later event");
});

test("the write fires once per continuation, whatever the service stores", () => {
	// The service stores `cleanTitleText`'s output, so a label carrying a control character comes back
	// different from the string we asked for. Comparing the stored title against the label would
	// therefore write again on every later input; the trigger is the first naming input's own seq.
	// Reachability on the real corpus is 0 of 49 produced labels, which is exactly why this needs a
	// fake that models the outcome instead of the corpus.
	const strip = (title) => title.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu, "").replace(/\s+/gu, " ").trim();
	const titles = fakeTitles(`${P}a099c90d`, strip);
	const child = fakeSession([userEvent(2, "abc\u0001def"), userEvent(9, "后来的话")]);
	relabelHandoffChild(fakeContext(titles), child, 2);
	assert.deepEqual(titles.calls, [`${P}abc\u0001def`]);
	assert.equal(titles.get().title, `${P}abcdef`, "the fixture really does model a service that rewrites the label");
	relabelHandoffChild(fakeContext(titles), child, 9);
	assert.deepEqual(titles.calls, [`${P}abc\u0001def`], "a later input does not write a second title");
	// "Once" is the trigger's doing, not the comparison's: a handler that ran again for the *same*
	// seq would write again, because the stored title legitimately differs from what was asked for.
	// The host delivers each event once, and this is why the guard below is the seq rather than the
	// stored text — the title can never reach a fixed point with a service that rewrites it.
	relabelHandoffChild(fakeContext(titles), child, 2);
	assert.equal(titles.calls.length, 2, "the same seq re-run writes again; the seq gate is what makes that unreachable in the host");

	// The trigger is an equality, not "at or after": a seq that is not the first naming input's is
	// refused even when it is smaller, so nothing here depends on the order events arrive in.
	const early = fakeTitles(`${P}a099c90d`);
	relabelHandoffChild(fakeContext(early), child, 1);
	assert.deepEqual(early.calls, [], "a seq that is not the first naming input's writes nothing");
});

test("a label the service strips restores the title the continuation already had", () => {
	// An escape sequence with a printable body passes `hasVisibleText` but is removed whole by the
	// host's `cleanTitleText`, which would leave the prefix one space short of the literal the watcher
	// matches. The service reports what it accepted, so the previous label is written back instead —
	// the same backstop the handoff's own write carries, with the title this session already had.
	const titles = fakeTitles(`${P}a099c90d`, () => P.trimEnd());
	const warnings = [];
	relabelHandoffChild(fakeContext(titles, warnings), fakeSession([userEvent(3, "\u001B[31m")]), 3);
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
	assert.doesNotThrow(() => relabelHandoffChild(fakeContext(titles, warnings), fakeSession([userEvent(13, "按档 5 动手")]), 13));
	assert.equal(warnings.length, 1);
	assert.match(warnings[0], /not live/);
});

/** One `user/message` through the plugin's real `apply()` wiring; returns the titles it wrote. */
function relabelThroughApply({ origin, kind = "user", title = `${P}a099c90d`, text = "按档 5 动手", seq = 2, config = {} } = {}) {
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
	const session = fakeSession([userEvent(seq, text, kind)]);
	if (origin !== undefined) session.header.origin = origin;
	const fire = (eventSeq) => listener(session, { type: "user/message", seq: eventSeq, time: Date.now(), data: { source: { kind }, content: [{ type: "text", text }] } });
	fire(seq);
	// A second event with a later seq: a wiring that ignored the trigger seq would write twice.
	fire(seq + 7);
	assert.equal(modelCalls, 0, "the deferred title must not call a model");
	return titles.calls;
}

test("the wiring renames on a human message only, and only while the handoff is on", () => {
	// The positive control is what makes the four negatives evidence: the same event, with each
	// single condition restored, writes exactly once.
	const written = [`${P}按档 5 动手`];
	assert.deepEqual(relabelThroughApply(), written, "a human message on a continuation renames it, once");
	assert.deepEqual(relabelThroughApply({ kind: "runtime-context" }), [], "an injected user-role snapshot is not a human message");
	assert.deepEqual(relabelThroughApply({ kind: "dsh-project-context" }), [], "the plugin's own seed is not a human message");
	assert.deepEqual(relabelThroughApply({ origin: "subagent" }), [], "a delegated child is never a continuation");
	assert.deepEqual(relabelThroughApply({ config: { handoffEnabled: false } }), [], "the handoff is off, so it writes no titles");
	assert.deepEqual(relabelThroughApply({ title: "用户自己起的名字" }), [], "a title the user chose is left alone");
});
