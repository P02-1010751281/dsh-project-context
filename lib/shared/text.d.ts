/**
 * Text measurement and clipping for small auxiliary replies and rendered documents: the
 * character budget per token, the logged/console head of a bad reply, and surrogate-safe
 * clipping that never splits a code point.
 */
import { type ContentBlock } from "@deepseek-ai/dsh-llm";
/** Characters of that excerpt kept in the *console* copy of the error; the log keeps the full head. */
export declare const MAX_CONSOLE_REPLY_CHARS = 200;
/**
 * Attach the head of the reply the model actually sent so `errors.log` can be diagnosed later.
 * The excerpt is redacted here, at the one place the raw reply becomes an error message: this
 * error also reaches `ctx.logger.warn` (which writes verbatim), so masking only on the file path
 * would still print the credentials, and capping only for the console would still write them.
 * @param raw - the raw model reply.
 * @param maxChars - excerpt length; the console passes a shorter budget than the log.
 * @returns a fenced excerpt for an error message.
 */
export declare function replyHead(raw: string, maxChars?: number): string;
/**
 * Conservative output-token rate for text the reply must re-emit. Dense scripts (CJK and every
 * other non-ASCII script, including emoji) are charged a full token per code point; ASCII prose is
 * charged 0.4; quotes and backslashes pay extra for their JSON escape. Never underestimates.
 * @param text - the text the reply has to reproduce.
 * @returns tokens per UTF-16 unit.
 */
export declare function replyTokenRate(text: string): number;
/**
 * Head and tail of a text, shortened to a char limit (the `\n\n` joiner included). Never ends or
 * starts on half of a surrogate pair, which a provider cannot re-encode.
 * @param text - the text to shorten.
 * @param limit - maximum characters in the result.
 * @returns the shortened text.
 */
export declare function clipText(text: string, limit: number): string;
/** Clip from the original text to a char limit, keeping the original when it already fits. */
export declare function clipTo(text: string, limit: number): string;
export declare function clip(value: string, limit: number): string;
/**
 * Clip one single-line label — a session title, an index line — to a char limit.
 *
 * Whitespace is collapsed first: a label is one line, so a multi-line source would otherwise push its
 * own newlines into the session list. The cut lands before a split surrogate pair (a client cannot
 * re-encode half of one), and the trailing `…` is what tells a shortened label from a short one.
 * @param value - the raw label text.
 * @param limit - maximum characters in the result, the ellipsis included.
 * @returns the collapsed label, cut to at most `limit` characters.
 */
export declare function clipTitle(value: string, limit: number): string;
export declare function truncateMiddle(text: string, limit: number): string;
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
export declare function textOf(content: readonly ContentBlock[]): string;
