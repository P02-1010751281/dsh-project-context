// F1 closure probe: is the measure's baseline always the document the model was shown, including
// on the truncation-retry path? Read-only; every fixture is created under /tmp.
//
// Scenario A: the stored entry is retired by the pre-prompt Z2 plan (anchor drift), the FIRST reply is
// cut off by the output cap, and the retry lands a document without that entry. Both prompts omit the
// retired entry, so `shownMemory` must be the shortened view and the measure must report 0; measuring
// against `basisKey` (the raw store) would report 2.
//
// Scenario B: control — nothing is retired, the reply drops a literal that WAS shown. Measured 1.
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = "/mnt/Data/Projects/dsh-project-context";
const { consolidateProject, memoryUpdateReply } = await import(`${REPO}/lib/project-memory/index.js`);
const { missingLiteralsBetween, backtickedLiterals } = await import(`${REPO}/lib/project-memory/missing-literals.js`);
const { resolvePluginConfig } = await import(`${REPO}/lib/shared/config.js`);

const CONTEXT_OBJECT = { title: "t", summary: "s", key_points: [], open_tasks: [] };

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
			id: "session-f1-closure",
			header: { cwd: root, createdAt: Date.now() },
			snapshotEvents: () => [],
			deriveEventMessage: () => null,
			deriveMessages: () => [],
			requestHeader: () => undefined,
		},
	};
}

async function project(prefix, document, withAnchorDir) {
	const root = await mkdtemp(path.join(tmpdir(), prefix));
	await mkdir(path.join(root, ".agents", "memory"), { recursive: true });
	if (withAnchorDir) await mkdir(path.join(root, "src", "project-memory"), { recursive: true });
	await writeFile(path.join(root, ".agents", "memory", "MEMORY.md"), document, "utf8");
	return root;
}

const replyText = (markdown) => JSON.stringify({ memory_markdown: markdown, context: CONTEXT_OBJECT });
const existingMemoryOf = (prompt) => {
	const from = prompt.indexOf("<existing-memory>");
	const to = prompt.indexOf("</existing-memory>");
	return from < 0 || to < 0 ? "" : prompt.slice(from + "<existing-memory>".length + 1, to);
};

// ---------------------------------------------------------------- Scenario A (retry + retirement)
{
	const STORED = `# Project Memory

## Project
- root \`/etc/nixos\` holds the flake
- the \`orbitalDriftGate\` lives in \`src/project-memory/gone.ts\`
- \`isHeadingOnlyDocument\` refuses the skeleton

## Invariants
- one name per fact

## Pitfalls
- none yet

## Index
- docs/README.md
`;
	const LANDED_MARKDOWN = `# Project Memory

## Project
- root \`/etc/nixos\` holds the flake
- \`isHeadingOnlyDocument\` refuses the skeleton

## Invariants
- one name per fact

## Pitfalls
- none yet

## Index
- docs/README.md
`;
	const root = await project("ml-closure-f1-retry-", STORED, true);
	// Call 1 is cut off (max-tokens); call 2 is the truncation retry that lands.
	const { ctx, calls } = ctxWith([
		{ text: '{"memory_markdown":"# Project Memory\\n\\n## Project\\n- root', reason: { kind: "max-tokens" } },
		{ text: replyText(LANDED_MARKDOWN) },
	]);
	const config = resolvePluginConfig({ consolidateTurns: 1, forceDedupeMs: 0, maxMemoryChars: 52000 });
	const report = await consolidateProject(ctx, config, agentFor(root), { force: true, silent: true });
	const landed = await readFile(path.join(root, ".agents", "memory", "MEMORY.md"), "utf8");
	const shown1 = existingMemoryOf(calls[0].messages[0].content.map((b) => b.text ?? "").join("\n"));
	const shown2 = calls.length > 1 ? existingMemoryOf(calls[1].messages[0].content.map((b) => b.text ?? "").join("\n")) : "(no retry)";
	const retiredInPrompt = (text) => ["orbitalDriftGate", "src/project-memory/gone.ts"].filter((t) => text.includes(t));
	const retiredRecord = await readFile(path.join(root, ".agents", "memory", "retired.md"), "utf8").catch(() => "");

	console.log("=== Scenario A: truncation retry + a deliberate pre-prompt retirement ===");
	console.log("model calls:", calls.length, "| first stopReason path was max-tokens");
	console.log("report.status:", report.status, "| memoryWritten:", report.memoryWritten);
	console.log("report.itemTruncated:", report.itemTruncated, "| sectionDropped:", report.sectionDropped);
	console.log("report.missingLiterals:", JSON.stringify(report.missingLiterals));
	console.log("retired literals still visible in call-1 <existing-memory>:", JSON.stringify(retiredInPrompt(shown1)));
	console.log("retired literals still visible in call-2 <existing-memory>:", JSON.stringify(retiredInPrompt(shown2)));
	console.log("call-1 view === call-2 view:", shown1 === shown2);
	console.log("retired.md records the deletion:", /orbitalDriftGate/.test(retiredRecord));
	console.log("landed still carries orbitalDriftGate:", landed.includes("orbitalDriftGate"));
	console.log("BASIS-KEY variant missingLiteralsBetween(store, landed):", JSON.stringify(missingLiteralsBetween(STORED, landed)));
	console.log("receipt:", memoryUpdateReply(report).text.split("\n")[0]);
}

// ------------------------------------------------------------------- Scenario B (control: real loss)
{
	const STORED = `# Project Memory

## Project
- root \`/etc/nixos\` holds the flake
- \`isHeadingOnlyDocument\` refuses the skeleton

## Invariants
- one name per fact

## Pitfalls
- none yet

## Index
- docs/README.md
`;
	const root = await project("ml-closure-f1-loss-", STORED, false);
	const { ctx } = ctxWith([{ text: replyText(`# Project Memory

## Project
- root \`/etc/nixos\` holds the flake
- the skeleton gate is unchanged

## Invariants
- one name per fact

## Pitfalls
- none yet

## Index
- docs/README.md
`) }]);
	const config = resolvePluginConfig({ consolidateTurns: 1, forceDedupeMs: 0, maxMemoryChars: 52000 });
	const report = await consolidateProject(ctx, config, agentFor(root), { force: true, silent: true });

	console.log("\n=== Scenario B: control — a literal that was shown and left ===");
	console.log("report.status:", report.status, "| memoryWritten:", report.memoryWritten);
	console.log("report.missingLiterals:", JSON.stringify(report.missingLiterals));
	console.log("receipt:", memoryUpdateReply(report).text.split("\n")[0]);
}
