/**
 * The todo dimension: the session's own todo list, folded mechanically into its context document.
 *
 * The consolidation pass rewrites a context document from a model reply, but the session's todo
 * list is not the model's to restate — dsh's `todo_write` tool owns it and its `todos` projection
 * is the only truthful copy (latest whole-list snapshot, `null` before a write and after the next
 * `turn/start`). So the unfinished items are copied into the document's Open tasks section as lines
 * carrying the `[todo]` prefix, and every other entry in that section is left byte-identical.
 *
 * The split is deliberate: prose stays a model decision, the work list does not. Two rules keep the
 * write cheap and quiet. An unchanged snapshot writes nothing — most turns do not move the list, and
 * a write per turn would rewrite `CONTEXT.md`'s mtime (and its git diff) for no content. A `null`
 * projection writes nothing at all: it means no todo write happened this turn, not that the work
 * finished, so the previous snapshot stands. An **empty** list is the deliberate "nothing left" and
 * does clear the mechanic lines.
 *
 * A pass must keep these lines too, or the mechanical write would be undone seconds after every
 * `turn/end` (the pass runs on the idle that follows it). Both callers apply the same function.
 */
import type { Session } from "@deepseek-ai/dsh-session";
import type { SessionProjectionRegistry } from "@deepseek-ai/dsh-session-projection";
/** The prefix that marks a line as mechanically maintained rather than model-authored. */
export declare const TODO_LINE_PREFIX = "[todo]";
/** What one status the tool declares can mean; anything else is not trusted. */
export type TodoStatus = "pending" | "in_progress" | "completed";
/**
 * The document lines one projection value stands for, or `undefined` when it has no opinion.
 *
 * `null` (and an absent or malformed value) means "no write happened", which must stay distinct
 * from an empty array: the first leaves a stored snapshot alone, the second is the tool saying
 * nothing is left. Completed items are omitted — an Open tasks section lists what is still open —
 * and an in-progress item keeps that fact, because the next reader's first question is which one
 * is being worked on.
 * @param value - the raw projection value.
 * @returns the rendered `- [todo] …` lines, or `undefined`.
 */
export declare function todoLines(value: unknown): string[] | undefined;
/** True for a line this module owns; the test and the pass both read it through {@link todoLinesIn}. */
export declare function isTodoLine(line: string): boolean;
/** One document with the mechanic lines it currently carries, in document order. */
export declare function todoLinesIn(text: string): string[];
/** The session's todo snapshot as document lines; `undefined` when it has no opinion. */
export declare function projectTodoLines(projections: SessionProjectionRegistry | undefined, session: Session): string[] | undefined;
/** What one mechanic write did; `changed` false means the caller must not touch the file. */
export interface TodoPatch {
    /** The document to store, or the input when nothing changed. */
    text: string;
    /** True when the document differs from the input. */
    changed: boolean;
    /** Items the Open tasks budget could not hold on this write; the caller reports it. */
    droppedItems: number;
}
/**
 * Replace the mechanic lines in a context document's Open tasks section.
 *
 * Only `- [todo] …` bullets are touched: the block is placed at the top of the section, any
 * placeholder (`- None recorded`) is removed so it cannot stand next to real entries, and a section
 * left with no bullets gets the placeholder back. Everything else — Summary, Key points, other Open
 * tasks entries, the trailing title comment and a truncation marker — stays byte-identical, which is
 * what makes this safe to run on a document a model just rewrote.
 *
 * The new lines are kept inside the Open tasks budget and the shared entry cap, because a mechanic
 * write that overflows would make the **next** pass clip model-authored entries to make room; items
 * that do not fit are counted instead of written, so the loss is reported rather than silent.
 * @param text - the stored context or task document.
 * @param lines - the rendered `- [todo] …` lines, in the order to write them.
 * @returns the (possibly) patched document.
 */
export declare function withTodoLines(text: string, lines: readonly string[]): TodoPatch;
/** One line for `errors.log` when a snapshot did not fit, naming where it was (not) written. */
export declare function todoFitNotice(target: string, droppedItems: number): string;
