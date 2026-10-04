/**
 * Reading the model's reply into proposals, and the backtrack budget the pass may spend.
 *
 * Two entries produce the same decision: the `record_skill` tool call (the preferred one) and the
 * JSON text reply (the fallback), so both read through the same shaping helpers.
 */

import { parseJsonObject } from "../shared/reply-json.js";
import { type ProposedSkill } from "./skill.js";

/** At most three archives, 16 KB each: enough for concrete steps without a huge prompt. */
const MAX_BACKTRACK_SESSIONS = 3;

/** One autolearn decision: the proposal (or none) and the archives it wants read before deciding. */
export type AutolearnDecision = { skill: ProposedSkill | null; needSessions: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read the `need_sessions` member: string ids, trimmed, blanks dropped, capped at the budget. */
function readNeedSessions(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((item): item is string => typeof item === "string")
		.map((item) => item.trim())
		.filter((item) => item.length > 0)
		.slice(0, MAX_BACKTRACK_SESSIONS);
}

/**
 * Shape one `skill` member: a proposal, `null` for "nothing to propose", or `undefined` when the
 * shape is wrong.
 *
 * An empty (or whitespace) `name` is the tool contract's "nothing to propose", and the other fields
 * are then ignored — which is what lets the tool schema require every property without an `anyOf`.
 * A non-empty name still is not filtered here: `saveProposedSkill` owns the kebab-case rule, and
 * filtering it at parse time would make that rule unreachable from a model answer.
 */
function shapeProposedSkill(raw: Record<string, unknown>): ProposedSkill | null | undefined {
	if (typeof raw.name !== "string") return undefined;
	const name = raw.name.trim();
	if (name === "") return null;
	if (typeof raw.description !== "string" || typeof raw.body !== "string") return undefined;
	return {
		name,
		description: raw.description.replace(/\s+/g, " ").trim(),
		body: raw.body.trim(),
		evidence: Array.isArray(raw.evidence) ? raw.evidence.filter((item): item is string => typeof item === "string").map((item) => item.trim()) : [],
		candidate: raw.candidate === true,
		reason: typeof raw.reason === "string" ? raw.reason.replace(/\s+/g, " ").trim().slice(0, 500) : "",
	};
}

/**
 * Parse the autolearn JSON contract, keeping the distinction between "the reply carried no readable
 * object" and "it parsed and proposed nothing".
 *
 * The distinction is the signal a caller needs to accept a reply cut at the output cap: the cut text
 * parsed, so the object closed before the cut and every member was emitted whole (a raw `JSON.parse`
 * cannot accept a half-written value) — while an unreadable reply must still be re-asked rather than
 * read as a decision. `undefined` means unreadable; `{skill: null}` means the model proposed nothing.
 */
export function parseAutolearnReply(text: string): AutolearnDecision | undefined {
	const parsed = parseJsonObject(text);
	if (!parsed) return undefined;
	// The text path keeps its historical verdict: a malformed `skill` member is "nothing to
	// propose", not an unusable reply.
	const raw = isRecord(parsed.skill) ? parsed.skill : null;
	const skill = raw === null ? null : shapeProposedSkill(raw) ?? null;
	return { skill, needSessions: readNeedSessions(parsed.need_sessions) };
}

/**
 * Parse the autolearn JSON contract the fail-soft way: an unreadable reply is the same decision a
 * model that proposed nothing returns.
 *
 * Kept as the reading entry for callers that have nothing better to do with an unreadable reply;
 * `parseAutolearnReply` is the one that reports which of the two happened.
 */
export function parseAutolearn(text: string): AutolearnDecision {
	return parseAutolearnReply(text) ?? { skill: null, needSessions: [] };
}

/**
 * Read a `record_skill` tool call's arguments.
 *
 * `undefined` means the arguments are unusable, which the caller must treat as a failed call —
 * falling back to the text path, or failing loudly when there is no text — never as a decision that
 * proposed nothing.
 */
export function parseAutolearnToolCall(value: unknown): AutolearnDecision | undefined {
	if (!isRecord(value)) return undefined;
	const needSessions = readNeedSessions(value.need_sessions);
	const raw = value.skill;
	// `null` and a missing member are the text shape, which a model may still return out of habit.
	if (raw === null || raw === undefined) return { skill: null, needSessions };
	if (!isRecord(raw)) return undefined;
	const skill = shapeProposedSkill(raw);
	if (skill === undefined) return undefined;
	return { skill, needSessions };
}
