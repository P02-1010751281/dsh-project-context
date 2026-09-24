/**
 * Tests for the autolearn pass: the project-persisted gate (and its restart
 * behaviour), the accumulated-turn reset, the existing-skill inventory in the
 * prompt, evidence verification against the archive on disk, the adaptive output
 * budget, and the project-local state store.
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import { statSync, utimesSync } from "node:fs";
import { mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { apply as applyAutolearn } from "../lib/autolearn.js";
import { autolearnProjectSkills } from "../lib/shared/autolearn.js";
import { adaptiveOutputTokens } from "../lib/shared/learn.js";
import { REPLY_OUTPUT_MARGIN_TOKENS } from "../lib/shared/learn.js";
import { resolvePluginConfig } from "../lib/shared/config.js";
import { learnStateFile, readLearnState, updateLearnState } from "../lib/shared/learn-state.js";
import {
	MAX_SKILL_BODY_CHARS,
	contextFile,
	logsDir,
	memoryFile,
	readOptional,
	sessionIndexFile,
	skillsDir,
} from "../lib/shared/project-state.js";

/** Comfortably above MIN_SKILL_BODY_CHARS (160) and below MAX_SKILL_BODY_CHARS. */
const BODY = [
	"## When to use",
	"Use this when the fixture project must yield a body long enough to pass the minimum-size gate.",
	"",
	"## Steps",
	"1. Run `pnpm build`.",
	"2. Run `pnpm test` and read the reported counts.",
	"3. Record the outcome in the project memory.",
	"",
].join("\n");

/** One archived session log with a user and an assistant message. */
function sessionLog(id) {
	return [
		JSON.stringify({
			type: "user/message",
			data: { source: { kind: "user" }, content: [{ type: "text", text: `for ${id}: run the release checklist` }] },
		}),
		JSON.stringify({
			type: "assistant/message",
			data: { message: { content: [{ type: "text", text: `for ${id}: pnpm build, then pnpm test` }] } },
		}),
		"",
	].join("\n");
}

/**
 * A throwaway project root with memory, context, an optional index, optional
 * archived session logs, and optional existing skills.
 */
async function project({ skills = [], sessions = [], index = [] } = {}) {
	const root = await mkdtemp(path.join(tmpdir(), "dsh-autolearn-"));
	await mkdir(path.join(root, ".agents", "memory"), { recursive: true });
	await writeFile(memoryFile(root), "# Project Memory\n\n- keep the suite green\n");
	await writeFile(contextFile(root), "# Project Context\n\nLast updated: 2026-09-13\n");
	for (const id of sessions) {
		await mkdir(path.join(logsDir(root), id), { recursive: true });
		await writeFile(path.join(logsDir(root), id, "session.jsonl"), sessionLog(id));
	}
	if (index.length > 0) {
		await mkdir(logsDir(root), { recursive: true });
		const lines = index.map((id) => `- [${id}](${id}/session.md) — 2026-09-13 — Fixture ${id}`);
		await writeFile(sessionIndexFile(root), ["# Session Index", "", ...lines, ""].join("\n"));
	}
	for (const skill of skills) {
		await mkdir(path.join(skillsDir(root), skill.name), { recursive: true });
		await writeFile(path.join(skillsDir(root), skill.name, "SKILL.md"), `---\nname: ${skill.name}\ndescription: ${JSON.stringify(skill.description)}\n---\n\n${skill.body ?? "Existing body."}\n`);
	}
	return root;
}

/** A minimal Agent stand-in: routing, session id, cwd, and human turns. */
function fakeAgent(cwd, { id = "session-current", turns = 2 } = {}) {
	const events = Array.from({ length: turns }, (_, index) => ({
		type: "user/message",
		data: { source: { kind: "user" }, content: [{ type: "text", text: `turn ${index + 1}` }] },
	}));
	return {
		options: { provider: "test-provider", model: "test-model" },
		session: {
			id,
			header: { cwd, createdAt: Date.now() },
			snapshotEvents: () => events,
			requestHeader: () => undefined,
		},
	};
}

/** A minimal Context stand-in that records every model call and replays canned replies. */
function fakeContext(replies, { modelLimit } = {}) {
	const calls = [];
	return {
		calls,
		logger: { info() {}, warn() {} },
		llm: {
			async resolveModelInfo() {
				if (modelLimit === undefined) throw new Error("no model catalog");
				return { provider: "test-provider", id: "test-model", name: "test-model", defaultMaxTokens: modelLimit };
			},
			stream(options) {
				const reply = replies[calls.length];
				calls.push(options);
				const text = typeof reply === "function" ? reply(options) : (reply ?? '{"skill": null}');
				return (async function* generate() {
					yield { type: "text-delta", text };
				})();
			},
		},
	};
}

/** The visible text of one recorded plugin model call. */
function promptOf(call) {
	return call.messages[0].content.map((block) => block.text ?? "").join("\n");
}

/** A future mtime, so "new material" is unambiguous at millisecond resolution. */
function future() {
	return new Date(Date.now() + 3_600_000);
}

test("the gate timestamp survives a restart and new material re-opens it", async () => {
	const root = await project({ sessions: ["session-a"] });
	const config = resolvePluginConfig({ autolearnTurns: 1, autolearnIntervalMs: 60 * 60 * 1000 });
	const agent = fakeAgent(root, { turns: 3 });

	const first = fakeContext(['{"skill": null}']);
	assert.deepEqual(await autolearnProjectSkills(first, agent, config), { skill: null, backtracked: [], candidate: false });
	assert.equal(first.calls.length, 1);
	assert.ok((await readLearnState(root)).autolearnAt > 0);

	// A restart forgets the in-process throttle, but not the project-persisted gate:
	// an empty throttle takes a fresh module instance, exactly like a new process.
	const restarted = await import("../lib/shared/autolearn.js?restart=1");
	const second = fakeContext(['{"skill": null}']);
	assert.equal(await restarted.autolearnProjectSkills(second, agent, config), undefined);
	assert.equal(second.calls.length, 0);

	// Touching MEMORY.md after the recorded gate is new material, so the pass re-opens.
	const stamp = future();
	await utimes(memoryFile(root), stamp, stamp);
	const third = fakeContext(['{"skill": null}']);
	assert.deepEqual(await restarted.autolearnProjectSkills(third, agent, config), { skill: null, backtracked: [], candidate: false });
	assert.equal(third.calls.length, 1);

	// The gate is the newer of the two artifacts: touching CONTEXT.md alone re-opens it too. The
	// turn counter restarted at the previous recorded pass, so this needs a fresh accumulation.
	const contextStamp = new Date(stamp.getTime() + 60_000);
	await utimes(contextFile(root), contextStamp, contextStamp);
	const fourth = fakeContext(['{"skill": null}']);
	assert.deepEqual(await restarted.autolearnProjectSkills(fourth, fakeAgent(root, { turns: 6 }), config), { skill: null, backtracked: [], candidate: false });
	assert.equal(fourth.calls.length, 1);
});

test("a recorded pass resets the accumulated turn counter", async () => {
	const root = await project({ sessions: ["session-a"] });
	const config = resolvePluginConfig({ autolearnTurns: 3, autolearnIntervalMs: 60 * 60 * 1000 });
	const agent = fakeAgent(root, { turns: 3 });
	const ctx = fakeContext(['{"skill": null}']);

	assert.deepEqual(await autolearnProjectSkills(ctx, agent, config), { skill: null, backtracked: [], candidate: false });
	assert.equal(ctx.calls.length, 1);

	// New material opens the material gate, but the counter restarted at zero, so the
	// turn cadence is still closed and no second pass runs.
	const stamp = future();
	await utimes(memoryFile(root), stamp, stamp);
	assert.equal(await autolearnProjectSkills(ctx, agent, config), undefined);
	assert.equal(ctx.calls.length, 1);
});

test("the prompt carries the project skill inventory and a reuse is rejected", async () => {
	const root = await project({
		skills: [{ name: "release-checklist", description: "How to cut a release" }],
		sessions: ["session-a", "session-b"],
		index: ["session-a", "session-b"],
	});
	const config = resolvePluginConfig({ autolearnTurns: 1 });
	const proposal = JSON.stringify({
		skill: { name: "release-checklist", description: "duplicate", body: BODY, evidence: ["session-a", "session-b"] },
	});
	const ctx = fakeContext([proposal]);

	const outcome = await autolearnProjectSkills(ctx, fakeAgent(root, { turns: 2 }), config);
	assert.match(promptOf(ctx.calls[0]), /<existing-skills>\n- release-checklist: How to cut a release\n<\/existing-skills>/);
	// The proposal was refused by an admission rule, so the outcome now names which one instead of
	// reading exactly like "the model proposed nothing".
	assert.deepEqual(outcome, { skill: null, backtracked: [], candidate: false, rejected: 'skill "release-checklist" already exists' });
	// The existing skill was left untouched instead of being overwritten.
	assert.match(await readFile(path.join(skillsDir(root), "release-checklist", "SKILL.md"), "utf8"), /description: "How to cut a release"/);
});

test("evidence ids without an archive on disk are dropped", async () => {
	const root = await project({ sessions: ["session-a"], index: ["session-a"] });
	const config = resolvePluginConfig({ autolearnTurns: 1 });
	const backtracked = JSON.stringify({
		skill: { name: "ghost-steps", description: "hallucinated", body: BODY, evidence: ["hallucinated-id"] },
	});
	const ctx = fakeContext(['{"skill": null, "need_sessions": ["session-a", "hallucinated-id"]}', backtracked]);

	const outcome = await autolearnProjectSkills(ctx, fakeAgent(root, { turns: 2 }), config);
	assert.equal(ctx.calls.length, 2);
	const backtrackPrompt = promptOf(ctx.calls[1]);
	assert.match(backtrackPrompt, /## session session-a/);
	assert.match(backtrackPrompt, /untrusted data/);
	assert.doesNotMatch(backtrackPrompt, /hallucinated-id/);
	// The one surviving log cannot ground a normal skill, and the invented citation is
	// not evidence, so nothing is written — and the outcome now says which rule refused it.
	assert.deepEqual(outcome, { skill: null, backtracked: ["session-a"], candidate: false, rejected: "needs evidence from at least two different sessions" });
	assert.equal(await readOptional(path.join(skillsDir(root), "ghost-steps", "SKILL.md")), "");
});

test("all requested ids missing behaves like no evidence", async () => {
	// The index claims both sessions; neither has a log on disk, and only an unrelated
	// session is archived, so the pass still runs and the model asks for the ghosts.
	const root = await project({ sessions: ["session-a"], index: ["ghost-a", "ghost-b"] });
	const config = resolvePluginConfig({ autolearnTurns: 1 });
	const ctx = fakeContext(['{"skill": null, "need_sessions": ["ghost-a", "ghost-b"]}']);

	const outcome = await autolearnProjectSkills(ctx, fakeAgent(root, { turns: 2 }), config);
	assert.equal(ctx.calls.length, 1);
	assert.deepEqual(outcome, { skill: null, backtracked: [], candidate: false });
});

test("an indexed id whose log is gone does not count as verified evidence", async () => {
	// Both ids are indexed, but no session.jsonl exists for either one: an index line
	// is a claim about a session, not the evidence a citation needs. A real unrelated
	// archive keeps the pass running so the filter itself is what the test exercises.
	const root = await project({ sessions: ["session-a"], index: ["ghost-a", "ghost-b"] });
	const config = resolvePluginConfig({ autolearnTurns: 1 });
	const ctx = fakeContext([
		JSON.stringify({ skill: { name: "ghost-steps", description: "unverifiable", body: BODY, evidence: ["ghost-a", "ghost-b"] } }),
	]);

	const outcome = await autolearnProjectSkills(ctx, fakeAgent(root, { turns: 2 }), config);
	assert.equal(ctx.calls.length, 1);
	assert.deepEqual(outcome, { skill: null, backtracked: [], candidate: false, rejected: "needs evidence from at least two different sessions" });
	assert.equal(await readOptional(path.join(skillsDir(root), "ghost-steps", "SKILL.md")), "");
});

test("a skill citing two verified sessions is written", async () => {
	const root = await project({ sessions: ["session-a", "session-b"], index: ["session-a", "session-b"] });
	const config = resolvePluginConfig({ autolearnTurns: 1 });
	const ctx = fakeContext([
		JSON.stringify({ skill: { name: "release-steps", description: "cut a release", body: BODY, evidence: ["session-a", "session-b"] } }),
	]);

	const outcome = await autolearnProjectSkills(ctx, fakeAgent(root, { turns: 2 }), config);
	assert.equal(outcome?.skill?.name, "release-steps");
	assert.equal(outcome?.candidate, false);
	assert.deepEqual(outcome?.backtracked, []);
	assert.match(await readFile(path.join(skillsDir(root), "release-steps", "SKILL.md"), "utf8"), /^---\nname: release-steps\n/);
});

test("the adaptive output cap is raised to fit, bounded by the model and by maxOutputTokens", () => {
	const needed = MAX_SKILL_BODY_CHARS + REPLY_OUTPUT_MARGIN_TOKENS;
	assert.equal(needed, 21_024);
	// Raised to fit a full-size body when the model publishes no limit.
	assert.equal(adaptiveOutputTokens(8192, needed, {}, 32_768), needed);
	// Bounded by the model's own output limit.
	assert.equal(adaptiveOutputTokens(8192, needed, { maxTokens: 16_000 }, 32_768), 16_000);
	// Bounded by the configured ceiling, which caps how far the request may grow.
	assert.equal(adaptiveOutputTokens(8192, needed, { maxTokens: 100_000 }, 12_000), 12_000);
	// The ceiling is a growth bound, not an absolute cap (pi rule): it never forces the request
	// below the configured starting budget, so a smaller ceiling loses to `maxTokens`.
	assert.equal(adaptiveOutputTokens(8192, 100, { maxTokens: 100_000 }, 4_000), 8192);
	// Never lowered below the configured cap for a request that needs less, and an unusable limit
	// is ignored.
	assert.equal(adaptiveOutputTokens(8192, 100, {}, 32_768), 8192);
	assert.equal(adaptiveOutputTokens(8192, 100, { maxTokens: 0 }, 32_768), 8192);
});

test("both autolearn calls use the adaptive output budget", async () => {
	const config = resolvePluginConfig({ autolearnTurns: 1, maxTokens: 8192 });
	const replies = ['{"skill": null, "need_sessions": ["session-a"]}', '{"skill": null}'];

	// With a published model limit the cap is the model's own limit.
	const limited = await project({ sessions: ["session-a"], index: ["session-a"] });
	const limitedCtx = fakeContext(replies, { modelLimit: 16_000 });
	await autolearnProjectSkills(limitedCtx, fakeAgent(limited, { turns: 2 }), config);
	assert.equal(limitedCtx.calls.length, 2);
	assert.deepEqual(limitedCtx.calls.map((call) => call.maxTokens), [16_000, 16_000]);

	// Without one the pass asks for the full body budget.
	const open = await project({ sessions: ["session-a"], index: ["session-a"] });
	const openCtx = fakeContext(replies);
	await autolearnProjectSkills(openCtx, fakeAgent(open, { turns: 2 }), config);
	assert.deepEqual(openCtx.calls.map((call) => call.maxTokens), [21_024, 21_024]);
});

test("the learn state file round-trips, and a corrupt file reads as never-ran", async () => {
	const root = await project();
	const file = learnStateFile(root);
	assert.equal(file, path.join(root, ".agents", "memory", "autolearn-state.json"));
	assert.deepEqual(await readLearnState(root), { autolearnAt: 0, lastAttemptAt: 0 });

	const at = 1_700_000_000_000;
	const attemptedAt = 1_700_000_012_345;
	assert.deepEqual(await updateLearnState(root, { autolearnAt: at, lastAttemptAt: attemptedAt }), { autolearnAt: at, lastAttemptAt: attemptedAt });
	assert.deepEqual(await readLearnState(root), { autolearnAt: at, lastAttemptAt: attemptedAt });
	assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { autolearnAt: at, lastAttemptAt: attemptedAt });
	// A patch without the fields keeps the recorded values, and a fractional material stamp (a file
	// mtime) survives the JSON round-trip exactly — rounding it would re-open the gate every idle.
	const fraction = at + 0.4795;
	assert.deepEqual(await updateLearnState(root, { autolearnAt: fraction }), { autolearnAt: fraction, lastAttemptAt: attemptedAt });
	assert.equal((await readLearnState(root)).autolearnAt, fraction);

	// Corrupt and unusable values read as "never ran" instead of throwing, and the next
	// write replaces them with valid JSON.
	for (const bad of ["{not json", JSON.stringify({ autolearnAt: "soon" }), JSON.stringify([1, 2])]) {
		await writeFile(file, bad);
		assert.deepEqual(await readLearnState(root), { autolearnAt: 0, lastAttemptAt: 0 });
	}
	assert.deepEqual(await updateLearnState(root, { autolearnAt: at + 1 }), { autolearnAt: at + 1, lastAttemptAt: 0 });
	assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { autolearnAt: at + 1, lastAttemptAt: 0 });
});

test("a corrupt state file does not lose the pass", async () => {
	const root = await project({ sessions: ["session-a"] });
	await writeFile(learnStateFile(root), "garbage{");
	const config = resolvePluginConfig({ autolearnTurns: 1 });
	const ctx = fakeContext(['{"skill": null}']);

	assert.deepEqual(await autolearnProjectSkills(ctx, fakeAgent(root, { turns: 2 }), config), { skill: null, backtracked: [], candidate: false });
	assert.equal(ctx.calls.length, 1);
	assert.ok((await readLearnState(root)).autolearnAt > 0);
});

test("a failed pass backs off until new material appears", async () => {
	const root = await project({ sessions: ["session-a"] });
	// An old persisted gate opens the interval gate while few turns keep the turn gate
	// closed, so the retry decision rests on the material check alone.
	await updateLearnState(root, { autolearnAt: Date.now() - 2 * 60 * 60 * 1000 });
	const config = resolvePluginConfig({ autolearnTurns: 5, autolearnIntervalMs: 60 * 60 * 1000 });
	const ctx = fakeContext([() => {
		throw new Error("model offline");
	}]);

	// The pass fails (the wrapper logs and reports undefined) after one model call.
	assert.equal(await autolearnProjectSkills(ctx, fakeAgent(root, { turns: 2 }), config), undefined);
	assert.equal(ctx.calls.length, 1);

	// New material alone must not retry immediately: the failed attempt backs off.
	const stamp = future();
	await utimes(memoryFile(root), stamp, stamp);
	assert.equal(await autolearnProjectSkills(ctx, fakeAgent(root, { turns: 2 }), config), undefined);
	assert.equal(ctx.calls.length, 1);
});

test("a project with no memory or context reports the skip, not a claim about the model", async () => {
	// The second skip path: nothing to learn from, so no model call is made. It must carry its own
	// reason — otherwise the reply falls through to "the model's answer contained no usable skill",
	// which asserts something about a model that was never asked. Only this and the dedupe/archive
	// reasons make `skipped` exhaustive for `/autolearn`; the archive path has its own test above.
	const root = await project({ sessions: ["session-a"] });
	await writeFile(memoryFile(root), "");
	await writeFile(contextFile(root), "");
	const config = resolvePluginConfig({ autolearnTurns: 1, provider: "test-provider", model: "test-model" });
	const ctx = fakeContext(['{"skill": {"name": "x", "description": "y", "body": "z".repeat(200)}}']);
	const outcome = await autolearnProjectSkills(ctx, fakeAgent(root, { turns: 2, id: "session-empty-material" }), config);
	assert.equal(ctx.calls.length, 0, "no model call is spent on a project with nothing to learn from");
	assert.deepEqual(outcome, {
		skill: null, backtracked: [], candidate: false,
		skipped: "the project has no memory or context to learn from; no model call was made",
	});

	const handlers = new Map();
	const commandCtx = {
		effect: (callback) => callback(),
		inject: (_deps, callback) => callback({ settings: { installSection: () => undefined } }),
		on: (type, handler) => { handlers.set(type, handler); },
		commands: { register: (command) => handlers.set("command", command) },
		logger: { info() {}, warn() {} },
		llm: {
			resolveModelInfo: async () => ({ provider: "test-provider", id: "test-model", name: "test-model" }),
			stream: () => (async function* generate() { yield { type: "text-delta", text: "{}" }; })(),
		},
	};
	applyAutolearn(commandCtx, config);
	const commandRoot = await project({ sessions: ["session-a"] });
	await writeFile(memoryFile(commandRoot), "");
	await writeFile(contextFile(commandRoot), "");
	const reply = await handlers.get("command").handler({ agent: fakeAgent(commandRoot, { turns: 2, id: "session-empty-cmd" }), rawInput: "", signal: new AbortController().signal });
	assert.match(reply.text, /No skill was considered: the project has no memory or context/, `reply hid the skip: ${reply.text}`);
	assert.doesNotMatch(reply.text, /the model/, "a skipped pass must not make a claim about the model");
});

test("a project with no archive spends no model call", async () => {
	// A live skill needs two verified sessions and a candidate needs one, so with an empty archive
	// the pass cannot produce anything: it must not pay for a model call to find that out.
	const root = await project();
	const config = resolvePluginConfig({ autolearnTurns: 1 });
	const ctx = fakeContext(['{"skill": {"name": "x", "description": "y", "body": "z"}}']);
	assert.deepEqual(await autolearnProjectSkills(ctx, fakeAgent(root, { turns: 3 }), config), {
		skill: null, backtracked: [], candidate: false,
		skipped: "no archived session grounds a new skill; no model call was made",
	});
	assert.equal(ctx.calls.length, 0);
});

test("material written while a pass runs is not masked by the gate", async () => {
	const root = await project({ sessions: ["session-a"] });
	const config = resolvePluginConfig({ autolearnTurns: 1, autolearnIntervalMs: 60 * 60 * 1000 });
	// The model reply writes new memory, exactly like a consolidation pass finishing on the same
	// idle. The gate must record the material the pass actually distilled, not the clock, or that
	// write would count as already distilled until it happened to be written again.
	const ctx = fakeContext([() => {
		const now = new Date();
		utimesSync(memoryFile(root), now, now);
		return '{"skill": null}';
	}]);
	assert.deepEqual(await autolearnProjectSkills(ctx, fakeAgent(root, { turns: 3 }), config), { skill: null, backtracked: [], candidate: false });
	assert.equal(ctx.calls.length, 1);
	const gate = (await readLearnState(root)).autolearnAt;
	const written = statSync(memoryFile(root)).mtimeMs;
	assert.ok(gate < written, `the gate (${gate}) must predate material written during the pass (${written})`);

	await autolearnProjectSkills(ctx, fakeAgent(root, { turns: 6 }), config);
	assert.equal(ctx.calls.length, 2, "the newer material re-opens the pass");
});

test("a forced pass still runs in a project with no archive", async () => {
	// The skip is for the automatic path only: `/autolearn` is the user asking for the call, and it
	// must not be silently turned into a no-op just because no skill can be saved afterwards.
	const root = await project();
	const config = resolvePluginConfig({ autolearnTurns: 1 });
	const ctx = fakeContext(['{"skill": null}']);
	assert.deepEqual(await autolearnProjectSkills(ctx, fakeAgent(root, { turns: 2 }), config, { force: true }), { skill: null, backtracked: [], candidate: false });
	assert.equal(ctx.calls.length, 1);
});

test("the interval gate survives a restart instead of measuring from the material", async () => {
	const root = await project({ sessions: ["session-a"] });
	const config = resolvePluginConfig({ autolearnTurns: 5, autolearnIntervalMs: 60 * 60 * 1000 });
	// A pass ran a moment ago on material that was already an hour old when the gate was recorded:
	// new material exists, but the interval since the *attempt* is what must keep the gate closed.
	const written = new Date(Date.now() - 60 * 60 * 1000);
	await utimes(memoryFile(root), written, written);
	await utimes(contextFile(root), written, written);
	await updateLearnState(root, { autolearnAt: Date.now() - 2 * 60 * 60 * 1000, lastAttemptAt: Date.now() });

	const restarted = await import("../lib/shared/autolearn.js?interval=1");
	const ctx = fakeContext(['{"skill": null}']);
	assert.equal(await restarted.autolearnProjectSkills(ctx, fakeAgent(root, { turns: 2 }), config), undefined);
	assert.equal(ctx.calls.length, 0, "the recorded attempt time keeps the interval gate closed");
});

test("the autoLearn switch alone suppresses the automatic pass", async () => {
	// Every other gate is open here — one verified archive, new material, a due turn count — so the
	// switch is the only thing that can stop the pass. Without this the mutation "drop the switch
	// check" survives the suite while the plugin keeps spending model calls with autoLearn off.
	const root = await project({ sessions: ["session-a"] });
	const modelCalls = [];
	const handlers = new Map();
	const makeCtx = () => ({
		effect: (callback) => callback(),
		inject: (_deps, callback) => callback({ settings: { installSection: () => undefined } }),
		on: (type, handler) => { handlers.set(type, handler); },
		commands: { register: (command) => handlers.set("command", command) },
		logger: { info() {}, warn() {} },
		llm: {
			resolveModelInfo: async () => ({ provider: "test-provider", id: "test-model", name: "test-model" }),
			stream: () => {
				modelCalls.push(1);
				return (async function* generate() { yield { type: "text-delta", text: '{"skill": null}' }; })();
			},
		},
	});
	const settings = { autoLearn: false, autolearnTurns: 1, autolearnIntervalMs: 1000, provider: "test-provider", model: "test-model" };

	applyAutolearn(makeCtx(), resolvePluginConfig(settings));
	const off = fakeAgent(root, { turns: 5 });
	await handlers.get("agent/status")({ agent: off, status: "idle" });
	await handlers.get("session/flush")(off.session);
	assert.equal(modelCalls.length, 0, "autoLearn: false must not run a pass");

	// Positive control: the same project with the switch on does run one, so the assertion above
	// cannot pass merely because no pass can run at all.
	applyAutolearn(makeCtx(), resolvePluginConfig({ ...settings, autoLearn: true }));
	const on = fakeAgent(root, { turns: 5 });
	await handlers.get("agent/status")({ agent: on, status: "idle" });
	await handlers.get("session/flush")(on.session);
	assert.equal(modelCalls.length, 1, "the same event runs a pass once the switch is on");
});

test("a proposed skill the admission rules refuse is not reported as \"no skill was warranted\"", async () => {
	// The model returned a full, well-formed skill citing two verified archived sessions; the only
	// failing rule is the body-size minimum. `autolearnProjectSkills` used to collapse that into the
	// exact same `{skill: null, backtracked: [], candidate: false}` as "the model proposed nothing",
	// so `/autolearn` answered "No new skill was warranted." after a *paid* call that had in fact
	// produced a skill — sending the user to re-prompt a model that already answered.
	const root = await project({ sessions: ["session-a", "session-b"], index: ["session-a", "session-b"] });
	const config = resolvePluginConfig({ autolearnTurns: 1, provider: "test-provider", model: "test-model" });
	// Long enough to be a real skill rather than a placeholder, but under MIN_SKILL_BODY_CHARS (160).
	const shortBody = "## Steps\n\n1. Run `pnpm build`.\n2. Run `pnpm test`.\n";
	assert.ok(shortBody.length < 160 && shortBody.length > 16, `fixture body is ${shortBody.length} chars`);
	const proposal = JSON.stringify({
		skill: { name: "too-slim-steps", description: "a workflow", body: shortBody, evidence: ["session-a", "session-b"] },
	});
	const ctx = fakeContext([proposal]);

	const outcome = await autolearnProjectSkills(ctx, fakeAgent(root, { turns: 2 }), config);
	assert.equal(ctx.calls.length, 1, "the model really was called and really did answer");
	// The three fields alone no longer carry the distinction, which is exactly how the bug hid.
	assert.equal(outcome?.skill, null);
	assert.deepEqual(outcome?.backtracked, []);
	assert.equal(outcome?.candidate, false);
	assert.equal(outcome?.rejected, "body too short", "the refusal reason survives the outcome");
	assert.equal(await readOptional(path.join(skillsDir(root), "too-slim-steps", "SKILL.md")), "", "nothing was written");

	// The user-visible surface: the `/autolearn` command reply, driven through the real handler.
	const handlers = new Map();
	const commandCtx = {
		effect: (callback) => callback(),
		inject: (_deps, callback) => callback({ settings: { installSection: () => undefined } }),
		on: (type, handler) => { handlers.set(type, handler); },
		commands: { register: (command) => handlers.set("command", command) },
		logger: { info() {}, warn() {} },
		llm: {
			resolveModelInfo: async () => ({ provider: "test-provider", id: "test-model", name: "test-model" }),
			stream: () => (async function* generate() { yield { type: "text-delta", text: proposal }; })(),
		},
	};
	applyAutolearn(commandCtx, config);
	const commandRoot = await project({ sessions: ["session-a", "session-b"], index: ["session-a", "session-b"] });
	const reply = await handlers.get("command").handler({ agent: fakeAgent(commandRoot, { turns: 2, id: "session-reject-cmd" }), rawInput: "", signal: new AbortController().signal });
	assert.equal(reply.kind, "success");
	assert.match(reply.text, /Skill rejected: body too short/, `reply named the wrong cause: ${reply.text}`);
	assert.doesNotMatch(reply.text, /No new skill was warranted/, "a refusal must not be reported as the model proposing nothing");

	// The other half of the distinction: when the model genuinely proposes nothing, `rejected`
	// stays absent — otherwise the fix would just move the misattribution to the other branch.
	const silentRoot = await project({ sessions: ["session-a", "session-b"], index: ["session-a", "session-b"] });
	const silentCtx = fakeContext(['{"skill": null}']);
	const silentOutcome = await autolearnProjectSkills(silentCtx, fakeAgent(silentRoot, { turns: 2, id: "session-silent-direct" }), config);
	assert.equal(silentOutcome?.skill, null);
	assert.equal("rejected" in silentOutcome, false, "no proposal means no rejection reason, and no extra field");
	assert.deepEqual(silentOutcome, { skill: null, backtracked: [], candidate: false }, "a silent model keeps the historical shape");
});

test("a second /autolearn inside the dedupe window does not claim the model proposed nothing", async () => {
	// Pressing `/autolearn` twice inside `forceDedupeMs` (15 s by default) returns from the dedupe
	// branch *before* any model call. Reporting that as "the model proposed no skill" asserts
	// something false about a model that was never asked — the same class of misattribution this
	// change exists to remove, so the reply must name the skip instead.
	const config = resolvePluginConfig({ autolearnTurns: 1, provider: "test-provider", model: "test-model" });
	const handlers = new Map();
	let streams = 0;
	const commandCtx = {
		effect: (callback) => callback(),
		inject: (_deps, callback) => callback({ settings: { installSection: () => undefined } }),
		on: (type, handler) => { handlers.set(type, handler); },
		commands: { register: (command) => handlers.set("command", command) },
		logger: { info() {}, warn() {} },
		llm: {
			resolveModelInfo: async () => ({ provider: "test-provider", id: "test-model", name: "test-model" }),
			stream: () => { streams += 1; return (async function* generate() { yield { type: "text-delta", text: '{"skill": null}' }; })(); },
		},
	};
	applyAutolearn(commandCtx, config);
	const root = await project({ sessions: ["session-a", "session-b"], index: ["session-a", "session-b"] });
	const command = handlers.get("command");
	const agent = fakeAgent(root, { turns: 2, id: "session-dedupe" });
	const first = await command.handler({ agent, rawInput: "", signal: new AbortController().signal });
	const before = streams;
	const second = await command.handler({ agent, rawInput: "", signal: new AbortController().signal });

	assert.equal(before, 1, "the first press ran the model once");
	assert.equal(streams, 1, "the second press inside the dedupe window spends no model call");
	assert.match(first.text, /the model's answer contained no usable skill/, `first reply was dishonest: ${first.text}`);
	assert.equal(second.kind, "success");
	assert.match(second.text, /No skill was considered: a pass ran moments ago/, `reply hid the skip: ${second.text}`);
	assert.doesNotMatch(second.text, /the model/, "a skipped pass must not make a claim about the model");
	assert.doesNotMatch(second.text, /No new skill was warranted/);
});

test("a model answer with no usable skill says only what is verifiable", async () => {
	// The model *was* called and returned a payload the parser could not use (no string
	// `description`), so `skill` is null. That is not "the model proposed nothing" — the reply must
	// not assert what the model intended, only what came back.
	const root = await project({ sessions: ["session-a", "session-b"], index: ["session-a", "session-b"] });
	const config = resolvePluginConfig({ autolearnTurns: 1, provider: "test-provider", model: "test-model" });
	const ctx = fakeContext(['{"skill": {"name": "broken", "body": "' + "x".repeat(300) + '"}}']);
	const outcome = await autolearnProjectSkills(ctx, fakeAgent(root, { turns: 2, id: "session-unusable" }), config);
	assert.equal(ctx.calls.length, 1, "the model really was called");
	assert.equal(outcome?.skill, null);
	assert.equal("rejected" in outcome, false, "nothing was proposed to the admission rules, so there is no refusal reason");
	assert.equal("skipped" in outcome, false, "the pass did not skip the model either");

	const handlers = new Map();
	const commandCtx = {
		effect: (callback) => callback(),
		inject: (_deps, callback) => callback({ settings: { installSection: () => undefined } }),
		on: (type, handler) => { handlers.set(type, handler); },
		commands: { register: (command) => handlers.set("command", command) },
		logger: { info() {}, warn() {} },
		llm: {
			resolveModelInfo: async () => ({ provider: "test-provider", id: "test-model", name: "test-model" }),
			stream: () => (async function* generate() { yield { type: "text-delta", text: '{"skill": {"name": "broken", "body": "' + "x".repeat(300) + '"}}' }; })(),
		},
	};
	applyAutolearn(commandCtx, config);
	const reply = await handlers.get("command").handler({ agent: fakeAgent(await project({ sessions: ["session-a", "session-b"], index: ["session-a", "session-b"] }), { turns: 2, id: "session-unusable-cmd" }), rawInput: "", signal: new AbortController().signal });
	assert.equal(reply.kind, "success");
	assert.match(reply.text, /the model's answer contained no usable skill/, `reply was dishonest: ${reply.text}`);
	assert.doesNotMatch(reply.text, /proposed no skill/);
	assert.doesNotMatch(reply.text, /No new skill was warranted/);
});
