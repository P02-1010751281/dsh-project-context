/**
 * Batch R evidence — does the truncation retry carry the hidden thinking the first attempt spent?
 *
 * Read-only against the repo: imports the built `lib/` and writes only inside a throwaway root under
 * `$TMPDIR`. Run from anywhere:
 *
 *     node .agents/evidence/2026-10-11-batchR-retry-headroom/probe.mjs
 *
 * The claim it decides: after a first consolidation attempt that ran into the output cap having spent
 * `OBSERVED_REASONING_TOKENS` on hidden reasoning, the retry must ask for that much extra room
 * **exactly** — this fixture's ceiling does not bind, so the requested cap grows by the headroom passed
 * to `fitMemoryInput`. Equality (not a tolerance) is what rules out an implementation that carries only
 * part of the spend, e.g. `max(RETRY_OUTPUT_HEADROOM_TOKENS, observed - RETRY_OUTPUT_HEADROOM_TOKENS)`.
 * The reasoning reserve is capped at 8192 while a route can spend far more, so a retry that carries only
 * the flat `+4096` asks again with the very headroom that just starved it.
 *
 * Exit 10 = DEFECT PRESENT (the retry ignores the spend), 11 = CONTROL REGRESSION (a route reporting no
 * hidden thinking no longer gets the flat constant), 0 = DEFECT CLOSED, 1 = the fixture itself did not
 * run (no retry, or the pass failed). Only 0 is a pass; every other code must be read as what it says.
 */
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { consolidateProject } = await import(path.join(ROOT, "lib/project-memory/index.js"));
const { resolvePluginConfig } = await import(path.join(ROOT, "lib/shared/config.js"));
const { RETRY_OUTPUT_HEADROOM_TOKENS } = await import(path.join(ROOT, "lib/shared/output-budget.js"));

/** The field case (pi `099ebf3`, Quantum_Matrix 2026-10-08) spent 20489 tokens on hidden thinking. */
const OBSERVED_REASONING_TOKENS = 20_000;

const COMPLETE_REPLY = JSON.stringify({
	memory_markdown: "# Project Memory\n\n## Project\n- recovered after the cap.\n",
	context: { title: "t", summary: "s", key_points: [], open_tasks: [] },
});
const CUT_REPLY = '{"memory_markdown":"# Project Memory\\n\\n## Project\\n- was cut off here';

/**
 * Drive one forced consolidation whose first reply hits the cap with a reported reasoning spend and
 * whose second reply completes. Returns the requested output cap of both calls.
 * @param observedReasoning - hidden-reasoning tokens the first (cut-off) reply reports.
 * @returns the two requested caps, or a failure description.
 */
async function retryCaps(observedReasoning) {
	const root = await mkdtemp(path.join(tmpdir(), "dsh-batchR-"));
	await mkdir(path.join(root, ".agents", "memory"), { recursive: true });
	// Dense content large enough that the first fit is driven by the document rather than by the
	// configured floor, so the retry's extra headroom shows up as a larger requested cap. The memory
	// is well under the read cap, so nothing here is about clipping.
	await writeFile(path.join(root, ".agents", "memory", "MEMORY.md"), `# Project Memory\n\n${"记".repeat(9000)}\n`, "utf8");
	const calls = [];
	const ctx = {
		logger: { info() {}, warn() {} },
		llm: {
			resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
			stream(options) {
				calls.push(options.maxTokens);
				const first = calls.length === 1;
				return (async function* generate() {
					if (first) {
						yield { type: "usage", usage: { inputTokens: 10, outputTokens: 8192, reasoningTokens: observedReasoning } };
						yield { type: "text-delta", index: 0, text: CUT_REPLY };
						yield { type: "finish", reason: { kind: "max-tokens" } };
						return;
					}
					yield { type: "text-delta", index: 0, text: COMPLETE_REPLY };
					yield { type: "finish", reason: { kind: "stop" } };
				})();
			},
		},
	};
	const agent = {
		options: { provider: "test-provider", model: "test-model" },
		session: { id: "batchR", header: { cwd: root, createdAt: Date.now() }, snapshotEvents: () => [], deriveMessages: () => [], requestHeader: () => undefined },
	};
	try {
		await consolidateProject(ctx, resolvePluginConfig({ maxTokens: 8192, maxOutputTokens: 131_072, consolidateTurns: 1 }), agent, { force: true });
	} catch (error) {
		return { error: error.message, caps: calls };
	}
	return { caps: calls };
}

console.log(`RETRY_OUTPUT_HEADROOM_TOKENS = ${RETRY_OUTPUT_HEADROOM_TOKENS}`);
console.log(`observed hidden-reasoning spend  = ${OBSERVED_REASONING_TOKENS}`);
console.log("");

const spent = await retryCaps(OBSERVED_REASONING_TOKENS);
if (spent.error !== undefined || spent.caps.length !== 2) {
	console.log(`FIXTURE FAILED: calls=${spent.caps.length} error=${spent.error ?? "none"}`);
	process.exitCode = 1;
} else {
	const growth = spent.caps[1] - spent.caps[0];
	console.log(`a truncated reply that spent ${OBSERVED_REASONING_TOKENS} on hidden reasoning:`);
	console.log(`  requested cap ${spent.caps[0]} -> ${spent.caps[1]}  (growth ${growth})`);
	console.log(`  required growth == ${OBSERVED_REASONING_TOKENS} (the ceiling does not bind here)`);
	const carries = growth === OBSERVED_REASONING_TOKENS;
	console.log(`  verdict: ${carries ? "carries the spend" : "DOES NOT carry the spend"}`);
	console.log("");

	// The zero-spend control: a route that reports no hidden thinking must keep exactly today's
	// behaviour, so this half is expected to pass before and after the fix (defect or not).
	const none = await retryCaps(0);
	if (none.error !== undefined || none.caps.length !== 2) {
		console.log(`CONTROL FIXTURE FAILED: calls=${none.caps.length} error=${none.error ?? "none"}`);
		process.exitCode = 1;
	} else {
		const controlGrowth = none.caps[1] - none.caps[0];
		console.log(`control — a reply that reports no hidden thinking (0):`);
		console.log(`  requested cap ${none.caps[0]} -> ${none.caps[1]}  (growth ${controlGrowth})`);
		console.log(`  flat constant preserved: ${controlGrowth === RETRY_OUTPUT_HEADROOM_TOKENS}`);
		console.log("");
		// Each failure names its own cause: a control regression is not the defect this probe hunts, and
		// reporting it as "the retry ignores the spend" would be the wrong cause (this project's own
		// central defect class).
		if (!carries) {
			console.log("DEFECT PRESENT: the retry does not carry the observed reasoning spend — it is not asking for the room it just used up.");
			process.exitCode = 10;
		} else if (controlGrowth !== RETRY_OUTPUT_HEADROOM_TOKENS) {
			console.log(`CONTROL REGRESSION: a reply reporting no hidden thinking must keep the flat constant, got growth ${controlGrowth}.`);
			process.exitCode = 11;
		} else {
			console.log("DEFECT CLOSED: the retry carries the observed reasoning spend, and a zero-spend route is unchanged.");
			process.exitCode = 0;
		}
	}
}
