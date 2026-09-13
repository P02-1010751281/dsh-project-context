/**
 * dsh session-archive reader.
 *
 * The canonical `session.jsonl` stores one full event per line, including
 * `assistant/message.stream` chunks that dwarf the visible conversation. When a
 * later pass backtracks into the archive it needs message-level text, not the
 * raw event payloads — this module replays the JSONL into the same compact
 * `## user / ## assistant / ## tool result` shape the live passes use.
 */

import { createReadStream } from "node:fs";
import type { ReadStream } from "node:fs";
import type { ContentBlock, ToolCallBlock } from "@deepseek-ai/dsh-llm";
import { clip, textOf, truncateMiddle } from "./learn.js";

const MAX_TEXT_CHARS = 4_000;
const MAX_TOOL_CHARS = 1_500;

interface ArchivedEntry {
	type?: unknown;
	data?: unknown;
}

/**
 * Render one archived JSONL line into a transcript section.
 * @param line - one line of the canonical session log.
 * @returns the section, or `undefined` when the line is not a visible message.
 */
function archivedSectionFromLine(line: string): string | undefined {
	if (!line.trim()) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return undefined;
	}

	// A JSONL line can parse to `null`/an array/scalar; only an event object
	// carries a `type`, and one bad line must not fail the whole backtrack.
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
	const entry = parsed as ArchivedEntry;

	if (entry.type === "user/message") {
		const data = entry.data as { source?: { kind?: unknown }; content?: unknown } | undefined;
		if (data?.source?.kind !== "user" || !Array.isArray(data.content)) return undefined;
		const text = textOf(data.content as ContentBlock[]);
		return text ? `## user\n${clip(text, MAX_TEXT_CHARS)}` : undefined;
	}

	if (entry.type === "assistant/message") {
		// The visible message lives under data.message; data.stream is dropped.
		const data = entry.data as { message?: { content?: unknown } } | undefined;
		const content = data?.message?.content;
		if (!Array.isArray(content)) return undefined;
		const blocks = content as ContentBlock[];
		const text = textOf(blocks);
		const tools = blocks
			.filter((block): block is ToolCallBlock => block.type === "tool-call")
			.map((block) => `[tool: ${block.name}]`)
			.join(" ");
		const parts = [text ? clip(text, MAX_TEXT_CHARS) : "", tools].filter(Boolean);
		return parts.length > 0 ? `## assistant\n${parts.join("\n")}` : undefined;
	}

	if (entry.type === "tool/result") {
		const data = entry.data as { content?: unknown } | undefined;
		const text = Array.isArray(data?.content) ? textOf(data.content as ContentBlock[]) : "";
		return text ? `## tool result\n${clip(text, MAX_TOOL_CHARS)}` : undefined;
	}

	return undefined;
}

/**
 * Render archived JSONL into a budgeted conversation transcript.
 *
 * Production reads go through {@link readArchivedConversation}, which streams the
 * file; this string form is the reference the streaming reader must stay
 * byte-identical to (and what the tests compare against).
 * @param jsonl - the whole canonical log.
 * @param limit - transcript character budget.
 * @returns the budgeted transcript.
 */
export function archivedConversationText(jsonl: string, limit: number): string {
	const sections: string[] = [];
	for (const line of jsonl.split("\n")) {
		const section = archivedSectionFromLine(line);
		if (section !== undefined) sections.push(section);
	}
	return truncateMiddle(sections.join("\n\n"), limit);
}

/**
 * Read one archived session and render its conversation.
 *
 * The log is streamed rather than slurped: an archived session can be tens of
 * megabytes, and the caller only needs the rendered sections, which are a
 * fraction of that. A missing or unreadable file renders as empty, like
 * `readOptional` did.
 * @param file - absolute path of the archived `session.jsonl`.
 * @param limit - transcript character budget.
 * @returns the budgeted transcript.
 */
export async function readArchivedConversation(file: string, limit: number): Promise<string> {
	const sections: string[] = [];
	let stream: ReadStream | undefined;
	let pending = "";
	try {
		stream = createReadStream(file, { encoding: "utf8" });
		for await (const chunk of stream) {
			pending += chunk as string;
			// Split on "\n" exactly like `archivedConversationText`: `readline` would
			// also break on a bare CR and render a file the string reader ignores.
			for (let end = pending.indexOf("\n"); end >= 0; end = pending.indexOf("\n")) {
				const section = archivedSectionFromLine(pending.slice(0, end));
				if (section !== undefined) sections.push(section);
				pending = pending.slice(end + 1);
			}
		}
	} catch {
		return "";
	} finally {
		stream?.destroy();
	}
	// A last line without a trailing newline still counts, as it does in `split("\n")`.
	if (pending.length > 0) {
		const section = archivedSectionFromLine(pending);
		if (section !== undefined) sections.push(section);
	}
	return truncateMiddle(sections.join("\n\n"), limit);
}
