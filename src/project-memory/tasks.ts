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

import { readdirSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import type { TaskMode } from "../shared/config.js";
import { AGENTS_DIR, MEMORY_SUBDIR, TASKS_SUBDIR, sessionMetaFileFor, taskFile, tasksDir, validSkillName } from "../shared/paths.js";
import { readTextCachedSync, writeAtomic } from "../shared/files.js";

/** The three states a task can be in. Only `archived` is authoritative on disk. */
export type TaskStatus = "active" | "dormant" | "archived";

/** Days without activity before a task reports `dormant`. */
export const TASK_DORMANT_DAYS = 30;
/**
 * Days without activity before a task reports `archived`. The spec words this as "dormant for 90
 * days", which in derived terms is simply "no activity for 90 days": dormant is not a stored state,
 * so the only observable boundary is the age of `lastSeen`. Acceptance criterion ③ in §11.8 states
 * the same number as a test (`91` days), and that is the one this constant matches.
 */
export const TASK_ARCHIVE_DAYS = 90;

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
export function validTaskSlug(slug: string): boolean {
	return validSkillName(slug);
}

/** `YYYY-MM-DD` for one instant, in UTC — the convention `session-meta.ts` and `retirement.ts` use. */
export function dateStamp(now: Date = new Date()): string {
	return now.toISOString().slice(0, 10);
}

/** Whole days from one `YYYY-MM-DD` to another, or `undefined` when either is malformed. */
export function daysBetween(from: string, to: string): number | undefined {
	const day = (stamp: string): number | undefined => {
		const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(stamp);
		if (!match) return undefined;
		const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
		return Number.isNaN(ms) ? undefined : Math.floor(ms / 86_400_000);
	};
	const start = day(from);
	const end = day(to);
	return start === undefined || end === undefined ? undefined : end - start;
}

/** The heading every task document carries; the slug is the document's identity, not its title. */
export function taskHeader(slug: string): string {
	return `# Project Task: ${slug}`;
}

/** The meta line's prefix: a blockquote, so it is preamble text and never a section heading. */
const TASK_META_PREFIX = "> created ";

/** `> created 2026-11-10 · status active · lastSeen 2026-11-10 · title Release prep` */
export function taskMetaLine(meta: TaskMeta): string {
	const title = meta.title.replace(/\s+/g, " ").trim();
	return `${TASK_META_PREFIX}${meta.created} · status ${meta.status} · lastSeen ${meta.lastSeen}${title === "" ? "" : ` · title ${title}`}`;
}

const TASK_META_RE = /^> created (\d{4}-\d{2}-\d{2}) · status (active|dormant|archived) · lastSeen (\d{4}-\d{2}-\d{2})(?: · title (.*))?$/;

/**
 * The metadata line of a task document, or `undefined` when the document carries none.
 *
 * Only the first matching line is read: a document is rendered with exactly one, and a later
 * look-alike (a quote inside a summary) must not be able to republish a status.
 */
export function parseTaskMeta(text: string): TaskMeta | undefined {
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith(TASK_META_PREFIX)) continue;
		const match = TASK_META_RE.exec(trimmed);
		if (!match) return undefined;
		return {
			created: match[1],
			status: match[2] as TaskStatus,
			lastSeen: match[3],
			title: match[4] ?? "",
		};
	}
	return undefined;
}

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
export function deriveTaskStatus(meta: TaskMeta, options: { mode: TaskMode; today: string }): TaskStatus {
	if (meta.status === "archived") return "archived";
	if (options.mode === "manual") return meta.status;
	const age = daysBetween(meta.lastSeen, options.today);
	// A malformed date cannot age: report what is stored rather than inventing activity or decay.
	if (age === undefined) return meta.status;
	if (age > TASK_ARCHIVE_DAYS && options.mode === "delegated") return "archived";
	if (age > TASK_DORMANT_DAYS) return "dormant";
	// Activity inside the dormant horizon reopens a dormant task; that is what `active` means.
	return "active";
}

/** One task from its stored text, or `undefined` when the document carries no usable meta line. */
function record(slug: string, text: string): TaskRecord | undefined {
	const meta = parseTaskMeta(text);
	return meta === undefined ? undefined : { slug, meta, text };
}

/** Read one task document asynchronously; a missing file and an unparseable one both read as absent. */
export async function readTask(projectRoot: string, slug: string): Promise<TaskRecord | undefined> {
	if (!validTaskSlug(slug)) return undefined;
	let text: string;
	try {
		text = await readFile(taskFile(projectRoot, slug), "utf8");
	} catch {
		return undefined;
	}
	return record(slug, text);
}

/**
 * Synchronous cached read for prompt assembly: same bytes as {@link readTask}, no await.
 *
 * Prompt assembly cannot block, so this is the reader the injection uses; `readTextCachedSync`
 * re-reads only when the file's mtime or size changed.
 */
export function readTaskSync(projectRoot: string, slug: string): TaskRecord | undefined {
	if (!validTaskSlug(slug)) return undefined;
	const text = readTextCachedSync(taskFile(projectRoot, slug));
	return text === "" ? undefined : record(slug, text);
}

/** Every valid task file, sorted by slug. One unreadable document must not hide the rest. */
export async function listTasks(projectRoot: string): Promise<TaskRecord[]> {
	let entries: string[];
	try {
		entries = await readdir(tasksDir(projectRoot));
	} catch {
		return [];
	}
	const records: TaskRecord[] = [];
	for (const entry of entries.sort()) {
		if (!entry.endsWith(".md")) continue;
		const slug = entry.slice(0, -3);
		if (!validTaskSlug(slug)) continue;
		const task = await readTask(projectRoot, slug);
		if (task !== undefined) records.push(task);
	}
	return records;
}

/** The synchronous counterpart of {@link listTasks}, for the injection provider. */
export function listTasksSync(projectRoot: string): TaskRecord[] {
	let entries: string[];
	try {
		entries = readdirSync(tasksDir(projectRoot));
	} catch {
		return [];
	}
	const records: TaskRecord[] = [];
	for (const entry of entries.sort()) {
		if (!entry.endsWith(".md")) continue;
		const slug = entry.slice(0, -3);
		if (!validTaskSlug(slug)) continue;
		const task = readTaskSync(projectRoot, slug);
		if (task !== undefined) records.push(task);
	}
	return records;
}

/**
 * The task slug a session is bound to, read from its own `meta.json`.
 *
 * The binding lives on disk rather than in process memory on purpose: a restart, a resumed session
 * and a different process must all see the same answer, and `meta.json` is already the session's
 * truth source (`Z1`). A malformed file reads as unbound instead of failing the prompt.
 */
export function readSessionTaskSync(projectRoot: string, sessionId: string | undefined): string | undefined {
	if (sessionId === undefined || sessionId === "") return undefined;
	const text = readTextCachedSync(sessionMetaFileFor(projectRoot, sessionId));
	if (text.trim() === "") return undefined;
	try {
		const parsed = JSON.parse(text) as { task?: unknown };
		return typeof parsed.task === "string" && validTaskSlug(parsed.task) ? parsed.task : undefined;
	} catch {
		return undefined;
	}
}

/** Replace one task document; the caller has already rendered its bytes. */
export async function writeTaskDocument(projectRoot: string, slug: string, text: string): Promise<void> {
	await writeAtomic(taskFile(projectRoot, slug), text);
}

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
export function boundTaskSync(
	projectRoot: string,
	sessionId: string | undefined,
	options: { mode: TaskMode; today: string },
): TaskRecord | undefined {
	const slug = readSessionTaskSync(projectRoot, sessionId);
	if (slug === undefined) return undefined;
	const task = readTaskSync(projectRoot, slug);
	if (task === undefined) return undefined;
	return deriveTaskStatus(task.meta, options) === "archived" ? undefined : task;
}

/** The project-relative path a receipt shows for one task document. */
export function taskRelativePath(slug: string): string {
	return [AGENTS_DIR, MEMORY_SUBDIR, TASKS_SUBDIR, `${slug}.md`].join("/");
}

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
export function withTaskStatus(text: string, status: TaskStatus, today: string): string {
	const meta = parseTaskMeta(text);
	if (meta === undefined) return text;
	const lines = text.split("\n");
	const index = lines.findIndex((line) => line.trim().startsWith(TASK_META_PREFIX));
	if (index === -1) return text;
	lines[index] = taskMetaLine({ ...meta, status, lastSeen: today });
	return lines.join("\n");
}

/** Every task with its status derived for the given mode and date. */
export function taskViews(records: readonly TaskRecord[], options: { mode: TaskMode; today: string }): TaskView[] {
	return records.map((task) => ({ ...task, status: deriveTaskStatus(task.meta, options) }));
}
