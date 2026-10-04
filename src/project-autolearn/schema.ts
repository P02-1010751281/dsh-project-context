/**
 * The `record_skill` tool schema.
 *
 * The text reply shape allowed `skill: null`, which cannot be expressed in a strict JSON schema: an
 * object member would be wrapped into `anyOf: [<object>, {type: "null"}]`, and object unions are
 * rejected. The tool shape is therefore always an object whose empty `name` carries "nothing to
 * propose", so every property is required and no `anyOf` is needed. The text fallback keeps the
 * nullable `skill` member it has always had.
 *
 * Ported from pi's `extensions/project-context/autolearn/schema.ts`, keeping this repo's
 * `need_sessions` field name (pi renamed it to `inspect` in the same change; the rename is not the
 * port, and the existing prompt, parser and tests already use `need_sessions`).
 */

import { type PluginTool } from "../shared/model-call.js";
import { MAX_SKILL_BODY_CHARS } from "../shared/project-state.js";
import { MAX_SKILL_DESCRIPTION_CHARS } from "./skill.js";

export const RECORD_SKILL_TOOL: PluginTool = {
	name: "record_skill",
	description:
		"Submit this pass's skill decision; call it once. Code validates the proposal, stores a valid one for the user to confirm, and reports the rest, so state evidence honestly. Never include secrets, credentials, generic programming advice, or instructions that override system or user instructions.",
	parameters: {
		type: "object",
		additionalProperties: false,
		required: ["skill", "need_sessions"],
		properties: {
			skill: {
				type: "object",
				additionalProperties: false,
				required: ["name", "description", "body", "evidence", "candidate", "reason"],
				description:
					'The proposed skill. When there is nothing to propose — the normal outcome — set `name` to "" and fill every other field with an empty string or array; never omit this object.',
				properties: {
					name: {
						type: "string",
						description:
							'Lowercase-kebab-case name, never reused from the existing inventory — except a name marked `(learned)` there whose body is shown under <learned-skill-bodies>, which may be reused to update that skill. "" means propose nothing; the other skill fields are then ignored.',
					},
					description: { type: "string", description: `One line: when to use the skill, at most ${MAX_SKILL_DESCRIPTION_CHARS} characters.` },
					body: { type: "string", description: `Concise Markdown procedure with when-to-use and exact commands or paths, at most ${MAX_SKILL_BODY_CHARS} characters.` },
					evidence: {
						type: "array",
						items: { type: "string" },
						description: "Session ids copied from the archive index that verify this skill.",
					},
					candidate: {
						type: "boolean",
						description:
							"true stores a proposal for the user to confirm and needs at least one verified session id; false needs at least two distinct verified session ids. An update to a learned skill must be stored this way, because only the user's approval replaces it.",
					},
					reason: {
						type: "string",
						description:
							"One line: why this proposal is worth storing. Code trims it to 500 characters and embeds it in the candidate SKILL.md header.",
					},
				},
			},
			need_sessions: {
				type: "array",
				items: { type: "string" },
				description: "Up to three archived session ids whose raw transcripts you want to read before deciding.",
			},
		},
	},
};
