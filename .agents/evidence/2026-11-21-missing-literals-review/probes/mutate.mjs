// Mutation spot-check for the batch's tests: patch the SANDBOX copy of lib/ (never the repo),
// run the unit suite and the two new end-to-end cases, restore, repeat.
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const sb = "/tmp/mlreview/sandbox";
const ml = path.join(sb, "lib/project-memory/missing-literals.js");
const idx = path.join(sb, "lib/project-memory/index.js");
const pristine = { ml: readFileSync(ml, "utf8"), idx: readFileSync(idx, "utf8") };

function run(args) {
	try {
		const out = execFileSync(process.execPath, ["--test", ...args], { cwd: sb, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
		const pass = /ℹ pass (\d+)/.exec(out)?.[1];
		const fail = /ℹ fail (\d+)/.exec(out)?.[1];
		return `pass=${pass} fail=${fail}`;
	} catch (error) {
		const out = `${error.stdout ?? ""}${error.stderr ?? ""}`;
		const pass = /ℹ pass (\d+)/.exec(out)?.[1];
		const fail = /ℹ fail (\d+)/.exec(out)?.[1];
		const names = [...out.matchAll(/^\s*✖ (.+?) \(\d/gm)].map((m) => m[1]).slice(0, 3);
		return `pass=${pass} fail=${fail} red=${JSON.stringify(names)}`;
	}
}

const unit = ["test/missing-literals.test.mjs"];
const e2e = ["--test-name-pattern=backticked fact", "test/logic.test.mjs"];

function check(label, mutate) {
	writeFileSync(ml, pristine.ml);
	writeFileSync(idx, pristine.idx);
	const note = mutate();
	console.log(`\n### ${label}${note ? ` (${note})` : ""}`);
	console.log("  unit:", run(unit));
	console.log("  e2e :", run(e2e));
}

check("baseline (unmutated)", () => "");

check("M1 filter short spans at the match stage (pairing inverted)", () => {
	writeFileSync(ml, pristine.ml.replace(
		/export function backtickedLiterals\(text\) \{[\s\S]*?\n\}/,
		`export function backtickedLiterals(text) {\n    return [...new Set([...text.matchAll(/\`([^\`\\n]{3,})\`/g)].map((m) => m[1].trim()))];\n}`,
	));
	return "unit case 1 must go red";
});

check("M2 bare-text survival check removed", () => {
	writeFileSync(ml, pristine.ml.replace(".filter((literal) => !kept.has(literal) && !next.includes(literal))", ".filter((literal) => !kept.has(literal))"));
	return "unit case 2 must go red";
});

check("M3 samples cap raised 10 -> 20", () => {
	writeFileSync(ml, pristine.ml.replace("export const MISSING_LITERAL_SAMPLES = 10;", "export const MISSING_LITERAL_SAMPLES = 20;"));
	return "unit case 7 must go red";
});

check("M4 report field not carried", () => {
	writeFileSync(idx, pristine.idx.replace(/\n\s*\.\.\.\(wroteMemory && memoryLiteralLoss !== undefined \? \{ missingLiterals: memoryLiteralLoss \} : \{\}\),?/, ""));
	return "e2e (both) must go red";
});

check("M5 receipt sentence removed", () => {
	writeFileSync(idx, pristine.idx.replace("return { kind: \"success\", text: `${updated}${verdict}${missing}` };", "return { kind: \"success\", text: `${updated}${verdict}` };"));
	return "e2e positive must go red on the receipt assertion";
});

check("M6 errors.log line not written", () => {
	writeFileSync(idx, pristine.idx.replace(/await logError\(projectRoot, "memory", `\$\{memoryLiteralLoss\.count\} backticked literal\(s\)[^`]*`\);/, "void memoryLiteralLoss;"));
	return "e2e positive must go red on the log assertion";
});

check("M7 measurement taken from the reply instead of the landed bytes", () => {
	writeFileSync(idx, pristine.idx.replace("missingLiteralsBetween(outcome.basisKey, landed)", "missingLiteralsBetween(outcome.basisKey, memoryText)"));
	return "no test should notice — the reply and the landed bytes coincide in both fixtures";
});

writeFileSync(ml, pristine.ml);
writeFileSync(idx, pristine.idx);
console.log("\nrestored");
