/** CONTEXT.md rendering: the rolling session summary, key points, and open tasks. */

import type { ContextUpdate } from "../shared/llm.js";
import { MAX_CONTEXT_CHARS, MAX_LIST_ITEM_CHARS, MAX_SUMMARY_CHARS } from "../shared/project-state.js";

function trimLine(value: string, limit = MAX_LIST_ITEM_CHARS): string {
	return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function listMarkdown(items: string[]): string {
	if (items.length === 0) return "- None recorded";
	return items.map((item) => `- ${trimLine(item)}`).join("\n");
}

/** Cap list sections before budgeting so a runaway model cannot force thousands of renders. */
const MAX_LIST_ENTRIES = 50;

export function renderContextDocument(update: ContextUpdate, options: { updatedAt: string }): string {
	const title = trimLine(update.title, 160) || "Untitled session";
	const summary = trimLine(update.summary, MAX_SUMMARY_CHARS) || "No summary recorded yet.";
	const render = (keyPoints: string[], openTasks: string[]): string => [
		"# Project Context",
		"",
		`Last updated: ${options.updatedAt}`,
		"",
		"## Summary",
		"",
		summary,
		"",
		"## Key points",
		"",
		listMarkdown(keyPoints),
		"",
		"## Open tasks",
		"",
		listMarkdown(openTasks),
		"",
		`<!-- latest-session-title: ${title} -->`,
		"",
	].join("\n");

	let keyPoints = update.key_points.slice(0, MAX_LIST_ENTRIES);
	let openTasks = update.open_tasks.slice(0, MAX_LIST_ENTRIES);
	let document = render(keyPoints, openTasks);
	// Shed list items until the document fits; the summary is already capped.
	while (document.length > MAX_CONTEXT_CHARS && (keyPoints.length > 0 || openTasks.length > 0)) {
		if (keyPoints.length > openTasks.length) keyPoints = keyPoints.slice(0, -1);
		else openTasks = openTasks.slice(0, -1);
		document = render(keyPoints, openTasks);
	}
	// Last resort: the header plus a summary that alone exceeds the budget can still overshoot, so
	// what a caller injects is never longer than the cap.
	return document.length > MAX_CONTEXT_CHARS ? document.slice(0, MAX_CONTEXT_CHARS) : document;
}
