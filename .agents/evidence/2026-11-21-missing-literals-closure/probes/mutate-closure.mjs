// Mutation round for the closure review. Patches a SANDBOX copy under /tmp (never the repository):
// /tmp/ml-closure/mut/{lib,test}. Each mutant is applied to the committed lib/, the named suites run,
// and the tree is restored before the next one.
//
// The CHANGELOG claims: "新增 13 条 ... 变异 8 个全部命中：配对前过滤、去掉整词检查、抬高样本上限、
// 回执不报、日志不写、回执条件反转、报告字段不携带、基线退回库里原文".
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const SB = "/tmp/ml-closure/mut";
const PRISTINE = "/mnt/Data/Projects/dsh-project-context";
const files = {
	ml: path.join(SB, "lib/project-memory/missing-literals.js"),
	idx: path.join(SB, "lib/project-memory/index.js"),
	cons: path.join(SB, "lib/project-memory/consolidate.js"),
};
const original = {
	ml: readFileSync(files.ml, "utf8"),
	idx: readFileSync(files.idx, "utf8"),
	cons: readFileSync(files.cons, "utf8"),
};

function restore() {
	writeFileSync(files.ml, original.ml);
	writeFileSync(files.idx, original.idx);
	writeFileSync(files.cons, original.cons);
}

function run(args) {
	let out;
	let ok = true;
	try {
		out = execFileSync(process.execPath, ["--test", ...args], { cwd: SB, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	} catch (error) {
		ok = false;
		out = `${error.stdout ?? ""}${error.stderr ?? ""}`;
	}
	const pass = /ℹ pass (\d+)/.exec(out)?.[1];
	const fail = /ℹ fail (\d+)/.exec(out)?.[1];
	const red = [...out.matchAll(/^\s*✖ (.+?) \(\d/gm)].map((m) => m[1]);
	return { ok, pass, fail, red: [...new Set(red)] };
}

const UNIT = ["test/missing-literals.test.mjs"];
const E2E = ["--test-name-pattern=backticked|deliberate retirement", "test/logic.test.mjs"];

function check(label, mutate) {
	restore();
	const note = mutate();
	const unit = run(UNIT);
	const e2e = run(E2E);
	const allOk = unit.ok && e2e.ok;
	console.log(`\n### ${label}${note ? ` — ${note}` : ""}`);
	console.log(`  unit: pass=${unit.pass} fail=${unit.fail} ${unit.ok ? "GREEN (mutant survived)" : `RED ${JSON.stringify(unit.red)}`}`);
	console.log(`  e2e : pass=${e2e.pass} fail=${e2e.fail} ${e2e.ok ? "GREEN (mutant survived)" : `RED ${JSON.stringify(e2e.red)}`}`);
	return !allOk; // caught?
}

const results = [];
results.push(check("baseline (unmutated)", () => ""));
results.push(check("M1 pair/filter inverted (filter short spans at the match stage)", () => {
	writeFileSync(files.ml, original.ml.replace(
		/export function backtickedLiterals\(text\) \{[\s\S]*?\n\}/,
		"export function backtickedLiterals(text) {\n    return [...new Set([...text.matchAll(/`([^`\\n]{3,})`/g)].map((m) => m[1].trim()))];\n}",
	));
}));
results.push(check("M2 token-boundary check removed (bare substring)", () => {
	writeFileSync(files.ml, original.ml.replace(
		"!kept.has(literal) && !mentionedAsToken(literal, bare)",
		"!kept.has(literal) && !next.includes(literal)",
	));
}));
results.push(check("M3 samples cap raised 10 -> 20", () => {
	writeFileSync(files.ml, original.ml.replace("export const MISSING_LITERAL_SAMPLES = 10;", "export const MISSING_LITERAL_SAMPLES = 20;"));
}));
results.push(check("M4 report field not carried", () => {
	writeFileSync(files.idx, original.idx.replace(/\n\s*\.\.\.\(wroteMemory && memoryLiteralLoss !== undefined \? \{ missingLiterals: memoryLiteralLoss \} : \{\}\),?/, ""));
}));
results.push(check("M5 receipt sentence not emitted", () => {
	writeFileSync(files.idx, original.idx.replace("return { kind: \"success\", text: `${updated}${verdict}${missing}` };", "return { kind: \"success\", text: `${updated}${verdict}` };"));
}));
results.push(check("M6 errors.log line not written", () => {
	writeFileSync(files.idx, original.idx.replace(/await logError\(projectRoot, "memory", `\$\{memoryLiteralLoss\.count\} backticked literal\(s\)[^`]*`\);/, "void memoryLiteralLoss;"));
}));
results.push(check("M7 receipt condition inverted (reports a lossless pass)", () => {
	writeFileSync(files.idx, original.idx.replace(
		"report.missingLiterals === undefined || report.missingLiterals.count === 0",
		"report.missingLiterals === undefined || report.missingLiterals.count > 0",
	));
}));
results.push(check("M8 baseline reverted to the stored document (basisKey)", () => {
	writeFileSync(files.idx, original.idx.replace("missingLiteralsBetween(outcome.shownMemory, snapshot.landed)", "missingLiteralsBetween(outcome.basisKey, snapshot.landed)"));
}));
results.push(check("M9 the pre-prompt retirement plan is skipped", () => {
	writeFileSync(files.cons, original.cons.replace("if (storedSectionsForPlan !== undefined) {", "if (false) {"));
}));
results.push(check("M10 measured from memoryText instead of the read-back (the residual)", () => {
	writeFileSync(files.idx, original.idx.replace("missingLiteralsBetween(outcome.shownMemory, snapshot.landed)", "missingLiteralsBetween(outcome.shownMemory, memoryText)"));
}));

restore();
rmSync(path.join(SB, "lib"), { recursive: true, force: true });
cpSync(path.join(PRISTINE, "lib"), path.join(SB, "lib"), { recursive: true });
console.log(`\nrestored; mutants caught: ${results.slice(1).filter(Boolean).length}/${results.length - 1}`);
console.log(`baseline alive: ${results[0] ? "NO (bad)" : "yes"}`);
