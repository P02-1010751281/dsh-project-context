/**
 * The `/context task` list **core**: what the rows show, folded from plain counts.
 *
 * The list used to be `slug · status · title` — enough to pick a task, nothing about whether it is
 * still in use. The three numbers that answer that are all read-only and mechanical: how many
 * archived sessions are bound to the task, how many items its Open tasks section still lists, and
 * when it was last touched. Folding them here keeps the arithmetic (and the "newest of several
 * dates" rule) out of the filesystem shim and testable without a project.
 *
 * Nothing here reads a file or knows what a session is: {@link TaskUsageInput} arrives from
 * `task-usage-source.ts`, which owns the archive walk and the todo-line reader.
 */

import { type DocumentLanguage, pick } from "../shared/language.js";

/** One task's raw material, as the shim collected it. */
export interface TaskUsageInput {
	readonly slug: string;
	/** Stored title, empty when the document never got one. */
	readonly title: string;
	/** Status already derived for the project's mode and today. */
	readonly status: string;
	/** The task document's own `lastSeen`, when it carries a metadata line. */
	readonly storedLastSeen?: string;
	/** Archive dates of the sessions bound to this task. */
	readonly sessionDates: readonly string[];
	/** The `- [todo] …` lines its Open tasks section carries; they are all unfinished by construction. */
	readonly todoLines: readonly string[];
}

/** One rendered row's facts. */
export interface TaskUsage {
	readonly slug: string;
	readonly title: string;
	readonly status: string;
	readonly sessions: number;
	readonly openTodos: number;
	/** Newest activity date (`YYYY-MM-DD`), or `undefined` when nothing records one. */
	readonly lastSeen?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The newest of the activity dates, or `undefined`.
 *
 * A malformed date is dropped rather than compared: `2016-1-1` sorts below every real stamp, so
 * keeping it would silently hide the actual last activity behind a typo. The archive's `date` column
 * and a task's `lastSeen` are both `YYYY-MM-DD`, which sorts lexicographically, so no parsing is
 * needed once the shape is validated.
 */
function newestDate(dates: readonly string[]): string | undefined {
	let newest: string | undefined;
	for (const date of dates) {
		if (!DATE_RE.test(date)) continue;
		if (newest === undefined || date > newest) newest = date;
	}
	return newest;
}

/**
 * Fold the shim's inputs into rows, one per task, in the order they were read.
 *
 * "Last seen" is the newest of the task document's own `lastSeen` and its bound sessions' archive
 * dates. Both are activity; taking only the document's value would freeze the column for a task
 * whose sessions were archived later, and taking only the sessions' would hide a bind that happened
 * after the last archive.
 */
export function taskUsage(inputs: readonly TaskUsageInput[]): TaskUsage[] {
	return inputs.map((input) => {
		const dates = input.storedLastSeen === undefined ? input.sessionDates : [...input.sessionDates, input.storedLastSeen];
		const lastSeen = newestDate(dates);
		return {
			slug: input.slug,
			title: input.title,
			status: input.status,
			sessions: input.sessionDates.length,
			openTodos: input.todoLines.length,
			...(lastSeen === undefined ? {} : { lastSeen }),
		};
	});
}

/**
 * The status as a receipt names it, per language.
 *
 * `status` stays a plain string: the derived value comes from `deriveTaskStatus` in the memory half,
 * and a receipt that met an unknown word must print it rather than fail the read.
 */
export const TASK_STATUS_LABEL: Record<DocumentLanguage, Record<string, string>> = {
	en: { active: "active", dormant: "dormant", archived: "archived" },
	zh: { active: "活跃", dormant: "休眠", archived: "已归档" },
};

/** The status as a receipt names it; an unknown value is printed as stored. */
export function taskStatusLabel(status: string, language: DocumentLanguage = "en"): string {
	return TASK_STATUS_LABEL[language][status] ?? status;
}

/**
 * One list row.
 *
 * `boundSlug` marks the session's own task in the same words the list used before the numbers were
 * added, so the existing receipt keeps its anchor. An empty title falls back to the slug: a task
 * document without a title line must still be pickable by name.
 *
 * The numbers carry their own nouns (`sessions 3` / `3 个会话`) because the row is read as prose: a
 * bare `3` under a ` · ` separator names nothing. ` · ` is the one separator both languages share.
 * @param usage - the folded row.
 * @param boundSlug - the slug the calling session is bound to, if any.
 * @param language - the language the receipt is written in.
 * @returns the `- …` line.
 */
export function taskUsageRow(usage: TaskUsage, boundSlug?: string, language: DocumentLanguage = "en"): string {
	const title = usage.title.trim() === "" ? usage.slug : usage.title;
	const seen = usage.lastSeen ?? pick(language, "未知", "unknown");
	// The Chinese nouns are the column names README documents for this row (`/context task`:
	// slug / 状态 / 标题 / 绑定会话数 / 未完成 todo 数 / 最近活动), so a reader can match the two.
	const sessions = pick(language, `绑定会话数 ${usage.sessions}`, `sessions ${usage.sessions}`);
	const openTodos = pick(language, `未完成 todo ${usage.openTodos}`, `open todos ${usage.openTodos}`);
	const bound = usage.slug === boundSlug ? pick(language, "（本会话）", " (this session)") : "";
	return `- ${usage.slug} · ${taskStatusLabel(usage.status, language)} · ${title} · ${sessions} · ${openTodos} · ${pick(language, "最近活动", "last seen")} ${seen}${bound}`;
}
