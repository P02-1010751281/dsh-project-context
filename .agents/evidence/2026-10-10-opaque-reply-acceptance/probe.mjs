/**
 * Batch Q evidence — what dsh's memory write path accepts as a "document".
 *
 * Read-only against the repo: imports the built `lib/`, and the end-to-end section writes only inside a
 * throwaway root under `$TMPDIR`. Run from anywhere:
 *
 *     node .agents/evidence/2026-10-10-opaque-reply-acceptance/probe.mjs
 *
 * Expected output is recorded in README.md beside this file; the two claims it proves are
 * (1) `sectionsFromMarkdown` accepts only the plain four-section document, and
 * (2) a conversational reply reaches the WRITE PATH and replaces the stored memory.
 */
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { isHeadingOnlyDocument, sectionsFromMarkdown } = await import(path.join(ROOT, "lib/project-memory/sections.js"));
const { consolidateProject } = await import(path.join(ROOT, "lib/project-memory/index.js"));
const { resolvePluginConfig } = await import(path.join(ROOT, "lib/shared/config.js"));

console.log("=== 1. the gate only sees a body-less skeleton ===");
const FIELD = "# Project Memory\n\nI'll review the frozen revision and record the durable lessons now.";
for (const [name, text] of [
	["field opener (118 bytes)", FIELD],
	["prose + one bullet", "# Project Memory\n\nI'll do the following:\n- review"],
	["heading-only skeleton", "## Project\n\n## Invariants\n\n## Pitfalls\n\n## Index\n"],
	["headingless prose", "I'll review the frozen revision and record memory now."],
]) {
	console.log(
		`  ${name.padEnd(24)} isHeadingOnly=${String(isHeadingOnlyDocument(text)).padEnd(5)} sections=${
			sectionsFromMarkdown(text) === undefined ? "undefined" : "PARSED"
		}`,
	);
}

console.log("\n=== 2. sectionsFromMarkdown acceptance table ===");
const good = "# Project Memory\n\n## Project\n- a\n\n## Invariants\n- b\n\n## Pitfalls\n- c\n\n## Index\n- d\n";
const variants = {
	good,
	setext: "# Project Memory\n\nProject\n------\n- a\n",
	"html heading": "# Project Memory\n\n<h2>Project</h2>\n- a\n",
	"star bullet": "# Project Memory\n\n## Project\n* a\n\n## Invariants\n- b\n\n## Pitfalls\n- c\n\n## Index\n- d\n",
	numbered: "# Project Memory\n\n## Project\n1. a\n",
	"indented entry": "# Project Memory\n\n## Project\n  - a\n",
	"unknown section": "# Project Memory\n\n## Notes\n- a\n",
	"prose line": "# Project Memory\n\n## Project\n- a\nsome prose\n\n## Invariants\n- b\n\n## Pitfalls\n- c\n\n## Index\n- d\n",
	"no title": "## Project\n- a\n\n## Invariants\n- b\n\n## Pitfalls\n- c\n\n## Index\n- d\n",
	"fenced body block":
		"# Project Memory\n\n## Project\n- a\n\n```\n## Invariants\n- fake\n```\n\n## Invariants\n- b\n\n## Pitfalls\n- c\n\n## Index\n- d\n",
};
for (const [name, text] of Object.entries(variants)) {
	console.log(`  ${name.padEnd(18)} ${sectionsFromMarkdown(text) === undefined ? "REJECT(undefined)" : "ACCEPT"}`);
}
console.log(`  ${"CRLF".padEnd(18)} ${sectionsFromMarkdown(good.replace(/\n/g, "\r\n")) === undefined ? "REJECT(undefined)" : "ACCEPT"}`);

console.log("\n=== 3. end-to-end: does the reply reach the write? ===");
const STORED = "# Project Memory\n\n## Project\n- p1\n\n## Invariants\n- i1\n\n## Pitfalls\n- q1\n\n## Index\n- x1\n";
async function run(label, replyText) {
	const root = await mkdtemp(path.join(tmpdir(), "dsh-e2e-"));
	await mkdir(path.join(root, ".agents", "memory"), { recursive: true });
	const file = path.join(root, ".agents", "memory", "MEMORY.md");
	await writeFile(file, STORED, "utf8");
	const ctx = {
		logger: { info() {}, warn() {} },
		llm: {
			resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
			stream() {
				return (async function* () {
					yield { type: "text-delta", index: 0, text: replyText };
					yield { type: "finish", reason: { kind: "stop" } };
				})();
			},
		},
	};
	const agent = {
		options: { provider: "test-provider", model: "test-model" },
		session: { id: "s", header: { cwd: root, createdAt: Date.now() }, snapshotEvents: () => [], deriveMessages: () => [], requestHeader: () => undefined },
	};
	const report = await consolidateProject(ctx, resolvePluginConfig({ consolidateTurns: 1 }), agent, { force: true });
	const after = await readFile(file, "utf8");
	console.log(`  [${label}] status=${report.status} memoryWritten=${report.memoryWritten} stored byte-identical=${after === STORED}`);
	console.log(`    MEMORY.md now: ${JSON.stringify(after.slice(0, 90))}`);
	return after === STORED;
}

const survived = [];
survived.push(await run("field-opener (pi's incident shape)", FIELD));
survived.push(await run("prose + one bullet", "# Project Memory\n\nI'll do the following:\n- review"));
const skeletonSurvived = await run("heading-only skeleton", "# Project Memory\n\n## Project\n\n## Invariants\n\n## Pitfalls\n\n## Index\n");

console.log("\n=== verdict ===");
const defect = !survived[0] && !survived[1] && skeletonSurvived;
console.log(defect ? "  DEFECT PRESENT: a prose reply replaced the stored memory; only the bare skeleton was kept." : "  DEFECT CLOSED: prose replies no longer replace the stored memory.");
process.exitCode = defect ? 10 : 0;
