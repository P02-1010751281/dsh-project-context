/**
 * Mechanical session index: `<memory>/session-logs/INDEX.md`.
 *
 * One line per archived session, written without any model call — the archive
 * step (S0) owns it. The title comes from dsh's own `session/title` event,
 * falling back to the first user message. Later passes (autolearn backtracking,
 * handoff pointers) read the index to navigate the raw archive.
 */
import type { Session } from "@deepseek-ai/dsh-session";
export interface SessionIndexEntry {
    id: string;
    date: string;
    title: string;
    /** Absolute path of the session's Markdown rendering. */
    file: string;
    /** Absolute path of the canonical JSONL archive (the source for backtracking). */
    raw: string;
}
/**
 * Title from a bare event list: `session/title`, else the first user message a handoff did not
 * generate, else a fallback. Both harnesses that write into `.agents/` are read — dsh's named
 * events and pi's bare `message` event — so a pi archive imported by dsh gets the same title the
 * live path would.
 */
export declare function sessionTitleFromEntries(events: readonly unknown[]): string;
/** Title dsh itself assigned to the session, else the first user message, else a fallback. */
export declare function sessionTitle(session: Session): string;
/**
 * One Markdown index line from its parts. Links are relative to `session-logs/`.
 *
 * The link points at `session.jsonl`, the canonical log, rather than the rendered
 * `session.md`: the JSONL is what every reader actually opens (autolearn's backtrack,
 * the import completeness check) and it is never pruned, while the rendering is
 * reproducible from it and may be deleted to reclaim disk. Parsing ignores the target,
 * so both forms read identically.
 */
export declare function sessionIndexLineFrom(id: string, createdAt: number, title: string): string;
/** One Markdown index line. Links are relative to `session-logs/`. */
export declare function sessionIndexLine(session: Session, title?: string): string;
/**
 * Convert pre-move index links (`session-logs/<id>/session.md`) to the current relative form.
 * @param document - the legacy index body.
 * @returns the body with every link made relative to `session-logs/`.
 */
export declare function normalizeLegacyIndex(document: string): string;
/** Parse an INDEX.md body; unrecognized lines are ignored. */
export declare function parseSessionIndex(text: string): Array<{
    id: string;
    date: string;
    title: string;
}>;
/**
 * Whether an adopted file still has the size and mtime it had when it was read. Exported for its
 * own unit test: the check has to notice an *append* (same inode, new size/mtime), and the
 * end-to-end adoption test cannot reach that case — there the write replaces the path and so
 * changes the inode too, which an identity-based (and append-blind) check would also catch.
 */
export declare function untouchedSince(file: string, adopted: {
    size: number;
    mtimeMs: number;
}): Promise<boolean>;
/** Read the index with absolute paths so later passes can open the archives directly. */
export declare function readSessionIndex(projectRoot: string): Promise<SessionIndexEntry[]>;
/**
 * Insert or refresh this session's index line. Idempotent: a session keeps its place in the date
 * order, and the title is refreshed if dsh assigned a better one later.
 */
export declare function queueSessionIndexEntry(projectRoot: string, session: Session): Promise<void>;
/** Insert or refresh one index line (used by the live writer and the archive backfill). */
export declare function queueIndexLine(projectRoot: string, id: string, line: string): Promise<void>;
