/**
 * The **shim** that lists archived sessions from `.agents/memory/session-logs/`.
 *
 * Both read-only surfaces added in this batch — `/context find` and the `/context task` numbers —
 * need the same fact: the sessions this project archived, with their date, title and task binding.
 * Reading it twice in two shims would give the two commands two chances to disagree about which
 * session is bound to a task, so the walk lives here and each command consumes the DTOs.
 *
 * What it mirrors: the archive layout `<memory>/session-logs/<id>/meta.json` and the metadata shape
 * `session-meta.ts` writes (`id`, `date`, `title`, `kind`, `parentId`, `task`). A directory without a
 * readable `meta.json` is skipped rather than guessed at — `INDEX.md` is a projection of exactly those
 * files, so a directory that has none is not an archived session this reader can describe.
 *
 * Removal condition: none of its own. This is a filesystem layout, not a host API, and the layout is
 * the contract shared with pi; it disappears only when the archive moves off `.agents/memory`.
 */
/** One archived session, as the two read-only commands need it. */
export interface ArchivedSession {
    /** Directory name: the safe session id the archive uses as its path segment. */
    readonly id: string;
    /** Absolute directory, so a caller can read `session.md` or `HANDOFF.md` beside the metadata. */
    readonly dir: string;
    /** `YYYY-MM-DD` the archive recorded (the index's date column). */
    readonly date: string;
    readonly title: string;
    /** Task slug this session is bound to, when `meta.json` carries one. */
    readonly task?: string;
    /** `session`, `subagent` or `handoff`, when recorded. */
    readonly kind?: string;
}
/**
 * Every archived session, newest first.
 *
 * Newest first is the order both callers want: the search window is "the recent 20", and a task's
 * "last seen" is the newest of its sessions. The sort is total (date, then id) so two sessions
 * archived the same day cannot swap places between reads.
 * @param projectRoot - the project owning the archive.
 * @returns the sessions, newest first; an absent or unreadable archive is an empty list.
 */
export declare function listArchivedSessions(projectRoot: string): Promise<ArchivedSession[]>;
