#!/usr/bin/env node
/**
 * The core/host boundary gate.
 *
 * `src/host/` is the adapter layer: it owns every host package import, every `ctx.get(...)` lookup
 * and the plugin-lifecycle seam. Everything else is core and may reach the host only through
 * `host/contract.ts`, `host/dsh/*` and the `index.ts` wiring file of its own plugin.
 *
 * The script exists because a boundary that is only described in a document decays: one convenient
 * `import type { Session } from "@deepseek-ai/dsh-session"` in a core module re-couples it silently.
 * `--root` lets the tests feed known-bad trees.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, posix, resolve, sep } from "node:path";

const failures = [];

/** Root of the tree under test; the real repo unless a test fixture overrides it. */
function parseRoot(argv) {
	const index = argv.indexOf("--root");
	if (index === -1) return resolve(dirname(new URL(import.meta.url).pathname), "..");
	const value = argv[index + 1];
	if (value === undefined) throw new Error("--root needs a directory");
	return resolve(value);
}

function fail(check, detail) {
	failures.push(`${check}: ${detail}`);
}

function relative(root, path) {
	return path.startsWith(root) ? path.slice(root.length + 1).split(sep).join(posix.sep) : path;
}

/** Strip block and line comments so prose that names a host API does not trip the gate. */
function code(text) {
	return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function sourceFiles(root) {
	const files = [];
	const walk = (dir) => {
		if (!existsSync(dir)) return;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (entry.name.endsWith(".ts")) files.push(path);
		}
	};
	walk(join(root, "src"));
	return files;
}

const HOST_IMPORT = /from\s+"(@deepseek-ai\/[^"]+)"/g;
const LIBRARY_IMPORT = "@deepseek-ai/schemastery";
const SERVICES = /ctx\.(get|logger|llm|agents|skills|effect)\b/g;
const WIRING = /ctx\.(on|commands|systemPrompt)\b/g;

function check(root) {
	for (const file of sourceFiles(root)) {
		const rel = relative(root, file);
		const text = code(readFileSync(file, "utf8"));
		const inHost = rel.startsWith("src/host/");
		const isContract = rel === "src/host/contract.ts";
		const isEntry = /^src\/[^/]+\/index\.ts$/.test(rel);

		for (const match of text.matchAll(HOST_IMPORT)) {
			if (inHost) {
				if (!isContract) fail("single-door", `${rel} imports ${match[1]}; only src/host/contract.ts may name a host package`);
			} else if (match[1] !== LIBRARY_IMPORT) {
				fail("host-import", `${rel} imports ${match[1]}; route it through src/host/contract.ts`);
			}
		}

		if (!inHost) {
			for (const match of text.matchAll(SERVICES)) {
				fail("service-access", `${rel} touches ctx.${match[1]} directly; use src/host/dsh/*`);
			}
			if (!isEntry) {
				for (const match of text.matchAll(WIRING)) {
					fail("wiring", `${rel} uses ctx.${match[1]}; registration belongs in its plugin's index.ts`);
				}
			}
		}

		if (inHost) {
			for (const match of text.matchAll(/from\s+"((?:\.\.\/)+(?:project|shared)-[^"]+)"/g)) {
				fail("layering", `${rel} imports ${match[1]}; the host layer must not depend on a core or shared module`);
			}
		}
	}
}

const root = parseRoot(process.argv);
check(root);
for (const failure of failures) console.error(`FAIL ${failure}`);
console.log(`boundary check: ${sourceFiles(root).length} source file(s), ${failures.length} failure(s)`);
process.exitCode = failures.length === 0 ? 0 : 1;
