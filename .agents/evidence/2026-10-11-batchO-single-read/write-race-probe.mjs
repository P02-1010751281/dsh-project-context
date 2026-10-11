/**
 * Batch O evidence, write side — does the adopt journal bytes the file no longer holds?
 *
 * Same FIFO trick, this time driving the write path: `recordMemoryDocument` reads the render up
 * front, so under the replacement the key it hands to the adopt belongs to a version the path has
 * already dropped. Journalling that key pushes the journal's mtime past the replacement, so the
 * newer edit is shadowed from the read path and then overwritten by the next publish - it survives
 * nowhere.
 *
 * Read-only against the repo: imports the built `lib/` and writes only inside a throwaway root under
 * `$TMPDIR`. Run from anywhere:
 *
 *     node .agents/evidence/2026-10-11-batchO-single-read/write-race-probe.mjs
 *
 * Exit 0 = FIXED (the dropped version never reached the journal, the pass still published),
 * exit 10 = DEFECT (the journal holds the dropped version), exit 2 = UNOBSERVABLE,
 * exit 3 = OVERBLOCKED (the pass did not publish), exit 4 = UNREPORTED (no cause logged).
 */

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, open, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { memoryJournalFile, recordMemoryDocument } = await import(path.join(ROOT, "lib/project-memory/memory-store.js"));
const { memoryFile } = await import(path.join(ROOT, "lib/shared/project-state.js"));

const SEED = "# Project Memory\n\n- the memory the journal holds before the race.\n";
const OLDER = "# Project Memory\n\n- older bytes handed to the reader.\n";
const NEWER = "# Project Memory\n\n- external edit newer than the journal.\n";
const REPLY = "# Project Memory\n\n- this pass's reply.\n";
const LIMIT = 32_000;

const root = await mkdtemp(path.join(tmpdir(), "dsh-batchO-write-"));
try {
	await mkdir(path.join(root, ".agents", "memory"), { recursive: true });
	await recordMemoryDocument(root, SEED);
	const past = new Date(Date.now() - 60_000);
	await utimes(memoryJournalFile(root), past, past);
	const target = memoryFile(root);
	await rm(target, { force: true });
	execFileSync("mkfifo", [target]);

	const writing = recordMemoryDocument(root, REPLY, LIMIT);
	const watchdog = setTimeout(() => {
		console.error("FAIL: the FIFO fixture never got a reader within 30s");
		// The cleanup must never be the thing that stops the signal from ending the run.
		try {
			execFileSync("rm", ["-rf", root]);
		} catch {}
		process.kill(process.pid, "SIGKILL");
	}, 30_000);

	const writer = await open(target, "w");
	await writer.writeFile(OLDER);
	await rm(target);
	await writeFile(target, NEWER);
	await writer.close();

	const result = await writing;
	clearTimeout(watchdog);

	const journal = await readFile(memoryJournalFile(root), "utf8");
	const onDisk = await readFile(target, "utf8");
	const errors = await readFile(path.join(root, ".agents", "memory", "errors.log"), "utf8").catch(() => "");
	console.log(`journal holds dropped version : ${journal.includes("older bytes")}`);
	console.log(`reply published               : ${result.written === true}`);
	const refusal = errors.includes("the memory render changed before the memory journal could record the edit");
console.log(`refusal logged                : ${refusal}`);
	console.log(`on disk                       : ${onDisk.includes("this pass's reply") ? "the reply" : "something else"}`);

	if (!onDisk.includes("this pass's reply")) {
		console.error("RESULT: UNOBSERVABLE - the fixture did not stage the replacement under the read");
		process.exit(2);
	}
	if (journal.includes("older bytes")) {
		console.error("RESULT: DEFECT - the journal recorded a version the file had already dropped");
		process.exit(10);
	}
	if (!refusal) {
		console.error("RESULT: UNREPORTED - the refused append left no cause in errors.log");
		process.exit(4);
	}
	if (!result.written) {
		console.error("RESULT: OVERBLOCKED - the pass should still publish its reply");
		process.exit(3);
	}
	console.log("RESULT: FIXED - the dropped version never reached the journal and the pass still published");
	process.exit(0);
} finally {
	await rm(root, { recursive: true, force: true });
}
