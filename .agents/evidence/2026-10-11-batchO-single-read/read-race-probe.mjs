/**
 * Batch O evidence, read side — does the pure read pair one version's bytes with another's mtime?
 *
 * A FIFO at the render's path makes the race deterministic: the writer hands the reader the OLD
 * bytes, and by the time the read returns the path already holds the replacement. The pre-fix read
 * took its `stat` after the read, so it labelled the older bytes with the newer file's mtime and
 * adopted them; the fixed read either reports `changed` or pairs bytes and time consistently.
 *
 * Read-only against the repo: imports the built `lib/` and writes only inside a throwaway root under
 * `$TMPDIR`. Run from anywhere:
 *
 *     node .agents/evidence/2026-10-11-batchO-single-read/read-race-probe.mjs
 *
 * Exit 0 = FIXED (the journal's fold stands, and a stable newer render still wins), exit 10 = DEFECT
 * (the older bytes were adopted), exit 2 = UNOBSERVABLE, exit 3 = OVERBLOCKED (a stable edit lost).
 */

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, open, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { loadMemory, memoryJournalFile, recordMemoryDocument } = await import(path.join(ROOT, "lib/project-memory/memory-store.js"));
const { memoryFile } = await import(path.join(ROOT, "lib/shared/project-state.js"));

const SEED = "# Project Memory\n\n- the memory the journal holds before the race.\n";
const OLDER = "# Project Memory\n\n- older bytes handed to the reader.\n";
const NEWER = "# Project Memory\n\n- external edit newer than the journal.\n";
const LIMIT = 32_000;

const root = await mkdtemp(path.join(tmpdir(), "dsh-batchO-race-"));
try {
	await mkdir(path.join(root, ".agents", "memory"), { recursive: true });
	await recordMemoryDocument(root, SEED);
	const past = new Date(Date.now() - 60_000);
	await utimes(memoryJournalFile(root), past, past);
	const target = memoryFile(root);
	await rm(target, { force: true });
	execFileSync("mkfifo", [target]);

	const reading = loadMemory(root, LIMIT);
	const watchdog = setTimeout(() => {
		console.error("FAIL: the FIFO fixture never got a reader within 30s");
		// The cleanup must never be the thing that stops the signal from ending the run.
		try {
			execFileSync("rm", ["-rf", root]);
		} catch {}
		process.kill(process.pid, "SIGKILL");
	}, 30_000);

	// A blocking "w" is the scheduling barrier: the write end returns only once the reader holds the
	// FIFO open, so the reader is guaranteed to take the older bytes before the path is replaced.
	const writer = await open(target, "w");
	await writer.writeFile(OLDER);
	await rm(target);
	await writeFile(target, NEWER);
	await writer.close();

	const loaded = await reading;
	clearTimeout(watchdog);

	const onDisk = await readFile(target, "utf8");
	console.log(`source        : ${path.basename(loaded.source)}`);
	console.log(`adopted older : ${loaded.text.includes("older bytes")}`);
	console.log(`file replaced : ${onDisk.includes("external edit newer")}`);

	if (!onDisk.includes("external edit newer")) {
		console.error("RESULT: UNOBSERVABLE - the fixture did not stage the replacement under the read");
		process.exit(2);
	}
	if (loaded.text.includes("older bytes")) {
		console.error("RESULT: DEFECT - the read adopted the older bytes wearing the newer file's mtime");
		process.exit(10);
	}
	// The other half of the pin: a stable newer render must still be adopted, or the guard is just a
	// blanket refusal of external edits.
	const stable = await loadMemory(root, LIMIT);
	console.log(`stable source : ${path.basename(stable.source)}`);
	if (!stable.text.includes("external edit newer")) {
		console.error("RESULT: OVERBLOCKED - a stable newer render was not adopted");
		process.exit(3);
	}
	console.log("RESULT: FIXED - the journal's fold stands through the replacement, and a stable edit still wins");
	process.exit(0);
} finally {
	await rm(root, { recursive: true, force: true });
}
