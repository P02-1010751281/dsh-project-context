/**
 * Batch O evidence, third face — does a render cleared by hand win the read?
 *
 * The comparison key of ANY render is at least the canonical bare header, so `memoryComparisonKey*`
 * never returns "" (`"" | " " | "\n\t "` -> `"# Project Memory\n"`, 17 chars). A guard written as
 * "an empty key means the file was cleared" therefore never fires, and a truncated or unreadable
 * `MEMORY.md` newer than the journal wins both readers - the model is shown "# Project Memory\n" and a
 * pass that built its reply from the fold is refused with "the newer content stays effective" naming
 * that skeleton. The decision has to test the render's TEXT (`render.text.trim()`), which is what
 * `externalRenderWins` does.
 *
 * Read-only against the repo: imports the built `lib/` and writes only inside a throwaway root under
 * `$TMPDIR`. Run from anywhere:
 *
 *     node .agents/evidence/2026-10-11-batchO-single-read/cleared-render-probe.mjs
 *
 * Exit 0 = FIXED, exit 10 = DEFECT (the cleared render won), exit 11 = DEFECT (a real pass was
 * refused in favour of the skeleton), exit 2 = UNOBSERVABLE, exit 3 = OVERBLOCKED.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { loadMemory, loadMemorySync, memoryJournalFile, recordMemoryDocument } = await import(path.join(ROOT, "lib/project-memory/memory-store.js"));
const { memoryFile } = await import(path.join(ROOT, "lib/shared/project-state.js"));

const SEED = "# Project Memory\n\n- the document the journal holds\n";
const REPLY = "# Project Memory\n\n- this pass's reply\n";
const LIMIT = 32_000;

const root = await mkdtemp(path.join(tmpdir(), "dsh-batchO-cleared-"));
try {
	await mkdir(path.join(root, ".agents", "memory"), { recursive: true });
	await recordMemoryDocument(root, SEED);
	const journal = memoryJournalFile(root);
	const fold = (await loadMemory(root)).text;

	// Hand-cleared after the journal was written, so it is newer than the journal.
	await writeFile(memoryFile(root), "", "utf8");
	const loaded = await loadMemory(root);
	const synced = loadMemorySync(root);
	console.log(`source               : ${path.basename(loaded.source)}`);
	console.log(`read is the fold     : ${loaded.text.includes("the document the journal holds")}`);
	console.log(`sync agrees          : ${synced === loaded.text}`);

	const result = await recordMemoryDocument(root, REPLY, LIMIT, { basisKey: fold });
	const onDisk = await readFile(memoryFile(root), "utf8");
	const errors = await readFile(path.join(root, ".agents", "memory", "errors.log"), "utf8").catch(() => "");
	console.log(`pass published       : ${result.written === true}`);
	console.log(`wrong-cause refusal  : ${errors.includes("the memory changed while this pass's reply was being built")}`);

	if (loaded.text.trim() === "# Project Memory") {
		console.error("RESULT: DEFECT - the cleared render won the read and the journal's document was lost to the prompt");
		process.exit(10);
	}
	if (!loaded.text.includes("the document the journal holds") || !synced.includes("the document the journal holds")) {
		console.error("RESULT: UNOBSERVABLE - the fixture did not stage a journal-backed fold");
		process.exit(2);
	}
	if (errors.includes("the memory changed while this pass's reply was being built")) {
		console.error("RESULT: DEFECT - a real pass was refused and the bare header was called the newer content");
		process.exit(11);
	}
	if (!result.written || !onDisk.includes("this pass's reply")) {
		console.error("RESULT: OVERBLOCKED - the pass did not publish");
		process.exit(3);
	}
	console.log("RESULT: FIXED - a cleared render leaves the journal in charge and the pass still publishes");
	process.exit(0);
} finally {
	await rm(root, { recursive: true, force: true });
}
