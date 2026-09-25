/**
 * Reading the session: the rendered split a handoff summarizes, the pending question it
 * may have to carry, the file index beside the prompt, and the language of the messages.
 *
 * Pure functions over a `Session`; nothing here talks to the host or the model.
 */

import { type Session } from "@deepseek-ai/dsh-session";
import { type PluginConfig } from "../shared/config.js";
import { type ConversationSection, conversationMessageSections, truncateMiddle } from "../shared/llm.js";
import { MAX_CONVERSATION_CHARS } from "../shared/project-state.js";
import { type HandoffLanguage, type HandoffLanguageMessage, REPLAY_MARKER, isHandoffContinuationText, resolveLanguage } from "./language.js";

/** Rough character budget per token for the carried-over recent tail. */
export const CHARS_PER_TOKEN = 3.5;

/** Phrasings that mark the assistant's last message as awaiting a user decision. */
const PENDING_QUESTION_PATTERNS =
	/would you like|shall i\b|should i\b|do you want|let me know|your call|which (?:one|option|approach|direction|do you)|please (?:confirm|choose|decide)|awaiting your|waiting for your|需要我|要不要|是否需要|是否要|请你(?:确认|选择|决定)|等你(?:确认|回复|决定)/i;

function messageText(content: readonly { type: string; text?: string }[]): string {
	return content
		.filter((block) => block.type === "text" && typeof block.text === "string")
		.map((block) => block.text as string)
		.join("\n")
		.trim();
}

/** Exported for tests: whether an assistant message ends in a question. */
export function textAsksQuestion(text: string): boolean {
	// Fenced code must not contribute a stray "?" to the check.
	const clean = text.replace(/```[\s\S]*?```/g, " ");
	const lines = clean.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
	const lastLine = lines.length > 0 ? lines[lines.length - 1] : "";
	const stripped = lastLine.replace(/[*_`~)\]"'）】》]+$/g, "").trimEnd();
	if (stripped.endsWith("?") || stripped.endsWith("？")) return true;
	return PENDING_QUESTION_PATTERNS.test(clean.slice(-400));
}

/** The question the session is waiting on, when its last conversational message is an assistant question. Exported for tests. */
export function pendingQuestion(session: Session): string | undefined {
	let last: { role: string; text: string } | undefined;
	for (const message of session.deriveMessages()) {
		if (message.role !== "user" && message.role !== "assistant") continue;
		const text = messageText(message.content);
		if (text.length > 0) last = { role: message.role, text };
	}
	if (last === undefined || last.role !== "assistant") return undefined;
	return textAsksQuestion(last.text) ? last.text : undefined;
}

/** File index from tool calls (read/write/edit), mirroring pi's compaction file tracking. */
export function fileOperations(session: Session): string {
	const read = new Set<string>();
	const modified = new Set<string>();
	for (const message of session.deriveMessages()) {
		if (message.role !== "assistant") continue;
		for (const block of message.content) {
			if (block.type !== "tool-call") continue;
			if (block.name !== "read" && block.name !== "write" && block.name !== "edit") continue;
			let parsed: unknown;
			try {
				parsed = JSON.parse(block.arguments);
			} catch {
				continue;
			}
			const file = (parsed as { path?: unknown } | null)?.path;
			if (typeof file !== "string" || file.length === 0) continue;
			if (block.name === "read") read.add(file);
			else modified.add(file);
		}
	}
	const readOnly = [...read].filter((file) => !modified.has(file)).sort();
	const sections: string[] = [];
	if (readOnly.length > 0) sections.push(`<read-files>\n${readOnly.join("\n")}\n</read-files>`);
	if (modified.size > 0) sections.push(`<modified-files>\n${[...modified].sort().join("\n")}\n</modified-files>`);
	return sections.join("\n\n");
}

/** Raw user-source messages for `auto` language resolution. */
function languageMessagesOf(sections: readonly ConversationSection[]): HandoffLanguageMessage[] {
	const messages: HandoffLanguageMessage[] = [];
	for (const section of sections) {
		if (section.userText === undefined || section.sourceKind === undefined) continue;
		messages.push({ role: "user", sourceKind: section.sourceKind, text: section.userText });
	}
	return messages;
}

/** Raw derived messages of a whole session, for a status read that does not split it. */
export function sessionLanguageMessages(session: Session): HandoffLanguageMessage[] {
	return languageMessagesOf(conversationMessageSections(session));
}

/** A previous continuation prompt is replaced in place, keeping the message order around it. */
function replaySection(section: ConversationSection): string {
	if (section.userText !== undefined && isHandoffContinuationText(section.userText)) {
		return `## user\n${REPLAY_MARKER}`;
	}
	return section.rendered;
}

export interface HandoffSplit {
	/** The older part, summarized by the model. */
	older: string;
	/** The recent tail carried verbatim; stale continuation prompts are already marked. */
	tail: string;
	/** Raw user messages of both parts, for `auto` language resolution. */
	languageMessages: HandoffLanguageMessage[];
}

/**
 * Split of the rendered conversation for a handoff. Works from `conversationMessageSections` so it
 * can (a) replace a recognized continuation prompt in the carried tail with {@link REPLAY_MARKER}
 * and (b) hand `auto` detection the unclipped text, since the rendered section cuts user text at
 * 4000 characters — shorter than a real continuation, which would hide its closing line.
 */
export function handoffSplit(session: Session, keepChars: number): HandoffSplit {
	const sections = conversationMessageSections(session);
	let start = sections.length;
	if (keepChars > 0) {
		let used = 0;
		while (start > 0) {
			const size = sections[start - 1].rendered.length + 2;
			if (used > 0 && used + size > keepChars) break;
			used += size;
			start -= 1;
		}
	}
	// The cut lands between whole messages, so the tail may exceed the budget by at most the one
	// message this loop is forced to keep (`used > 0`). That floor is also why the pi fix
	// "cut mid-turn so one huge turn cannot block the handoff" (pi 093dbf3) has no dsh counterpart:
	// pi pulled the cut back to a turn start and could leave nothing to summarize, while every
	// rendered section here is clipped to 4000 chars (`conversationMessageSections`), far below a
	// realistic keep budget, so a session larger than the budget always leaves an older span —
	// only a conversation that genuinely fits the window has none (the empty-span guard).
	const olderSections = sections.slice(0, start);
	const tailSections = sections.slice(start);
	return {
		older: truncateMiddle(olderSections.map((section) => section.rendered).join("\n\n"), MAX_CONVERSATION_CHARS),
		tail: tailSections.map(replaySection).join("\n\n"),
		languageMessages: languageMessagesOf([...olderSections, ...tailSections]),
	};
}

/** The pending question carried into the continuation when the config opts into `wait`. */
export function pendingQuestionFor(config: PluginConfig, session: Session): string | undefined {
	return config.handoffPendingQuestion === "wait" ? pendingQuestion(session) : undefined;
}

/** Resolve the language for one handoff: explicit config wins, otherwise the conversation decides. */
export function resolveHandoffLanguage(messages: readonly HandoffLanguageMessage[], config: PluginConfig): HandoffLanguage {
	return resolveLanguage(messages, config.handoffLanguage);
}
