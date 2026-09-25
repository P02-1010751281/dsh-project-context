/**
 * Reading the model's reply into proposals, and the backtrack budget the pass may spend.
 */

import { parseJsonObject } from "../shared/reply-json.js";
import { type LearnedSkill, type ProposedSkill } from "./skill.js";

/** At most three archives, 16 KB each: enough for concrete steps without a huge prompt. */
const MAX_BACKTRACK_SESSIONS = 3;

/** Parse the autolearn JSON contract: either a skill, or a request to read archives. */
export function parseAutolearn(text: string): { skill: ProposedSkill | null; needSessions: string[] } {
	const parsed = parseJsonObject(text);
	if (!parsed) return { skill: null, needSessions: [] };
	const needSessions = Array.isArray(parsed.need_sessions)
		? parsed.need_sessions
			.filter((item): item is string => typeof item === "string")
			.map((item) => item.trim())
			.filter((item) => item.length > 0)
			.slice(0, MAX_BACKTRACK_SESSIONS)
		: [];
	const raw = parsed.skill && typeof parsed.skill === "object" ? parsed.skill as Partial<LearnedSkill> & { evidence?: unknown; candidate?: unknown; reason?: unknown } : null;
	const skill = raw && typeof raw.name === "string" && typeof raw.description === "string" && typeof raw.body === "string"
		? {
			name: raw.name.trim(),
			description: raw.description.replace(/\s+/g, " ").trim(),
			body: raw.body.trim(),
			evidence: Array.isArray(raw.evidence) ? raw.evidence.filter((item): item is string => typeof item === "string").map((item) => item.trim()) : [],
			candidate: raw.candidate === true,
			reason: typeof raw.reason === "string" ? raw.reason.replace(/\s+/g, " ").trim().slice(0, 500) : "",
		}
		: null;
	return { skill, needSessions };
}
