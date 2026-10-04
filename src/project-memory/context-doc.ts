/**
 * CONTEXT.md rendering: the rolling session summary, key points, and open tasks.
 *
 * The fixed sections and their per-section budgets come from `context-schema.ts`, shared with the
 * consolidation prompt. Over budget a section is clipped on a line boundary and the document ends
 * with an explicit truncation marker instead of a bare `slice()`: a silently clipped CONTEXT.md
 * used to be indistinguishable from a complete one.
 *
 * Ported from pi's `extensions/project-context/memory/context-doc.ts`.
 */

import { MAX_LIST_ENTRIES, MAX_LIST_ITEM_CHARS } from "../shared/project-state.js";
import { type ContextUpdate } from "../shared/reply-json.js";
import { CONTEXT_HEADER, CONTEXT_TITLE_CHARS, contextSectionBudgets, contextTruncationMarker, type ContextSectionBudget } from "./context-schema.js";
import { clipToLineBoundary } from "./document.js";

/** Collapse whitespace and trim; the shared normalization for titles, items, and summaries. */
function normalizeLine(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

/** A whitespace-normalized value cut to `limit` at a line (and surrogate-safe) boundary. */
function trimLine(value: string, limit = MAX_LIST_ITEM_CHARS): string {
	return clipToLineBoundary(normalizeLine(value), limit);
}

function listMarkdown(lines: string[]): string {
	return lines.length === 0 ? "- None recorded" : lines.join("\n");
}

/** Clip a prose body to its budget on a line boundary, counting the dropped characters. */
function clipProse(value: string, limit: number): { text: string; dropped: number } {
	const normalized = normalizeLine(value);
	if (normalized.length <= limit) return { text: normalized, dropped: 0 };
	const text = clipToLineBoundary(normalized, limit);
	return { text, dropped: normalized.length - text.length };
}

/**
 * Clip a bullet list to its section budget: every item is trimmed to `MAX_LIST_ITEM_CHARS` and the
 * list to `MAX_LIST_ENTRIES` entries, then whole trailing items are dropped until the section fits.
 * `dropped` counts every character the untrimmed render would have carried — including the per-item
 * trim and the entry-cap drop, not only the budget drop — so the marker reports the real loss. The
 * smallest section budget exceeds the per-item cap, so a surviving item can never overflow alone.
 */
function clipList(items: string[], limit: number): { lines: string[]; dropped: number } {
	// Blank/whitespace items carry no content; drop them before measuring so they render as no items.
	const content = items.map(normalizeLine).filter((item) => item.length > 0);
	const full = content.map((item) => `- ${item}`);
	let kept = content.map((item) => `- ${trimLine(item)}`).slice(0, MAX_LIST_ENTRIES);
	while (kept.length > 1 && kept.join("\n").length > limit) kept = kept.slice(0, -1);
	return { lines: kept, dropped: full.join("\n").length - kept.join("\n").length };
}

export function renderContextDocument(update: ContextUpdate, options: { updatedAt: string }): string {
	const title = trimLine(update.title, CONTEXT_TITLE_CHARS) || "Untitled session";
	const budgets = contextSectionBudgets();
	const budgetByEntry: Record<ContextSectionBudget["entry"], number> = { summary: 0, key_points: 0, open_tasks: 0 };
	for (const section of budgets) budgetByEntry[section.entry] = section.chars;
	const summary = clipProse(update.summary, budgetByEntry.summary);
	const keyPoints = clipList(update.key_points, budgetByEntry.key_points);
	const openTasks = clipList(update.open_tasks, budgetByEntry.open_tasks);
	// `entry` picks both the field and the clipper: summary is prose, the other two are lists.
	const rendered: Record<ContextSectionBudget["entry"], string> = {
		summary: summary.text || "No summary recorded yet.",
		key_points: listMarkdown(keyPoints.lines),
		open_tasks: listMarkdown(openTasks.lines),
	};
	const parts = [
		CONTEXT_HEADER.trimEnd(),
		"",
		`Last updated: ${options.updatedAt}`,
		"",
		...budgets.flatMap((section) => [`## ${section.heading}\n\n${rendered[section.entry]}`, ""]),
		`<!-- latest-session-title: ${title} -->`,
	];
	const document = `${parts.join("\n")}\n`;
	const dropped = summary.dropped + keyPoints.dropped + openTasks.dropped;
	// A cut context must never look complete: say how much was dropped, in the stored file itself.
	return dropped > 0 ? `${document.trimEnd()}\n\n${contextTruncationMarker(dropped)}\n` : document;
}
