#!/usr/bin/env node
/**
 * Batch S probe — the opencode auxiliary route: the request identity, and the checkpoint cycle
 * that identity creates unless the durability tracker is narrowed to the write phase.
 *
 * Read-only against the repo: imports the built `lib/` and writes only inside a throwaway root under
 * `$TMPDIR`. Run from anywhere:
 *
 *     node .agents/evidence/2026-10-11-batchS-aux-route/aux-route-probe.mjs
 *
 * Three claims, each decided by its own section:
 *
 * 1. **COMPOSITION** (drives the real `apply()` wiring): the plugin model call must name the live
 *    session. The fake adapter below inlines dsh's checkpoint policy verbatim — `session-checkpoint-policy`
 *    flushes the session the request names *before* the adapter is reached, and returns `next()`
 *    untouched when the request carries no identity — so the same section also answers the second half:
 *    once the identity is stamped, does that flush come back while the adapter is still parked, or is
 *    it parked behind the very call that issued it?
 * 2. **MECHANISM** (equivalent construction, reproducible at any tree state): the pre-fix wiring —
 *    the tracker holds the whole pass — built by hand on the real `SessionWorkTracker`. It shows the
 *    cycle directly: the flush stays pending until the pass is released. `FLUSH_WAIT_MS` is the only
 *    bound, so production would not hang but would stall 90 s per auxiliary call.
 * 3. **REGISTRATION** (drives the real exported `consolidateProject`): the pass must hand the tracker
 *    its write phase and nothing else — registered after the model call, resolving to the report.
 *
 * Exit codes: 0 = all three hold; 10 = the request carries no session identity (the reported
 * MissingSessionID); 11 = the checkpoint flush is parked behind the pass (the cycle); 12 = the pass
 * never reached its model call (fixture did not run); 1 = the equivalent-construction control
 * regressed. Only 0 is a pass; every other code must be read as what it says.
 */
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { apply: applyMemory, consolidateProject } = await import(path.join(ROOT, "lib/project-memory/index.js"));
const { apply: applyAutolearn } = await import(path.join(ROOT, "lib/project-autolearn/index.js"));
const { SessionWorkTracker, FLUSH_WAIT_MS } = await import(path.join(ROOT, "lib/shared/lifecycle.js"));
const { resolvePluginConfig } = await import(path.join(ROOT, "lib/shared/config.js"));
const { contextFile, memoryFile, logsDir, sessionIndexFile } = await import(path.join(ROOT, "lib/shared/project-state.js"));
const { learnStateFile } = await import(path.join(ROOT, "lib/project-autolearn/learn-state.js"));

/** Long enough to leave a trace on disk, so the composition section proves the pass really finished. */
const MEMORY_MARKER = "- batch-s probe wrote this";
const COMPLETE_REPLY = JSON.stringify({
	memory_markdown: `# Project Memory\n\n${MEMORY_MARKER}\n`,
	context: { title: "t", summary: "s", key_points: [], open_tasks: [] },
});

function deferred() {
	let resolve;
	const promise = new Promise((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolve to `undefined` unless `probe()` reports true within `ms`. */
async function within(ms, probe) {
	const deadline = Date.now() + ms;
	for (;;) {
		if (await probe()) return true;
		if (Date.now() >= deadline) return false;
		await sleep(5);
	}
}

/** A throwaway project both passes can run against. */
async function project(prefix, { sessions = [], index = [] } = {}) {
	const root = await mkdtemp(path.join(tmpdir(), prefix));
	await mkdir(path.join(root, ".agents", "memory"), { recursive: true });
	await writeFile(memoryFile(root), "# Project Memory\n\n- keep the suite green\n");
	await writeFile(contextFile(root), "# Project Context\n\nLast updated: 2026-09-13\n\n## Summary\n\nA fixture project.\n");
	for (const id of sessions) {
		await mkdir(path.join(logsDir(root), id), { recursive: true });
		await writeFile(
			path.join(logsDir(root), id, "session.jsonl"),
			`${JSON.stringify({ type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "run the release checklist" }] } })}\n`,
		);
	}
	if (index.length > 0) {
		await mkdir(logsDir(root), { recursive: true });
		await writeFile(sessionIndexFile(root), `# Session Index\n\n${index.map((id) => `- [${id}](${id}/session.md) — 2026-09-13 — Fixture ${id}`).join("\n")}\n`);
	}
	return root;
}

/** A minimal Agent stand-in with the shape both passes read. */
function fakeAgent(root, { id = "session-probe" } = {}) {
	const events = Array.from({ length: 3 }, (_, index) => ({
		type: "user/message",
		seq: index + 1,
		time: Date.now(),
		data: { source: { kind: "user" }, content: [{ type: "text", text: `turn ${index + 1}` }] },
	}));
	return {
		options: { provider: "test-provider", model: "test-model" },
		session: {
			id,
			header: { cwd: root, createdAt: Date.now() },
			snapshotEvents: () => events,
			ownEvents: () => events,
			deriveMessages: () => [
				{ role: "user", source: { kind: "user" }, content: [{ type: "text", text: "turn 1" }] },
				{ role: "assistant", source: { kind: "assistant" }, content: [{ type: "text", text: "done" }] },
			],
			requestHeader: () => undefined,
		},
	};
}

/**
 * Run one plugin's real `apply()` wiring against a parked adapter.
 *
 * The adapter below is the *whole* dispatch path this probe controls, and it inlines the one line of
 * dsh's checkpoint policy that matters:
 *
 *     ctx.on('llm/stream', (options, next) => {
 *       if (options.sessionId === undefined) return next()
 *       const session = ctx.sessions.get(options.sessionId)
 *       return session === undefined ? next() : afterCheckpoint(ctx, session, next)   // await ctx.sessions.flush(session)
 *     })
 *
 * `flushedBeforeDispatch` is therefore both the identity check (a request with no identity never
 * reaches the flush at all) and the cycle check (a flush that is parked behind the pass cannot set it).
 */
async function composition({ label, apply, config, sessions = [], index = [], writes, finished }) {
	const root = await project(`dsh-batchS-${label}-`, { sessions, index });
	const requests = [];
	const handlers = new Map();
	const on = (type, handler) => {
		(handlers.get(type) ?? handlers.set(type, []).get(type)).push(handler);
		return () => undefined;
	};
	const release = deferred();
	const live = new Map();
	let checkpointFlushes = 0;
	let flushedBeforeDispatch = false;
	const ctx = {
		logger: { info() {}, warn() {} },
		effect: (callback) => callback(),
		inject: (_deps, callback) => callback({ settings: { installSection: () => undefined } }),
		systemPrompt: { context: () => undefined },
		on,
		commands: { register: () => undefined },
		sessions: { get: (id) => live.get(String(id)) },
		llm: {
			resolveModelInfo: async () => ({ provider: "test-provider", id: "test-model", name: "test-model", context: { contextWindow: 200_000 }, defaultMaxTokens: 4096 }),
			stream(options) {
				requests.push(options);
				const session = options.sessionId === undefined ? undefined : live.get(String(options.sessionId));
				return (async function* generate() {
					if (session !== undefined) {
						checkpointFlushes += 1;
						for (const handler of handlers.get("session/flush") ?? []) await handler(session);
						flushedBeforeDispatch = true;
					}
					await release.promise;
					yield { type: "text-delta", text: COMPLETE_REPLY };
					yield { type: "finish", reason: { kind: "stop" } };
				})();
			},
		},
	};
	apply(ctx, config);
	const agent = fakeAgent(root, { id: `session-probe-${label}` });
	live.set(`session-probe-${label}`, agent.session);
	await handlers.get("agent/status")[0]({ agent, status: "idle" });
	const parked = await within(2_000, () => requests.length > 0);
	// While the adapter is parked, the checkpoint's flush has either already returned or it is the
	// pass's own caller: poll instead of awaiting, so a parked flush cannot hang this probe.
	const prompt = parked ? await within(300, () => flushedBeforeDispatch) : false;
	release.resolve();
	const settled = parked ? await within(5_000, () => finished(root)) : false;
	const request = requests[0];
	return {
		label,
		parked,
		sessionId: request === undefined ? "(no request)" : request.sessionId,
		checkpointFlushes,
		flushedBeforeDispatch: prompt,
		writes: await writes(root),
		settled,
	};
}

/** Section 1 — the real wiring, memory pass (the `/memory update` path that failed). */
async function memoryComposition() {
	return composition({
		label: "memory",
		apply: applyMemory,
		config: resolvePluginConfig({ consolidateTurns: 1, consolidateIntervalMs: 1000, provider: "test-provider", model: "test-model" }),
		writes: async (root) => (await readFile(memoryFile(root), "utf8")).includes(MEMORY_MARKER),
		finished: async (root) => (await readFile(memoryFile(root), "utf8")).includes(MEMORY_MARKER),
	});
}

/** Section 1 (second half) — the real wiring, autolearn pass: the same identity and the same flush. */
async function autolearnComposition() {
	return composition({
		label: "autolearn",
		apply: applyAutolearn,
		config: resolvePluginConfig({ autolearnTurns: 1, autolearnIntervalMs: 1000, provider: "test-provider", model: "test-model" }),
		sessions: ["session-archived"],
		index: ["session-archived"],
		writes: async (root) => {
			const state = await readFile(learnStateFile(root), "utf8").catch(() => "");
			return state.length > 0;
		},
		finished: async (root) => {
			const state = await readFile(learnStateFile(root), "utf8").catch(() => "");
			return state.length > 0;
		},
	});
}

/**
 * Section 2 — the cycle, built by hand on the real tracker with the pre-fix wiring (the tracker holds
 * the whole pass). Reproducible at any tree state on purpose: it is the mechanism, not the shipped
 * call site, and it must keep showing the stall after the shipped wiring is narrowed.
 */
async function cycleMechanism() {
	const session = { id: "session-wiring" };
	const tracker = new SessionWorkTracker();
	const release = deferred();
	let wrote = false;
	// Pre-fix: the registered span IS the pass, so it contains the model call the flush was issued by.
	const pass = (async () => {
		await release.promise;
		wrote = true;
	})();
	tracker.track(session, pass);
	const flush = tracker.flush(session);
	const whileParked = await Promise.race([flush.then(() => "returned"), sleep(300).then(() => "parked")]);
	release.resolve();
	await pass;
	const afterRelease = await Promise.race([flush.then(() => "returned"), sleep(300).then(() => "parked")]);
	return { whileParked, afterRelease, wrote };
}

/** Section 3 — the shipped registration: the tracker must be handed the write phase, not the pass. */
async function registrationShape() {
	const root = await project("dsh-batchS-register-");
	let inCall = false;
	let modelCalls = 0;
	const registrations = [];
	const ctx = {
		logger: { info() {}, warn() {} },
		systemPrompt: { context: () => undefined },
		on: () => () => undefined,
		commands: { register: () => undefined },
		llm: {
			resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
			stream: () =>
				(async function* generate() {
					modelCalls += 1;
					inCall = true;
					try {
						yield { type: "text-delta", text: COMPLETE_REPLY };
						yield { type: "finish", reason: { kind: "stop" } };
					} finally {
						inCall = false;
					}
				})(),
		},
	};
	const agent = fakeAgent(root, { id: "session-probe-register" });
	const report = await consolidateProject(ctx, resolvePluginConfig({ consolidateTurns: 1, provider: "test-provider", model: "test-model" }), agent, {
		force: true,
		silent: true,
		track: (work) => registrations.push({ inCall, modelCalls, work }),
	});
	await Promise.all(registrations.map((entry) => entry.work));
	return {
		registrations: registrations.length,
		registeredDuringCall: registrations.some((entry) => entry.inCall),
		registeredAfterFirstCall: registrations.every((entry) => entry.modelCalls >= 1),
		reportStatus: report.status,
	};
}

const memory = await memoryComposition();
const autolearn = await autolearnComposition();
const mechanism = await cycleMechanism();
const registration = await registrationShape();

console.log("== 1. composition (real apply() wiring, checkpoint policy inlined in the adapter)");
for (const result of [memory, autolearn]) {
	console.log(
		`   ${result.label}: parked=${result.parked} sessionId=${JSON.stringify(result.sessionId)} ` +
			`checkpointFlushes=${result.checkpointFlushes} flushReturnedBeforeDispatch=${result.flushedBeforeDispatch} ` +
			`passFinished=${result.settled} writeLanded=${result.writes}`,
	);
}
console.log("== 2. mechanism (equivalent construction: the pre-fix wiring on the real SessionWorkTracker)");
console.log(`   FLUSH_WAIT_MS=${FLUSH_WAIT_MS}; flush while the pass is parked: ${mechanism.whileParked}; after release: ${mechanism.afterRelease}; pass ran: ${mechanism.wrote}`);
console.log("== 3. registration (real consolidateProject with a track callback)");
console.log(`   registrations=${registration.registrations} registeredDuringCall=${registration.registeredDuringCall} registeredAfterFirstCall=${registration.registeredAfterFirstCall} report=${registration.reportStatus}`);

const identityMissing = [memory, autolearn].filter((result) => result.sessionId === undefined || result.sessionId === "(no request)");
const parked = [memory, autolearn].filter((result) => result.parked && result.checkpointFlushes > 0 && !result.flushedBeforeDispatch);
const notRun = [memory, autolearn].filter((result) => !result.parked || !result.settled);

let code = 0;
if (notRun.length > 0) {
	console.log(`RESULT: FAIL (${notRun.map((result) => result.label).join(", ")}: the pass never reached its model call or never finished — fixture did not run)`);
	code = 12;
} else if (identityMissing.length > 0) {
	console.log(`RESULT: FAIL (${identityMissing.map((result) => result.label).join(", ")}: the auxiliary request carries no session identity — opencode answers 400 MissingSessionID)`);
	code = 10;
} else if (parked.length > 0) {
	console.log(`RESULT: FAIL (${parked.map((result) => result.label).join(", ")}: the checkpoint flush this call issued is parked behind it; the only bound is FLUSH_WAIT_MS=${FLUSH_WAIT_MS})`);
	code = 11;
} else if (mechanism.whileParked !== "parked" || mechanism.afterRelease !== "returned" || !mechanism.wrote) {
	console.log("RESULT: FAIL (the equivalent-construction control did not reproduce the pre-fix wiring)");
	code = 1;
} else if (registration.registrations === 0 || registration.registeredDuringCall || !registration.registeredAfterFirstCall) {
	console.log("RESULT: FAIL (the pass did not hand the tracker a write phase registered outside every model call)");
	code = 11;
} else {
	console.log("RESULT: PASS (identity stamped, the checkpoint flush returns before dispatch, the tracker holds only the write phase)");
}
process.exit(code);
