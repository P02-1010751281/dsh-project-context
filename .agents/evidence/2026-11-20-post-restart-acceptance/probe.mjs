// Behavioural acceptance probe for the post-restart batch (acceptance, task-2).
// READ-ONLY: loadMemory / memoryStatusReply / formatMemoryStatus only read the store.
// Run: node .agents/evidence/2026-11-20-post-restart-acceptance/probe.mjs
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const PROJECT = "/mnt/Data/Projects/dsh-project-context";
const CAP = 52000;
const INSTALLED = "/home/user/.dsh/profiles/desktop/node_modules/dsh-project-context/lib";
const REPO = path.join(PROJECT, "lib");

const problems = [];
function check(id, ok, detail) {
  console.log(`[CHECK ${id}] ${ok ? "PASS" : "FAIL"} — ${detail}`);
  if (!ok) problems.push(id);
}

async function load(root) {
  const { loadMemory } = await import(`${root}/project-memory/load.js`);
  const { memoryStatusReply } = await import(`${root}/project-memory/index.js`);
  const { formatMemoryStatus } = await import(`${root}/project-memory/status-report.js`);
  const { memoryJournalFile } = await import(`${root}/project-memory/journal.js`);
  return { loadMemory, memoryStatusReply, formatMemoryStatus, memoryJournalFile };
}

function sha(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

console.log("=== module identity: installed copy vs repo lib ===");
for (const rel of [
  "project-memory/status-report.js",
  "project-memory/load.js",
  "project-memory/index.js",
  "project-memory/consolidate.js",
  "project-autolearn/pass.js",
  "shared/model-call.js",
]) {
  const a = sha(path.join(INSTALLED, rel));
  const b = sha(path.join(REPO, rel));
  console.log(`${a === b ? "SAME" : "DIFF"}  ${rel}  installed=${a}  repo=${b}`);
  check(`sha:${rel}`, a === b, "installed built file is byte-identical to repo lib");
}

const inst = await load(INSTALLED);
const repo = await load(REPO);
const journal = inst.memoryJournalFile(PROJECT);

console.log("\n=== ITEM 1: live /memory receipt (installed copy, cap 52000) ===");
const mem = await inst.loadMemory(PROJECT, CAP);
console.log(`journal path: ${journal}`);
console.log(`memory.source: ${mem.source}`);
console.log(`memory.text.length: ${mem.text.length}`);
console.log(`memory.cappedDroppedChars: ${mem.cappedDroppedChars}`);
console.log(`memory.damaged: ${mem.damaged ?? 0}  poisoned: ${mem.poisoned === true}  unreadable: ${mem.unreadable === true}`);

const reply = await inst.memoryStatusReply(mem, { projectRoot: PROJECT, journal, maxMemoryChars: CAP });
const lines = reply.text.split("\n");
console.log(`kind: ${reply.kind}`);
console.log(`text.length: ${reply.text.length}`);
console.log(`line count: ${lines.length}`);
lines.forEach((line, i) => console.log(`line[${i}] len=${line.length} ${JSON.stringify(line)}`));

const LINE1 = /^Memory: \d+\/52000 chars \(\d+%\) · \d+ entr(y|ies) \(Project \d+, Invariants \d+, Pitfalls \d+, Index \d+\)$/;
check("1a-line1", LINE1.test(lines[0]), `line 1 is the measurements form (${JSON.stringify(lines[0])})`);
check("1b-len", Number(lines[0].match(/^Memory: (\d+)\//)?.[1]) === mem.text.length, `line 1's printed length equals the loaded document length ${mem.text.length}`);
check(
  "1c-sections",
  /· \d+ entr(y|ies) \(Project \d+, Invariants \d+, Pitfalls \d+, Index \d+\)$/.test(lines[0]),
  "line 1 ends with the four-section entry counts",
);
const sourceLines = lines.filter((l) => l.startsWith("source "));
console.log(`source lines: ${JSON.stringify(sourceLines)}`);
check(
  "1d-source-conditional",
  mem.source === journal ? sourceLines.length === 0 : sourceLines.length === 1 && sourceLines[0] === `source ${mem.source}`,
  `source line present iff source !== journal (source ${mem.source === journal ? "===" : "!=="} journal)`,
);
const maxLen = Math.max(...lines.map((l) => l.length));
check("1e-max-line", maxLen < 416, `max line length ${maxLen} < the recorded old single-line 416 (CHANGELOG.md:38)`);
// Old (pre-ed167f4) shape: every clause joined by ` · `, led by `Memory: <source>`; the old code
// always printed the source path, which the multi-line layout now omits when it equals the journal.
const flat = `Memory: ${mem.source} · ${[lines[0].replace(/^Memory: /, ""), ...lines.slice(1)].join(" · ")}`;
console.log(`old single-line reconstruction length: ${flat.length}`);
console.log(`old single-line reconstruction (first 160 / last 120): ${JSON.stringify(flat.slice(0, 160))} … ${JSON.stringify(flat.slice(-120))}`);
check("1f-flat", flat.length >= 416, `flattening the same facts reproduces a >=416-char single line (${flat.length}) — this is the form the multi-line layout replaces`);

console.log("\n=== ITEM 1 (repo lib parity) ===");
const memRepo = await repo.loadMemory(PROJECT, CAP);
const replyRepo = await repo.memoryStatusReply(memRepo, { projectRoot: PROJECT, journal: repo.memoryJournalFile(PROJECT), maxMemoryChars: CAP });
check("1g-repo-parity", replyRepo.text === reply.text && replyRepo.kind === reply.kind, "repo lib renders the byte-identical receipt for the same facts");

console.log("\n=== ITEM 2: cap two-state (crafted reports, installed copy) ===");
const shortDoc = [
  "# Project Memory",
  "",
  "## Project",
  "- short",
  "",
  "## Invariants",
  "",
  "## Pitfalls",
  "",
  "## Index",
  "",
  "_[memory truncated at 52000 characters: 9621 dropped]_",
].join("\n");
const { isMemoryTruncated } = await import(`${INSTALLED}/project-memory/document.js`);
console.log(`crafted document length: ${shortDoc.length}; isMemoryTruncated: ${isMemoryTruncated(shortDoc)}`);
check("2a-marker-present", isMemoryTruncated(shortDoc), "the crafted document does carry a truncation marker (so the marker branch is reachable)");

function reportFor(document, cappedDroppedChars) {
  return {
    document,
    source: `${PROJECT}/.agents/memory/memory.jsonl`,
    expectedPath: `${PROJECT}/.agents/memory/MEMORY.md`,
    journalPath: `${PROJECT}/.agents/memory/memory.jsonl`,
    maxChars: CAP,
    damaged: 0,
    unreadable: false,
    poisoned: false,
    cappedDroppedChars,
    staleness: undefined,
    files: {
      // Crafted numbers, deliberately not the live store's — this case isolates the wording.
      journal: { kind: "present", lines: 2, bytes: 100 },
      backups: 1,
      archivedSessions: 2,
      errorLogLines: 0,
    },
  };
}

const stateA = inst.formatMemoryStatus(reportFor(shortDoc, 0));
console.log(`--- (a) marker + cappedDroppedChars:0 (len ${stateA.text.length}) ---`);
stateA.text.split("\n").forEach((l, i) => console.log(`a.line[${i}] len=${l.length} ${JSON.stringify(l)}`));
const aText = stateA.text;
check("2b-note", /^Note: MEMORY\.md still carries the marker of an earlier cap, but nothing was dropped from this read/m.test(aText), "(a) renders the Note line");
check("2c-no-cut", !aText.includes("this read is cut"), "(a) does not contain 'this read is cut'");
check("2d-no-refused", !aText.includes("read-capped-refused"), "(a) does not contain 'read-capped-refused'");
check("2e-no-warning", !aText.includes("Warning:"), "(a) does not render a Warning:");
const hasSourceA = aText.split("\n").some((l) => l.startsWith("source "));
console.log(`--- (a) source line present: ${hasSourceA} (source === journalPath here) ---`);

const stateB = inst.formatMemoryStatus(reportFor(shortDoc, 9621));
console.log(`--- (b) same document + cappedDroppedChars:9621 (len ${stateB.text.length}) ---`);
stateB.text.split("\n").forEach((l, i) => console.log(`b.line[${i}] len=${l.length} ${JSON.stringify(l)}`));
const bText = stateB.text;
check("2f-warning", bText.includes("Warning: MEMORY.md is at the 52000-character cap"), "(b) renders the Warning line");
check("2g-cut", bText.includes("this read is cut"), "(b) contains 'this read is cut'");
check("2h-refused", bText.includes("read-capped-refused"), "(b) contains 'read-capped-refused'");
check("2i-no-note", !bText.includes("Note:"), "(b) does not render the Note");
check("2j-differ", aText !== bText, "the same document renders differently under the two counts — the marker alone is not the discriminator");
console.log("NEGATIVE CONTROL: a renderer keyed on isMemoryTruncated alone would emit the Warning in case (a) and fail 2c/2d.");

const stateC = inst.formatMemoryStatus(reportFor("# Project Memory\n\n## Project\n- short\n", 0));
console.log(`--- (c) control: no marker + 0 (len ${stateC.text.length}) ---`);
check("2k-control", !stateC.text.includes("Note:") && !stateC.text.includes("Warning:"), "(c) neither marker nor cap drop renders no Note/Warning at all");

const noMarkerCut = inst.formatMemoryStatus(reportFor("# Project Memory\n\n## Project\n- short\n", 9621));
console.log(`--- (d) control: no marker + cappedDroppedChars:9621 (len ${noMarkerCut.text.length}) ---`);
check(
  "2o-count-alone",
  noMarkerCut.text.includes("Warning:") && !noMarkerCut.text.includes("Note:"),
  "(d) the cap count alone produces the Warning, with no marker in the document — the two states are independent",
);

console.log("\n=== ITEM 2 (repo lib parity) ===");
const repoA = repo.formatMemoryStatus(reportFor(shortDoc, 0));
const repoB = repo.formatMemoryStatus(reportFor(shortDoc, 9621));
check("2l-repo-parity", repoA.text === stateA.text && repoB.text === stateB.text, "repo lib renders byte-identical two-state receipts");

console.log("\n=== ITEM 2 (source-line conditional, crafted: source differs from journal) ===");
const differs = inst.formatMemoryStatus({
  ...reportFor("# Project Memory\n\n## Project\n- short\n", 0),
  source: `${PROJECT}/.agents/memory/MEMORY.md`,
});
const differsLines = differs.text.split("\n");
console.log(differsLines.map((l, i) => `d.line[${i}] ${JSON.stringify(l)}`).join("\n"));
check(
  "2m-source-present",
  differsLines.includes(`source ${PROJECT}/.agents/memory/MEMORY.md`),
  "a source line appears when source !== journal path",
);
const sameAsJournal = inst.formatMemoryStatus(reportFor("# Project Memory\n\n## Project\n- short\n", 0));
check(
  "2n-source-absent",
  !sameAsJournal.text.split("\n").some((l) => l.startsWith("source ")),
  "no source line when source === journal path (the journal line already names the file)",
);

console.log("\n=== ITEM 3: retry wiring, behavioural (installed copy) ===");
const { callWithToolsFallback } = await import(`${INSTALLED}/shared/model-call.js`);
const { readFileSync: readSrc } = await import("node:fs");

const consolidateSrc = readSrc(`${INSTALLED}/project-memory/consolidate.js`, "utf8");
const autolearnSrc = readSrc(`${INSTALLED}/project-autolearn/pass.js`, "utf8");
const modelCallSrc = readSrc(`${INSTALLED}/shared/model-call.js`, "utf8");

check(
  "3a-memory-declares",
  consolidateSrc.includes('extraCodes: ["MALFORMED_RESPONSE"]'),
  "installed lib/project-memory/consolidate.js contains `extraCodes: [\"MALFORMED_RESPONSE\"]` verbatim",
);
check(
  "3b-autolearn-silent",
  !autolearnSrc.includes("extraCodes") && !autolearnSrc.includes("MALFORMED_RESPONSE"),
  `installed lib/project-autolearn/pass.js mentions neither extraCodes nor MALFORMED_RESPONSE (${autolearnSrc.match(/extraCodes/g)?.length ?? 0} / ${autolearnSrc.match(/MALFORMED_RESPONSE/g)?.length ?? 0})`,
);
const shapes = modelCallSrc.match(/const REQUEST_SHAPE_CODES = new Set\(\[[^\]]*\]\);/)?.[0];
console.log(`REQUEST_SHAPE_CODES: ${shapes}`);
check(
  "3c-allowlist",
  shapes === 'const REQUEST_SHAPE_CODES = new Set(["INVALID_REQUEST", "HTTP_400", "HTTP_413"]);',
  "the shared allowlist is exactly INVALID_REQUEST / HTTP_400 / HTTP_413 (untouched, no MALFORMED_RESPONSE)",
);
const logLine = "the model's record_memory reply was unusable (${code}); the pass was retried once without tools";
check(
  "3d-log-line",
  consolidateSrc.includes(logLine) && !modelCallSrc.includes("record_memory reply was unusable"),
  "the retry log line exists verbatim in the memory pass (and not in the shared module, which owns no log)",
);

function codedError(code) {
  const error = new Error(`simulated ${code}`);
  error.code = code;
  return error;
}

async function exercise(options, offersTools = true) {
  const state = {};
  const seen = [];
  const retried = [];
  try {
    const outcome = await callWithToolsFallback(
      state,
      offersTools,
      async (withTools) => {
        seen.push(withTools);
        if (seen.length === 1) throw codedError(options.__code);
        return "retried-ok";
      },
      options.extraCodes === undefined && options.onRetry === undefined
        ? undefined
        : { extraCodes: options.extraCodes, onRetry: (code) => retried.push(code) },
    );
    return { outcome, seen, retried, state };
  } catch (error) {
    return { error: error.code ?? error.message, seen, retried, state };
  }
}

const memoryPolicy = await exercise({ __code: "MALFORMED_RESPONSE", extraCodes: ["MALFORMED_RESPONSE"], onRetry: () => {} });
console.log(`memory policy (extraCodes MALFORMED_RESPONSE): ${JSON.stringify(memoryPolicy)}`);
check(
  "3e-memory-retries",
  memoryPolicy.outcome === "retried-ok" && JSON.stringify(memoryPolicy.seen) === "[true,false]" && memoryPolicy.retried.length === 1 && memoryPolicy.state.toolsDisabled === true,
  "a MALFORMED_RESPONSE first call is retried exactly once, without tools, and onRetry fires once",
);

const autolearnPolicy = await exercise({ __code: "MALFORMED_RESPONSE" });
console.log(`autolearn policy (no options): ${JSON.stringify(autolearnPolicy)}`);
check(
  "3f-autolearn-no-retry",
  autolearnPolicy.error === "MALFORMED_RESPONSE" && JSON.stringify(autolearnPolicy.seen) === "[true]" && autolearnPolicy.retried.length === 0,
  "the same failure with no extraCodes throws immediately — the retry is opted into per caller, not global",
);

const shapeControl = await exercise({ __code: "INVALID_REQUEST" });
console.log(`shared-set control (INVALID_REQUEST, no options): ${JSON.stringify(shapeControl)}`);
check(
  "3g-shape-control",
  shapeControl.outcome === "retried-ok" && JSON.stringify(shapeControl.seen) === "[true,false]",
  "INVALID_REQUEST still spends the retry with no extraCodes — the shared request-shape set is intact",
);

const noTools = await exercise({ __code: "MALFORMED_RESPONSE", extraCodes: ["MALFORMED_RESPONSE"] }, false);
console.log(`no-tools-offered control: ${JSON.stringify(noTools)}`);
check(
  "3h-no-tools",
  noTools.error === "MALFORMED_RESPONSE" && noTools.seen.length === 1,
  "with no tools offered there is nothing to fall back from, so no retry even with extraCodes",
);

console.log(`\n=== SUMMARY: ${problems.length === 0 ? "ALL CHECKS PASS" : `FAILED ${problems.join(", ")}`} ===`);
process.exitCode = problems.length === 0 ? 0 : 1;
