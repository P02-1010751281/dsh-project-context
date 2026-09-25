/**
 * What the project already knows: the skill inventory injected into the prompt, and the archived
 * session ids evidence may cite.
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { logsDir, pathExists, readOptional, skillsDir, validSkillName } from "../shared/project-state.js";
import { skillDescription } from "./skill.js";

/** Existing skill inventory carried in the prompt, names plus one-line descriptions. */
const MAX_INVENTORY_CHARS = 8_000;

interface SkillInventory {
	name: string;
	description: string;
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
		skills.push({ name: entry.name, description: skillDescription(raw) });
	}
	return skills.sort((left, right) => left.name.localeCompare(right.name));
}

/** Budgeted prompt rendering of the inventory; `(none)` when the project has no skills. */
export function inventoryText(skills: readonly SkillInventory[]): string {
	const lines: string[] = [];
	let used = 0;
	for (const skill of skills) {
		const line = `- ${skill.name}${skill.description ? `: ${skill.description}` : ""}`;
		if (used + line.length > MAX_INVENTORY_CHARS) break;
		lines.push(line);
		used += line.length + 1;
	}
	return lines.join("\n") || "(none)";
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
