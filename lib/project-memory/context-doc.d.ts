/**
 * Context-document rendering: the rolling session summary, key points, and open tasks.
 *
 * `CONTEXT.md` is one instance; a task document (`tasks/<slug>.md`) is the same document bound to a
 * different owner, differing only in its header and stamp lines. Both render through one section
 * path so the schema, the budgets and the marker stay single-sourced.
 *
 * The fixed sections and their per-section budgets come from `context-schema.ts`, shared with the
 * consolidation prompt. Over budget a section is clipped on a line boundary and the document ends
 * with an explicit truncation marker instead of a bare `slice()`: a silently clipped CONTEXT.md
 * used to be indistinguishable from a complete one.
 *
 * Ported from pi's `extensions/project-context/memory/context-doc.ts`.
 */
import { type ContextUpdate } from "../shared/reply-json.js";
import { type TaskMeta } from "./tasks.js";
export declare function renderContextDocument(update: ContextUpdate, options: {
    updatedAt: string;
}): string;
/**
 * The document for one task: the same three sections, with the task's own header and metadata line
 * where the context carries its `Last updated` stamp.
 *
 * A task file is not a second context format — it is the same document bound to a different owner,
 * so the model's reply renders here unchanged. The metadata line is the only authored state in the
 * file (`created`), the status is re-derived from `lastSeen` on every read, and `title` gives the
 * "other tasks" list a label without opening the body.
 * @param update - the consolidation reply's context section.
 * @param options - the document's date, slug and metadata as stored before this write.
 * @returns the rendered task document and the characters its section clips dropped.
 */
export declare function renderTaskDocument(update: ContextUpdate, options: {
    updatedAt: string;
    slug: string;
    meta: TaskMeta;
}): {
    text: string;
    dropped: number;
};
