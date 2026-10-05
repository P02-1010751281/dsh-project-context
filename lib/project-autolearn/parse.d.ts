/**
 * Reading the model's reply into proposals, and the backtrack budget the pass may spend.
 *
 * Two entries produce the same decision: the `record_skill` tool call (the preferred one) and the
 * JSON text reply (the fallback), so both read through the same shaping helpers.
 */
import { type ProposedSkill } from "./skill.js";
/**
 * One autolearn decision: the proposal (or none), the archives it wants read, and the learned skill
 * bodies it wants shown before deciding.
 */
export type AutolearnDecision = {
    skill: ProposedSkill | null;
    needSessions: string[];
    inspectSkill: string[];
};
/**
 * Parse the autolearn JSON contract, keeping the distinction between "the reply carried no readable
 * object" and "it parsed and proposed nothing".
 *
 * The distinction is the signal a caller needs to accept a reply cut at the output cap: the cut text
 * parsed, so the object closed before the cut and every member was emitted whole (a raw `JSON.parse`
 * cannot accept a half-written value) — while an unreadable reply must still be re-asked rather than
 * read as a decision. `undefined` means unreadable; `{skill: null}` means the model proposed nothing.
 */
export declare function parseAutolearnReply(text: string): AutolearnDecision | undefined;
/**
 * Read a `record_skill` tool call's arguments.
 *
 * `undefined` means the arguments are unusable, which the caller must treat as a failed call —
 * falling back to the text path, or failing loudly when there is no text — never as a decision that
 * proposed nothing.
 */
export declare function parseAutolearnToolCall(value: unknown): AutolearnDecision | undefined;
