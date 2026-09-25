/**
 * The skill shapes and their rendering: the model's proposed skill, the `SKILL.md` document
 * it becomes, and the body/description safety checks every write goes through.
 */

import { MAX_SKILL_BODY_CHARS } from "../shared/project-state.js";

export interface LearnedSkill {
	name: string;
	description: string;
	body: string;
}

export interface ProposedSkill extends LearnedSkill {
	/** Session ids the proposal is grounded in. */
	evidence: string[];
	/** A candidate is stored for the user to confirm instead of activating directly. */
	candidate: boolean;
	reason: string;
}

export const MAX_SKILL_DESCRIPTION_CHARS = 1024;

export function skillDocument(skill: ProposedSkill): string {
	const description = skill.description.replace(/\s+/g, " ").trim().slice(0, MAX_SKILL_DESCRIPTION_CHARS);
	const body = skill.body.trim().slice(0, MAX_SKILL_BODY_CHARS);
	const header = skill.candidate
		? `---\nname: ${skill.name}\ndescription: ${JSON.stringify(description)}\ncandidate: true\n---\n\n<!-- evidence: ${[...new Set(skill.evidence)].join(", ")}${skill.reason ? ` — ${skill.reason}` : ""} -->\n\n`
		: `---\nname: ${skill.name}\ndescription: ${JSON.stringify(description)}\n---\n\n`;
	return `${header}${body}\n`;
}

/**
 * Learned skills are discovered natively by dsh and injected into future
 * sessions, so refuse bodies that try to steer the agent instead of describing
 * a workflow. Heuristic, but it catches the common injection phrasings a
 * summarizer might copy out of untrusted repository content.
 */
const UNSAFE_SKILL_PATTERNS: readonly RegExp[] = [
	/ignore (?:all |any |the )?(?:previous|prior|earlier|above) (?:instructions|rules|prompts)/i,
	/override (?:the )?(?:system|developer|user) (?:prompt|instructions|rules)/i,
	/(?:do not|don't|never) (?:tell|inform|mention (?:this |it )?to|reveal (?:this |it )?to) the user/i,
	/hide (?:this|it) from the user/i,
	/忽略(?:之前|以上|上述|先前|前面)(?:的)?(?:所有)?(?:指令|指示|规则|要求)/,
	/(?:不要|别)(?:告诉|告知|提醒|透露给)用户/,
	/绕过(?:安全|权限|限制)/,
];

export function skillBodyUnsafe(body: string): boolean {
	return UNSAFE_SKILL_PATTERNS.some((pattern) => pattern.test(body));
}

/** Description from a skill/candidate document's frontmatter. Exported for the plugin. */
export function skillDescription(raw: string, limit = MAX_SKILL_DESCRIPTION_CHARS): string {
	const line = raw.split("\n").find((candidate) => candidate.trim().startsWith("description:"));
	if (!line) return "";
	let value = line.trim().slice("description:".length).trim();
	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
		try {
			value = String(JSON.parse(value));
		} catch {
			value = value.slice(1, -1);
		}
	}
	return value.replace(/\s+/g, " ").trim().slice(0, limit);
}
