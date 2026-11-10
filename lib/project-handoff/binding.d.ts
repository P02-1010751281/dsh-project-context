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
 * document instead. A failed handoff takes the file back ({@link discardHandoffBinding}), since a
 * metadata file with no archive would otherwise become an index row whose link goes nowhere.
 */
import { type SessionMeta } from "../project-context/session-meta.js";
/** What the handoff recorded for its child, and where, so an abandoned attempt can take it back. */
export interface HandoffBinding {
    /** The child's session directory. */
    dir: string;
    /** The metadata that landed. */
    meta: SessionMeta;
}
/**
 * Record the continuation's parent link and task binding.
 * @param projectRoot - the project whose `session-logs/` holds the metadata.
 * @param parentSessionId - the session being continued.
 * @param childId - the continuation session.
 * @param title - the title to seed; the archive write refreshes it once the child has its own.
 * @param now - the clock, injectable so a test can pin the date.
 * @returns what was written, for {@link discardHandoffBinding}.
 */
export declare function bindHandoffChild(projectRoot: string, parentSessionId: string, childId: string, title: string, now?: Date): Promise<HandoffBinding>;
/**
 * Take back a binding whose handoff never landed.
 *
 * The archive owns this directory once it has written `session.jsonl`; removing the metadata then
 * would delete a real session's row on the next generation. Nothing else exists here yet, so the
 * only file to drop is the one this attempt wrote. The empty directory is skipped by generation (no
 * metadata and no archive header), and the child's own archive recreates it.
 * @param binding - what {@link bindHandoffChild} returned, or `undefined` when it never ran.
 */
export declare function discardHandoffBinding(binding: HandoffBinding | undefined): Promise<void>;
