/**
 * Read-only eligibility dry run for this repository against DSH STORE's own policy module.
 *
 * The catalog automation reads a fixed Commit's tree and never runs install/prepare/build, so the
 * verdict is a pure function of (manifest, tree, policy). This script rebuilds that input from the
 * local checkout and calls DSH STORE's `reviewFixedSource` unchanged.
 *
 *   git clone --depth 1 --filter=blob:none --sparse ssh://git@ssh.github.com:443/AI-Scarlett/DSH-Store.git /tmp/dsh-store
 *   git -C /tmp/dsh-store sparse-checkout set src registry
 *   node .agents/evidence/2026-10-05-dsh-store-eligibility/eligibility-probe.mjs
 *
 * It writes nothing and imports no plugin code; `STORE_DIR` overrides the clone location and
 * `REPO_DIR` the checkout under review.
 */
import { readFileSync, statSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const storeDir = process.env.STORE_DIR ?? "/tmp/dsh-store";
const repo = process.env.REPO_DIR ?? process.cwd();
const { reviewFixedSource } = await import(path.join(storeDir, "src/fixed-source-review.mjs"));
const { permissionSignals } = await import(path.join(storeDir, "src/automation-source-policy.mjs"));

const manifest = JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8"));
const policy = JSON.parse(readFileSync(path.join(storeDir, "registry/automation-policy.json"), "utf8"));
const revision = execFileSync("git", ["-C", storeDir, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
// The candidate fields the automation derives from the manifest and the canonical repository.
const candidate = {
	repositoryUrl: "https://github.com/P02-1010751281/dsh-project-context",
	manifestPath: "package.json",
	installPath: null,
	compatibility: { dsh: ">=0.1.7-rc.2", node: manifest.engines?.node ?? null },
	details: { license: manifest.license },
	risk: { installScripts: [] },
};

const head = execFileSync("git", ["-C", repo, "ls-tree", "-r", "-l", "-z", "HEAD"], { cwd: repo, encoding: "utf8" });
const gitEntries = head.split("\0").filter(Boolean).map((line) => {
	const cut = line.indexOf("\t");
	const [mode, type, , size] = line.slice(0, cut).split(/\s+/);
	return { path: line.slice(cut + 1), mode, type, size: Number(size) || 0 };
});
const libTracked = gitEntries.some((entry) => entry.path.startsWith("lib/"));

function buildOutput() {
	const acc = [];
	(function walk(dir, rel) {
		for (const item of readdirSync(dir, { withFileTypes: true })) {
			const abs = path.join(dir, item.name);
			const next = rel ? `${rel}/${item.name}` : item.name;
			if (item.isDirectory()) walk(abs, next);
			else if (item.isFile()) acc.push({ path: next, mode: "100644", type: "blob", size: statSync(abs).size });
		}
	})(path.join(repo, "lib"), "lib");
	return acc;
}

const fromGit = (p) => execFileSync("git", ["-C", repo, "cat-file", "blob", `HEAD:${p}`], { maxBuffer: 1 << 23 }).toString("utf8");
const fromDiskOrGit = (p) => {
	try {
		return readFileSync(path.join(repo, p), "utf8");
	} catch {
		return fromGit(p);
	}
};

// When `lib/` is not tracked, the shipped surface is what a fixed Commit holds; adding the build
// output beside it models the candidate fix. Once `lib/` is tracked, HEAD is the whole answer.
const variants = libTracked
	? [["as committed (lib/ tracked)", { tree: gitEntries, truncated: false }, fromGit]]
	: [
			["as published (lib/ ignored)", { tree: gitEntries, truncated: false }, fromGit],
			["with lib/ committed", { tree: [...gitEntries, ...buildOutput()], truncated: false }, fromDiskOrGit],
		];

console.log(`DSH-Store revision ${revision}   policy sourceBounds ${JSON.stringify(policy.sourceBounds)}`);
console.log(`automaticApproval.permissionSignals ${JSON.stringify(policy.automaticApproval.permissionSignals)}\n`);

for (const [label, tree, readSource] of variants) {
	const review = await reviewFixedSource(candidate, manifest, tree, policy, readSource);
	console.log(`=== ${label}`);
	console.log(`approved: ${review.reasons.length === 0}   scanComplete: ${review.scanComplete}`);
	console.log(`scope: ${JSON.stringify(review.scope)}`);
	console.log(`runtimeFiles: ${review.runtimeFiles}  runtimeBytes: ${review.runtimeBytes}`);
	console.log(`signals: ${JSON.stringify(review.signals)}`);
	console.log(`reviewSignals: ${JSON.stringify(review.reviewSignals)}`);
	console.log(`reasons (${review.reasons.length}):`);
	review.reasons.forEach((reason, index) => console.log(`  ${index + 1}. ${reason}`));
	console.log("");
}

console.log("=== capability carriers on the shipped surface");
for (const entry of gitEntries) {
	if (!/\.(?:[cm]?[jt]sx?)$/i.test(entry.path) || !/^(?:lib|scripts)\//.test(entry.path)) continue;
	const hit = Object.entries(permissionSignals(fromGit(entry.path), entry.path)).filter(([, value]) => value).map(([key]) => key);
	if (hit.length || entry.mode === "100755") console.log(`  ${entry.mode}  ${hit.join(",") || "(exec bit only)"}  ${entry.path}`);
}
