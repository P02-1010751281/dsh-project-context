// End-to-end: a pass that DELIBERATELY retires an entry (batch Z2 anchor-drift) and lands the reply
// without it. What do the two report layers say about that same deletion?
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { consolidateProject, memoryUpdateReply } from "/mnt/Data/Projects/dsh-project-context/lib/project-memory/index.js";
import { resolvePluginConfig } from "/mnt/Data/Projects/dsh-project-context/lib/shared/config.js";

const STORED = `# Project Memory

## Project
- root \`/etc/nixos\` holds the flake
- the \`orbitalDriftGate\` lives in src/project-memory/gone.ts
- \`isHeadingOnlyDocument\` refuses the skeleton

## Invariants
- one name per fact

## Pitfalls
- none yet

## Index
- docs/README.md
`;

// What the model returns: it was never shown the drifted entry, so it cannot re-emit it.
const REPLY = JSON.stringify({
	memory_markdown: `# Project Memory

## Project
- root \`/etc/nixos\` holds the flake
- \`isHeadingOnlyDocument\` refuses the skeleton

## Invariants
- one name per fact

## Pitfalls
- none yet

## Index
- docs/README.md
`,
	context: { title: "t", summary: "s", key_points: [], open_tasks: [] },
});

const root = await mkdtemp(path.join(tmpdir(), "ml-retirement-"));
await mkdir(path.join(root, ".agents", "memory"), { recursive: true });
// The cited parent directory exists; the cited file does not — anchor drift fires.
await mkdir(path.join(root, "src", "project-memory"), { recursive: true });
await writeFile(path.join(root, ".agents", "memory", "MEMORY.md"), STORED, "utf8");

const calls = [];
const ctx = {
	get: () => undefined,
	logger: { info() {}, warn() {} },
	llm: {
		resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
		stream(options) {
			calls.push(options);
			return (async function* generate() {
				yield { type: "text-delta", index: 0, text: REPLY };
				yield { type: "finish", reason: { kind: "stop" } };
			})();
		},
	},
};
const agent = {
	options: { provider: "test-provider", model: "test-model" },
	session: {
		id: "session-ml-review",
		header: { cwd: root, createdAt: Date.now() },
		snapshotEvents: () => [],
		deriveEventMessage: () => null,
		deriveMessages: () => [],
		requestHeader: () => undefined,
	},
};
const config = resolvePluginConfig({ consolidateTurns: 1, forceDedupeMs: 0, maxMemoryChars: 52000 });
const report = await consolidateProject(ctx, config, agent, { force: true, silent: true });

console.log("status:", report.status, "memoryWritten:", report.memoryWritten);
console.log("Z2 retirement fired?", "yes (the stored entry cites src/project-memory/gone.ts, which does not exist)");
console.log("report.removedEntries (batch Q2's layer):", JSON.stringify(report.removedEntries));
console.log("report.missingLiterals:", JSON.stringify(report.missingLiterals));
const landed = await readFile(path.join(root, ".agents", "memory", "MEMORY.md"), "utf8");
console.log("landed still carries orbitalDriftGate?", landed.includes("orbitalDriftGate"));
const log = await readFile(path.join(root, ".agents", "memory", "errors.log"), "utf8").catch(() => "");
console.log("--- errors.log lines naming the deletion / the literals ---");
for (const line of log.split("\n")) if (/literal|regression|retire|gone\.ts|drift/i.test(line)) console.log("  " + line);
console.log("--- receipt ---");
console.log(memoryUpdateReply(report).text);

// Prove Z2 really retired it (a tombstone is written only for a retirement this pass planned).
const retiredFile = path.join(root, ".agents", "memory", "retired.md");
console.log("--- retired.md (Z2 tombstones) ---");
console.log(await readFile(retiredFile, "utf8").catch(() => "(none)"));
