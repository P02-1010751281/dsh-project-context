/**
 * The session-log state machine, derived only.
 *
 * What this core has today is a directory, a `meta.json` and a row in `INDEX.md`, and its "state" was
 * whatever you inferred from whether the directory happened to exist. That inference is exactly what is
 * missing a report surface: the AOCI vocabulary the survey brought in — Missing, Orphan, Stale,
 * Unbaselined — names four failures of an index, and each one is decidable here without a model:
 *
 * - **missing**   — the index names a session whose directory is gone.
 * - **orphan**    — a directory the index does not name (the projection missed it).
 * - **unbaselined** — a directory with no `meta.json`, so nothing about it is recorded.
 * - **stale**     — the row disagrees with the directory's own `meta.json` (a mid-write, or a bug).
 *
 * Two more are this core's own: **dangling** (it continues a session that is no longer on disk) and the
 * healthy pair **live** / **settled**, split by activity so a report can say how much is still moving.
 *
 * Every state is derived from disk on each read and nothing is written: an explicit lifecycle recorded in
 * `meta.json` would be a second truth that can disagree with the directory, which is the defect this
 * module exists to report. The transitions that matter are therefore all *repairs* of the four failure
 * states (re-index, adopt the directory, rewrite the row), and none of them belongs to a read-only view.
 */
/** What one archived session's own files say about it, most certain first. */
export type SessionState = "missing" | "orphan" | "unbaselined" | "stale" | "abandoned" | "dangling" | "live" | "settled";
/** Every state, in the order a receipt counts them. */
export declare const SESSION_STATES: readonly SessionState[];
/** The states that mean the archive and its index disagree: what a repair would act on. */
export declare const BROKEN_SESSION_STATES: readonly SessionState[];
/**
 * How a receipt orders the broken states: worst first.
 *
 * A row naming a directory that is gone is evidence loss; an unindexed directory is one that can still be
 * adopted; a row that disagrees with its own meta is a projection bug, not a missing session. The order is
 * declared here rather than derived from the state list so the count order and the severity order can
 * never be silently tied together.
 */
export declare const SESSION_SEVERITY: readonly SessionState[];
/** Days without activity after which a healthy session reads as `settled` rather than `live`. */
export declare const SETTLED_DAYS = 7;
/** One row of `INDEX.md`, as the comparison needs it. */
export interface SessionRow {
    readonly date: string;
    readonly title: string;
}
/** One session directory, as the comparison needs it. */
export interface SessionDirFacts {
    /** Newest modification time among the directory's artifacts, in ms. */
    readonly activityMs: number;
    /** The parsed `meta.json`, or `undefined` when it is absent or unreadable. */
    readonly meta: (SessionRow & {
        readonly parentId?: string;
        readonly kind?: string;
    }) | undefined;
    /**
     * Human turns, measured only for a settled handoff continuation. `undefined` means "not measured",
     * which is different from zero: a session that was never read cannot be called abandoned.
     */
    readonly humanTurns?: number;
}
/** Everything the verdict reads, so the rules are testable without a filesystem. */
export interface SessionStateInput {
    /** Directory name -> its facts. */
    readonly dirs: ReadonlyMap<string, SessionDirFacts>;
    /** Row id -> its columns. */
    readonly rows: ReadonlyMap<string, SessionRow>;
    /** False when `INDEX.md` is absent: then every directory would look orphaned and nothing is claimed. */
    readonly indexPresent: boolean;
    readonly now: number;
    /** The configured boundary: a session with no activity for longer than this counts as settled, and an unread handoff continuation as abandoned. */
    readonly settledDays: number;
}
/** One session's verdict. */
export interface SessionVerdict {
    readonly id: string;
    readonly state: SessionState;
    /** The concrete evidence: a path, a date, or the parent id that is gone. */
    readonly detail: string;
}
/** The whole archive's verdict. */
export interface SessionStateReport {
    readonly indexPresent: boolean;
    readonly verdicts: readonly SessionVerdict[];
    readonly counts: Record<SessionState, number>;
}
/**
 * Judge every session the archive knows about, from the index side and the disk side together.
 *
 * A row with no directory and a directory with no row are different failures with different repairs, so
 * they are different states rather than one "mismatch". An absent index is reported as such instead of
 * turning every directory into an orphan — a scan that could not judge must not look like a full one.
 * @param input - both sides of the archive plus the clock.
 * @returns one verdict per session id, and the counts a receipt prints.
 */
export declare function sessionStates(input: SessionStateInput): SessionStateReport;
/** True for the states a repair would act on. */
export declare function brokenSession(state: SessionState): boolean;
/**
 * The `/session-log status` receipt.
 *
 * The first line carries the counts on purpose: the client folds a command card to one ellipsized line,
 * so a payload below it would be unreadable without expanding the card. Named entries follow, worst
 * state first, because a count with no id is not actionable.
 * @param report - the verdict for the whole archive.
 * @param named - how many broken sessions to name.
 * @returns the command text.
 */
export declare function sessionStatusReceipt(report: SessionStateReport, named?: number): string;
