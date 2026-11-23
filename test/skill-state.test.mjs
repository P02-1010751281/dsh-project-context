/**
 * Batch AA4: a learned skill gets a state, and one of those states has a transition.
 *
 * A promoted skill could only change by being replaced, so one that cited code which had been deleted
 * stayed active forever — injected into every prompt and still the target of memory pointers. These cases
 * pin the determination (five states from the files it cites) and the two refusals that make the automatic
 * transition safe: a hand-written skill is never touched, and a moved directory is not an expiry.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { apply as applyAutolearn } from "../lib/project-autolearn/index.js";
import { resolvePluginConfig } from "../lib/shared/config.js";
import { SKILL_SEVERITY, skillStateOf, skillStates, skillStatusReceipt } from "../lib/project-autolearn/skill-state.js";
import { bindSkills, expireSkill, measureSkillStates } from "../lib/project-autolearn/skill-state-source.js";

const MARKER = "<!-- autolearn-generated: this skill may be superseded by a later autolearn pass -->";

/** A skill document that carries the provenance marker and cites `paths`. */
function skillDoc(name, paths) {
	return `---\nname: ${name}\ndescription: "a learned skill"\n---\n\n${MARKER}\n\n# ${name}\n\nUse ${paths.map((file) => `\`${file}\``).join(" and ")}.\n`;
}

async function projectWith(skills, memory = "") {
	const root = await mkdtemp(path.join(tmpdir(), "dsh-skill-state-"));
	await mkdir(path.join(root, ".agents", "memory"), { recursive: true });
	await mkdir(path.join(root, ".agents", "skills"), { recursive: true });
	for (const [name, document] of Object.entries(skills)) {
		await mkdir(path.join(root, ".agents", "skills", name), { recursive: true });
		await writeFile(path.join(root, ".agents", "skills", name, "SKILL.md"), document, "utf8");
	}
	await writeFile(path.join(root, ".agents", "memory", "MEMORY.md"), memory, "utf8");
	return root;
}

const REFERENCED = "# Project Memory\n\n## Index\n- `.agents/skills/usable/SKILL.md` owns the procedure\n";

test("the five states are derived from what the skill cites, worst first in a receipt", () => {
	const facts = [
		{ name: "usable", bound: 2, changed: [], missing: [], moved: [], references: 1 },
		{ name: "no-baseline", bound: 0, bindable: 1, changed: [], missing: [], moved: [], references: 1 },
		{ name: "changed-file", bound: 1, changed: ["src/a.ts"], missing: [], moved: [], references: 1 },
		{ name: "gone-file", bound: 2, changed: [], missing: ["src/b.ts"], moved: [], references: 1 },
		{ name: "all-gone", bound: 1, changed: [], missing: ["src/c.ts"], moved: [], references: 1 },
		{ name: "unreferenced", bound: 1, changed: [], missing: [], moved: [], references: 0 },
	];
	const report = skillStates(facts);
	const byName = new Map(report.verdicts.map((verdict) => [verdict.name, verdict]));
	assert.equal(byName.get("usable").state, "intact");
	assert.equal(byName.get("no-baseline").state, "unbaselined");
	assert.equal(byName.get("changed-file").state, "drifted");
	assert.equal(byName.get("gone-file").state, "drifted", "a partial loss is drift, not expiry");
	assert.equal(byName.get("all-gone").state, "expired");
	assert.equal(byName.get("unreferenced").state, "orphan");
	assert.deepEqual(report.counts, { unbaselined: 1, expired: 1, moved: 0, drifted: 2, orphan: 1, intact: 1 });

	const receipt = skillStatusReceipt(report);
	const [first] = receipt.split("\n");
	assert.match(first, /^Learned skills: 6 skill\(s\) — 1 intact, 5 needing a look/, `payload on line one, got ${first}`);
	// The corpus denominator: a report of 18 learned skills out of 40 must say where the other 22 went.
	const scoped = skillStates(facts, { total: 40 });
	assert.equal(scoped.unmanaged, 34, "hand-written skills are counted, not silently dropped");
	// The denominator stays on the collapsed line; the hand-written split is its own line so the
	// `needing a look` count is not pushed past the client's clip.
	assert.match(skillStatusReceipt(scoped).split("\n")[0], /6 of 40 skill\(s\) — \d+ intact, \d+ needing a look/);
	assert.match(skillStatusReceipt(scoped), /^34 hand-written skill\(s\) are not managed/m);

	const order = receipt.split("\n").filter((line) => line.startsWith("  ")).map((line) => line.trim().split(" — ")[0]);
	// Consecutive duplicates collapsed: two `drifted` entries are one group in the order, not a repeat.
	const ranks = order.filter((state, index) => index === 0 || state !== order[index - 1]).map((state) => SKILL_SEVERITY.indexOf(state));
	assert.deepEqual(ranks, [...ranks].sort((left, right) => left - right), "worst first, in the declared order");
});

test("a whole directory that moved never counts as an expiry", () => {
	// Every citation is gone, but each vanished with its parent: that is a move, and retiring the skill
	// would delete knowledge that still exists somewhere else.
	const report = skillStates([{ name: "moved", bound: 1, changed: [], missing: ["src/old/a.ts"], moved: ["src/old/a.ts"], references: 1 }]);
	assert.equal(report.verdicts[0].state, "moved", "named separately: the remedy is a pointer rewrite, not a re-read");
	assert.match(report.verdicts[0].detail, /moved with its directory/);
});

test("the I/O half binds, drifts, expires and moves a skill out of service", async () => {
	const root = await projectWith({ usable: skillDoc("usable", ["src/a.ts"]) }, REFERENCED);
	await mkdir(path.join(root, "src"), { recursive: true });
	await writeFile(path.join(root, "src", "a.ts"), "one\n", "utf8");

	// Before any baseline, nothing can be judged: that is `unbaselined`, not `intact`.
	assert.equal((await measureSkillStates(root)).counts.unbaselined, 1);
	const bound = await bindSkills(root);
	assert.deepEqual(bound.bound, [{ name: "usable", paths: 1 }]);
	assert.deepEqual(bound.skipped, [], "a skill with a bindable path is never reported as unbindable");
	assert.equal((await measureSkillStates(root)).counts.intact, 1, "baselined, unchanged and referenced");

	await writeFile(path.join(root, "src", "a.ts"), "two\n", "utf8");
	assert.equal((await measureSkillStates(root)).counts.drifted, 1);

	// Deleting the file while its directory stays is the one case that counts as expiry.
	await rm(path.join(root, "src", "a.ts"));
	assert.equal((await measureSkillStates(root)).counts.expired, 1);
	const refused = await expireSkill(root, "usable");
	assert.equal(refused.status, "moved", "an expired skill is the one case the command moves");
	const raw = JSON.parse(await readFile(path.join(root, ".agents", "memory", "skill-bindings.json"), "utf8"));
	assert.deepEqual(raw.skills, {}, "the baseline of a moved skill is dropped");
	await assert.rejects(access(path.join(root, ".agents", "skills", "usable")));
	await access(path.join(root, ".agents", "memory", "expired-skills", "usable", "SKILL.md"));
});

test("a moved directory is reported, never expired by the command", async () => {
	const root = await projectWith({ mover: skillDoc("mover", ["src/old/a.ts"]) }, REFERENCED);
	await mkdir(path.join(root, "src", "old"), { recursive: true });
	await writeFile(path.join(root, "src", "old", "a.ts"), "one\n", "utf8");
	await bindSkills(root);
	await rm(path.join(root, "src", "old"), { recursive: true });
	// The parent is gone too, so this is a move: named, and the command refuses to act.
	assert.equal((await measureSkillStates(root)).counts.moved, 1);
	const outcome = await expireSkill(root, "mover");
	assert.equal(outcome.status, "not-expired");
	await access(path.join(root, ".agents", "skills", "mover", "SKILL.md"));
});

test("a hand-written skill is not part of the learned corpus", async () => {
	const handWritten = `---\nname: hand\ndescription: "mine"\n---\n\n# hand\n\nUse \`src/a.ts\`.\n`;
	const root = await projectWith({ hand: handWritten }, "");
	await mkdir(path.join(root, "src"), { recursive: true });
	await writeFile(path.join(root, "src", "a.ts"), "one\n", "utf8");
	assert.deepEqual((await bindSkills(root)).bound, [], "it is never bound");
	assert.equal((await measureSkillStates(root)).verdicts.length, 0, "and never judged");
	assert.equal((await expireSkill(root, "hand")).status, "no-such-skill");
});

test("the registered /autolearn command routes 'status' to the corpus report", async () => {
	const root = await projectWith({ usable: skillDoc("usable", ["src/a.ts"]) }, REFERENCED);
	await mkdir(path.join(root, "src"), { recursive: true });
	await writeFile(path.join(root, "src", "a.ts"), "one\n", "utf8");
	await bindSkills(root);

	let handler;
	applyAutolearn(
		{
			get: () => undefined,
			logger: { info() {}, warn() {} },
			effect: (callback) => callback(),
			on: () => () => undefined,
			commands: { register: (registration) => { if (registration.name === "autolearn") handler = registration.handler; } },
		},
		resolvePluginConfig({ provider: "test-provider", model: "test-model" }),
	);
	assert.equal(typeof handler, "function", "control: the plugin registered the autolearn command");

	const agent = { session: { header: { cwd: root, id: "session-current" } } };
	const receipt = await handler({ agent, rawInput: "status" });
	assert.equal(receipt.kind, "success", receipt.text);
	assert.match(receipt.text, /^Learned skills: 1 skill\(s\) — 1 intact/);
});

test("an idle agent moves an expired skill before the pass spends a model call", async () => {
	// The wiring, not the helper: the transition has to be reachable from the event the host fires, or a
	// green unit test proves only that the function works when nothing calls it.
	const root = await projectWith({ usable: skillDoc("usable", ["src/a.ts"]) }, REFERENCED);
	await mkdir(path.join(root, "src"), { recursive: true });
	await writeFile(path.join(root, "src", "a.ts"), "one\n", "utf8");
	await bindSkills(root);
	await rm(path.join(root, "src", "a.ts"));

	const handlers = new Map();
	applyAutolearn(
		{
			get: () => undefined,
			logger: { info() {}, warn() {} },
			effect: (callback) => callback(),
			on: (event, handler) => { handlers.set(event, handler); return () => undefined; },
			commands: { register: () => () => undefined },
		},
		resolvePluginConfig({ provider: "test-provider", model: "test-model", autolearnTurns: 1 }),
	);
	const onIdle = handlers.get("agent/status");
	assert.equal(typeof onIdle, "function", "control: the plugin listens for agent/status");
	onIdle({ agent: { session: { header: { cwd: root, id: "session-x" } } }, status: "idle" });

	// The move happens before the model call, so a host with no `llm` still performs it; the pass itself
	// fails afterwards and is logged, which is not what this case is about.
	for (let i = 0; i < 100; i += 1) {
		const gone = await access(path.join(root, ".agents", "skills", "usable")).then(() => false).catch(() => true);
		if (gone) break;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	await assert.rejects(access(path.join(root, ".agents", "skills", "usable")), "the expired skill left the harness's view");
	await access(path.join(root, ".agents", "memory", "expired-skills", "usable", "SKILL.md"));
});

test("an unbindable skill is told apart from one nobody bound", () => {
	// The same state, two different facts: one is waiting for a `bind`, the other can never have a
	// baseline. Printing one sentence for both makes the second look like the first forever.
	const never = skillStateOf({ name: "never", bound: 0, bindable: 2, changed: [], missing: [], moved: [], references: 1 });
	const cannot = skillStateOf({ name: "cannot", bound: 0, bindable: 0, changed: [], missing: [], moved: [], references: 1 });
	assert.equal(never.state, "unbaselined");
	assert.equal(cannot.state, "unbaselined");
	assert.match(never.detail, /no fingerprint was recorded/);
	assert.match(cannot.detail, /nothing bindable/);
	assert.notEqual(never.detail, cannot.detail, "the two reasons must not collapse into one sentence");
});

test("a skill with nothing bindable is named by bind, and the status says why", async () => {
	const root = await projectWith({ buildonly: skillDoc("buildonly", ["lib/client.js"]) }, "");
	await mkdir(path.join(root, "lib"), { recursive: true });
	await writeFile(path.join(root, "lib", "client.js"), "x\n", "utf8");

	const report = await bindSkills(root);
	assert.deepEqual(report.bound, [], "a build output is never fingerprinted: the next build would call it drift");
	assert.deepEqual(report.skipped, ["buildonly"], "so bind names it instead of silently doing nothing");

	const states = await measureSkillStates(root);
	assert.equal(states.counts.unbaselined, 1);
	assert.match(states.verdicts[0].detail, /nothing bindable/);
});

test("the bind receipt carries the skills no baseline can cover", async () => {
	const root = await projectWith({ buildonly: skillDoc("buildonly", ["lib/client.js"]) }, "");
	await mkdir(path.join(root, "lib"), { recursive: true });
	await writeFile(path.join(root, "lib", "client.js"), "x\n", "utf8");
	let handler;
	applyAutolearn(
		{
			get: () => undefined,
			logger: { info() {}, warn() {} },
			effect: (callback) => callback(),
			on: () => () => undefined,
			commands: { register: (registration) => { if (registration.name === "autolearn") handler = registration.handler; } },
		},
		resolvePluginConfig({ provider: "test-provider", model: "test-model" }),
	);
	const receipt = await handler({ agent: { session: { header: { cwd: root, id: "session-current" } } }, rawInput: "bind" });
	assert.equal(receipt.kind, "success", receipt.text);
	assert.match(receipt.text, /1 skill\(s\) have no bindable path/);
	assert.match(receipt.text, /buildonly/);
});

test("the expiry switch is independent of the distillation switch", async () => {
	// Pass off, expiry on: the move still happens, because the switch that owns it is on.
	const moved = await projectWith({ usable: skillDoc("usable", ["src/a.ts"]) }, REFERENCED);
	await mkdir(path.join(moved, "src"), { recursive: true });
	await writeFile(path.join(moved, "src", "a.ts"), "one\n", "utf8");
	await bindSkills(moved);
	await rm(path.join(moved, "src", "a.ts"));
	const idle = new Map();
	applyAutolearn(
		{
			get: () => undefined,
			logger: { info() {}, warn() {} },
			effect: (callback) => callback(),
			on: (event, handler) => { idle.set(event, handler); return () => undefined; },
			commands: { register: () => () => undefined },
		},
		resolvePluginConfig({ provider: "test-provider", model: "test-model", autolearnEnabled: false, autolearnExpireSkills: true }),
	);
	idle.get("agent/status")({ agent: { session: { header: { cwd: moved, id: "session-off" } } }, status: "idle" });
	for (let i = 0; i < 100; i += 1) {
		const gone = await access(path.join(moved, ".agents", "skills", "usable")).then(() => false).catch(() => true);
		if (gone) break;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	await assert.rejects(access(path.join(moved, ".agents", "skills", "usable")), "the pass being off does not keep an expired skill in view");

	// Expiry off: the same setup keeps the skill, because the switch that owns the move is off.
	const kept = await projectWith({ usable: skillDoc("usable", ["src/a.ts"]) }, REFERENCED);
	await mkdir(path.join(kept, "src"), { recursive: true });
	await writeFile(path.join(kept, "src", "a.ts"), "one\n", "utf8");
	await bindSkills(kept);
	await rm(path.join(kept, "src", "a.ts"));
	const handlers = new Map();
	applyAutolearn(
		{
			get: () => undefined,
			logger: { info() {}, warn() {} },
			effect: (callback) => callback(),
			on: (event, handler) => { handlers.set(event, handler); return () => undefined; },
			commands: { register: () => () => undefined },
		},
		resolvePluginConfig({ provider: "test-provider", model: "test-model", autolearnEnabled: false, autolearnExpireSkills: false }),
	);
	handlers.get("agent/status")({ agent: { session: { header: { cwd: kept, id: "session-expiry-off" } } }, status: "idle" });
	await new Promise((resolve) => setTimeout(resolve, 200));
	await access(path.join(kept, ".agents", "skills", "usable"));

	// Pass on, expiry off: the pass still runs (and fails for want of a model) but must not move the
	// skill. Without this case the gate inside the pass is never exercised: every other case has it on.
	const passOnly = await projectWith({ usable: skillDoc("usable", ["src/a.ts"]) }, REFERENCED);
	await mkdir(path.join(passOnly, "src"), { recursive: true });
	await writeFile(path.join(passOnly, "src", "a.ts"), "one\n", "utf8");
	await bindSkills(passOnly);
	await rm(path.join(passOnly, "src", "a.ts"));
	const passHandlers = new Map();
	applyAutolearn(
		{
			get: () => undefined,
			logger: { info() {}, warn() {} },
			effect: (callback) => callback(),
			on: (event, handler) => { passHandlers.set(event, handler); return () => undefined; },
			commands: { register: () => () => undefined },
		},
		resolvePluginConfig({ provider: "test-provider", model: "test-model", autolearnEnabled: true, autolearnExpireSkills: false }),
	);
	passHandlers.get("agent/status")({ agent: { session: { header: { cwd: passOnly, id: "session-pass-only" } } }, status: "idle" });
	await new Promise((resolve) => setTimeout(resolve, 300));
	await access(path.join(passOnly, ".agents", "skills", "usable"));
});
