/**
 * Batch Q evidence — what the user actually sees when a rewrite is refused for its shape.
 *
 * Read-only against the repo: imports the built `lib/`, writes only inside a throwaway root under
 * `$TMPDIR`. Run from anywhere:
 *
 *     node .agents/evidence/2026-10-10-opaque-reply-acceptance/receipt-probe.mjs
 *
 * The question the main probe does not answer: a refusal that only leaves an `errors.log` line is a
 * silent no-op from the outside, so this drives the user-visible surface too. The fixture is the
 * deliberate-cost case — a *free-form* store (title + column-0 bullets, no `## <section>`) rewritten in
 * exactly the same free-form shape. Expected: the memory is refused and byte-identical, the receipt
 * names only what landed (`Memory: updated CONTEXT.md.` — it never claims a memory write), and the
 * new diagnostic is the one line in `errors.log`. Pre-batch-Q the same fixture reports
 * `memoryWritten=true` and replaces the store, because the only guard then was the skeleton test.
 */
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { consolidateProject, memoryUpdateReply } = await import(path.join(ROOT, "lib/project-memory/index.js"));
const { resolvePluginConfig } = await import(path.join(ROOT, "lib/shared/config.js"));

const FREEFORM = "# Project Memory\n\n- the older free-form memory this project has carried for a while\n";
const REPLY = "# Project Memory\n\n- a free-form rewrite in exactly the same shape the store already has\n";

const root = await mkdtemp(path.join(tmpdir(), "dsh-q-receipt-"));
await mkdir(path.join(root, ".agents", "memory"), { recursive: true });
const file = path.join(root, ".agents", "memory", "MEMORY.md");
await writeFile(file, FREEFORM, "utf8");

const ctx = {
	logger: { info() {}, warn() {} },
	llm: {
		resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
		stream() {
			return (async function* () {
				yield { type: "text-delta", index: 0, text: JSON.stringify({ memory_markdown: REPLY, context: { title: "t", summary: "s", key_points: [], open_tasks: [] } }) };
				yield { type: "finish", reason: { kind: "stop" } };
			})();
		},
	},
};
const agent = {
	options: { provider: "test-provider", model: "test-model" },
	session: { id: "s", header: { cwd: root, createdAt: Date.now() }, snapshotEvents: () => [], deriveMessages: () => [], requestHeader: () => undefined },
};
const config = resolvePluginConfig({ consolidateTurns: 1, forceDedupeMs: 0 });

const report = await consolidateProject(ctx, config, agent, { force: true, silent: true });
const receipt = memoryUpdateReply(report).text;
const storedUntouched = (await readFile(file, "utf8")) === FREEFORM;
const diagnostics = (await readFile(path.join(root, ".agents", "memory", "errors.log"), "utf8")).trim().split("\n").filter(Boolean);

console.log(`  status=${report.status} memoryWritten=${report.memoryWritten} contextWritten=${report.contextWritten}`);
console.log(`  receipt: ${JSON.stringify(receipt)}`);
console.log(`  stored byte-identical=${storedUntouched} diagnostics=${diagnostics.length}`);
for (const line of diagnostics) console.log(`    ${line.slice(line.indexOf("[memory]"))}`);

// PASS = the memory was refused, the receipt names only CONTEXT.md, and exactly one diagnostic names the
// shape (not the cap) as the reason.
const ok =
	report.memoryWritten === false &&
	report.contextWritten === true &&
	storedUntouched &&
	receipt === "Memory: updated CONTEXT.md." &&
	diagnostics.length === 1 &&
	diagnostics[0].includes("was not a writable memory document");
console.log(ok ? "RESULT: PASS" : "RESULT: FAIL");
process.exitCode = ok ? 0 : 1;
