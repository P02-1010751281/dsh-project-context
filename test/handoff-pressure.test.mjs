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
 * that regresses: while a crossing holds, the text stays byte-identical — including when the
 * occupancy grows and when the session's detected language would flip.
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
	recordHandoffGate(first.session, first.gate, "zh");
	const frozen = handoffPressureText(first.session);
	assert.notEqual(frozen, "", "crossing the threshold must produce a line");
	assert.ok(frozen.includes(String(OVER)), "the crossing's occupancy is what the reader is owed");

	// Five more steps, each with a larger occupancy: the trigger object changes, the text must not.
	for (const grown of [OVER + 1_000, OVER + 2_000, OVER + 3_000, OVER + 5_000, OVER + 8_000]) {
		const later = await gateFor(id, grown);
		recordHandoffGate(later.session, later.gate, "zh");
		assert.equal(handoffPressureText(later.session), frozen, `occupancy ${grown} must not re-render the line`);
	}
	clearHandoffPressure(id);
});

test("a language flip does not re-render a frozen crossing", async () => {
	// The language is derived from the conversation, so a bilingual session reaching the detector's
	// threshold would flip the line — a text change, i.e. another ~37 KB snapshot. Freeze it with the
	// crossing instead, which is also why the context provider takes no language argument.
	const id = "session-langfreeze-000001";
	const first = await gateFor(id, OVER);
	recordHandoffGate(first.session, first.gate, "zh");
	const frozen = handoffPressureText(first.session);
	assert.ok(frozen.includes("自动交接状态"), "the crossing's language is the one that renders");

	for (const flipped of ["en", "en", "zh", "en"]) {
		recordHandoffGate(first.session, first.gate, flipped);
		assert.equal(handoffPressureText(first.session), frozen, `a later ${flipped} resolution must not re-render`);
	}
	clearHandoffPressure(id);
});

test("the line reports the same threshold the decision used", async () => {
	const id = "session-samesource-000001";
	const { session, gate } = await gateFor(id, OVER);
	assert.notEqual(gate.threshold, undefined, "the fixture must clear the threshold");
	recordHandoffGate(session, gate, "zh");
	const text = handoffPressureText(session);
	assert.ok(text.includes(String(gate.threshold.tokens)), "the rendered threshold is the resolved one");
	assert.ok(text.includes(String(gate.measurement.totalTokens)), "the rendered occupancy is the measured one");
	clearHandoffPressure(id);
});

test("below the threshold there is no line, and a later crossing speaks with its own numbers", async () => {
	const id = "session-recross-00000001";
	const under = await gateFor(id, UNDER);
	recordHandoffGate(under.session, under.gate, "zh");
	assert.equal(handoffPressureText(under.session), "", "an un-crossed session contributes nothing");
	assert.equal(handoffPressureIsOver(id), false);

	const over = await gateFor(id, OVER);
	recordHandoffGate(over.session, over.gate, "zh");
	assert.equal(handoffPressureIsOver(id), true);
	assert.ok(handoffPressureText(over.session).includes(String(OVER)));

	// Falling back below the threshold clears it, so the *next* crossing is allowed to speak again.
	const back = await gateFor(id, UNDER);
	recordHandoffGate(back.session, back.gate, "zh");
	assert.equal(handoffPressureText(back.session), "");
	clearHandoffPressure(id);
});

test("a deferral changes the line once, and repeating the same reason changes nothing", async () => {
	const id = "session-reason-00000001";
	const { session, gate } = await gateFor(id, OVER);
	recordHandoffGate(session, gate, "zh");
	const bare = handoffPressureText(session);

	recordHandoffDeferral(id, "question");
	const withReason = handoffPressureText(session);
	assert.notEqual(withReason, bare, "the reason is a fact the reader needs");
	assert.ok(withReason.includes("问题"), "the reason is named, not implied");

	recordHandoffDeferral(id, "question");
	assert.equal(handoffPressureText(session), withReason, "the same reason must not re-render");

	recordHandoffDeferral(id, "subagents");
	assert.notEqual(handoffPressureText(session), withReason, "a different reason re-renders once");
	clearHandoffPressure(id);
});

test("a reason with no visible crossing is dropped, not queued", async () => {
	const id = "session-late-0000000001";
	const { session, gate } = await gateFor(id, UNDER);
	recordHandoffGate(session, gate, "zh");
	recordHandoffDeferral(id, "nothing-to-drop");
	assert.equal(handoffPressureText(session), "", "no crossing means no line to enrich");
	clearHandoffPressure(id);
});

test("the line is localized from the language frozen with the crossing", async () => {
	const zh = await gateFor("session-lang-zh-00000001", OVER);
	recordHandoffGate(zh.session, zh.gate, "zh");
	const en = await gateFor("session-lang-en-00000001", OVER);
	recordHandoffGate(en.session, en.gate, "en");
	const zhText = handoffPressureText(zh.session);
	const enText = handoffPressureText(en.session);
	assert.ok(zhText.includes("自动交接状态"), "a zh crossing gets Chinese prose");
	assert.ok(enText.includes("Automatic-handoff status"), "an en crossing gets English prose");
	assert.notEqual(zhText, enText);
	assert.ok(enText.includes(String(en.gate.threshold.tokens)) && zhText.includes(String(zh.gate.threshold.tokens)), "both carry the number");
	clearHandoffPressure(String(zh.session.id));
	clearHandoffPressure(String(en.session.id));
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
	assert.notEqual(contribution, undefined, "the pressure line must be registered");
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
