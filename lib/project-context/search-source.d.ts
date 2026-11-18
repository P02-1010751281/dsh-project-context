/**
 * The **shim** behind `/context find`: `.agents/memory` on disk → the core's {@link SearchDoc} corpus.
 *
 * This is the only file in the search path that knows the archive layout, which files are documents
 * and how a line number is counted. `search.ts` folds those DTOs and stays host- and fs-free.
 *
 * What it mirrors:
 *  - `<memory>/MEMORY.md` — one line per `- ` entry (the four policy sections);
 *  - `<memory>/CONTEXT.md` — its sections and Open tasks;
 *  - `<memory>/tasks/<slug>.md` — one document per task;
 *  - `<memory>/session-logs/<id>/meta.json` — the session's title / task / kind / date, read as the
 *    file's own lines so `path:line` points at the line that matched;
 *  - `<memory>/session-logs/<id>/{HANDOFF.md,session.md}` — the handoff document and the rendered
 *    transcript, restricted to the most recent sessions (the archive can be large; the window is what
 *    bounds one query's read).
 *
 * Removal condition: none of its own — the layout is the contract shared with pi, not a host API. It
 * changes only when the archive moves off `.agents/memory`.
 *
 * Deliberately absent: a persistent index, an mtime cache and any write. Each file is added exactly
 * once by this walk, so the corpus needs no dedupe pass of its own.
 */
import { type SearchDoc } from "./search.js";
/** Sessions whose handoff document and transcript are searched; the archive beyond them is metadata only. */
export declare const DEFAULT_RECENT_SESSIONS = 20;
/** What one query may read. */
export interface SearchCorpus {
    readonly docs: readonly SearchDoc[];
    /** Archived sessions whose metadata entered the corpus. */
    readonly sessions: number;
}
/**
 * Read one query's corpus.
 *
 * Recency ranks feed the tiebreak only: the project's own documents (memory, context, tasks) are the
 * current state and rank `0`; session documents rank by their place in the newest-first archive list,
 * so two equally good hits prefer the session that happened later.
 * @param projectRoot - the project whose `.agents/memory` is read.
 * @param options - how many recent sessions contribute their transcript and handoff document.
 * @returns the corpus and how many sessions it covered.
 */
export declare function readSearchCorpus(projectRoot: string, options?: {
    recentSessions?: number;
}): Promise<SearchCorpus>;
