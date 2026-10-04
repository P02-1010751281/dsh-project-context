/**
 * What the project already knows: the skill inventory injected into the prompt, and the archived
 * session ids evidence may cite.
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { MAX_SKILL_BODY_CHARS, logsDir, pathExists, readOptional, skillsDir, validSkillName } from "../shared/project-state.js";
import { autolearnProvenance, skillBody, skillDescription, withoutAutolearnProvenance } from "./skill.js";

/** Existing skill inventory carried in the prompt, names plus one-line descriptions. */
const MAX_INVENTORY_CHARS = 8_000;

/**
 * How much of the learned skills' own bodies the merge prompt may carry. Whole bodies only: a
 * truncated body invites a lossy merge, so a body that does not fit is left out entirely and the
 * prompt then forbids reusing its name this pass.
 */
const MAX_LEARNED_BODY_CHARS = MAX_SKILL_BODY_CHARS;

export interface SkillInventory {
	name: string;
	description: string;
	/** True when this pipeline wrote the skill; only such a skill may be superseded. */
	autolearn: boolean;
	/** The learned skill's own body, carried so an update can merge instead of rewriting blind. */
	body?: string;
}

/**
 * Existing project skills: `name` plus the frontmatter description. The prompt
 * offers them so the model does not re-litigate a workflow the project already
 * documents, and the names are what makes "never reuse a name" checkable.
 */
export async function collectSkillInventory(projectRoot: string): Promise<SkillInventory[]> {
	const entries = await readdir(skillsDir(projectRoot), { withFileTypes: true }).catch(() => []);
	const skills: SkillInventory[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory() || !validSkillName(entry.name)) continue;
		const raw = await readOptional(path.join(skillsDir(projectRoot), entry.name, "SKILL.md"));
		const autolearn = autolearnProvenance(raw);
		skills.push({
			name: entry.name,
			description: skillDescription(raw),
			autolearn,
			// Only a skill this pipeline wrote may be superseded, and reading the marker here is what
			// keeps the gate and the prompt judging the same fact.
			...(autolearn ? { body: withoutAutolearnProvenance(skillBody(raw)) } : {}),
		});
	}
	return skills.sort((left, right) => left.name.localeCompare(right.name));
}

/** Budgeted prompt rendering of the inventory; `(none)` when the project has no skills. */
export function inventoryText(skills: readonly SkillInventory[]): string {
	const lines: string[] = [];
	let used = 0;
	for (const skill of skills) {
		// Marking the pipeline's own output is what makes the one allowed name reuse checkable by the
		// model: without it, "never reuse a name" is the only rule it can apply.
		const line = `- ${skill.name}${skill.autolearn ? " (learned)" : ""}${skill.description ? `: ${skill.description}` : ""}`;
		if (used + line.length > MAX_INVENTORY_CHARS) break;
		lines.push(line);
		used += line.length + 1;
	}
	return lines.join("\n") || "(none)";
}

/**
 * The learned skills' own bodies, so an update can keep every still-valid step instead of rewriting
 * the procedure blind. Whole bodies only — see `MAX_LEARNED_BODY_CHARS`.
 */
export function learnedBodiesText(skills: readonly SkillInventory[]): string {
	const sections: string[] = [];
	let used = 0;
	for (const skill of skills) {
		if (!skill.autolearn || !skill.body) continue;
		const section = `### ${skill.name}\n\n${skill.body}`;
		if (used + section.length > MAX_LEARNED_BODY_CHARS) continue;
		sections.push(section);
		used += section.length + 1;
	}
	return sections.join("\n\n");
}

/**
 * Session ids whose canonical `session.jsonl` is actually on disk.
 *
 * An INDEX.md line is a claim about a session, not the evidence itself: an id
 * can be indexed after its log was deleted, and a model can invent one. Only
 * ids verified here may be read or cited as evidence.
 */
export async function archivedSessionIds(projectRoot: string): Promise<Set<string>> {
	const dir = logsDir(projectRoot);
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
	const ids = new Set<string>();
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		if (await pathExists(path.join(dir, entry.name, "session.jsonl"))) ids.add(entry.name);
	}
	return ids;
}
