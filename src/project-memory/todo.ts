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
import { MAX_LIST_ENTRIES, MAX_LIST_ITEM_CHARS } from "../shared/project-state.js";
import { contextSectionBudgets } from "./context-schema.js";
import { clipToLineBoundary } from "./document.js";

/** The prefix that marks a line as mechanically maintained rather than model-authored. */
export const TODO_LINE_PREFIX = "[todo]";

/** A rendered mechanic line: a bullet whose content starts with the prefix. */
const TODO_LINE_RE = /^-\s+\[todo\](?:\s|$)/;

/** The renderer's placeholder for an empty list; it must never survive next to real entries. */
const PLACEHOLDER_LINE = "- None recorded";

/** Level-two heading and fence shapes, the same ones `injection.ts` walks a document with. */
const HEADING_RE = /^##\s+(.+?)\s*$/;
const FENCE_RE = /^(`{3,}|~{3,})/;

/** The one section this module edits. */
const OPEN_TASKS_HEADING = "Open tasks";

/**
 * The projection key the todo tool publishes. Its declared home is `@deepseek-ai/dsh-tool-todo/types`,
 * a host package outside this repository's pinned type baseline (0.1.7-rc.2), and the read is
 * defensive anyway — an unknown or malformed value reads as "no opinion". Naming the key here
 * instead of adding a dependency keeps the package's peer surface untouched.
 */
const TODO_PROJECTION_KEY = "todos";

/**
 * `snapshot` takes keys from the merged `SessionProjectionMap`; the key above is deliberately not
 * declared in this program, so it is passed through the parameter's own type rather than widened to
 * `string` at the call (the call must still be the registry's real one).
 */
type SnapshotKeys = NonNullable<Parameters<SessionProjectionRegistry["snapshot"]>[1]>;
const TODO_SNAPSHOT_KEYS = [TODO_PROJECTION_KEY] as unknown as SnapshotKeys;

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
export function todoLines(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const lines: string[] = [];
	for (const item of value as readonly unknown[]) {
		if (typeof item !== "object" || item === null) continue;
		const { content, status } = item as { content?: unknown; status?: unknown };
		if (typeof content !== "string") continue;
		if (status !== "pending" && status !== "in_progress") continue;
		const text = content.replace(/\s+/g, " ").trim();
		if (text === "") continue;
		const body = status === "in_progress" ? `${TODO_LINE_PREFIX} (in progress) ${text}` : `${TODO_LINE_PREFIX} ${text}`;
		lines.push(`- ${clipToLineBoundary(body, MAX_LIST_ITEM_CHARS)}`);
	}
	return lines;
}

/** True for a line this module owns; the test and the pass both read it through {@link todoLinesIn}. */
export function isTodoLine(line: string): boolean {
	return TODO_LINE_RE.test(line.trim());
}

/** One document with the mechanic lines it currently carries, in document order. */
export function todoLinesIn(text: string): string[] {
	const body = openTasksBody(scan(text));
	return body === undefined ? [] : body.lines.filter(isTodoLine).map((line) => line.trim());
}

/** The session's todo snapshot as document lines; `undefined` when it has no opinion. */
export function projectTodoLines(projections: SessionProjectionRegistry | undefined, session: Session): string[] | undefined {
	if (projections === undefined) return undefined;
	const values: Record<string, unknown> = projections.snapshot(session, TODO_SNAPSHOT_KEYS).values as unknown as Record<string, unknown>;
	return todoLines(values[TODO_PROJECTION_KEY]);
}

/** One line's membership in a fenced code block, so a `## …` or a bullet inside one is content. */
interface Scanned {
	readonly lines: string[];
	/** Per line: inside a fenced block (delimiters included). */
	readonly fenced: boolean[];
	/** Indexes of level-two headings outside fences. */
	readonly headings: number[];
}

function scan(text: string): Scanned {
	const lines = text.split("\n");
	const fenced: boolean[] = new Array<boolean>(lines.length).fill(false);
	const headings: number[] = [];
	let fence: string | undefined;
	for (let index = 0; index < lines.length; index += 1) {
		const trimmed = lines[index].trim();
		const run = FENCE_RE.exec(trimmed);
		if (fence === undefined) {
			if (run) {
				fence = run[1];
				fenced[index] = true;
				continue;
			}
			if (HEADING_RE.test(lines[index])) headings.push(index);
		} else {
			fenced[index] = true;
			// A closing fence is the same character, at least as long, with nothing after it.
			if (run && run[1][0] === fence[0] && run[1].length >= fence.length && trimmed.slice(run[1].length).trim() === "") fence = undefined;
		}
	}
	return { lines, fenced, headings };
}

interface OpenTasksBody {
	/** The heading line's index in the document. */
	heading: number;
	/** Exclusive end of the section: the next heading, or the end of the document. */
	end: number;
	/** The section's body lines, verbatim. */
	lines: string[];
	/** Whether each body line sits inside a fence. */
	fenced: boolean[];
}

/** The Open tasks section of a rendered document, or `undefined` when it carries none. */
function openTasksBody(scanned: Scanned): OpenTasksBody | undefined {
	const heading = scanned.headings.find((index) => HEADING_RE.exec(scanned.lines[index])?.[1] === OPEN_TASKS_HEADING);
	if (heading === undefined) return undefined;
	const end = scanned.headings.find((index) => index > heading) ?? scanned.lines.length;
	return {
		heading,
		end,
		lines: scanned.lines.slice(heading + 1, end),
		fenced: scanned.fenced.slice(heading + 1, end),
	};
}

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
export function withTodoLines(text: string, lines: readonly string[]): TodoPatch {
	const scanned = scan(text);
	const section = openTasksBody(scanned);
	if (section === undefined) return { text, changed: false, droppedItems: 0 };

	const todoIndexes = new Set<number>();
	const otherBullets: string[] = [];
	let insertAt = 0;
	// The block goes at the top of the section body, after the blank line the renderer leaves under
	// the heading. `insertAt` is that position in the body before any line is removed.
	while (insertAt < section.lines.length && section.lines[insertAt].trim() === "") insertAt += 1;
	for (const [index, line] of section.lines.entries()) {
		const trimmed = line.trim();
		if (section.fenced[index] || !trimmed.startsWith("- ")) continue;
		if (isTodoLine(trimmed)) {
			todoIndexes.add(index);
			continue;
		}
		if (trimmed !== PLACEHOLDER_LINE) otherBullets.push(trimmed);
	}

	// What survives the replacement: every non-mechanic line, in order.
	const rest: string[] = [];
	/** Position in `rest` corresponding to the top of the section body. */
	let restInsertAt = 0;
	for (const [index, line] of section.lines.entries()) {
		if (index === insertAt) restInsertAt = rest.length;
		if (todoIndexes.has(index)) continue;
		if (line.trim() === PLACEHOLDER_LINE) continue;
		rest.push(line);
	}

	const budget = contextSectionBudgets().find((entry) => entry.heading === OPEN_TASKS_HEADING)?.chars ?? MAX_LIST_ITEM_CHARS;
	const kept: string[] = [];
	for (const line of lines) {
		const next = [...kept, line, ...otherBullets];
		if (next.join("\n").length > budget || next.length > MAX_LIST_ENTRIES) break;
		kept.push(line);
	}
	const droppedItems = lines.length - kept.length;

	// A section with no entries at all reads as "nothing recorded" through the renderer's own line;
	// an empty list must not render as an empty heading.
	const body = [...kept, ...otherBullets].length === 0
		? [...rest.slice(0, restInsertAt), PLACEHOLDER_LINE, ...rest.slice(restInsertAt)]
		: [...rest.slice(0, restInsertAt), ...kept, ...rest.slice(restInsertAt)];
	const rebuilt = [...scanned.lines.slice(0, section.heading + 1), ...body, ...scanned.lines.slice(section.end)].join("\n");
	const changed = rebuilt !== text;
	// An unchanged document already carries the fit decision this write would have made; reporting it
	// again would log the same dropped items on every turn.
	return { text: changed ? rebuilt : text, changed, droppedItems: changed ? droppedItems : 0 };
}

/** One line for `errors.log` when a snapshot did not fit, naming where it was (not) written. */
export function todoFitNotice(target: string, droppedItems: number): string {
	return `the session's todo list did not fit the Open tasks budget: ${droppedItems} item(s) were not written to ${target}`;
}
