/**
 * Reading a session as rendered conversation sections — the shape the consolidation prompt,
 * the handoff split and the language detector all consume — plus the input fitting that keeps
 * a consolidation request inside its budget.
 */

import { type ToolCallBlock } from "@deepseek-ai/dsh-llm";
import { type Session } from "@deepseek-ai/dsh-session";
import { MAX_CONVERSATION_CHARS } from "./project-state.js";
import { MAX_ADAPTIVE_OUTPUT_TOKENS, MIN_CLIP_CHARS, REPLY_OUTPUT_MARGIN_TOKENS, adaptiveOutputTokens, allocateTokens, reasoningReserveTokens } from "./output-budget.js";
import { clip, clipTo, replyTokenRate, textOf, truncateMiddle } from "./text.js";

/** What the pass sends instead of the stored artifacts, plus the budget it asks for. */
export type MemoryInput = { text: string; contextText: string; maxTokens: number; clipped: boolean };

/**
 * Match the output budget to everything the reply must re-emit. A large memory is what truncated
 * replies (and the poisoned files they used to leave) came from: the cap is raised up to the
 * model's own limit, and when even that cannot hold memory plus context, both are shortened
 * head-and-tail so the reply can still come back complete and parseable. Each artifact is budgeted
 * by its own token rate, so a large cheap context cannot let a small dense memory pass the cap.
 */
export function fitMemoryInput(
	memory: string,
	context: string,
	configuredMaxTokens: number,
	model: { maxTokens?: number; reasoning?: boolean },
	ceilingTokens: number = MAX_ADAPTIVE_OUTPUT_TOKENS,
	extraHeadroomTokens: number = 0,
): MemoryInput {
	const memoryRate = replyTokenRate(memory);
	const contextRate = replyTokenRate(context);
	const contentTokens = memory.length * memoryRate + context.length * contextRate;
	// Hidden thinking and a retry's extra headroom are charged to the same output cap as the visible
	// reply, so they widen the request and shrink what the input may consume.
	const reasoningReserve = reasoningReserveTokens(contentTokens, model);
	const needed = Math.ceil(contentTokens) + REPLY_OUTPUT_MARGIN_TOKENS + reasoningReserve + extraHeadroomTokens;
	const maxTokens = adaptiveOutputTokens(configuredMaxTokens, needed, model, ceilingTokens);
	// Keep a JSON-scaffolding margin plus whatever is reserved for thinking, with a small absolute
	// floor so a tiny cap cannot spend every token on content and then truncate the reply's own
	// braces and keys. The half-cap arm keeps a large reserve from eating the whole budget.
	const desiredReserve = REPLY_OUTPUT_MARGIN_TOKENS + reasoningReserve + extraHeadroomTokens;
	const reserved = Math.min(desiredReserve, Math.max(0, maxTokens - MIN_CLIP_CHARS), Math.max(REPLY_OUTPUT_MARGIN_TOKENS, Math.round(maxTokens * 0.5)));
	const budget = Math.max(0, maxTokens - reserved);
	if (contentTokens <= budget) {
		return { text: memory, contextText: context, maxTokens, clipped: false };
	}
	// Over budget: each artifact keeps a floor in tokens and the rest follows its measured need, so
	// a big cheap artifact cannot crowd out a small dense one. Repeat with the clipped texts' own
	// rates: clipping can change the density, and the reallocation only shrinks what is over.
	const initial = allocateTokens(budget, memory.length * memoryRate, context.length * contextRate);
	let text = clipTo(memory, Math.floor(initial.memory / Math.max(memoryRate, 0.001)));
	let contextText = clipTo(context, Math.floor(initial.context / Math.max(contextRate, 0.001)));
	for (let attempt = 0; attempt < 10; attempt += 1) {
		const textTokens = text.length * replyTokenRate(text);
		const contextTokens = contextText.length * replyTokenRate(contextText);
		if (textTokens + contextTokens <= budget + 0.5) break;
		const next = allocateTokens(budget, textTokens, contextTokens);
		const stepText = clipTo(memory, Math.floor(next.memory / Math.max(replyTokenRate(text), 0.001)));
		const stepContext = clipTo(context, Math.floor(next.context / Math.max(replyTokenRate(contextText), 0.001)));
		if (stepText.length === text.length && stepContext.length === contextText.length) break;
		text = stepText;
		contextText = stepContext;
	}
	// Clipping can also come out lighter than the original text, leaving budget unused. Fill it by
	// growing both artifacts toward their full length; a step that overshoots is retried smaller,
	// and the last fitting result is kept.
	let step = 1;
	for (let attempt = 0; attempt < 12 && step > 0.002; attempt += 1) {
		const textTokens = text.length * replyTokenRate(text);
		const contextTokens = contextText.length * replyTokenRate(contextText);
		const spare = budget - (textTokens + contextTokens);
		if (spare <= Math.max(0.5, budget * 0.005)) break;
		const rateText = Math.max(replyTokenRate(text), 0.001);
		const rateContext = Math.max(replyTokenRate(contextText), 0.001);
		const needText = Math.max(0, memory.length - text.length) * rateText;
		const needContext = Math.max(0, context.length - contextText.length) * rateContext;
		if (needText + needContext <= 0) break;
		const growText = (spare * step * needText) / (needText + needContext) / rateText;
		const growContext = (spare * step * needContext) / (needText + needContext) / rateContext;
		const grownText = clipTo(memory, Math.min(memory.length, text.length + Math.ceil(growText)));
		const grownContext = clipTo(context, Math.min(context.length, contextText.length + Math.ceil(growContext)));
		const grownTokens = grownText.length * replyTokenRate(grownText) + grownContext.length * replyTokenRate(grownContext);
		if (grownTokens > budget + 0.5) {
			step /= 2;
			continue;
		}
		text = grownText;
		contextText = grownContext;
		step = 1;
	}
	// Absolute safety: the char count of a clip cannot exceed its token count (rate ≤ 1.0).
	if (text.length * replyTokenRate(text) + contextText.length * replyTokenRate(contextText) > budget + 0.5) {
		const safe = allocateTokens(budget, text.length * replyTokenRate(text), contextText.length * replyTokenRate(contextText));
		text = clipTo(text, Math.floor(safe.memory));
		contextText = clipTo(contextText, Math.floor(safe.context));
	}
	// Exact trim: char rounding in the limits can leave a fraction of a token over budget.
	for (let attempt = 0; attempt < 4; attempt += 1) {
		const textTokens = text.length * replyTokenRate(text);
		const contextTokens = contextText.length * replyTokenRate(contextText);
		const over = textTokens + contextTokens - budget;
		if (over <= 0.0001) break;
		if (textTokens >= contextTokens && text.length > 0) {
			text = clipTo(text, text.length - Math.max(1, Math.ceil(over / Math.max(replyTokenRate(text), 0.001))));
		} else if (contextText.length > 0) {
			contextText = clipTo(contextText, contextText.length - Math.max(1, Math.ceil(over / Math.max(replyTokenRate(contextText), 0.001))));
		} else break;
	}
	return { text, contextText, maxTokens, clipped: text.length < memory.length || contextText.length < context.length };
}

/**
 * One rendered conversation section, with the unclipped user text kept alongside it.
 *
 * The handoff pass must recognize a previous continuation prompt in the *raw* text — the render
 * clips a user message to 4000 characters, which is shorter than a real continuation — so both
 * callers share this one pass instead of each re-implementing the rendering and drifting apart.
 */
export interface ConversationSection {
	/** The rendered `## user` / `## assistant` / `## tool result` block. */
	readonly rendered: string;
	/** Unclipped text, present only for user-role messages. */
	readonly userText?: string;
	/** dsh source kind of that user message. */
	readonly sourceKind?: string;
}

/** Compact section-per-message rendering of the derived conversation. */
export function conversationMessageSections(session: Session): ConversationSection[] {
	const sections: ConversationSection[] = [];
	for (const message of session.deriveMessages()) {
		if (message.role === "system") continue;
		if (message.source.kind === "tool") {
			const text = textOf(message.content);
			if (text) sections.push({ rendered: `## tool result\n${clip(text, 1500)}` });
			continue;
		}
		if (message.role === "user") {
			const text = textOf(message.content);
			if (text) sections.push({ rendered: `## user\n${clip(text, 4000)}`, userText: text, sourceKind: message.source.kind });
			continue;
		}
		const text = textOf(message.content);
		const tools = message.content
			.filter((block): block is ToolCallBlock => block.type === "tool-call")
			.map((block) => `[tool: ${block.name}]`)
			.join(" ");
		const parts = [text ? clip(text, 4000) : "", tools].filter(Boolean);
		if (parts.length > 0) sections.push({ rendered: `## assistant\n${parts.join("\n")}` });
	}
	return sections;
}

/** The rendered sections alone, for the learn prompt. */
function conversationSections(session: Session): string[] {
	return conversationMessageSections(session).map((section) => section.rendered);
}

/** Compact, budgeted rendering of the derived conversation for the learn prompt. */
export function conversationText(session: Session): string {
	return truncateMiddle(conversationSections(session).join("\n\n"), MAX_CONVERSATION_CHARS);
}

/** Human turns only: plugin-injected user-role context does not count. */
export function userTurnCount(session: Session): number {
	return session.snapshotEvents().filter((event) => event.type === "user/message" && event.data.source.kind === "user").length;
}

export function firstUserText(session: Session): string {
	for (const event of session.snapshotEvents()) {
		if (event.type !== "user/message" || event.data.source.kind !== "user") continue;
		const text = textOf(event.data.content);
		if (text) return text;
	}
	return "";
}
