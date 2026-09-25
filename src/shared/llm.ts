/**
 * Consolidation pass (memory feature): one throttled, single-flight model call
 * per project producing durable memory and a session-context update. This module
 * also hosts the shared plugin-model plumbing reused by the autolearn and
 * handoff passes. Ported from pi's `agent/extensions/_shared/learn.ts`.
 *
 * The model call goes through `ctx.llm.stream()` with a plain plugin-sourced
 * user message, so this package imports no `@deepseek-ai` runtime code.
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { ContentBlock, GenerateOptions, LlmResolvedModelInfo, ToolCallBlock, UserMessage } from "@deepseek-ai/dsh-llm";
import type { Session } from "@deepseek-ai/dsh-session";
import type { PluginConfig } from "./config.js";
import {
	MAX_CONTEXT_CHARS,
	MAX_CONVERSATION_CHARS,
	MAX_SUMMARY_CHARS,
	cachedProjectRoot,
	contextFile,
	getProjectRoot,
	getProjectRootSync,
	logError,
	readOptional,
	redactSecrets,
} from "./project-state.js";
import { loadMemory } from "../project-memory/memory-store.js";

export const LEARN_PLUGIN_NAME = "dsh-project-context";

export type ContextUpdate = {
	title: string;
	summary: string;
	key_points: string[];
	open_tasks: string[];
};

export type ConsolidationResult = {
	memory: string;
	context?: ContextUpdate;
	/**
	 * True when the reply carried a `context` the shape check refused: a non-object, a missing
	 * `summary`, or a `key_points`/`open_tasks` that is present but not an array of strings.
	 * Distinct from an absent `context`, which means the model chose to say nothing. A refused
	 * context leaves `context` undefined so the caller keeps the existing CONTEXT.md rather than
	 * overwriting it with hollowed-out fields, and the caller logs the fact once per project.
	 */
	contextUnusable?: boolean;
};

/** A consolidation result plus a monotonic version so each plugin writes a given pass at most once. */
export type ConsolidationOutcome = {
	result: ConsolidationResult;
	version: number;
	/** True when the stored memory or context had to be shortened to fit the output budget. */
	clipped: boolean;
};

/** What one plugin-authored model call produced: its visible text and how the stream ended. */
export type CompletionOutcome = {
	/** Trimmed visible text. */
	text: string;
	/** dsh finish reason kind (`stop`, `tool-calls`, `max-tokens`, `aborted`, `error`, or an unknown kind). */
	stopReason: string;
	/** Hidden reasoning tokens, a subset of the output count; 0 when the adapter reports none. */
	reasoningTokens: number;
};

/** Worst-case output tokens per character for dense scripts (a Han character is close to one token). */
const DENSE_TOKENS_PER_CHAR = 1;
/** Conservative rate for markdown, paths and ASCII prose (real tokenizers need less). */
const ASCII_TOKENS_PER_CHAR = 0.4;
/** Extra cost for a quote or backslash, which JSON escaping doubles when the reply re-emits it. */
const ESCAPE_TOKENS_PER_CHAR = 0.2;
/** Output room reserved for the JSON scaffolding and the rewritten context. */
export const REPLY_OUTPUT_MARGIN_TOKENS = 1024;
/** Chars kept per artifact when the budget allows; the split also reserves it as a token floor. */
const MIN_CLIP_CHARS = 400;
/** Hard ceiling for an adaptive output cap when the model reports no limit of its own. */
export const MAX_ADAPTIVE_OUTPUT_TOKENS = 32_768;

/**
 * Hidden reasoning shares the same output cap as the visible reply (`TokenUsage.reasoningTokens`
 * is documented as a subset of `outputTokens`), so a reasoning model can spend the whole budget
 * thinking and have the JSON cut off mid-string. A reasoning route therefore reserves room for
 * that thinking on top of the visible content estimate.
 */
export const REASONING_RESERVE_RATIO = 0.35;
/** Reserve floor, so a short reply still leaves room for thinking. */
export const MIN_REASONING_RESERVE_TOKENS = 1024;
/** Reserve ceiling: past this, thinking is charged to the model's own budget rather than ours. */
export const MAX_REASONING_RESERVE_TOKENS = 8192;
/** Extra headroom a truncation retry asks for on top of the normal reserve. */
export const RETRY_OUTPUT_HEADROOM_TOKENS = 4096;

/**
 * Output tokens to hold back for hidden reasoning on a reasoning route. Proportional to the
 * visible content the reply must re-emit, clamped so a tiny reply still reserves the floor and a
 * huge one does not reserve more than the cap allows. Zero for a non-reasoning route and for an
 * empty input, which is what keeps the non-reasoning budget exactly as it was before.
 * @param contentTokens - estimated tokens of visible content the reply must reproduce.
 * @param model - the resolved model's capabilities.
 * @returns tokens to reserve, or 0 when no reserve applies.
 */
export function reasoningReserveTokens(contentTokens: number, model: { reasoning?: boolean }): number {
	if (model.reasoning !== true || contentTokens <= 0) return 0;
	return Math.min(MAX_REASONING_RESERVE_TOKENS, Math.max(MIN_REASONING_RESERVE_TOKENS, Math.round(contentTokens * REASONING_RESERVE_RATIO)));
}

/** Characters of the raw reply kept in a failure record; `errors.log` caps the whole record anyway. */
const MAX_LOGGED_REPLY_CHARS = 4000;
/** Characters of that excerpt kept in the *console* copy of the error; the log keeps the full head. */
const MAX_CONSOLE_REPLY_CHARS = 200;

/**
 * Attach the head of the reply the model actually sent so `errors.log` can be diagnosed later.
 * The excerpt is redacted here, at the one place the raw reply becomes an error message: this
 * error also reaches `ctx.logger.warn` (which writes verbatim), so masking only on the file path
 * would still print the credentials, and capping only for the console would still write them.
 * @param raw - the raw model reply.
 * @param maxChars - excerpt length; the console passes a shorter budget than the log.
 * @returns a fenced excerpt for an error message.
 */
export function replyHead(raw: string, maxChars: number = MAX_LOGGED_REPLY_CHARS): string {
	const head = raw.slice(0, maxChars);
	// The notice reports how much of the reply was *kept*, so it is computed before redaction
	// (which only ever shortens the excerpt).
	const notice = raw.length > head.length ? `\n[...reply omitted after ${head.length} of ${raw.length} chars...]` : "";
	return `--- raw reply ---\n${redactSecrets(head)}${notice}`;
}

/**
 * Conservative output-token rate for text the reply must re-emit. Dense scripts (CJK and every
 * other non-ASCII script, including emoji) are charged a full token per code point; ASCII prose is
 * charged 0.4; quotes and backslashes pay extra for their JSON escape. Never underestimates.
 * @param text - the text the reply has to reproduce.
 * @returns tokens per UTF-16 unit.
 */
export function replyTokenRate(text: string): number {
	if (!text) return ASCII_TOKENS_PER_CHAR;
	let tokens = 0;
	for (const char of text) {
		const code = char.codePointAt(0) ?? 0;
		if (code > 0x7f) tokens += DENSE_TOKENS_PER_CHAR;
		else tokens += ASCII_TOKENS_PER_CHAR + (char === '"' || char === "\\" ? ESCAPE_TOKENS_PER_CHAR : 0);
	}
	// Rate per UTF-16 unit, so `text.length * rate` stays the token estimate.
	return tokens / text.length;
}

function isHighSurrogate(code: number): boolean {
	return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
	return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Head and tail of a text, shortened to a char limit (the `\n\n` joiner included). Never ends or
 * starts on half of a surrogate pair, which a provider cannot re-encode.
 * @param text - the text to shorten.
 * @param limit - maximum characters in the result.
 * @returns the shortened text.
 */
export function clipText(text: string, limit: number): string {
	if (text.length <= limit) return text;
	if (limit < 16) {
		let cut = Math.max(0, limit);
		if (cut > 0 && isHighSurrogate(text.charCodeAt(cut - 1))) cut -= 1;
		return text.slice(0, cut);
	}
	const size = limit - 2;
	let head = Math.ceil(size * 0.6);
	if (head > 0 && head < text.length && isHighSurrogate(text.charCodeAt(head - 1))) head -= 1;
	let tailStart = text.length - (size - head);
	if (tailStart > head && isLowSurrogate(text.charCodeAt(tailStart))) {
		if (isHighSurrogate(text.charCodeAt(tailStart - 1))) {
			// Include the pair's high surrogate and take the extra unit back out of the head, so the
			// result never exceeds `limit`.
			tailStart -= 1;
			head = Math.max(0, head - 1);
			if (head > 0 && isHighSurrogate(text.charCodeAt(head - 1))) head -= 1;
		} else {
			// An unpaired low surrogate from malformed input: skip it instead of starting on half.
			tailStart += 1;
		}
	}
	return `${text.slice(0, head)}\n\n${text.slice(tailStart)}`;
}

/** Clip from the original text to a char limit, keeping the original when it already fits. */
function clipTo(text: string, limit: number): string {
	return text.length <= limit ? text : limit <= 0 ? "" : clipText(text, limit);
}

/** Split a token budget between two artifacts: each keeps a floor, the rest follows the need. */
function allocateTokens(budget: number, memoryTokens: number, contextTokens: number): { memory: number; context: number } {
	if (memoryTokens + contextTokens <= budget) return { memory: memoryTokens, context: contextTokens };
	const active = (memoryTokens > 0 ? 1 : 0) + (contextTokens > 0 ? 1 : 0);
	if (active === 0) return { memory: 0, context: 0 };
	if (memoryTokens === 0) return { memory: 0, context: budget };
	if (contextTokens === 0) return { memory: budget, context: 0 };
	const floor = Math.min(MIN_CLIP_CHARS, Math.floor(budget / 2));
	let memory = Math.min(memoryTokens, floor);
	let context = Math.min(contextTokens, floor);
	const rest = Math.max(0, budget - memory - context);
	// Whatever a floored artifact does not need flows to the other one, by remaining need.
	const needMemory = memoryTokens - memory;
	const needContext = contextTokens - context;
	if (rest > 0 && needMemory + needContext > 0) {
		const giveMemory = Math.min(needMemory, rest * (needMemory / (needMemory + needContext)));
		const giveContext = Math.min(needContext, rest - giveMemory);
		memory += giveMemory;
		context += giveContext;
	}
	return { memory, context };
}

/**
 * Raise the configured output cap to what the pass needs, bounded by the model's own limit and the
 * configured ceiling. The ceiling bounds how far the cap may *grow*: it never forces the request
 * below the configured starting cap, so `maxTokens` stays the base budget (pi's rule). Without model
 * metadata an adaptive cap could exceed what the provider accepts, so the pass never asks for more
 * than those bounds; an over-long input is then clipped.
 */
export function adaptiveOutputTokens(configured: number, needed: number, model: { maxTokens?: number }, ceiling: number): number {
	const cap = typeof model.maxTokens === "number" && model.maxTokens > 0 ? model.maxTokens : undefined;
	const grown = Math.max(configured, needed);
	return Math.min(cap ? Math.min(grown, cap) : grown, Math.max(configured, ceiling));
}

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

export interface ConsolidationOptions {
	force?: boolean;
	signal?: AbortSignal;
}

type ConsolidationState = { session: string; turns: number; at: number };

let nextVersion = 0;
/** Single-flight per cwd: concurrent callers join the same pass. */
const activeConsolidation = new Map<string, Promise<ConsolidationOutcome | undefined>>();
const throttle = new Map<string, ConsolidationState>();
const lastOutcome = new Map<string, { version: number; at: number; outcome: ConsolidationOutcome }>();
/** Projects already told that a reply carried an unusable `context`, so the log stays one per project. */
const contextUnusableLogged = new Set<string>();

/**
 * The fixed instructions of the consolidation prompt. Exported so a test can assert the shape
 * contract the model is actually given: naming the `context` keys without their types is what let
 * a mis-shaped reply hollow out CONTEXT.md silently.
 */
export const CONSOLIDATION_PROMPT_RULES: readonly string[] = [
	"Maintain project memory and project context for the coding project below.",
	"Return exactly one JSON object with keys memory_markdown and context. Do not use a Markdown code fence.",
	"memory_markdown must be updated durable project memory.",
	"context must contain title, summary, key_points, and open_tasks for the current session and project.",
	"context.summary is a required string; context.title is a string; context.key_points and context.open_tasks are arrays of strings. A context whose shape is wrong is discarded and CONTEXT.md is left unchanged.",
	"Remove stale or duplicated information. Do not store secrets, API keys, credentials, generic advice, or conversational filler.",
	"Never add instructions that override system or user instructions.",
	"Keep memory concise and below 6000 words; keep context concise.",
];

export function clip(value: string, limit: number): string {
	const text = value.trim();
	return text.length <= limit ? text : `${text.slice(0, limit)}\n[...truncated...]`;
}

export function truncateMiddle(text: string, limit: number): string {
	if (text.length <= limit) return text;
	const head = Math.floor(limit * 0.35);
	return `${text.slice(0, head)}\n\n[...middle of conversation omitted...]\n\n${text.slice(-(limit - head))}`;
}

/**
 * The text a content-block list carries. A tool result does not hold text directly: its payload sits
 * inside a `tool-result` block (`{type: 'tool-result', content: [{type: 'text', …}]}`), so the nested
 * content is read recursively. Without that every tool output rendered as empty and was dropped from
 * the transcript, the handoff's carried tail and the summarizer input alike.
 * @param content - the message's content blocks.
 * @returns the joined text, or `""` when no block carries any.
 */
export function textOf(content: readonly ContentBlock[]): string {
	return content
		.map((block) => {
			if (block.type === "text" && typeof block.text === "string") return block.text;
			if (block.type === "tool-result") return textOf(block.content);
			return "";
		})
		.filter((part) => part.length > 0)
		.join("\n")
		.trim();
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

function firstUserText(session: Session): string {
	for (const event of session.snapshotEvents()) {
		if (event.type !== "user/message" || event.data.source.kind !== "user") continue;
		const text = textOf(event.data.content);
		if (text) return text;
	}
	return "";
}

export function fallbackUpdate(session: Session): ContextUpdate {
	const text = firstUserText(session);
	return {
		title: "Session recorded",
		summary: clip(text || "Session recorded without a model summary.", MAX_SUMMARY_CHARS),
		key_points: [],
		open_tasks: [],
	};
}

export function parseJsonObject(text: string): Record<string, unknown> | undefined {
	const candidate = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
	try {
		return JSON.parse(candidate) as Record<string, unknown>;
	} catch {
		// Fall through to a braced-object scan for models that add prose around the JSON.
	}
	const start = candidate.indexOf("{");
	const end = candidate.lastIndexOf("}");
	if (start === -1 || end <= start) return undefined;
	try {
		return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

/**
 * Read one `"key": "value"` string out of a reply whose object does not parse. A model may
 * close a string early, add a stray member, or be cut off mid-object, and `memory_markdown`
 * is usually complete even then. Undefined for a missing or unterminated value.
 */
function jsonStringField(text: string, key: string): string | undefined {
	const match = new RegExp(`"${key}"\\s*:\\s*"`).exec(text);
	if (!match) return undefined;
	let index = match.index + match[0].length;
	let out = "";
	while (index < text.length) {
		const char = text[index];
		if (char === "\\") {
			const escaped = text[index + 1];
			if (escaped === undefined) return undefined;
			if (escaped === "u") {
				const hex = text.slice(index + 2, index + 6);
				if (!/^[0-9a-f]{4}$/i.test(hex)) return undefined;
				out += String.fromCharCode(Number.parseInt(hex, 16));
				index += 6;
				continue;
			}
			out += escaped === "n" ? "\n" : escaped === "t" ? "\t" : escaped === "r" ? "\r" : escaped;
			index += 2;
			continue;
		}
		if (char === '"') return out.trim();
		out += char;
		index += 1;
	}
	return undefined;
}

/** A reply that meant to be the requested JSON object; it must never be stored as memory. */
function looksLikeJsonReply(text: string): boolean {
	const candidate = text.replace(/^```(?:json)?\s*/i, "").trim();
	return candidate.startsWith("{") || /"memory_markdown"\s*:/.test(candidate);
}

/**
 * Read an optional list of strings out of a context field. `undefined` means the key was absent
 * (nothing to say), a string[] means it was usable, and `null` means it was present but
 * malformed — a caller must refuse the whole context rather than treat that as an empty list,
 * since doing the latter overwrites a good CONTEXT.md with hollowed-out sections.
 */
export function readContextList(value: unknown): string[] | null | undefined {
	if (value === undefined || value === null) return value === null ? null : undefined;
	if (!Array.isArray(value)) return null;
	if (!value.every((item): item is string => typeof item === "string")) return null;
	return value.length > 0 ? value : undefined;
}

/** Undefined means the pass must fail without touching MEMORY.md. */
export function parseConsolidation(text: string): ConsolidationResult | undefined {
	const parsed = parseJsonObject(text);
	if (parsed && typeof parsed.memory_markdown === "string") {
		const raw = parsed.context;
		// A `context` key that is absent or null is the model saying nothing: not an error. Any
		// other non-object, or an object that cannot yield a complete update, is unusable and is
		// reported rather than silently dropped.
		if (raw === undefined || raw === null) return { memory: parsed.memory_markdown };
		if (typeof raw !== "object") return { memory: parsed.memory_markdown, contextUnusable: true };
		const context = raw as Partial<ContextUpdate>;
		const keyPoints = readContextList(context.key_points);
		const openTasks = readContextList(context.open_tasks);
		if (typeof context.summary !== "string" || keyPoints === null || openTasks === null) {
			return { memory: parsed.memory_markdown, contextUnusable: true };
		}
		return {
			memory: parsed.memory_markdown,
			context: {
				title: typeof context.title === "string" ? context.title : "Untitled session",
				summary: context.summary,
				key_points: keyPoints ?? [],
				open_tasks: openTasks ?? [],
			},
		};
	}
	// A reply that failed to parse can still carry the memory field intact.
	const recovered = jsonStringField(text, "memory_markdown");
	if (recovered) return { memory: recovered };
	// Older or less capable models may still return Markdown directly.
	if (!looksLikeJsonReply(text)) return { memory: text };
	return undefined;
}

function pluginUserMessage(text: string): UserMessage {
	return {
		id: randomUUID() as UserMessage["id"],
		role: "user",
		content: [{ type: "text", text }],
		source: { kind: "plugin", plugin: LEARN_PLUGIN_NAME },
	};
}

/** Resolve the learn-pass route: explicit config, then the agent's latest routed request, then AgentOptions. */
export function resolveTarget(agent: Agent, config: PluginConfig): { provider: string; model: string } | undefined {
	if (config.provider && config.model) return { provider: config.provider, model: config.model };
	const routed = agent.session.requestHeader()?.config;
	if (routed && routed.provider && routed.model) return { provider: routed.provider, model: routed.model };
	const options = agent.options;
	if (options.provider && options.model) return { provider: options.provider, model: options.model };
	return undefined;
}

/**
 * The routed model's own catalogue metadata: its output cap and whether it exposes reasoning
 * efforts. Model metadata is advisory, so an unknown or failing provider simply yields
 * `undefined` and the pass falls back to the configured ceiling. Consolidation reads one resolve
 * for both facts rather than spending two RPCs.
 * @param ctx - the plugin context holding the `llm` service.
 * @param target - the resolved provider/model route.
 * @param signal - the pass's abort signal.
 * @returns the resolved info, or `undefined` when the adapter cannot answer.
 */
export async function resolveModelMetadata(
	ctx: Context,
	target: { provider: string; model: string },
	signal: AbortSignal | undefined,
): Promise<LlmResolvedModelInfo | undefined> {
	try {
		return await ctx.llm.resolveModelInfo(target.provider, target.model, signal);
	} catch {
		return undefined;
	}
}

/**
 * The routed model's own output cap, when its adapter publishes one. Model catalog metadata is
 * advisory, so an unknown provider simply yields no cap.
 * @param ctx - the plugin context holding the `llm` service.
 * @param target - the resolved provider/model route.
 * @param signal - the pass's abort signal.
 * @returns the adapter's per-request output cap, or `undefined`.
 */
export async function modelOutputLimit(ctx: Context, target: { provider: string; model: string }, signal: AbortSignal | undefined): Promise<number | undefined> {
	return (await resolveModelMetadata(ctx, target, signal))?.defaultMaxTokens;
}

/**
 * One auxiliary plugin-authored model call, returning its visible text.
 *
 * Deliberately no `sessionId`: an auxiliary call must not enter the loop's
 * session-checkpoint path, where `sessions.flush()` would await this very call
 * through the plugins' own `session/flush` listeners (deadlock).
 */
export async function requestPluginText(
	ctx: Context,
	target: { provider: string; model: string },
	maxTokens: number,
	prompt: string,
	signal: AbortSignal | undefined,
	options: { reasoningEffort?: string } = {},
): Promise<string> {
	return (await requestPluginTextWithMeta(ctx, target, maxTokens, prompt, signal, options)).text;
}

/**
 * One auxiliary plugin-authored model call, returning its visible text plus how it ended.
 *
 * The stop reason is the only signal that says a reply was cut off: a reply that hit the output
 * limit still carries content, so it parses as a truncated document rather than a failure. dsh
 * names that reason `max-tokens` — **not** pi's `length` — and it is deliberately not an error
 * here: the caller decides whether to retry with more headroom (a genuine `error`/`aborted`
 * finish still throws, with the message this plugin has always used).
 * @param ctx - the plugin context holding the `llm` service.
 * @param target - the resolved provider/model route.
 * @param maxTokens - the output cap to request.
 * @param prompt - the plugin-authored user message.
 * @param signal - the pass's abort signal.
 * @param options - optional reasoning effort override.
 * @returns the trimmed visible text, the finish reason kind, and hidden reasoning tokens.
 */
export async function requestPluginTextWithMeta(
	ctx: Context,
	target: { provider: string; model: string },
	maxTokens: number,
	prompt: string,
	signal: AbortSignal | undefined,
	options: { reasoningEffort?: string } = {},
): Promise<CompletionOutcome> {
	const requestOptions: GenerateOptions = {
		provider: target.provider,
		model: target.model,
		messages: [pluginUserMessage(prompt)],
		maxTokens,
		...(options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort as GenerateOptions["reasoningEffort"] }),
		...(signal ? { signal } : {}),
	};

	let text = "";
	let stopReason = "";
	let reasoningTokens = 0;
	let failure: { message: string; code: string } | undefined;
	for await (const chunk of ctx.llm.stream(requestOptions)) {
		if (chunk.type === "text-delta") {
			text += chunk.text;
		} else if (chunk.type === "usage") {
			reasoningTokens = chunk.usage.reasoningTokens ?? 0;
		} else if (chunk.type === "finish") {
			// Every known finish reason is recorded — including `max-tokens`, which is the signal a
			// caller needs to retry, and unknown merge-extensible kinds, which are reported as-is.
			stopReason = chunk.reason.kind;
			if (chunk.reason.kind === "error" || chunk.reason.kind === "aborted") {
				failure = { message: chunk.reason.failure.message, code: chunk.reason.failure.code };
			}
		}
	}
	if (failure) throw new Error(`plugin model call failed (${failure.code}): ${failure.message}`);
	return { text: text.trim(), stopReason, reasoningTokens };
}

/** Run one model call and collect its visible text. Throws on a failed or aborted stream. */
async function requestConsolidationText(
	ctx: Context,
	agent: Agent,
	config: PluginConfig,
	prompt: string,
	signal: AbortSignal | undefined,
	maxTokens: number,
): Promise<CompletionOutcome> {
	const target = resolveTarget(agent, config);
	if (!target) throw new Error("no provider/model available for the learn pass: route one request, set AgentOptions, or configure provider+model");
	return requestPluginTextWithMeta(ctx, target, maxTokens, prompt, signal);
}

/**
 * Run the consolidation pass (durable memory + session context).
 * Callers own persisting their artifact; results are cached per project so the memory and
 * session-context plugins can consume the same pass without a second model call.
 */
export function consolidateProjectState(
	ctx: Context,
	agent: Agent,
	config: PluginConfig,
	options: ConsolidationOptions = {},
): Promise<ConsolidationOutcome | undefined> {
	const cwd = path.resolve(agent.session.header.cwd ?? process.cwd());
	// Claim by project root, not cwd: the root and a subdirectory of one project
	// are the same state and must share a single pass. The root is cache-warm by
	// the time a pass can trigger (sessions warm it on create and callers resolve
	// it first), so the sync fallback practically never spawns git.
	const projectKey = cachedProjectRoot(cwd) ?? getProjectRootSync(cwd);
	const claimed = activeConsolidation.get(projectKey);
	if (claimed) return claimed;

	const run = (async (): Promise<ConsolidationOutcome | undefined> => {
		const force = options.force ?? false;
		const projectRoot = await getProjectRoot(cwd);
		const session = agent.session;
		const turns = userTurnCount(session);
		const sessionId = String(session.id);
		const previous = throttle.get(projectRoot);
		// The turn counter is session-local: after a session change, count from zero again.
		// Otherwise a fresh session would need `previous session turns + consolidateTurns` before learning.
		const baseline = previous?.session === sessionId ? previous.turns : 0;
		const cached = lastOutcome.get(projectRoot);
		const throttled = !force && (turns - baseline < config.consolidateTurns || Date.now() - (previous?.at ?? 0) < config.consolidateIntervalMs);
		if (throttled) return cached?.outcome;
		if (force && cached && Date.now() - cached.at < config.forceDedupeMs) return cached.outcome;

		const existing = await loadMemory(projectRoot, config.maxMemoryChars);
		// The pass continues with whatever is readable, but a broken source must stay diagnosable:
		// the prompt would otherwise look as if the project had no memory at all.
		if (existing.unreadable) await logError(projectRoot, "memory", `project memory exists but cannot be read: ${existing.source}`);
		else if (existing.damaged) await logError(projectRoot, "memory", `memory journal has ${existing.damaged} unusable line(s); they were skipped`);
		const existingContext = (await readOptional(contextFile(projectRoot))).slice(0, MAX_CONTEXT_CHARS);
		const target = resolveTarget(agent, config);
		if (!target) throw new Error("no provider/model available for the learn pass: route one request, set AgentOptions, or configure provider+model");
		// One resolve for both facts: the adapter's own output cap bounds the adaptive cap, and its
		// reasoning metadata decides whether hidden thinking must be reserved out of the same budget.
		const info = await resolveModelMetadata(ctx, target, options.signal);
		const auxModel = { maxTokens: info?.defaultMaxTokens, reasoning: info?.reasoning !== undefined };
		// The reply must re-emit both artifacts, so the output cap is matched to them (raised up to
		// the model's own limit and the configured ceiling) and the input is shortened head-and-tail
		// when even that cannot hold both. An over-long memory is what used to truncate the reply and
		// leave an unparseable document behind.
		const fitted = fitMemoryInput(existing.text, existingContext, config.maxTokens, auxModel, config.maxOutputTokens);
		const promptFor = (input: MemoryInput, retry: boolean): string => [
			...CONSOLIDATION_PROMPT_RULES,
			...(retry ? ["Your previous reply was cut off by the model output limit. Reply with a more compact JSON object and keep memory_markdown shorter."] : []),
			"",
			`Project root: ${projectRoot}`,
			"",
			"<existing-memory>",
			input.text || "(none)",
			"</existing-memory>",
			"",
			"<existing-context>",
			input.contextText || "(none)",
			"</existing-context>",
			"",
			"<recent-conversation>",
			conversationText(session),
			"</recent-conversation>",
		].join("\n");

		/** The input of the call actually sent last: a retry may have sent less than the first fit. */
		let usedInput = fitted;
		let attempt: CompletionOutcome;
		try {
			attempt = await requestConsolidationText(ctx, agent, config, promptFor(fitted, false), options.signal, fitted.maxTokens);
		} catch (error: unknown) {
			// Record the attempt so a persistent failure backs off instead of
			// retrying on every idle.
			throttle.set(projectRoot, { session: sessionId, turns, at: Date.now() });
			throw error;
		}
		let result = parseConsolidation(attempt.text);
		if (!result && attempt.stopReason === "max-tokens") {
			// The reply ran into the output cap, which is not a parse failure: ask again with extra
			// headroom reserved out of the same cap, and a shorter prompt. dsh reports this as
			// `max-tokens` (pi calls it `length`); matching the wrong string would never retry.
			const retried = fitMemoryInput(existing.text, existingContext, config.maxTokens, auxModel, config.maxOutputTokens, RETRY_OUTPUT_HEADROOM_TOKENS);
			try {
				attempt = await requestConsolidationText(ctx, agent, config, promptFor(retried, true), options.signal, retried.maxTokens);
			} catch (error: unknown) {
				throttle.set(projectRoot, { session: sessionId, turns, at: Date.now() });
				throw error;
			}
			usedInput = retried;
			result = parseConsolidation(attempt.text);
		}
		if (!result) {
			// Back off like any other failed pass, but never store the raw JSON as memory. A reply
			// that hit the cap is reported as what it is — the retry already happened, so a generic
			// "not a usable JSON object" would hide the one cause the operator can act on.
			throttle.set(projectRoot, { session: sessionId, turns, at: Date.now() });
			if (attempt.stopReason === "max-tokens") {
				const spent = attempt.reasoningTokens > 0 ? `, ${attempt.reasoningTokens} spent on hidden reasoning` : "";
				throw new Error(`consolidation reply was cut off by the model output limit (${usedInput.maxTokens} tokens requested${spent})\n${replyHead(attempt.text, MAX_CONSOLE_REPLY_CHARS)}`);
			}
			throw new Error(`consolidation reply was not a usable JSON object\n${replyHead(attempt.text, MAX_CONSOLE_REPLY_CHARS)}`);
		}
		const version = (nextVersion += 1);
		throttle.set(projectRoot, { session: sessionId, turns, at: Date.now() });
		if (result.contextUnusable && !contextUnusableLogged.has(projectRoot)) {
			// Memory still lands, but CONTEXT.md keeps its previous content: say so once per
			// project, since the alternative is a stale context with no trace of why.
			contextUnusableLogged.add(projectRoot);
			await logError(projectRoot, "memory", "consolidation reply carried a context whose shape is unusable (summary must be a string and key_points/open_tasks arrays of strings); CONTEXT.md was left unchanged");
		}
		const outcome: ConsolidationOutcome = { result, version, clipped: usedInput.clipped };
		lastOutcome.set(projectRoot, { version, at: Date.now(), outcome });
		return outcome;
	})().finally(() => {
		// Failures reject; the caller logs them and returns a truthful "failed".
		activeConsolidation.delete(projectKey);
	});

	activeConsolidation.set(projectKey, run);
	return run;
}
