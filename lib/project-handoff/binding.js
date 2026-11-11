/**
 * The continuation's own entry in the session store: which session it continues and which task it
 * belongs to.
 *
 * A handoff forks a session and dsh's session header has no parent field, so both facts exist only
 * if this write creates them. The task link is the load-bearing one: the memory plugin resolves a
 * session's slice of the project context through its own `meta.json` (`readSessionTaskSync`), so a
 * child left unbound would be seeded with the project-wide `CONTEXT.md` — the whole pack of
 * unrelated tasks the task dimension exists to separate — even though the session it continues was
 * bound to one of them. `kind: "handoff"` / `parentId` are what turn the session tree into a read
 * rather than a guess, and the archive write preserves both (`preserveForeign`).
 *
 * The write happens before the seed is admitted, because the child's first request resolves its
 * context from this file at admission; a later write would let that first turn see the project-wide
 * document instead. A failed handoff takes the file back, and the directory with it when this
 * attempt created it ({@link discardHandoffBinding}), since a metadata file with no archive would
 * otherwise become an index row whose link goes nowhere and an empty directory would count as an
 * archived session on disk.
 */
import { readdir, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { readOptional } from "../shared/files.js";
import { logsDir, safeSessionId } from "../shared/project-state.js";
import { readSessionTaskSync } from "../project-memory/tasks.js";
import { isDirectory, sessionMetaFile, writeSessionMeta } from "../project-context/session-meta.js";
/**
 * Record the continuation's parent link and task binding.
 * @param projectRoot - the project whose `session-logs/` holds the metadata.
 * @param parentSessionId - the session being continued.
 * @param childId - the continuation session.
 * @param title - the title to seed; the archive write refreshes it once the child has its own.
 * @param now - the clock, injectable so a test can pin the date.
 * @returns what was written, for {@link discardHandoffBinding}.
 */
export async function bindHandoffChild(projectRoot, parentSessionId, childId, title, now = new Date()) {
    const id = safeSessionId(childId);
    const task = readSessionTaskSync(projectRoot, parentSessionId);
    const meta = {
        id,
        date: now.toISOString().slice(0, 10),
        title,
        kind: "handoff",
        parentId: safeSessionId(parentSessionId),
        ...(task === undefined ? {} : { task }),
    };
    const dir = path.join(logsDir(projectRoot), id);
    // Read ownership before the write, because `writeSessionMeta` creates the directory: asking after
    // it landed would always answer "it existed".
    const createdDir = !(await isDirectory(dir));
    await writeSessionMeta(dir, meta);
    return { dir, meta, createdDir };
}
/**
 * Take back a binding whose handoff never landed.
 *
 * The archive owns this directory once it has written `session.jsonl`; removing the metadata then
 * would delete a real session's row on the next generation. Nothing else exists here yet, so the
 * only file to drop is the one this attempt wrote. The directory goes too when this attempt created
 * it and it is still empty: an empty `session-logs/<id>/` is invisible to generation but still a
 * directory on disk, so leaving it behind silently breaks "one row per directory" — the invariant
 * the index projection exists to hold — and the transaction's own promise that an abandoned handoff
 * leaves nothing behind in the project. `rmdir` rather than `rm -r`: anything that appeared after
 * the emptiness check must survive, and an over-eager recursive remove could delete an archive.
 * @param binding - what {@link bindHandoffChild} returned, or `undefined` when it never ran.
 */
export async function discardHandoffBinding(binding) {
    if (binding === undefined)
        return;
    try {
        if ((await readOptional(path.join(binding.dir, "session.jsonl"))).length > 0)
            return;
        await rm(sessionMetaFile(binding.dir), { force: true });
        if (!binding.createdDir)
            return;
        if ((await readdir(binding.dir)).length === 0)
            await rmdir(binding.dir);
    }
    catch {
        // The abort path must not raise a second error over the one that caused it.
    }
}
