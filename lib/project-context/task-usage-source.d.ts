/**
 * The **shim** behind the `/context task` list numbers: the archive and the task documents → the
 * core's {@link TaskUsageInput} rows.
 *
 * Two facts are read here and neither is re-derived:
 *  - which sessions are bound to a task: `meta.json`'s `task` field, listed once by
 *    `archive-source.ts` so the list and `/context find` cannot disagree about the archive;
 *  - how many items a task's Open tasks section still lists: `todoLinesIn` from
 *    `project-memory/todo.ts`, the reader that already owns the `- [todo] …` format. Re-implementing
 *    the pattern here would let the two readers drift the first time that format changes.
 *
 * Status derivation stays where it already lives — the command hands over the derived views
 * (`taskViews`), so this file never decides whether a task is active, dormant or archived.
 *
 * Removal condition: none of its own; it mirrors the `.agents/memory` layout, not a host API.
 */
import type { TaskUsageInput } from "./task-usage.js";
/** One task as the command already derived it; the fields this shim needs, nothing more. */
export interface TaskViewInput {
    readonly slug: string;
    readonly title: string;
    readonly status: string;
    /** The task document's own `lastSeen`. */
    readonly lastSeen: string;
    /** The task document, for its mechanically maintained todo lines. */
    readonly text: string;
}
/**
 * Collect each task's session dates and open todo lines.
 *
 * A session whose `meta.json` carries no task belongs to no row: the unbound ones use the project
 * context, and counting them against a task would inflate the number the column exists to make
 * trustworthy.
 * @param projectRoot - the project owning the archive.
 * @param views - the tasks, already status-derived by the caller.
 * @returns one input per task, in the order given.
 */
export declare function readTaskUsageInputs(projectRoot: string, views: readonly TaskViewInput[]): Promise<TaskUsageInput[]>;
