/**
 * The injected pressure line: the visible half of "the threshold was crossed and nothing happened".
 *
 * The motivating session (`54cdf479`, `↪ handoff · a00eb4ce`) sat at 2.01x its threshold with one
 * open turn, so `turn/end` — the only event the trigger runs on — had never evaluated it, and the
 * user only found out by computing the numbers by hand. So the line is computed on `step/start`.
 *
 * The other half of the design is a cost bound, and it is the reason this file exists: a registered
 * `systemPrompt.context` is materialized as a durable user-role runtime-context snapshot, and the
 * harness **appends** a fresh ~37 KB snapshot whenever its text changes (measured: session-3a19d454
 * carries five, and every surface event in it is `surfaceOp: "append"`). A line that re-rendered its
 * numbers every turn would therefore cost ~37 KB per turn. The pins below are the ones that fail if
 * that regresses: while a crossing holds, the text stays byte-identical.
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { apply } from "../lib/project-handoff/index.js";
import { clearHandoffPressure, handoffPressureIsOver, handoffPressureText, recordHandoffDeferral, recordHandoffGate } from "../lib/project-handoff/display.js";
import { resolveHandoffGate } from "../lib/project-handoff/gate.js";
import { resolvePluginConfig } from "../lib/shared/config.js";

const WINDOW = 200_000;
const OVER = 199_000;
const UNDER = 1_000;

/** One session shaped like the ones the plugin sees. */
function fakeSession(id, { origin, text = "请继续" } = {}) {
	const header = { cwd: process.cwd(), createdAt: Date.now() };
	if (origin !== undefined) header.origin = origin;
	return {
		id,
		header,
		deriveMessages: () => [
			{ role: "user", source: { kind: "user" }, content: [{ type: "text", text }] },
			{ role: "assistant", source: { kind: "assistant" }, content: [{ type: "text", text: "好" }] },
		],
		requestHeader: () => undefined,
		snapshotEvents: () => [],
		ownEvents: () => [],
	};
}

/** The services `resolveHandoffGate` reads, with a settable occupancy. */
function gateContext(occupancy) {
	const sessionController = { create: async () => ({ sessionId: "child-1" }), rename: async () => undefined };
	return {
		get: (name) =>
			name === "sessionController"
				? sessionController
				: name === "tokenMeter"
					? { measure: () => ({ totalTokens: occupancy.value, surfaceTokens: occupancy.value }) }
					: undefined,
		llm: { resolveModelInfo: async () => ({ context: { contextWindow: WINDOW } }) },
		logger: { info() {}, warn() {} },
	};
}

const RAW_CONFIG = { provider: "test-provider", model: "test-model", handoffPendingQuestion: "wait", handoffBudgetRecentTokens: 0 };

/** The resolved form, for the functions that take a `PluginConfig`. */
const CONFIG = () => resolvePluginConfig(RAW_CONFIG);

/** Resolve a real gate for one session at one occupancy. */
async function gateFor(id, tokens, options = {}) {
	const occupancy = { value: tokens };
	const session = fakeSession(id, options);
	const gate = await resolveHandoffGate(gateContext(occupancy), session, CONFIG());
	assert.notEqual(gate, undefined, "the fixture must be measurable");
	return { session, gate };
}

test("the line is frozen while the crossing holds: the text is byte-identical as occupancy grows", async () => {
	const id = "session-freeze-0000000001";
	const first = await gateFor(id, OVER);
	recordHandoffGate(first.session, first.gate);
	const frozen = handoffPressureText(first.session, "zh");
	assert.notEqual(frozen, "", "crossing the threshold must produce a line");
	assert.ok(frozen.includes(String(OVER)), "the crossing's occupancy is what the reader is owed");

	// Five more steps, each with a larger occupancy: the trigger object changes, the text must not.
	for (const grown of [OVER + 1_000, OVER + 2_000, OVER + 3_000, OVER + 5_000, OVER + 8_000]) {
		const later = await gateFor(id, grown);
		recordHandoffGate(later.session, later.gate);
		assert.equal(handoffPressureText(later.session, "zh"), frozen, `occupancy ${grown} must not re-render the line`);
	}
	clearHandoffPressure(id);
});

test("the line reports the same threshold the decision used", async () => {
	const id = "session-samesource-000001";
	const { session, gate } = await gateFor(id, OVER);
	assert.notEqual(gate.threshold, undefined, "the fixture must clear the threshold");
	recordHandoffGate(session, gate);
	const text = handoffPressureText(session, "zh");
	assert.ok(text.includes(String(gate.threshold.tokens)), "the rendered threshold is the resolved one");
	assert.ok(text.includes(String(gate.measurement.totalTokens)), "the rendered occupancy is the measured one");
	clearHandoffPressure(id);
});

test("below the threshold there is no line, and a later crossing speaks with its own numbers", async () => {
	const id = "session-recross-00000001";
	const under = await gateFor(id, UNDER);
	recordHandoffGate(under.session, under.gate);
	assert.equal(handoffPressureText(under.session, "zh"), "", "an un-crossed session contributes nothing");
	assert.equal(handoffPressureIsOver(id), false);

	const over = await gateFor(id, OVER);
	recordHandoffGate(over.session, over.gate);
	assert.equal(handoffPressureIsOver(id), true);
	assert.ok(handoffPressureText(over.session, "zh").includes(String(OVER)));

	// Falling back below the threshold clears it, so the *next* crossing is allowed to speak again.
	const back = await gateFor(id, UNDER);
	recordHandoffGate(back.session, back.gate);
	assert.equal(handoffPressureText(back.session, "zh"), "");
	clearHandoffPressure(id);
});

test("a deferral changes the line once, and repeating the same reason changes nothing", async () => {
	const id = "session-reason-00000001";
	const { session, gate } = await gateFor(id, OVER);
	recordHandoffGate(session, gate);
	const bare = handoffPressureText(session, "zh");

	recordHandoffDeferral(id, "question");
	const withReason = handoffPressureText(session, "zh");
	assert.notEqual(withReason, bare, "the reason is a fact the reader needs");
	assert.ok(withReason.includes("问题"), "the reason is named, not implied");

	recordHandoffDeferral(id, "question");
	assert.equal(handoffPressureText(session, "zh"), withReason, "the same reason must not re-render");

	recordHandoffDeferral(id, "subagents");
	assert.notEqual(handoffPressureText(session, "zh"), withReason, "a different reason re-renders once");
	clearHandoffPressure(id);
});

test("a reason with no visible crossing is dropped, not queued", async () => {
	const id = "session-late-0000000001";
	const { session, gate } = await gateFor(id, UNDER);
	recordHandoffGate(session, gate);
	recordHandoffDeferral(id, "nothing-to-drop");
	assert.equal(handoffPressureText(session, "zh"), "", "no crossing means no line to enrich");
	clearHandoffPressure(id);
});

test("the line is localized from the session's own conversation", async () => {
	const id = "session-lang-0000000001";
	const { session, gate } = await gateFor(id, OVER);
	recordHandoffGate(session, gate);
	const zh = handoffPressureText(session, "zh");
	const en = handoffPressureText(session, "en");
	assert.ok(zh.includes("自动交接状态"), "the Chinese detector gets Chinese prose");
	assert.ok(en.includes("Automatic-handoff status"), "the English detector gets English prose");
	assert.notEqual(zh, en);
	assert.ok(en.includes(String(gate.threshold.tokens)) && zh.includes(String(gate.threshold.tokens)), "both carry the number");
	clearHandoffPressure(id);
});

/** A Context stand-in that records the handlers and the registered runtime contexts. */
function wiringContext(occupancy) {
	const handlers = new Map();
	const contexts = new Map();
	const commands = [];
	return {
		handlers,
		contexts,
		commands,
		ctx: {
			...gateContext(occupancy),
			on: (type, handler) => {
				(handlers.get(type) ?? handlers.set(type, []).get(type)).push(handler);
				return () => undefined;
			},
			systemPrompt: {
				context: (contribution) => {
					contexts.set(contribution.name, contribution);
					return () => undefined;
				},
			},
			commands: { register: (command) => commands.push(command.name) },
		},
	};
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("the real wiring: a top-level step populates the line, a delegated step does not", async () => {
	const occupancy = { value: OVER };
	const { ctx, handlers, contexts } = wiringContext(occupancy);
	apply(ctx, RAW_CONFIG);
	assert.ok(wired(handlers, contexts), "apply() must wire the session/event and session/disposed handlers and one runtime context");

	const contribution = contexts.get("handoff-pressure");
	assert.notEqual(contribution, undefined, "the pressure line must be registered at order 200");
	assert.equal(contribution.order, 200);

	const top = fakeSession("session-wire-top-000001");
	const child = fakeSession("session-wire-child-0001", { origin: "subagent" });
	const step = handlers.get("session/event")[0];
	step(top, { type: "step/start" });
	step(child, { type: "step/start" });

	// The positive control must be proven first: a fixture that cannot populate anything would
	// satisfy the delegated half on its own.
	await settle();
	assert.notEqual(contribution.text({ agent: { session: top } }), "", "a top-level crossing is visible");
	assert.equal(contribution.text({ agent: { session: child } }), "", "a delegated child gets no line");
	assert.equal(handoffPressureIsOver(String(child.id)), false, "the tick must not even measure a child");

	// A settled tick over a session that is already frozen must not re-measure: hand the same session
	// a gate whose occupancy is far larger and confirm the text did not move.
	const frozen = contribution.text({ agent: { session: top } });
	occupancy.value = OVER + 20_000;
	step(top, { type: "step/start" });
	await settle();
	assert.equal(contribution.text({ agent: { session: top } }), frozen, "a frozen session stops being measured");

	// Disposal releases the marker rather than letting it live for the process.
	handlers.get("session/disposed")[0](top);
	assert.equal(contribution.text({ agent: { session: top } }), "");
});

/** Whether `apply()` wired both the pressure listener and its context contribution. */
function wired(handlers, contexts) {
	return handlers.get("session/event")?.length === 1 && handlers.get("session/disposed")?.length === 1 && contexts.size === 1;
}
