/**
 * Re-runnable account of what this plugin costs inside a small context window.
 *
 * Reads the tracked `.agents/memory` documents through the built `lib/` (the same `loadMemory` the
 * prompt providers and the consolidation pass call), so the tables describe the code the host loads
 * rather than a paraphrase of it. Nothing here writes to the repository.
 *
 * Run: `node .agents/evidence/2026-11-06-small-window-presets/measure.mjs`
 *
 * A. the read cap   -- what `loadMemory(root, cap)` actually hands the model at each `maxMemoryChars`:
 *                     characters kept, characters hidden, tokens, and which sections survive whole.
 * B. the threshold  -- `resolveThreshold` across (cap, handoffBudgetRecentTokens) at 64K / 128K.
 * C. the pass input -- whether the consolidation request itself fits: the documents plus the
 *                     conversation block it re-sends, against the configured output ceiling.
 */

import { readFileSync } from "node:fs";
import { loadMemory } from "../../../lib/project-memory/load.js";
import { replyTokenRate } from "../../../lib/shared/text.js";
import { resolveThreshold, thresholdRefusal } from "../../../lib/project-handoff/threshold.js";
import { DEFAULT_CONFIG } from "../../../lib/shared/config.js";
import { MAX_CONTEXT_CHARS, MAX_CONVERSATION_CHARS } from "../../../lib/shared/limits.js";
import { fitMemoryInput } from "../../../lib/shared/conversation.js";

const ROOT = new URL("../../../", import.meta.url).pathname;
const CAPS = [16000, 18000, 20000, 24000, 32000, 40000];
/** Rough size of the system prompt plus the tool surface, the part no document setting reaches. */
const BASE_TOKENS = 6000;

const contextText = readFileSync(`${ROOT}/.agents/memory/CONTEXT.md`, "utf8").slice(0, MAX_CONTEXT_CHARS);
const contextTokens = Math.round(contextText.length * replyTokenRate(contextText));

/** Per-section bullet counts of a possibly-clipped document. */
function sectionCounts(text) {
	const counts = new Map();
	let current;
	for (const line of text.split("\n")) {
		const heading = /^##\s+(.+)$/.exec(line.trim());
		if (heading) {
			current = heading[1].trim();
			if (!counts.has(current)) counts.set(current, 0);
			continue;
		}
		if (current !== undefined && line.startsWith("- ")) counts.set(current, counts.get(current) + 1);
	}
	return counts;
}

console.log(`输入文档：MEMORY.md / CONTEXT.md（CONTEXT 读入上限 ${MAX_CONTEXT_CHARS} 字符）`);
console.log(`CONTEXT.md ${contextText.length} 字符 = ${contextTokens} tokens；基线粗估 ${BASE_TOKENS} tokens\n`);

console.log("A. 每个 maxMemoryChars 下注入侧看到什么");
console.log("   cap |  读入字符 |  隐藏字符 | 记忆 tokens | 分节条目");
const rows = [];
for (const cap of CAPS) {
	const loaded = await loadMemory(ROOT, cap);
	const counts = sectionCounts(loaded.text);
	const tokens = Math.round(loaded.text.length * replyTokenRate(loaded.text));
	rows.push({ cap, chars: loaded.text.length, hidden: loaded.cappedDroppedChars, tokens, counts });
	const rendered = ["Project", "Invariants", "Pitfalls", "Index"].map((name) => `${name}=${counts.get(name) ?? 0}`);
	console.log(
		`  ${String(cap).padStart(5)} | ${String(loaded.text.length).padStart(9)} | ${String(loaded.cappedDroppedChars).padStart(9)} | ${String(tokens).padStart(11)} | ${rendered.join(" ")}`,
	);
}
const whole = rows.at(-1);
console.log(
	`  完整文档：${["Project", "Invariants", "Pitfalls", "Index"].map((n) => `${n}=${whole.counts.get(n)}`).join(" ")}\n`,
);

for (const window of [64000, 128000]) {
	console.log(`B. 窗口 ${window}：阈值随 cap 与 handoffBudgetRecentTokens 的变化`);
	for (const keep of [20000, 12000, 8000, 4000]) {
		const cells = rows.map((row) => {
			const config = { ...DEFAULT_CONFIG, handoffBudgetRecentTokens: keep };
			const measurement = { overheadTokens: row.tokens + contextTokens + BASE_TOKENS };
			const resolved = resolveThreshold(config, measurement, window);
			if (resolved === undefined) return `${row.cap}:不可用(${thresholdRefusal(config, measurement, window)})`;
			return `${row.cap}:${resolved.tokens}`;
		});
		console.log(`  keep ${String(keep).padStart(5)} | ${cells.join("  ")}`);
	}
	console.log("");
}

console.log("B2. 今天这份 40000 字符文档在 64K 上，只动 keep");
for (const keep of [20000, 16000, 12000, 8000, 4000, 0]) {
	const config = { ...DEFAULT_CONFIG, handoffBudgetRecentTokens: keep };
	const overhead = whole.tokens + contextTokens + BASE_TOKENS;
	const resolved = resolveThreshold(config, { overheadTokens: overhead }, 64000);
	const left = resolved === undefined ? "" : ` 触发点之上留给对话 ${resolved.tokens - overhead} tokens`;
	console.log(`  keep ${String(keep).padStart(5)}: ${resolved?.tokens ?? `不可用(${thresholdRefusal(config, { overheadTokens: overhead }, 64000)})`}${left}`);
}

console.log("\nC. 整理 pass 自己的请求：文档 + 它重发的对话块 + 它要的回吐量");
// The shape the plugin really uses for the auxiliary call: the adapter's own output cap, and
// reasoning metadata present (see consolidate.ts's `auxModel`).
const model = { reasoning: true, maxTokens: 328000 };
for (const cap of [18000, 40000]) {
	const loaded = await loadMemory(ROOT, cap);
	const fitted = fitMemoryInput(loaded.text, contextText, DEFAULT_CONFIG.maxTokens, model, DEFAULT_CONFIG.maxOutputTokens);
	for (const conversationChars of [0, 25000, MAX_CONVERSATION_CHARS]) {
		const conversationTokens = Math.round(conversationChars * 0.5);
		const input = Math.round(loaded.text.length * replyTokenRate(loaded.text)) + contextTokens + conversationTokens + 2000;
		const total = input + fitted.maxTokens;
		const verdict = [64000, 128000].map((window) => `${window}: ${total > window ? "超窗" : "可放下"}`).join(" | ");
		console.log(
			`  cap ${String(cap).padStart(5)} 对话块 ${String(conversationChars).padStart(5)} 字符（≈${String(conversationTokens).padStart(5)} tok）: 输入≈${String(input).padStart(6)} + 输出 ${fitted.maxTokens} = ${total} → ${verdict}`,
		);
	}
}
console.log(`\n（对话块上限 ${MAX_CONVERSATION_CHARS} 字符是常量，不随窗口缩放；该 block 的 token 按 0.5 tok/char 粗估。）`);
