/**
 * The route-failure half of the injected line — the failure that used to be visible only in
 * `errors.log`.
 *
 * When a mid-session model switch leaves the session's request header pointing at a pair this profile
 * cannot resolve, `resolveHandoffGate` throws, the automatic trigger backs off for five minutes and the
 * user sees a session that quietly stopped handing off. The pins below are the four things that make
 * the failure a *surface* instead:
 *
 *  - the throw is named (`HandoffRouteError`), not an anonymous exception, and a cancelled read stays
 *    what it was — the wrapper must not relabel "the caller stopped" as "your route is broken";
 *  - the injected line is byte-stable while the same failure repeats, because a `systemPrompt.context`
 *    text change appends a ~37 KB runtime-context snapshot; and it is cleared by the next successful
 *    resolution, which is what stops it claiming a failure that no longer holds;
 *  - `/handoff status` answers instead of throwing the very exception it exists to explain, and its
 *    receipt carries the adapter's own message (the prompt line deliberately does not: that text is
 *    frozen, so a varying message would append a snapshot per retry);
 *  - the real wiring records it: `turn/end` + a dead route produces the line on the contribution the
 *    host actually assembles.
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { apply } from "../lib/project-handoff/index.js";
import { clearHandoffPressure, handoffPressureText, recordHandoffGate } from "../lib/project-handoff/display.js";
import { resolveHandoffGate } from "../lib/project-handoff/gate.js";
import {
	HandoffRouteError,
	clearRouteFailure,
	recordRouteFailure,
	routeFailureOf,
	routeFailureReceipt,
	routeFailureText,
} from "../lib/project-handoff/route-failure.js";
import { statusText } from "../lib/project-handoff/command.js";
import { resolvePluginConfig } from "../lib/shared/config.js";

const WINDOW = 200_000;
const OVER = 199_000;
const UNDER = 1_000;
const ROUTE = { provider: "test-provider", model: "test-model" };

/** One session shaped like the ones the plugin sees. */
function fakeSession(id, { cwd = process.cwd(), text = "Continue the work." } = {}) {
	return {
		id,
		header: { cwd, createdAt: Date.now() },
		deriveMessages: () => [
			{ role: "user", source: { kind: "user" }, content: [{ type: "text", text }] },
			{ role: "assistant", source: { kind: "assistant" }, content: [{ type: "text", text: "ok" }] },
		],
		requestHeader: () => undefined,
		snapshotEvents: () => [],
		ownEvents: () => [],
	};
}

/** The services `resolveHandoffGate` and `statusText` read, with a settable occupancy and route read. */
function pluginContext(occupancy, resolveModelInfo) {
	const sessionController = { create: async () => ({ sessionId: "child-1" }), rename: async () => undefined };
	return {
		get: (name) =>
			name === "sessionController"
				? sessionController
				: name === "tokenMeter"
					? { measure: () => ({ totalTokens: occupancy.value, surfaceTokens: occupancy.value }) }
					: undefined,
		llm: { resolveModelInfo: resolveModelInfo ?? (async () => ({ context: { contextWindow: WINDOW } })) },
		logger: { info() {}, warn() {} },
	};
}

const RAW_CONFIG = { ...ROUTE, handoffPendingQuestion: "wait", handoffBudgetRecentTokens: 0, handoffLang: "en" };
const CONFIG = () => resolvePluginConfig(RAW_CONFIG);

/** A harness error as the llm service raises one: `code` is the supported discriminant. */
function harnessError(message, code) {
	return Object.assign(new Error(message), { code });
}

/** Resolve a real gate for one session at one occupancy. */
async function gateFor(id, tokens, options = {}) {
	const occupancy = { value: tokens };
	const session = fakeSession(id, options);
	const gate = await resolveHandoffGate(pluginContext(occupancy), session, CONFIG());
	assert.notEqual(gate, undefined, "the fixture must be measurable");
	return { session, gate };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("a dead route throws a named failure carrying the route, the harness code and the adapter message", async () => {
	const adapter = harnessError('pi-ai provider "test-provider" has no configured model "test-model"', "UNKNOWN_MODEL");
	const ctx = pluginContext({ value: UNDER }, async () => {
		throw adapter;
	});
	await assert.rejects(
		() => resolveHandoffGate(ctx, fakeSession("session-route-throw-001"), CONFIG()),
		(error) => {
			assert.ok(error instanceof HandoffRouteError, `expected a HandoffRouteError, got ${error?.name}`);
			assert.deepEqual(error.failure, { provider: "test-provider", model: "test-model", code: "UNKNOWN_MODEL" });
			assert.match(error.detail, /has no configured model/, "the receipt needs the adapter's own wording");
			assert.equal(error.cause, adapter, "the adapter's error is kept, not replaced");
			return true;
		},
	);
});

test("a cancelled read is rethrown as it was: the wrapper must not call a stop a broken route", async () => {
	const controller = new AbortController();
	controller.abort();
	const abort = Object.assign(new Error("the read was aborted"), { name: "AbortError" });
	const ctx = pluginContext({ value: UNDER }, async () => {
		throw abort;
	});
	await assert.rejects(
		() => resolveHandoffGate(ctx, fakeSession("session-route-abort-001"), CONFIG(), controller.signal),
		(error) => {
			assert.equal(error, abort, "an aborted read is not a route failure");
			return true;
		},
	);
});

test("the line names the route and the code, stays byte-identical on repeats, and clears", () => {
	const id = "session-route-line-0001";
	recordRouteFailure(id, { ...ROUTE, code: "UNKNOWN_MODEL" }, "zh");
	const first = routeFailureText(id);
	assert.match(first, /自动交接无法运行/, "the user learns the handoff cannot run");
	assert.ok(first.includes("`test-provider/test-model`"), "the route is what the user has to change");
	assert.match(first, /UNKNOWN_MODEL/);
	assert.match(first, /告知用户/, "the injected line is model-facing, so it must carry the instruction");

	// The five-minute backoff retries the same failure; a text change would append a snapshot each time.
	recordRouteFailure(id, { ...ROUTE, code: "UNKNOWN_MODEL" }, "en");
	assert.equal(routeFailureText(id), first, "the same failure under another language must not re-render");

	recordRouteFailure(id, { provider: "test-provider", model: "other-model", code: "UNKNOWN_MODEL" }, "zh");
	assert.notEqual(routeFailureText(id), first, "a different route re-renders once");
	assert.deepEqual(routeFailureOf(id), { provider: "test-provider", model: "other-model", code: "UNKNOWN_MODEL" });

	clearRouteFailure(id);
	assert.equal(routeFailureText(id), "");
	assert.equal(routeFailureOf(id), undefined);
});

test("a successful resolution clears the recorded failure: recovery stops the line", async () => {
	const id = "session-route-recover-01";
	const { session, gate } = await gateFor(id, UNDER);
	recordRouteFailure(id, { ...ROUTE, code: "UNKNOWN_MODEL" }, "en");
	assert.notEqual(routeFailureText(id), "");
	recordHandoffGate(session, gate, "en");
	assert.equal(routeFailureText(id), "", "the gate only exists when the route resolved");
	clearHandoffPressure(id);
});

test("a crossing and a route failure compose into one line, each half frozen", async () => {
	const id = "session-route-compose-01";
	const first = await gateFor(id, OVER);
	recordHandoffGate(first.session, first.gate, "en");
	recordRouteFailure(id, { ...ROUTE, code: "UNKNOWN_MODEL" }, "en");
	const text = handoffPressureText(first.session);
	assert.ok(text.includes("Automatic-handoff status"), "the crossing half is still there");
	assert.ok(text.includes("Automatic handoff cannot run"), "and the route half rides along");
	assert.ok(text.indexOf("Automatic-handoff status") < text.indexOf("Automatic handoff cannot run"), "in that order");

	// The trigger measures again on every turn end and the backoff retries the same failure: neither may
	// move the bytes. (A *successful* re-resolution is the recovery case and clears the route half — see
	// the test above — so this re-records the failure instead of resolving a gate.)
	recordRouteFailure(id, { ...ROUTE, code: "UNKNOWN_MODEL" }, "en");
	assert.equal(handoffPressureText(first.session), text, "a repeated failure must not re-render the line");
	clearHandoffPressure(id);
	assert.equal(routeFailureText(id), "", "disposal clears both halves");
});

test("the /handoff status receipt reports a dead route instead of throwing it", async () => {
	const signal = new AbortController().signal;
	const session = fakeSession("session-route-receipt-1");
	const dead = pluginContext({ value: UNDER }, async () => {
		throw harnessError('pi-ai provider "test-provider" has no configured model "test-model"', "UNKNOWN_MODEL");
	});
	const receipt = await statusText(dead, session, CONFIG(), signal);
	assert.match(receipt, /route `test-provider\/test-model` cannot be resolved \(UNKNOWN_MODEL\)/, "the receipt names the pair");
	assert.match(receipt, /has no configured model/, "and quotes the adapter's message, which the prompt line omits");
	assert.match(receipt, /automatic handoff cannot run until an available model is selected/);
	assert.doesNotMatch(receipt, /Tell the user/, "a receipt is read by the user, so it carries no instruction to them");

	// Control: the same receipt over a resolvable route answers with the numbers, so the assertion above
	// cannot be satisfied by a receipt that never renders anything.
	const live = pluginContext({ value: 120_000 });
	const healthy = await statusText(live, fakeSession("session-route-receipt-2"), CONFIG(), signal);
	assert.match(healthy, /context 120000\/200000 \(60%\)/);
	assert.doesNotMatch(healthy, /cannot be resolved/);

	// A receipt is a read: it must not clear the record the automatic path owns.
	const id = "session-route-receipt-3";
	recordRouteFailure(id, { ...ROUTE, code: "UNKNOWN_MODEL" }, "en");
	void routeFailureReceipt({ ...ROUTE, code: "UNKNOWN_MODEL" }, "detail", "en");
	assert.notEqual(routeFailureOf(id), undefined, "reading the receipt must not forge a recovery");
	clearRouteFailure(id);
});

test("the real wiring records the failure on turn/end; a disabled handoff never tries", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "dsh-handoff-route-"));
	const handlers = new Map();
	const contexts = new Map();
	const ctx = {
		...pluginContext({ value: UNDER }, async () => {
			throw harnessError('pi-ai provider "test-provider" has no configured model "test-model"', "UNKNOWN_MODEL");
		}),
		on: (type, handler) => {
			const list = handlers.get(type) ?? [];
			list.push(handler);
			handlers.set(type, list);
			return () => undefined;
		},
		systemPrompt: {
			context: (contribution) => {
				contexts.set(contribution.name, contribution);
				return () => undefined;
			},
		},
		commands: { register: () => undefined },
	};
	apply(ctx, RAW_CONFIG);
	const contribution = contexts.get("handoff-pressure");
	assert.notEqual(contribution, undefined, "the pressure line must be registered");
	const session = fakeSession("session-route-wire-0001", { cwd: root });

	// Below the threshold, so no crossing can supply the text: whatever appears here is the route half.
	assert.equal(contribution.text({ agent: { session } }), "", "nothing to say before the trigger ran");
	handlers.get("session/event")[0](session, { type: "turn/end", seq: 1 });
	let text = "";
	for (let attempt = 0; attempt < 100 && text === ""; attempt += 1) {
		await settle();
		text = contribution.text({ agent: { session } });
	}
	assert.ok(text.includes("test-provider/test-model"), `the wiring must record the failure, got ${JSON.stringify(text)}`);
	assert.match(text, /UNKNOWN_MODEL/);

	// Negative control: with the handoff off the attempt never runs, so no line may appear.
	const offHandlers = new Map();
	const offContexts = new Map();
	const offSession = fakeSession("session-route-wire-0002", { cwd: root });
	const off = {
		...pluginContext({ value: UNDER }, async () => {
			throw harnessError("should never be read", "UNKNOWN_MODEL");
		}),
		on: (type, handler) => {
			const list = offHandlers.get(type) ?? [];
			list.push(handler);
			offHandlers.set(type, list);
			return () => undefined;
		},
		systemPrompt: {
			context: (registered) => {
				offContexts.set(registered.name, registered);
				return () => undefined;
			},
		},
		commands: { register: () => undefined },
	};
	apply(off, { ...RAW_CONFIG, handoffEnabled: false });
	offHandlers.get("session/event")[0](offSession, { type: "turn/end", seq: 1 });
	await settle();
	await settle();
	assert.equal(offContexts.get("handoff-pressure").text({ agent: { session: offSession } }), "");
	assert.equal(routeFailureOf(String(offSession.id)), undefined, "a disabled trigger must not record a failure");

	clearHandoffPressure(String(session.id));
	clearHandoffPressure(String(offSession.id));
});
