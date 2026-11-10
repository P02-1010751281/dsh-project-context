/**
 * The task dimension: one context-shaped document per task, and the states it moves through.
 *
 * A project can host several unrelated workflows at once, but `CONTEXT.md` is one file and the
 * consolidation pass rewrites its Open tasks wholesale — so two sessions working on different
 * things overwrite each other's list. A task is the unit that separates them: `.agents/memory/
 * tasks/<slug>.md` holds one workflow's Summary / Key points / Open tasks, a session declares which
 * task it belongs to with `/context task <slug>`, and the declaration is persisted in that
 * session's `meta.json` so a restart cannot lose it.
 *
 * **Status is derived, never stored twice.** A document carries `created` / `status` / `lastSeen`,
 * but only `archived` is an authored value: `active` and `dormant` follow from the age of
 * `lastSeen`, so a task whose session was active yesterday cannot be reported dormant because some
 * sweep did not run. That is the same rule as the session index — a state that can disagree with
 * the evidence is the bug, so do not persist what can be computed.
 *
 * **The mode is a creation ladder, not a switch.** `manual` freezes the stored status (no age
 * derivation at all), `assisted` derives it and refuses to invent a task from a bare slug,
 * `delegated` additionally lets a bare slug create its own file. The spec's "the model may propose
 * a task" half has no channel yet — this package registers no tool — so the confirmation is
 * enforced at the command instead: a slug naming no existing task is refused with the exact
 * command that would create it.
 */
import type { TaskMode } from "../shared/config.js";
/** The three states a task can be in. Only `archived` is authoritative on disk. */
export type TaskStatus = "active" | "dormant" | "archived";
export declare const TASK_STATUSES: readonly TaskStatus[];
export declare const TASK_MODES: readonly TaskMode[];
/** Days without activity before a task reports `dormant`. */
export declare const TASK_DORMANT_DAYS = 30;
/**
 * Days without activity before a task reports `archived`. The spec words this as "dormant for 90
 * days", which in derived terms is simply "no activity for 90 days": dormant is not a stored state,
 * so the only observable boundary is the age of `lastSeen`. Acceptance criterion ③ in §11.8 states
 * the same number as a test (`91` days), and that is the one this constant matches.
 */
export declare const TASK_ARCHIVE_DAYS = 90;
/** The metadata a task document carries under its `# Project Task:` heading. */
export interface TaskMeta {
    /** `YYYY-MM-DD` the document was created. */
    created: string;
    /** The stored status. `active`/`dormant` are placeholders refreshed on write; `archived` is authored. */
    status: TaskStatus;
    /** `YYYY-MM-DD` of the last activity (a bind, or a document write). */
    lastSeen: string;
    /** Human label for the "other tasks" list; seeded with the slug and refreshed by each write. */
    title: string;
}
/** One task as read from disk. */
export interface TaskRecord {
    slug: string;
    meta: TaskMeta;
    text: string;
}
/** A task with the status derived for the caller's mode and date. */
export interface TaskView extends TaskRecord {
    status: TaskStatus;
}
/** Slugs are file names, so they take the same kebab-case rule the skill directory uses. */
export declare function validTaskSlug(slug: string): boolean;
/** `YYYY-MM-DD` for one instant, in UTC — the convention `session-meta.ts` and `retirement.ts` use. */
export declare function dateStamp(now?: Date): string;
/** Whole days from one `YYYY-MM-DD` to another, or `undefined` when either is malformed. */
export declare function daysBetween(from: string, to: string): number | undefined;
/** The heading every task document carries; the slug is the document's identity, not its title. */
export declare function taskHeader(slug: string): string;
/** `> created 2026-11-10 · status active · lastSeen 2026-11-10 · title Release prep` */
export declare function taskMetaLine(meta: TaskMeta): string;
/**
 * The metadata line of a task document, or `undefined` when the document carries none.
 *
 * Only the first matching line is read: a document is rendered with exactly one, and a later
 * look-alike (a quote inside a summary) must not be able to republish a status.
 */
export declare function parseTaskMeta(text: string): TaskMeta | undefined;
/**
 * The status a task reports today.
 *
 * An authored `archived` always wins: archiving is a decision, and a later write must not silently
 * reopen a task the user closed. Otherwise `lastSeen` decides — stale past the dormant horizon,
 * `delegated` also archives past the archive horizon. `manual` keeps the stored value untouched,
 * because that mode's contract is that nothing changes a status but an explicit command.
 * @param meta - the stored metadata.
 * @param options - the project's mode and today's date.
 * @returns the status the caller should report and act on.
 */
export declare function deriveTaskStatus(meta: TaskMeta, options: {
    mode: TaskMode;
    today: string;
}): TaskStatus;
/** Read one task document asynchronously; a missing file and an unparseable one both read as absent. */
export declare function readTask(projectRoot: string, slug: string): Promise<TaskRecord | undefined>;
/**
 * Synchronous cached read for prompt assembly: same bytes as {@link readTask}, no await.
 *
 * Prompt assembly cannot block, so this is the reader the injection uses; `readTextCachedSync`
 * re-reads only when the file's mtime or size changed.
 */
export declare function readTaskSync(projectRoot: string, slug: string): TaskRecord | undefined;
/** Every valid task file, sorted by slug. One unreadable document must not hide the rest. */
export declare function listTasks(projectRoot: string): Promise<TaskRecord[]>;
/** The synchronous counterpart of {@link listTasks}, for the injection provider. */
export declare function listTasksSync(projectRoot: string): TaskRecord[];
/** A project with no task documents at all: the injection must then stay byte-identical to today. */
export declare function hasTasks(projectRoot: string): boolean;
/**
 * The task slug a session is bound to, read from its own `meta.json`.
 *
 * The binding lives on disk rather than in process memory on purpose: a restart, a resumed session
 * and a different process must all see the same answer, and `meta.json` is already the session's
 * truth source (`Z1`). A malformed file reads as unbound instead of failing the prompt.
 */
export declare function readSessionTaskSync(projectRoot: string, sessionId: string | undefined): string | undefined;
/** Replace one task document; the caller has already rendered its bytes. */
export declare function writeTaskDocument(projectRoot: string, slug: string, text: string): Promise<void>;
/**
 * The task a session is bound to and that is still in use, or `undefined`.
 *
 * The single read used by both halves of the dimension: the prompt shows this task's document, and
 * the pass writes it. An `archived` task is bound but not in use — its document stays on disk to be
 * read, and the session falls back to the project-level context, exactly as the state table says
 * (archived is the one state that is not injected). Keeping that rule in one function is what stops
 * the prompt and the write from disagreeing about which file this session owns.
 * @param projectRoot - the project owning the task documents.
 * @param sessionId - the live session's id.
 * @param options - the project's mode and today's date.
 * @returns the task record to use, or `undefined` when the session owns no injectable task.
 */
export declare function boundTaskSync(projectRoot: string, sessionId: string | undefined, options: {
    mode: TaskMode;
    today: string;
}): TaskRecord | undefined;
/** The project-relative path a receipt shows for one task document. */
export declare function taskRelativePath(slug: string): string;
/**
 * The same document with its metadata line's status (and activity date) rewritten.
 *
 * A status change must not touch the body: `/context task <slug> archive` is a decision about the
 * task's life, not a consolidation pass, and re-rendering the sections here would replace the
 * model's text with nothing. The line is found by prefix, so a body line that merely quotes the
 * format cannot be rewritten instead.
 * @param text - the stored task document.
 * @param status - the new stored status.
 * @param today - the activity date to record alongside it.
 * @returns the document with its metadata line replaced, or the input when it has no such line.
 */
export declare function withTaskStatus(text: string, status: TaskStatus, today: string): string;
/** Every task with its status derived for the given mode and date. */
export declare function taskViews(records: readonly TaskRecord[], options: {
    mode: TaskMode;
    today: string;
}): TaskView[];
