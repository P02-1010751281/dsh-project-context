/**
 * Expiry, pure half: the two facts about an entry that the disk can settle and a fingerprint cannot.
 *
 * Batch V answers "did a file this entry cites change". That is the weakest question one can ask — it is
 * neither necessary nor sufficient for the fact becoming false (measured 2026-11-21: 6 of 25 bound
 * entries stale, 1 genuinely wrong). These two are stronger because they falsify the entry's own words:
 *
 * - **task-closed** — the entry cites `.agents/memory/tasks/<slug>.md` and that task is archived. The
 *   fact may be moot, which is not the same as false: the entry can be history.
 * - **version-shipped** — the entry claims something is still unreleased *and* names a batch marker that
 *   now appears in a released `docs/changelog/v<version>.md`. The marker is the falsifier; an entry that
 *   merely mentions `未发布` (the release procedure) names no marker and never fires.
 *
 * This module only *derives*; it owns no verdict. `entryStateOf` is the single arbiter, and every state
 * it returns has an exit (`/memory reconcile --accept <id>`). Deliberately absent: "the entry says
 * something is undecided and the decision was made" — that is an intent, not a disk state, and a phrase
 * list would trade one error class for another.
 */
import type { TaskMode } from "../shared/config.js";
import type { TaskMeta } from "./tasks.js";
/** One entry as the fact builders need it: its id and its body. */
export interface EntryText {
    readonly tid: string;
    readonly text: string;
}
/** A released changelog: the file it lives in and its text. */
export interface ReleasedChangelog {
    readonly file: string;
    readonly text: string;
}
/** A task record as the fact builder needs it. */
export interface TaskFact {
    readonly slug: string;
    readonly meta: TaskMeta;
}
/** The task slugs an entry cites, in document order and without duplicates. */
export declare function taskReferences(entry: string): string[];
/** The batch markers in one entry, in document order and without duplicates. */
export declare function batchMarkers(entry: string): string[];
/**
 * True when the entry asserts an unreleased state.
 *
 * Required before the marker test means anything: the release-procedure entry also says `未发布`, but it
 * asserts no feature is waiting on a release, so nothing about it can be falsified by a changelog.
 */
export declare function claimsUnreleased(entry: string): boolean;
/** The markers that appear in at least one released changelog, with the file that carries each. */
export declare function shippedMarkers(markers: readonly string[], released: readonly ReleasedChangelog[]): Array<{
    marker: string;
    file: string;
}>;
/**
 * `tid -> the archived task documents it cites`, for the entries that cite a closed task.
 *
 * A slug with no task document is skipped: the reference may be prose, and inventing a closure from a
 * missing file would be the same wrong-cause class `anchorDriftReasons` refuses to commit.
 * @param entries - the document's entries, in document order.
 * @param tasks - every task document in the project.
 * @param options - the task mode and today's date, which decide the derived status.
 * @returns one map entry per closed task an entry cites.
 */
export declare function taskClosedFacts(entries: readonly EntryText[], tasks: readonly TaskFact[], options: {
    readonly mode: TaskMode;
    readonly today: string;
}): Map<string, string[]>;
/**
 * `tid -> the released changelog that falsifies its unreleased claim`.
 *
 * Only entries that assert an unreleased state are considered, and only markers they name count: an
 * entry that says "the procedure moves `未发布` into a changelog" claims no release state at all.
 * @param entries - the document's entries, in document order.
 * @param released - every released changelog, read once by the caller.
 * @returns one map entry per falsified claim, with the file and marker as evidence.
 */
export declare function shippedFacts(entries: readonly EntryText[], released: readonly ReleasedChangelog[]): Map<string, string[]>;
/** The batch markers a receipt may name before it stops being a receipt. */
export declare const MAX_MARKERS_PER_ENTRY = 2;
/**
 * True when a user-typed word names one of the states an acceptance may resolve.
 *
 * Accepting a retirable state (`superseded`, `anchor-drift`, `age-unconfirmed`) is a category error: the
 * remedy there is the retirement engine, not a receipt.
 * @param value - what the user typed, or the state the arbiter returned.
 * @returns whether it is a non-retiring state.
 */
export declare function acceptsEntry(value: string): boolean;
