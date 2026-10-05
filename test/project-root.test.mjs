/**
 * The project-root lookup: the nearest `.git` entry wins, a `.git` *file* counts (a linked worktree or
 * a submodule), no entry anywhere falls back to the cwd, and the shipped source carries no command
 * capability — the only reason to import `child_process` was one `git rev-parse` per cwd.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { getProjectRoot, getProjectRootSync } from "../lib/shared/paths.js";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

/** A realpath'd temp project directory: the lookup resolves symlinks, so expectations must too. */
async function tempProject(label) {
	return realpath(await mkdtemp(path.join(tmpdir(), `dsh-project-root-${label}-`)));
}

function typescriptFiles(dir) {
	const found = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const target = path.join(dir, entry.name);
		if (entry.isDirectory()) found.push(...typescriptFiles(target));
		else if (/\.tsx?$/.test(entry.name)) found.push(target);
	}
	return found;
}

test("the nearest .git directory is the project root, and both variants agree", async () => {
	const root = await tempProject("dir");
	await mkdir(path.join(root, ".git"), { recursive: true });
	const nested = path.join(root, "packages", "one", "src");
	await mkdir(nested, { recursive: true });

	assert.equal(getProjectRootSync(nested), root);
	assert.equal(await getProjectRoot(nested), root);
});

test("a .git file counts as a root, so a linked worktree or submodule resolves", async () => {
	const root = await tempProject("file");
	await writeFile(path.join(root, ".git"), "gitdir: /elsewhere/.git/worktrees/one\n");
	const nested = path.join(root, "src");
	await mkdir(nested, { recursive: true });

	assert.equal(getProjectRootSync(nested), root);
	assert.equal(await getProjectRoot(nested), root);
});

test("the nearest .git wins over an outer one", async () => {
	const outer = await tempProject("outer");
	await mkdir(path.join(outer, ".git"), { recursive: true });
	const inner = path.join(outer, "packages", "inner");
	await mkdir(path.join(inner, ".git"), { recursive: true });
	const cwd = path.join(inner, "src", "deep");
	await mkdir(cwd, { recursive: true });

	assert.equal(getProjectRootSync(cwd), inner);
	assert.equal(await getProjectRoot(cwd), inner);
});

test("with no .git above it, a directory is its own project root", async () => {
	const root = await tempProject("bare");
	const nested = path.join(root, "work", "here");
	await mkdir(nested, { recursive: true });

	assert.equal(getProjectRootSync(nested), nested);
	assert.equal(await getProjectRoot(nested), nested);
});

test("the shipped source carries no command capability", () => {
	const hits = [];
	for (const dir of ["src", "client"]) {
		for (const file of typescriptFiles(path.join(repositoryRoot, dir))) {
			if (readFileSync(file, "utf8").includes("child_process")) hits.push(path.relative(repositoryRoot, file));
		}
	}
	assert.deepEqual(hits, [], "no shipped module may import child_process");
});
