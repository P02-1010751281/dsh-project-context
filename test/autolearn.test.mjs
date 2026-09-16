/**
 * Tests for the autolearn pass: the project-persisted gate (and its restart
 * behaviour), the accumulated-turn reset, the existing-skill inventory in the
 * prompt, evidence verification against the archive on disk, the adaptive output
 * budget, and the project-local state store.
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { adaptiveOutputTokens, autolearnProjectSkills } from "../lib/shared/autolearn.js";
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
	const root = await project();
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
});

test("a recorded pass resets the accumulated turn counter", async () => {
	const root = await project();
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
	assert.deepEqual(outcome, { skill: null, backtracked: [], candidate: false });
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
	// not evidence, so nothing is written.
	assert.deepEqual(outcome, { skill: null, backtracked: ["session-a"], candidate: false });
	assert.equal(await readOptional(path.join(skillsDir(root), "ghost-steps", "SKILL.md")), "");
});

test("all requested ids missing behaves like no evidence", async () => {
	// The index claims both sessions; neither has a log on disk.
	const root = await project({ index: ["ghost-a", "ghost-b"] });
	const config = resolvePluginConfig({ autolearnTurns: 1 });
	const ctx = fakeContext(['{"skill": null, "need_sessions": ["ghost-a", "ghost-b"]}']);

	const outcome = await autolearnProjectSkills(ctx, fakeAgent(root, { turns: 2 }), config);
	assert.equal(ctx.calls.length, 1);
	assert.deepEqual(outcome, { skill: null, backtracked: [], candidate: false });
});

test("an indexed id whose log is gone does not count as verified evidence", async () => {
	// Both ids are indexed, but no session.jsonl exists for either one: an index line
	// is a claim about a session, not the evidence a citation needs.
	const root = await project({ index: ["ghost-a", "ghost-b"] });
	const config = resolvePluginConfig({ autolearnTurns: 1 });
	const ctx = fakeContext([
		JSON.stringify({ skill: { name: "ghost-steps", description: "unverifiable", body: BODY, evidence: ["ghost-a", "ghost-b"] } }),
	]);

	const outcome = await autolearnProjectSkills(ctx, fakeAgent(root, { turns: 2 }), config);
	assert.equal(ctx.calls.length, 1);
	assert.deepEqual(outcome, { skill: null, backtracked: [], candidate: false });
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
	assert.equal(adaptiveOutputTokens(8192, needed, undefined, 32_768), needed);
	// Bounded by the model's own output limit.
	assert.equal(adaptiveOutputTokens(8192, needed, 16_000, 32_768), 16_000);
	// Bounded by the configured ceiling.
	assert.equal(adaptiveOutputTokens(8192, needed, 100_000, 12_000), 12_000);
	// Never lowered below the configured cap, and an unusable limit is ignored.
	assert.equal(adaptiveOutputTokens(8192, 100, undefined, 32_768), 8192);
	assert.equal(adaptiveOutputTokens(8192, 100, 0, 32_768), 8192);
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
	assert.deepEqual(await readLearnState(root), { autolearnAt: 0 });

	const at = 1_700_000_000_000;
	assert.deepEqual(await updateLearnState(root, { autolearnAt: at }), { autolearnAt: at });
	assert.deepEqual(await readLearnState(root), { autolearnAt: at });
	assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { autolearnAt: at });
	// A patch without the field keeps the recorded value.
	assert.deepEqual(await updateLearnState(root, {}), { autolearnAt: at });

	// Corrupt and unusable values read as "never ran" instead of throwing, and the next
	// write replaces them with valid JSON.
	for (const bad of ["{not json", JSON.stringify({ autolearnAt: "soon" }), JSON.stringify([1, 2])]) {
		await writeFile(file, bad);
		assert.deepEqual(await readLearnState(root), { autolearnAt: 0 });
	}
	assert.deepEqual(await updateLearnState(root, { autolearnAt: at + 1 }), { autolearnAt: at + 1 });
	assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { autolearnAt: at + 1 });
});

test("a corrupt state file does not lose the pass", async () => {
	const root = await project();
	await writeFile(learnStateFile(root), "garbage{");
	const config = resolvePluginConfig({ autolearnTurns: 1 });
	const ctx = fakeContext(['{"skill": null}']);

	assert.deepEqual(await autolearnProjectSkills(ctx, fakeAgent(root, { turns: 2 }), config), { skill: null, backtracked: [], candidate: false });
	assert.equal(ctx.calls.length, 1);
	assert.ok((await readLearnState(root)).autolearnAt > 0);
});

test("a failed pass backs off until new material appears", async () => {
	const root = await project();
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
