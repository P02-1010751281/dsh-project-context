/**
 * Pins the two direction conversions phase 2d closed, by compiling the shipped adapter.
 *
 * This is the acceptance criterion the 2d decision note asked for: a compiler-visible check that runs
 * on the pinned type baseline. The fixture imports the real `toHostRequest` and the real
 * `projectionsOf`, so the fixture program compiles those modules too — which is what makes a broken
 * adapter fail here rather than only in `pnpm typecheck`.
 *
 * Two independent failure modes are covered, and both used to be silent:
 *   - the outbound request: the port handed the host the contract's request object behind one
 *     `as unknown as` cast, so a field the host needs could be missing without a diagnostic;
 *   - the projection registry: the todo read cast a `todos` key through the snapshot parameter's own
 *     type, so a misspelled or upstream-renamed key typechecked and then read as an empty value.
 *
 * The negative fixture plants exactly those two mistakes (one dropped field, one misspelled key) and
 * the test asserts that nothing *else* is rejected — a broken adapter in `src/` therefore fails the
 * "no foreign diagnostics" assertion, which is exactly the mutation this test exists to catch.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const project = path.join(repoRoot, "test", "fixtures", "host-contract", "tsconfig.json");
const tsc = path.join(repoRoot, "node_modules", "typescript", "bin", "tsc");

test("both direction conversions are typed: the positive compiles and the negative is rejected twice", () => {
	const run = spawnSync(process.execPath, [tsc, "-p", project], { cwd: repoRoot, encoding: "utf8" });
	assert.equal(run.error, undefined, `tsc could not be started: ${String(run.error)}`);
	const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;

	// Every diagnostic must be one of the two planted ones: this also fails when the adapter itself
	// stops compiling, which is how a field dropped from `toHostRequest` or a key dropped from the
	// translation map surfaces here.
	const diagnostics = output.split("\n").filter((line) => line.includes("error TS"));
	const foreign = diagnostics.filter((line) => !line.includes("negative.ts"));
	const negative = diagnostics.filter((line) => line.includes("negative.ts"));

	assert.deepEqual(foreign, [], `the positive control and the adapter must compile clean:\n${output}`);
	assert.equal(negative.length, 2, `exactly the two planted mistakes must be rejected:\n${output}`);

	// Asserted by name, not by error code: a wording change in TypeScript must not turn this green.
	assert.match(output, /Property 'sessionId' is missing/, "the dropped field is the routing session every request names");
	const misspelled = negative.find((line) => line.includes("contextBreakdwon")) ?? "";
	assert.match(misspelled, /not assignable to type 'ProjectionKey'/, "the misspelled projection key is rejected against the closed union");
	assert.notEqual(run.status, 0, "a rejected fixture must leave tsc with a non-zero exit code");
});
