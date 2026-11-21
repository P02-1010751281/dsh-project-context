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
import { deriveTaskStatus } from "./tasks.js";
/** `tasks/<slug>.md`, with or without the `.agents/memory/` prefix the real path carries. */
const TASK_REFERENCE = /(?:\/)?tasks\/([a-z0-9][a-z0-9-]*)\.md/g;
/** The task slugs an entry cites, in document order and without duplicates. */
export function taskReferences(entry) {
    const slugs = [];
    for (const match of entry.matchAll(TASK_REFERENCE)) {
        const slug = match[1];
        if (!slugs.includes(slug))
            slugs.push(slug);
    }
    return slugs;
}
/**
 * The batch markers an entry names (`Z8f`, `AA2b`, `Q2`, `T1`, `P0`).
 *
 * One or two upper-case letters, a number, an optional lower-case letter: wide enough for every marker
 * this repository uses, narrow enough that a version string, a hex id or an acronym with no number does
 * not match.
 */
const BATCH_MARKER = /\b([A-Z]{1,2}\d{1,2}[a-z]?)\b/g;
/** The batch markers in one entry, in document order and without duplicates. */
export function batchMarkers(entry) {
    const markers = [];
    for (const match of entry.matchAll(BATCH_MARKER)) {
        const marker = match[1];
        if (!markers.includes(marker))
            markers.push(marker);
    }
    return markers;
}
/**
 * True when the entry asserts an unreleased state.
 *
 * Required before the marker test means anything: the release-procedure entry also says `未发布`, but it
 * asserts no feature is waiting on a release, so nothing about it can be falsified by a changelog.
 */
export function claimsUnreleased(entry) {
    return entry.includes("未发布") || /\bunreleased\b/i.test(entry);
}
/** The markers that appear in at least one released changelog, with the file that carries each. */
export function shippedMarkers(markers, released) {
    const found = [];
    for (const marker of markers) {
        const needle = new RegExp(`\\b${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
        const hit = released.find((changelog) => needle.test(changelog.text));
        if (hit !== undefined)
            found.push({ marker, file: hit.file });
    }
    return found;
}
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
export function taskClosedFacts(entries, tasks, options) {
    const closed = new Map();
    for (const entry of entries) {
        for (const slug of taskReferences(entry.text)) {
            const task = tasks.find((record) => record.slug === slug);
            if (task === undefined)
                continue;
            if (deriveTaskStatus(task.meta, { mode: options.mode, today: options.today }) !== "archived")
                continue;
            const evidence = `tasks/${slug}.md (archived)`;
            const known = closed.get(entry.tid) ?? [];
            if (known.includes(evidence))
                continue;
            known.push(evidence);
            closed.set(entry.tid, known);
        }
    }
    return closed;
}
/**
 * `tid -> the released changelog that falsifies its unreleased claim`.
 *
 * Only entries that assert an unreleased state are considered, and only markers they name count: an
 * entry that says "the procedure moves `未发布` into a changelog" claims no release state at all.
 * @param entries - the document's entries, in document order.
 * @param released - every released changelog, read once by the caller.
 * @returns one map entry per falsified claim, with the file and marker as evidence.
 */
export function shippedFacts(entries, released) {
    const shipped = new Map();
    for (const entry of entries) {
        if (!claimsUnreleased(entry.text))
            continue;
        for (const hit of shippedMarkers(batchMarkers(entry.text), released)) {
            const evidence = `${hit.file} (${hit.marker})`;
            const known = shipped.get(entry.tid) ?? [];
            if (known.includes(evidence))
                continue;
            known.push(evidence);
            shipped.set(entry.tid, known);
        }
    }
    return shipped;
}
/** The batch markers a receipt may name before it stops being a receipt. */
export const MAX_MARKERS_PER_ENTRY = 2;
/**
 * True when a user-typed word names one of the states an acceptance may resolve.
 *
 * Accepting a retirable state (`superseded`, `anchor-drift`, `age-unconfirmed`) is a category error: the
 * remedy there is the retirement engine, not a receipt.
 * @param value - what the user typed, or the state the arbiter returned.
 * @returns whether it is a non-retiring state.
 */
export function acceptsEntry(value) {
    return value === "task-closed" || value === "version-shipped" || value === "content-stale";
}
