// Reproduce the two pre-write memory-loss mechanisms on the built `lib/` and show that the receipt
// now names them. Everything is read from `lib/`; the only writes go to a throwaway tmp project.
//
// The point of the last section: a document that was already trimmed re-renders with zero drops, so
// re-rendering the stored file after the fact proves nothing. The counts must therefore be read from
// the pass itself, which is what this probe does.
//
// Run: node probe.mjs > out.json
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = "/mnt/Data/Projects/dsh-project-context";
const { fitMemoryInput } = await import(ROOT + "/lib/shared/conversation.js");
const { renderMemoryDocument, sectionsFromMarkdown } = await import(ROOT + "/lib/project-memory/sections.js");
const { consolidateProject, memoryUpdateReply } = await import(ROOT + "/lib/project-memory/index.js");
const { resolvePluginConfig } = await import(ROOT + "/lib/shared/config.js");
const { RETRY_OUTPUT_HEADROOM_TOKENS } = await import(ROOT + "/lib/shared/output-budget.js");

/** A stub context/agent pair: only `llm`, `logger` and the session header are read by the pass. */
function fixture(root, replies) {
	const calls = [];
	const ctx = {
		logger: { info() {}, warn() {} },
		llm: {
			resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
			stream(options) {
				calls.push(options);
				const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
				return (async function* generate() {
					if (reply.toolCall) {
						yield { type: "tool-call-delta", index: 0, id: "call-1", name: reply.toolCall.name, argumentsDelta: "" };
						yield { type: "tool-call-delta", index: 0, id: "call-1", argumentsDelta: reply.toolCall.arguments };
						yield { type: "block-end", index: 0, block: { type: "tool-call", id: "call-1", name: reply.toolCall.name, arguments: reply.toolCall.arguments } };
					}
					if (reply.text !== undefined) yield { type: "text-delta", index: 0, text: reply.text };
					yield { type: "finish", reason: reply.reason ?? { kind: "stop" } };
				})();
			},
		},
	};
	const agent = {
		options: { provider: "probe-provider", model: "probe-model" },
		session: {
			id: "session-probe-loss-receipt",
			header: { cwd: root, createdAt: Date.now() },
			snapshotEvents: () => [],
			deriveMessages: () => [],
			requestHeader: () => undefined,
		},
	};
	return { calls, ctx, agent };
}

async function memoryRoot(prefix, memory) {
	const root = await mkdtemp(path.join(tmpdir(), prefix));
	await mkdir(path.join(root, ".agents", "memory"), { recursive: true });
	if (memory !== undefined) await writeFile(path.join(root, ".agents", "memory", "MEMORY.md"), memory, "utf8");
	return root;
}

// 1. Mechanism one, on the input the pass would send: `fitMemoryInput` hides characters of each
// stored artifact when memory plus context cannot fit the model's output budget.
const memory = "# Project Memory\n\n" + "m".repeat(60_000);
const context = "## Summary\n" + "c".repeat(60_000);
const fit = fitMemoryInput(memory, context, 8192, {}, 32_768);
const retryFit = fitMemoryInput(memory, context, 8192, {}, 32_768, RETRY_OUTPUT_HEADROOM_TOKENS);
const clip = {
	storedMemory: memory.length,
	storedContext: context.length,
	sentMemory: fit.text.length,
	sentContext: fit.contextText.length,
	clipped: fit.clipped,
	memoryHiddenChars: fit.memoryHiddenChars,
	contextHiddenChars: fit.contextHiddenChars,
	identityMemory: fit.text.length + fit.memoryHiddenChars === memory.length,
	identityContext: fit.contextText.length + fit.contextHiddenChars === context.length,
	retryHiddenChars: retryFit.memoryHiddenChars + retryFit.contextHiddenChars,
	firstHiddenChars: fit.memoryHiddenChars + fit.contextHiddenChars,
};

// 2. Mechanism two, on the *reply*: the renderer drops whole entries that overflow one section's
// share, and cuts a single entry to the section's per-item cap.
const replyDocument = [
	"# Project Memory",
	"",
	"## Project",
	...Array.from({ length: 400 }, (_, index) => `- short entry ${index}`),
	"",
	"## Invariants",
	"- i1",
	"",
	"## Pitfalls",
	"- q1",
	"",
	"## Index",
	"- x1",
	"",
].join("\n");
const replySections = sectionsFromMarkdown(replyDocument);
const drop = replySections === undefined ? null : renderMemoryDocument(replySections, 4000);
const cut = renderMemoryDocument({ project: [], invariants: [], pitfalls: [], index: ["x".repeat(803)] }, 4000);
const render = {
	replyEntries: replySections?.project?.length ?? null,
	sectionDropped: drop?.sectionDropped ?? null,
	droppedItems: drop?.droppedItems ?? null,
	renderedChars: drop?.text.length ?? null,
	itemTruncatedSingleEntry: cut.itemTruncated,
};

// 3. The same two losses through the real write path, and what the receipt says about them.
const lossyRoot = await memoryRoot("dsh-probe-lossy-", "# Project Memory\n\n## Project\n- " + "记".repeat(39_000) + "\n");
const keptMemory = [
	"# Project Memory",
	"",
	"## Project",
	"- a durable fact kept by this pass, long enough to pass the write path's length floor",
	"",
	"## Invariants",
	"- i1",
	"",
	"## Pitfalls",
	"- q1",
	"",
	"## Index",
	"- x1",
	"",
].join("\n");
const lossyFixture = fixture(lossyRoot, [{
	text: JSON.stringify({ memory_markdown: keptMemory, context: { title: "t", summary: "s", key_points: [], open_tasks: [] } }),
	reason: { kind: "stop" },
}]);
const lossyConfig = resolvePluginConfig({ maxTokens: 8192, maxOutputTokens: 32_768, consolidateTurns: 1, maxMemoryChars: 40_000, forceDedupeMs: 0 });
const lossyReport = await consolidateProject(lossyFixture.ctx, lossyConfig, lossyFixture.agent, { force: true, silent: true });

const dropRoot = await memoryRoot("dsh-probe-drop-", "# Project Memory\n\n## Project\n- original\n");
const dropReply = JSON.stringify({
	memory: { project: Array.from({ length: 400 }, (_, index) => `short entry ${index}`), invariants: [], pitfalls: [], index: [] },
	context: { title: "t", summary: "s", key_points: [], open_tasks: [] },
});
const dropFixture = fixture(dropRoot, [{ toolCall: { name: "record_memory", arguments: dropReply }, reason: { kind: "tool-calls" } }]);
const dropConfig = resolvePluginConfig({ consolidateTurns: 1, maxMemoryChars: 4000, forceDedupeMs: 0 });
const dropReport = await consolidateProject(dropFixture.ctx, dropConfig, dropFixture.agent, { force: true, silent: true });
// A second lossy pass on the same project: the loss log used to be gated to once per project, so
// this one is what shows every occurrence now leaves its own line.
const dropReport2 = await consolidateProject(dropFixture.ctx, dropConfig, dropFixture.agent, { force: true, silent: true });

// The trap, measured: the document that was written after a drop is already trimmed, so re-rendering
// it reports nothing. A clean post-write re-render is therefore not evidence that nothing was lost.
const storedAfterDrop = await readFile(path.join(dropRoot, ".agents", "memory", "MEMORY.md"), "utf8");
const storedSections = sectionsFromMarkdown(storedAfterDrop);
const storedReRender = storedSections === undefined ? null : renderMemoryDocument(storedSections, 4000);
const storedReRenderDrops = storedReRender === null ? null : storedReRender.sectionDropped + storedReRender.droppedItems;

// 4. A real clean pass: the receipt a pass that wrote both artifacts and lost nothing must produce.
// (Built from an actual pass, not a hand-made report, so the wording is the shipped one.)
const cleanRoot = await memoryRoot("dsh-probe-clean-", "# Project Memory\n\n## Project\n- original\n");
const cleanFixture = fixture(cleanRoot, [{
	text: JSON.stringify({ memory_markdown: keptMemory, context: { title: "t", summary: "s", key_points: [], open_tasks: [] } }),
	reason: { kind: "stop" },
}]);
const cleanConfig = resolvePluginConfig({ maxTokens: 8192, maxOutputTokens: 32_768, consolidateTurns: 1, maxMemoryChars: 40_000, forceDedupeMs: 0 });
const cleanReport = await consolidateProject(cleanFixture.ctx, cleanConfig, cleanFixture.agent, { force: true, silent: true });
const cleanErrors = await readFile(path.join(cleanRoot, ".agents", "memory", "errors.log"), "utf8").catch(() => "");

// 5. The two further loss sites the same receipt has to name, both measured through the write path:
// the context render's own budgets, and the memory cap the write path applies to an opaque reply.
const contextRoot = await memoryRoot("dsh-probe-context-clip-", "# Project Memory\n\n## Project\n- original\n");
await writeFile(path.join(contextRoot, ".agents", "memory", "CONTEXT.md"), "x".repeat(60_000), "utf8");
const contextFixture = fixture(contextRoot, [{
	text: JSON.stringify({ memory_markdown: keptMemory, context: { title: "t", summary: "s".repeat(20_000), key_points: [], open_tasks: [] } }),
	reason: { kind: "stop" },
}]);
const contextReport = await consolidateProject(contextFixture.ctx, cleanConfig, contextFixture.agent, { force: true, silent: true });

const capRoot = await memoryRoot("dsh-probe-write-cap-", "# Project Memory\n\n## Project\n- original\n");
const capFixture = fixture(capRoot, [{
	text: JSON.stringify({ memory_markdown: `# Project Memory\n\n${"a prose memory paragraph. ".repeat(400)}`, context: { title: "t", summary: "s", key_points: [], open_tasks: [] } }),
	reason: { kind: "stop" },
}]);
const capConfig = resolvePluginConfig({ maxTokens: 8192, maxOutputTokens: 32_768, consolidateTurns: 1, maxMemoryChars: 4000, forceDedupeMs: 0 });
const capReport = await consolidateProject(capFixture.ctx, capConfig, capFixture.agent, { force: true, silent: true });

const pass = {
	clipCase: { report: lossyReport, receipt: memoryUpdateReply(lossyReport).text },
	dropCase: { report: dropReport, receipt: memoryUpdateReply(dropReport).text, secondPassStatus: dropReport2.status },
	storedAfterDropChars: storedAfterDrop.length,
	storedReRenderDrops,
	lossLogLines: (await readFile(path.join(dropRoot, ".agents", "memory", "errors.log"), "utf8").catch(() => ""))
		.split("\n").filter((line) => line.includes("exceeded their budget")).length,
	cleanCase: { report: cleanReport, receipt: memoryUpdateReply(cleanReport).text, errorLines: cleanErrors.trim() === "" ? 0 : cleanErrors.trim().split("\n").length },
	contextClipCase: {
		report: contextReport,
		receipt: memoryUpdateReply(contextReport).text,
		contextTruncatedOnDisk: /_\[context truncated/.test(await readFile(path.join(contextRoot, ".agents", "memory", "CONTEXT.md"), "utf8")),
	},
	writeCapCase: {
		report: capReport,
		receipt: memoryUpdateReply(capReport).text,
		memoryTruncatedOnDisk: /_\[memory truncated/.test(await readFile(path.join(capRoot, ".agents", "memory", "MEMORY.md"), "utf8")),
		logLines: (await readFile(path.join(capRoot, ".agents", "memory", "errors.log"), "utf8").catch(() => ""))
			.split("\n").filter((line) => line.includes("was capped at")).length,
	},
};

console.log(JSON.stringify({ clip, render, pass }, null, 2));
