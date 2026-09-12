/**
 * Build the browser half into the DSH client module-system bundle format.
 *
 * Emits `lib/client.js` as
 *   window.__ModuleLoader__.load({ id, factory: (require) => ... })
 * with `react` / `react/jsx-runtime` external (the web client seeds them).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const ID = "dsh-project-context";
const OUT = "lib/client.js";

const result = await build({
	entryPoints: ["client/index.ts"],
	bundle: true,
	format: "cjs",
	platform: "browser",
	target: "es2020",
	jsx: "automatic",
	external: ["react", "react/jsx-runtime"],
	write: false,
	logLevel: "warning",
});

const output = result.outputFiles?.[0];
if (!output) throw new Error("esbuild produced no output");

const body = output.text
	.split("\n")
	.map((line) => (line.length > 0 ? `\t\t${line}` : line))
	.join("\n");

const bundle = [
	"window.__ModuleLoader__.load({",
	`\tid: ${JSON.stringify(ID)},`,
	"\tfactory: (require) => {",
	"\t\tvar module = { exports: {} };",
	"\t\tvar exports = module.exports;",
	body,
	"\t\treturn module.exports;",
	"\t}",
	"});",
	"",
].join("\n");

await mkdir("lib", { recursive: true });
await writeFile(OUT, bundle, "utf8");
process.stdout.write(`built ${OUT} (${Buffer.byteLength(bundle, "utf8")} bytes)\n`);
