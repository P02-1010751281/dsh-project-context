/**
 * Batch Q2 evidence — a shape-valid PARTIAL reply, and what the store loses when it lands.
 *
 * Read-only against the repo: imports the built `lib/`, and the end-to-end sections write only inside a
 * throwaway root under `$TMPDIR`. Run from anywhere:
 *
 *     node .agents/evidence/2026-10-11-batchQ2-acceptance-guard/probe.mjs
 *
 * Batch Q closed the door on "a conversational reply that carries none of our shape". It deliberately left
 * the adjacent door open: `## Invariants\n- x` IS our shape (`hasMemoryDocumentShape`), but
 * `sectionsFromMarkdown` requires all four sections (`sections.ts:571`), so it resolves as
 * `fallback-opaque` (`consolidate.ts:363-365`) and the reply is written VERBATIM — the store's other three
 * sections disappear with no diagnostic. This probe pins the four expectations of the layered guard the
 * user ruled on 2026-10-11 ("都做"): merge what can be merged, refuse what cannot, report entry-level loss,
 * and leave a fresh store alone.
 *
 * Exit 0 = the guard behaves as ruled; 10 = DEFECT PRESENT; 1 = the fixture could not run.
 */
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { consolidateProject } = await import(path.join(ROOT, "lib/project-memory/index.js"));
const { resolvePluginConfig } = await import(path.join(ROOT, "lib/shared/config.js"));

const STORED = "# Project Memory\n\n## Project\n- p1\n\n## Invariants\n- i1\n\n## Pitfalls\n- q1\n\n## Index\n- x1\n";
const BARE = "# Project Memory\n\n";

async function run(label, { stored, reply }) {
	// `reply` is one string, or the replies of successive model calls (the tier-C retry is a second call).
	const replies = typeof reply === "string" ? [reply] : reply;
	let calls = 0;
	const root = await mkdtemp(path.join(tmpdir(), "dsh-q2-"));
	await mkdir(path.join(root, ".agents", "memory"), { recursive: true });
	const file = path.join(root, ".agents", "memory", "MEMORY.md");
	const log = path.join(root, ".agents", "memory", "errors.log");
	await writeFile(file, stored, "utf8");
	const ctx = {
		logger: { info() {}, warn() {} },
		llm: {
			resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
			stream() {
				const text = replies[Math.min(calls, replies.length - 1)];
				calls += 1;
				return (async function* () {
					yield { type: "text-delta", index: 0, text };
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
	let errors = "";
	try { errors = await readFile(log, "utf8"); } catch { /* no line written */ }
	console.log(`  [${label}] status=${report.status} memoryWritten=${report.memoryWritten} calls=${calls} replacedVerbatim=${after === replies[replies.length - 1]}`);
	console.log(`    sections kept: ${["- p1", "- i1", "- i2", "- q1", "- x1"].filter((m) => after.includes(m)).join(" ") || "(none)"}`);
	console.log(`    errors.log: ${errors.trim() === "" ? "(empty)" : errors.trim().split("\n").slice(-2).join(" ⏎ ").slice(0, 200)}`);
	return { after, report, errors };
}

const failures = [];
const check = (name, ok) => {
	console.log(`    ${ok ? "OK  " : "FAIL"} ${name}`);
	if (!ok) failures.push(name);
};

console.log("=== A. a partial reply over a four-section store must MERGE (④) ===");
{
	// The reply must clear OPAQUE_DOCUMENT_MIN_CHARS (40) or the floor gate keeps the store first and the
	// write path is never reached — that is a different gate, and this probe is about this one.
	const reply = "# Project Memory\n\n## Invariants\n- i2 the rewrite carries this entry\n";
	const { after } = await run("partial: only Invariants", { stored: STORED, reply });
	check("the store's omitted sections survive", after.includes("- p1") && after.includes("- q1") && after.includes("- x1"));
	check("the carried section wins", after.includes("i2 the rewrite carries this entry") && !after.includes("- i1"));
}

console.log("\n=== B. a shape we cannot merge must be REFUSED, not silently replace (③) ===");
{
	// Prose inside a section is this extension's documented shape fail-open (batch Q), so the reply
	// carries our shape but cannot be turned into sections.
	const reply = "# Project Memory\n\n## Project\nsome prose\n- p2\n";
	const { after, report } = await run("unmergeable partial", { stored: STORED, reply });
	check("the stored memory is byte-identical", after === STORED);
	check("the pass does not claim a write", report.memoryWritten === false);
}

console.log("\n=== C. entry-level loss inside a carried section is REPORTED, never blocked (①) ===");
{
	const reply = "# Project Memory\n\n## Project\n- p1\n\n## Invariants\n- i9\n\n## Pitfalls\n- q1\n\n## Index\n- x1\n";
	const { after, errors } = await run("four-section rewrite drops i1", { stored: STORED, reply });
	check("the rewrite still lands (compression is the point)", after.includes("- i9"));
	check("the removal is named in errors.log", /memory regression/i.test(errors) && errors.includes("i1"));
}

console.log("\n=== D. control: a fresh store has nothing to protect ===");
{
	const reply = "# Project Memory\n\n## Invariants\n- i2 the rewrite carries this entry\n";
	const { after } = await run("partial over a bare store", { stored: BARE, reply });
	check("the reply lands verbatim as before", after === reply);
}

console.log("\n=== E. control: a complete four-section reply is unchanged ===");
{
	const reply = "# Project Memory\n\n## Project\n- p1\n\n## Invariants\n- i1\n\n## Pitfalls\n- q1\n\n## Index\n- x2\n";
	const { after, errors } = await run("complete rewrite", { stored: STORED, reply });
	check("the rewrite lands", after.includes("- x2"));
	check("no phantom regression line", !/memory regression/i.test(errors));
}

console.log("\n=== F. a tier-C retry that answers with an unmergeable partial must not replace the store (review finding) ===");
{
	// The independent review's blocking finding: the refusal was decided before tier C, so this retry was
	// accepted and written verbatim over the stored document. The first reply is storable but lossy (one
	// entry over the per-item cap), which is what makes tier C retry it.
	const first = `# Project Memory\n\n## Project\n- ${"p".repeat(900)}\n\n## Invariants\n- i1\n\n## Pitfalls\n- q1\n\n## Index\n- x1\n`;
	const retry = "# Project Memory\n\n## Project\nsome prose\n- p2\n";
	const { after, report } = await run("lossy first reply + unmergeable retry", { stored: STORED, reply: [first, retry] });
	check("the retry's partial is not written", !after.includes("some prose"));
	check("the store keeps all four sections", after.includes("## Invariants") && after.includes("## Pitfalls") && after.includes("## Index"));
	check("the first reply is what landed", report.memoryWritten === true);
}

console.log("\n=== verdict ===");
if (failures.length === 0) {
	console.log("  GUARD HOLDS: merge / refuse / report behave as ruled.");
	process.exitCode = 0;
} else {
	console.log(`  DEFECT PRESENT (${failures.length} expectation(s) unmet): ${failures.join(" | ")}`);
	process.exitCode = 10;
}
