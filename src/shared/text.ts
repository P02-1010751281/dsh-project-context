/**
 * Text measurement and clipping for small auxiliary replies and rendered documents: the
 * character budget per token, the logged/console head of a bad reply, and surrogate-safe
 * clipping that never splits a code point.
 */

import { type ContentBlock } from "@deepseek-ai/dsh-llm";
import { redactSecrets } from "./project-state.js";

/** Worst-case output tokens per character for dense scripts (a Han character is close to one token). */
const DENSE_TOKENS_PER_CHAR = 1;

/** Conservative rate for markdown, paths and ASCII prose (real tokenizers need less). */
const ASCII_TOKENS_PER_CHAR = 0.4;

/** Extra cost for a quote or backslash, which JSON escaping doubles when the reply re-emits it. */
const ESCAPE_TOKENS_PER_CHAR = 0.2;

/** Characters of the raw reply kept in a failure record; `errors.log` caps the whole record anyway. */
const MAX_LOGGED_REPLY_CHARS = 4000;

/** Characters of that excerpt kept in the *console* copy of the error; the log keeps the full head. */
export const MAX_CONSOLE_REPLY_CHARS = 200;

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
export function clipTo(text: string, limit: number): string {
	return text.length <= limit ? text : limit <= 0 ? "" : clipText(text, limit);
}

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
 * The text a content-block list carries.
 *
 * dsh 0.1.7-rc.2 removed the `tool-result` content block: a tool result is now a first-class
 * `role: 'tool'` message whose own `text` blocks hold the output, so joining this message's text
 * blocks covers tool output too. Before rc.2 the payload was nested inside a `tool-result` block and
 * had to be read recursively; without that every tool output rendered as empty and was dropped from
 * the transcript, the handoff's carried tail and the summarizer input alike. That regression is why
 * this walk has to cover whatever block actually carries text — see `conversationMessageSections`,
 * which renders the tool-role message through this same function.
 * @param content - the message's content blocks.
 * @returns the joined text, or `""` when no block carries any.
 */
export function textOf(content: readonly ContentBlock[]): string {
	return content
		.map((block) => (block.type === "text" && typeof block.text === "string" ? block.text : ""))
		.filter((part) => part.length > 0)
		.join("\n")
		.trim();
}
