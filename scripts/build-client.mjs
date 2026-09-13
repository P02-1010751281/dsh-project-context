/**
 * Build the browser half into the DSH client module-system bundle format.
 *
 * Emits the bundle named by `package.json` `exports["./client"]` as
 *   window.__ModuleLoader__.load({ id, factory: (require) => ... })
 * with `react` / `react/jsx-runtime` external (the web client seeds them).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Derived from package.json so the bundle id and output path cannot drift from
// the declaration the client module host scans when it composes the boot graph.
const root = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const ID = pkg.name;
const OUT = pkg.exports?.["./client"]?.default;
if (typeof ID !== "string" || typeof OUT !== "string") {
	throw new Error("package.json must declare a name and exports['./client'].default");
}
// Every path is anchored to this script's package, so the build does not depend on cwd.
const entry = path.join(root, "client", "index.ts");
const outFile = path.join(root, OUT);

const result = await build({
	entryPoints: [entry],
	bundle: true,
	format: "cjs",
	platform: "browser",
	target: "es2020",
	jsx: "automatic",
	external: ["react", "react/jsx-runtime"],
	write: false,
	logLevel: "warning",
});

const outputs = result.outputFiles ?? [];
if (outputs.length !== 1) throw new Error(`esbuild emitted ${outputs.length} outputs; expected exactly one bundle`);
const [output] = outputs;

// The body is embedded verbatim. Prefixing every line would also rewrite the
// contents of multi-line template literals (client/styles.ts ships CSS in one),
// silently changing strings rather than only indentation.
const bundle = [
	"window.__ModuleLoader__.load({",
	`\tid: ${JSON.stringify(ID)},`,
	"\tfactory: (require) => {",
	"\t\tvar module = { exports: {} };",
	"\t\tvar exports = module.exports;",
	output.text.replace(/\n$/, ""),
	"\t\treturn module.exports;",
	"\t}",
	"});",
	"",
].join("\n");

await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, bundle, "utf8");
process.stdout.write(`built ${OUT} (${Buffer.byteLength(bundle, "utf8")} bytes)\n`);
