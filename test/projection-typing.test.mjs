/**
 * Pins the type of the harness projection read that `src/project-handoff/runtime.ts` performs.
 *
 * The shim this replaced (`SessionProjectionsLike`) was a hand-written shape, so a wrong key was a
 * runtime `undefined` that the receipt then reported as "no contextBreakdown projection". The
 * declared types only buy something if the compiler actually rejects a wrong key, so this test runs
 * `tsc` over a control pair: the real key must compile and a one-character miss must not.
 *
 * Two independent failure modes land here, and both are the silent kind:
 *   - `ctx.get("sessionProjections")` resolving to its `get(name: string): any` overload;
 *   - `@deepseek-ai/dsh-token-meter`'s `SessionProjectionMap` augmentation not reaching the program,
 *     which is the only reason that import exists at all.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const project = path.join(repoRoot, "test", "fixtures", "projection-typing", "tsconfig.json");
const tsc = path.join(repoRoot, "node_modules", "typescript", "bin", "tsc");

test("the projection read is typed: the real key compiles, a near-miss key does not", () => {
	const run = spawnSync(process.execPath, [tsc, "-p", project], { cwd: repoRoot, encoding: "utf8" });
	assert.equal(run.error, undefined, `tsc could not be started: ${String(run.error)}`);
	const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;

	// No "tsc ran at all" guard here on purpose: if it did nothing, the assertion below fails anyway
	// (zero diagnostics in `negative.ts`), and a guard on "the output mentions a .ts file" would instead
	// blame a missing compile when the real cause is a read that silently widened to `any`.
	const diagnostics = output.split("\n").filter((line) => line.includes("error TS"));
	const positive = diagnostics.filter((line) => line.includes("positive.ts"));
	const negative = diagnostics.filter((line) => line.includes("negative.ts"));

	// The control: the read this plugin ships must typecheck. A failure here means the augmentation
	// stopped arriving, so the whole registry is no longer typed.
	assert.deepEqual(positive, [], `the control fixture must compile clean:\n${output}`);

	// The pin: exactly the typo, and nothing else. `any` would let this compile and produce zero
	// diagnostics, so an empty list here is the failure this test exists for.
	assert.equal(negative.length, 1, `exactly the near-miss key must be rejected:\n${output}`);
	assert.match(negative[0], /contextBreakdwon/, `the rejection must be the near-miss key:\n${negative[0]}`);
	assert.notEqual(run.status, 0, "a rejected fixture must leave tsc with a non-zero exit code");
});
