/**
 * The documentation gate must fail closed.
 *
 * The pass direction is the repository itself; the fail directions are deliberately malformed
 * fixtures, because a checker that only ever prints "0 failures" proves nothing (RULES 6.7).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const SCRIPT = path.resolve("scripts/check-docs.mjs");

function run(root) {
	return spawnSync(process.execPath, [SCRIPT, "--root", root], { encoding: "utf8" });
}

async function fixture(files) {
	const root = await mkdtemp(path.join(tmpdir(), "dsh-docgate-"));
	for (const [name, body] of Object.entries(files)) {
		const target = path.join(root, name);
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, body, "utf8");
	}
	return root;
}

test("the repository passes its own documentation gate", () => {
	const result = run(process.cwd());
	assert.equal(result.stderr, "", result.stderr);
	assert.equal(result.status, 0, result.stdout + result.stderr);
	assert.match(result.stdout, /0 failure\(s\)/);
});

test("a link that does not resolve from the document directory fails", async () => {
	const root = await fixture({ "docs/page.md": "see [gone](./not-here.md)\n" });
	const result = run(root);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /FAIL link: docs\/page\.md -> \.\/not-here\.md/);
});

test("an anchor past the end of its file fails", async () => {
	const root = await fixture({
		"RULES.md": "ref `src/a.ts:9`\n",
		"src/a.ts": "one\ntwo\nthree\n",
	});
	const result = run(root);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /FAIL anchor: RULES\.md:1 -> src\/a\.ts:9/);
});

test("a symbol named next to an anchor must be present at it", async () => {
	const root = await fixture({
		"RULES.md": "`claimSym`（`src/a.ts:1`）\n",
		"src/a.ts": "export function realThing(): void {}\n",
	});
	const result = run(root);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /FAIL symbol: RULES\.md:1 claims claimSym/);
});

test("a declared oversized-file baseline that no longer matches fails", async () => {
	const body = Array.from({ length: 901 }, (_, index) => `// line ${index + 1}`).join("\n") + "\n";
	const root = await fixture({
		"RULES.md": "`src/big.ts` 900 行\n",
		"src/big.ts": body,
	});
	const result = run(root);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /FAIL baseline: RULES\.md says src\/big\.ts is 900 lines; it is 901/);
});

test("an import outside the architecture whitelist fails", async () => {
	const root = await fixture({
		"RULES.md": "refs\n",
		"docs/architecture.md": "## 2 分层\n\n| 边 | 证据 |\n|---|---|\n\n## 3 next\n",
		"src/project-context/leak.ts": 'import { x } from "../project-memory/tasks.js";\n',
	});
	const result = run(root);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /FAIL edges: src\/project-context\/leak\.ts:1 is not in the architecture whitelist/);
	assert.match(result.stderr, /specifier \.\.\/project-memory\/tasks\.js is not in the architecture specifier list/);
});
