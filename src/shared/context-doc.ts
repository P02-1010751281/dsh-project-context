/** CONTEXT.md rendering and its session-index maintenance. Ported from pi's session-log.ts. */

import path from "node:path";
import type { Session } from "@deepseek-ai/dsh-session";
import type { ContextUpdate } from "./learn.js";
import { MAX_CONTEXT_CHARS, MAX_LIST_ITEM_CHARS, MAX_SUMMARY_CHARS, safeSessionId } from "./project-state.js";

function trimLine(value: string, limit = MAX_LIST_ITEM_CHARS): string {
	return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function listMarkdown(items: string[]): string {
	if (items.length === 0) return "- None recorded";
	return items.map((item) => `- ${trimLine(item)}`).join("\n");
}

export function sessionIndexLine(session: Session, title: string): string {
	const id = safeSessionId(String(session.id));
	const relativeLog = path.posix.join("session-logs", id, "session.md");
	const timestamp = new Date(session.header.createdAt).toISOString();
	return `- [${id}](${relativeLog}) — ${timestamp.slice(0, 10)} — ${trimLine(title, 160)}`;
}

function existingIndexLines(existing: string, sessionId: string): string[] {
	const lines = existing.split("\n");
	const start = lines.findIndex((line) => line.trim() === "## Session index");
	if (start === -1) return [];
	const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
	const entries = lines.slice(start + 1, end === -1 ? lines.length : end).filter((line) => line.startsWith("- "));

	// Keep the newest line per session id.
	const deduped: string[] = [];
	const seen = new Set<string>();
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const line = entries[index]!;
		const id = /^- \[([^\]]+)\]/.exec(line)?.[1] ?? line;
		if (seen.has(id)) continue;
		seen.add(id);
		deduped.unshift(line);
	}
	return deduped.filter((line) => !line.startsWith(`- [${sessionId}](`));
}

/** Cap list sections before budgeting so a runaway model cannot force thousands of renders. */
const MAX_LIST_ENTRIES = 50;

export function renderContextDocument(
	existing: string,
	update: ContextUpdate,
	options: { sessionLine: string; sessionId: string; updatedAt: string },
): string {
	const indexLines = [...existingIndexLines(existing, options.sessionId), options.sessionLine].slice(-200);
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
		"## Session index",
		"",
		...indexLines,
		"",
		`<!-- latest-session-title: ${title} -->`,
		"",
	].join("\n");

	let keyPoints = update.key_points.slice(0, MAX_LIST_ENTRIES);
	let openTasks = update.open_tasks.slice(0, MAX_LIST_ENTRIES);
	let document = render(keyPoints, openTasks);
	// The session index is the part that must survive: shed list items first,
	// then the oldest index lines, so the tail is never cut off.
	while (document.length > MAX_CONTEXT_CHARS && (keyPoints.length > 0 || openTasks.length > 0)) {
		if (keyPoints.length > openTasks.length) keyPoints = keyPoints.slice(0, -1);
		else openTasks = openTasks.slice(0, -1);
		document = render(keyPoints, openTasks);
	}
	while (document.length > MAX_CONTEXT_CHARS && indexLines.length > 1) {
		indexLines.shift();
		document = render(keyPoints, openTasks);
	}
	return document;
}
