/**
 * dsh session-archive reader.
 *
 * The canonical `session.jsonl` stores one full event per line, including
 * `assistant/message.stream` chunks that dwarf the visible conversation. When a
 * later pass backtracks into the archive it needs message-level text, not the
 * raw event payloads — this module replays the JSONL into the same compact
 * `## user / ## assistant / ## tool result` shape the live passes use.
 */

import type { ContentBlock, ToolCallBlock } from "@deepseek-ai/dsh-llm";
import { clip, textOf, truncateMiddle } from "./learn.js";
import { readOptional } from "./project-state.js";

const MAX_TEXT_CHARS = 4_000;
const MAX_TOOL_CHARS = 1_500;

interface ArchivedEntry {
	type?: unknown;
	data?: unknown;
}

/** Render archived JSONL into a budgeted conversation transcript. */
export function archivedConversationText(jsonl: string, limit: number): string {
	const sections: string[] = [];
	for (const line of jsonl.split("\n")) {
		if (!line.trim()) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}

		// A JSONL line can parse to `null`/an array/scalar; only an event object
		// carries a `type`, and one bad line must not fail the whole backtrack.
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
		const entry = parsed as ArchivedEntry;

		if (entry.type === "user/message") {
			const data = entry.data as { source?: { kind?: unknown }; content?: unknown } | undefined;
			if (data?.source?.kind !== "user" || !Array.isArray(data.content)) continue;
			const text = textOf(data.content as ContentBlock[]);
			if (text) sections.push(`## user\n${clip(text, MAX_TEXT_CHARS)}`);
			continue;
		}

		if (entry.type === "assistant/message") {
			// The visible message lives under data.message; data.stream is dropped.
			const data = entry.data as { message?: { content?: unknown } } | undefined;
			const content = data?.message?.content;
			if (!Array.isArray(content)) continue;
			const blocks = content as ContentBlock[];
			const text = textOf(blocks);
			const tools = blocks
				.filter((block): block is ToolCallBlock => block.type === "tool-call")
				.map((block) => `[tool: ${block.name}]`)
				.join(" ");
			const parts = [text ? clip(text, MAX_TEXT_CHARS) : "", tools].filter(Boolean);
			if (parts.length > 0) sections.push(`## assistant\n${parts.join("\n")}`);
			continue;
		}

		if (entry.type === "tool/result") {
			const data = entry.data as { content?: unknown } | undefined;
			const text = Array.isArray(data?.content) ? textOf(data.content as ContentBlock[]) : "";
			if (text) sections.push(`## tool result\n${clip(text, MAX_TOOL_CHARS)}`);
		}
	}
	return truncateMiddle(sections.join("\n\n"), limit);
}

/** Read one archived session and render its conversation. */
export async function readArchivedConversation(file: string, limit: number): Promise<string> {
	return archivedConversationText(await readOptional(file), limit);
}
