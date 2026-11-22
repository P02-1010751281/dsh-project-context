/**
 * The core/host boundary must fail closed.
 *
 * The pass direction is the repository; the fail directions are malformed fixtures, because a gate
 * that only prints "0 failures" proves nothing. Each fixture violates exactly one rule.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const SCRIPT = path.resolve("scripts/check-boundary.mjs");

function run(root) {
	return spawnSync(process.execPath, [SCRIPT, "--root", root], { encoding: "utf8" });
}

async function fixture(files) {
	const root = await mkdtemp(path.join(tmpdir(), "dsh-boundary-"));
	for (const [name, body] of Object.entries(files)) {
		const target = path.join(root, name);
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, body, "utf8");
	}
	return root;
}

test("the repository respects the core/host boundary", () => {
	const result = run(process.cwd());
	assert.equal(result.stderr, "", result.stderr);
	assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("a core module naming a host package fails", async () => {
	const root = await fixture({
		"src/project-x/work.ts": 'import type { Session } from "@deepseek-ai/dsh-session";\nexport type S = Session;\n',
	});
	const result = run(root);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /FAIL host-import: src\/project-x\/work\.ts imports @deepseek-ai\/dsh-session/);
});

test("a core module reading a service off ctx fails", async () => {
	const root = await fixture({ "src/project-x/work.ts": 'const s = ctx.get("settings");\n' });
	const result = run(root);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /FAIL service-access: src\/project-x\/work\.ts touches ctx\.get/);
});

test("only the plugin entry may register events or commands", async () => {
	const root = await fixture({ "src/project-x/work.ts": 'ctx.on("session/event", () => {});\n' });
	const result = run(root);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /FAIL wiring: src\/project-x\/work\.ts uses ctx\.on/);
});

test("the same registration in index.ts is allowed", async () => {
	const root = await fixture({ "src/project-x/index.ts": 'ctx.on("session/event", () => {});\nctx.commands.register({});\n' });
	const result = run(root);
	assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("the host layer must not import a core module", async () => {
	const root = await fixture({
		"src/host/dsh/leak.ts": 'import { x } from "../../project-memory/tasks.js";\nexport const y = x;\n',
	});
	const result = run(root);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /FAIL layering: src\/host\/dsh\/leak\.ts imports \.\.\/\.\.\/project-memory\/tasks\.js/);
});

test("a harness adapter may name a host package", async () => {
	const root = await fixture({
		"src/host/dsh/types.ts": 'import type { Session } from "@deepseek-ai/dsh-session";\nexport type S = Session;\n',
		"src/host/contract.ts": 'export * from "./dsh/types.js";\n',
	});
	const result = run(root);
	assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("the host-neutral contract may not name a host package", async () => {
	const root = await fixture({
		"src/host/contract.ts": 'import type { Session } from "@deepseek-ai/dsh-session";\nexport type S = Session;\n',
	});
	const result = run(root);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /FAIL single-door: src\/host\/contract\.ts imports @deepseek-ai\/dsh-session/);
});

test("a host file outside any harness directory may not name a host package", async () => {
	const root = await fixture({
		"src/host/leak.ts": 'import type { Session } from "@deepseek-ai/dsh-session";\nexport type S = Session;\n',
	});
	const result = run(root);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /FAIL single-door: src\/host\/leak\.ts imports @deepseek-ai\/dsh-session/);
});

test("a core module building the host façade itself fails", async () => {
	const root = await fixture({ "src/project-x/start.ts": 'const host = hostContextOf(ctx);\n' });
	const result = run(root);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /FAIL wiring: src\/project-x\/start\.ts calls hostContextOf/);
});

test("a core registering through the façade it was handed is allowed, and the entry builds it", async () => {
	const root = await fixture({
		"src/project-x/index.ts": 'export function apply(ctx) { start(hostContextOf(ctx)); }\n',
		"src/project-x/start.ts": 'export function start(host) { host.on("session/event", () => {}); host.registerCommand({ name: "x" }); }\n',
	});
	const result = run(root);
	assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("a ported core that names the raw host context fails", async () => {
	const root = await fixture({
		"src/project-x/start.ts": 'import type { Context } from "../host/contract.js";\nexport function start(host: Context): void { void host; }\n',
	});
	const result = run(root);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /FAIL raw-context: src\/project-x\/start\.ts names the raw host context/);
});

test("a ported core starting from the façade is allowed", async () => {
	const root = await fixture({
		"src/project-x/start.ts": 'import type { HostContext } from "../host/contract.js";\nexport function start(host: HostContext): void { host.on("session/flush", () => undefined); }\n',
	});
	const result = run(root);
	assert.equal(result.status, 0, result.stdout + result.stderr);
});
