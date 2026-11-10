/**
 * Batch Z4 — the cleaning channel: the only path in this plugin that deletes.
 *
 * Four local artifacts grow without a floor: byte-level backups of `MEMORY.md`, archived journals,
 * the append-only `errors.log`, and autolearn's candidate notes. Before this module each had (at
 * most) a burst guard next to its writer, and none of them had a durable floor.
 *
 * Two rules shape every line below:
 *
 *  1. **Nothing is deleted before it is in a tarball.** The archive is written and verified against
 *     its own listing first; a plan whose bytes cannot be archived deletes nothing at all. A deletion
 *     that cannot be undone is not worth the disk space it reclaims.
 *  2. **The session archives are never candidates, and neither is the live journal.** They are the
 *     timeline, and the timeline is the audit trail two of batch Z2's three retirement triggers read
 *     ("superseded" and "unconfirmed"); deleting a session directory would silently disable them.
 *     This is why the planner only ever looks at generated names in the memory directory itself.
 *
 * The module never throws: cleaning runs after every consolidation pass, so a failure here must not
 * turn a landed write into a failed command. Every applied run appends exactly one line to
 * `purge.log` (time / targets / bytes / result); the manual preview writes nothing.
 */
/** Byte-level backups kept, newest first. The render names the newest one, so it always survives. */
export declare const PRUNE_BACKUPS_KEPT = 3;
/** Archived journals (`memory-log-*.jsonl`) older than this are reclaimable. */
export declare const PRUNE_JOURNAL_AGE_MS: number;
/** Autolearn candidate notes older than this are reclaimable. */
export declare const PRUNE_CANDIDATE_AGE_MS: number;
/** What an applied run does with one candidate. */
export type PruneAction = "remove" | "truncate";
/** One reclaimable artifact, named relative to the memory directory so it is also a tar entry. */
export interface PruneCandidate {
    /** Path relative to `<memory>/`; used verbatim as the tar member name. */
    name: string;
    bytes: number;
    /** Why this file is a candidate, in the same words the receipt and `purge.log` use. */
    reason: "byte-backup" | "journal-archive" | "journal-temp" | "error-log" | "skill-candidate";
    action: PruneAction;
}
export interface PrunePlan {
    candidates: PruneCandidate[];
    /** Total bytes that leave the directory (a truncation counts its original size). */
    bytes: number;
}
export interface PruneOutcome {
    status: "preview" | "nothing" | "applied" | "partial" | "failed";
    plan: PrunePlan;
    /** The tarball holding every removed byte, when one was written. */
    trash?: string;
    removed: number;
    truncated: number;
    /** Candidates that were planned but could not be removed (a partial run says how many). */
    failed: number;
    error?: string;
}
/**
 * Name the files this project may delete, without touching any of them.
 *
 * Every branch reads the directory entry's own type (`isFile()`), so a symlink is never followed and
 * never a candidate — a link's target lives outside the tree this module owns.
 * @param projectRoot - the project root.
 * @param now - the clock age rules are measured against; injectable for tests.
 * @returns the plan, deterministic in name order.
 */
export declare function planPrune(projectRoot: string, now?: number): Promise<PrunePlan>;
/** A receipt- and log-friendly size: the plan can hold a megabyte-sized log next to a 300-byte note. */
export declare function formatBytes(bytes: number): string;
/** The members a tarball carries, by the format's own rules (how a verifying reader sees it). */
export declare function readTarNames(archive: Buffer): string[];
/**
 * Clean this project's memory directory.
 *
 * `apply: false` is the preview: it reports the plan and writes nothing, not even a log line — the
 * point of a dry run is that a look leaves no trace. `apply: true` archives, deletes and logs; the
 * automatic path passes the same flag as `/memory prune --apply`, so the two can never disagree
 * about what is deleted. A run with nothing to do logs a line only when it was asked for explicitly,
 * so an idle project does not grow `purge.log` by one line per consolidation pass.
 * @param projectRoot - the project root.
 * @param options.apply - false for a preview.
 * @param options.reason - `auto` (after a consolidation pass) or `manual` (`/memory prune --apply`).
 * @param options.now - the clock age rules are measured against; injectable for tests.
 * @returns what was planned and what actually happened.
 */
export declare function pruneProjectMemory(projectRoot: string, options: {
    apply: boolean;
    reason: "auto" | "manual";
    now?: number;
}): Promise<PruneOutcome>;
