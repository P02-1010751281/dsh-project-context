// F4 closure probe: (a) the read-back is unreachable when the write did not land, and (b) the
// surviving "landed bytes vs reply text" question — do the two ever differ observably?
// Read-only; every fixture is created under /tmp.
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = "/mnt/Data/Projects/dsh-project-context";
const { consolidateProject, memoryUpdateReply } = await import(`${REPO}/lib/project-memory/index.js`);
const { missingLiteralsBetween, backtickedLiterals } = await import(`${REPO}/lib/project-memory/missing-literals.js`);
const { resolvePluginConfig } = await import(`${REPO}/lib/shared/config.js`);

const CONTEXT_OBJECT = { title: "t", summary: "s", key_points: [], open_tasks: [] };
const replyText = (markdown) => JSON.stringify({ memory_markdown: markdown, context: CONTEXT_OBJECT });

function ctxWith(replies, onStream) {
	const calls = [];
	const ctx = {
		get: () => undefined,
		logger: { info() {}, warn() {} },
		llm: {
			resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
			stream(options) {
				calls.push(options);
				const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
				return (async function* generate() {
					if (onStream) await onStream(calls.length);
					if (reply.text !== undefined) yield { type: "text-delta", index: 0, text: reply.text };
					if (reply.skipFinish !== true) yield { type: "finish", reason: reply.reason ?? { kind: "stop" } };
				})();
			},
		},
	};
	return { ctx, calls };
}

function agentFor(root) {
	return {
		options: { provider: "test-provider", model: "test-model" },
		session: {
			id: "session-f4-closure",
			header: { cwd: root, createdAt: Date.now() },
			snapshotEvents: () => [],
			deriveEventMessage: () => null,
			deriveMessages: () => [],
			requestHeader: () => undefined,
		},
	};
}

async function project(prefix, document) {
	const root = await mkdtemp(path.join(tmpdir(), prefix));
	await mkdir(path.join(root, ".agents", "memory"), { recursive: true });
	await writeFile(path.join(root, ".agents", "memory", "MEMORY.md"), document, "utf8");
	return root;
}

const DOC = `# Project Memory

## Project
- root \`/etc/nixos\` holds the flake
- \`tailLiteral99\` gates the tail

## Invariants
- one name per fact

## Pitfalls
- none yet

## Index
- docs/README.md
`;

// ------------------------------------------------- (a) the write is refused: no read-back, no line
{
	const NEWER = `# Project Memory

## Project
- a newer external edit replaced the file mid-pass

## Invariants
- one name per fact

## Pitfalls
- none yet

## Index
- docs/README.md
`;
	const root = await project("ml-closure-f4-race-", DOC);
	const { ctx } = ctxWith([{ text: replyText(DOC.replace("gates the tail", "gates the tail (rewritten)")) }], async (n) => {
		if (n === 1) await writeFile(path.join(root, ".agents", "memory", "MEMORY.md"), NEWER, "utf8");
	});
	const config = resolvePluginConfig({ consolidateTurns: 1, forceDedupeMs: 0, maxMemoryChars: 52000 });
	const report = await consolidateProject(ctx, config, agentFor(root), { force: true, silent: true });
	const log = await readFile(path.join(root, ".agents", "memory", "errors.log"), "utf8").catch(() => "");
	console.log("=== (a) the write did not land (external edit during the model call) ===");
	console.log("report.memoryWritten:", report.memoryWritten);
	console.log("report.missingLiterals:", JSON.stringify(report.missingLiterals), "(undefined = no observation at all)");
	console.log("errors.log names the basis-key refusal:", /the memory changed while this pass's reply was being built/.test(log));
	console.log("errors.log carries a missing-literal line:", /backticked literal\(s\)/.test(log));
}

// ------------------------------------- (b) landed bytes vs reply text: an item-cap clip separates them
{
	const root = await project("ml-closure-f4-reply-", DOC);
	const LONG_ENTRY = `- ${"x".repeat(840)} tail \`tailLiteral99\``;
	const REPLY_MARKDOWN = `# Project Memory

## Project
- root \`/etc/nixos\` holds the flake
${LONG_ENTRY}

## Invariants
- one name per fact

## Pitfalls
- none yet

## Index
- docs/README.md
`;
	const { ctx } = ctxWith([{ text: replyText(REPLY_MARKDOWN) }]);
	const config = resolvePluginConfig({ consolidateTurns: 1, forceDedupeMs: 0, maxMemoryChars: 52000 });
	const report = await consolidateProject(ctx, config, agentFor(root), { force: true, silent: true });
	const landed = await readFile(path.join(root, ".agents", "memory", "MEMORY.md"), "utf8");
	const log = await readFile(path.join(root, ".agents", "memory", "errors.log"), "utf8").catch(() => "");
	console.log("\n=== (b) landed bytes vs the reply text, one entry over the per-item cap ===");
	console.log("report.status:", report.status, "| memoryWritten:", report.memoryWritten);
	console.log("report.itemTruncated:", report.itemTruncated);
	console.log("reply text carries tailLiteral99:", REPLY_MARKDOWN.includes("tailLiteral99"));
	console.log("landed bytes carry tailLiteral99:", landed.includes("tailLiteral99"));
	console.log("measured against LANDED bytes:", JSON.stringify(missingLiteralsBetween(DOC, landed)));
	console.log("measured against REPLY text  :", JSON.stringify(missingLiteralsBetween(DOC, REPLY_MARKDOWN)));
	console.log("report.missingLiterals:", JSON.stringify(report.missingLiterals));
	console.log("log line names the item-cap overlap:", /were also cut at their per-item cap/.test(log));
}
