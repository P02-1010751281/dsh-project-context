#!/usr/bin/env node
// 批次 L 载入的**行为**佐证（2026-10-06）。
//
// 经宿主真正解析的那条 profile 路径 import 被加载的模块，断言两层提示词都携带压缩阶梯、
// 且不再出现批次 L 之前的删除收尾句。这是不跑 `/memory update` 能得到的最强佐证；它证明的是
// “被加载的产物携带批次 L 行为”，不是“模型会遵守提示词”。
//
// 用法：node .agents/evidence/2026-10-06-batchL-load-verify/witness.mjs
// 退出码 0 = 载入的产物携带批次 L 行为；非 0 = 断言失败（stderr 指出是哪一条）。
// 覆盖模块路径：DSH_CONSOLIDATE_MODULE=<abs path>
import assert from "node:assert/strict";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const rel = "node_modules/dsh-project-context/lib/project-memory/consolidate.js";
const candidates = ["desktop", "web", "ctxdev"].map((profile) =>
	join(homedir(), ".dsh", "profiles", profile, rel),
);
const modulePath = process.env.DSH_CONSOLIDATE_MODULE ?? candidates.find((path) => existsSync(path));
assert.ok(modulePath, `no loaded consolidate.js found; tried:\n  ${candidates.join("\n  ")}`);

const mod = await import(modulePath);
console.log(`module passed to import : ${modulePath}`);
console.log(`resolved real path      : ${realpathSync(modulePath)}`);

const cap = 40000;
const rule = mod.memorySectionRule(cap);
const retry = mod.memoryLossRetryRule(
	[{ heading: "Pitfalls", over: 423, budget: 11577, droppedEntries: 1, truncatedEntries: 0, itemCap: 800 }],
	0,
);
const banned = /drop(ping)? the least durable entr/i;

assert.equal(typeof mod.MEMORY_KEEP_RULE, "string", "MEMORY_KEEP_RULE is exported");
assert.ok(rule.includes(mod.MEMORY_KEEP_RULE), "memorySectionRule carries MEMORY_KEEP_RULE");
assert.ok(retry.includes(mod.MEMORY_KEEP_RULE), "memoryLossRetryRule carries the same rule");
assert.ok(retry.includes("apply the same ladder without sections"), "the retry covers the sectionless cap path");
assert.equal(banned.test(rule), false, "memorySectionRule no longer instructs deletion");
assert.equal(banned.test(retry), false, "memoryLossRetryRule no longer instructs deletion");
assert.equal(typeof mod.MEMORY_SURVIVAL_CAPTION, "string", "MEMORY_SURVIVAL_CAPTION is exported");
assert.ok(mod.MEMORY_SURVIVAL_CAPTION.length > 0, "MEMORY_SURVIVAL_CAPTION is non-empty");

console.log("--- memorySectionRule (last line) ---");
console.log(rule.split("\n").at(-1));
console.log("--- memoryLossRetryRule (last line) ---");
console.log(retry.split("\n").at(-1));
console.log("WITNESS: the loaded artifact carries batch L behaviour (keep rule in both layers, no deletion instruction)");
