/**
 * Candidate skills on disk: the pending `<name>.md` files, the admission rules a proposal must
 * pass, and the approve/reject transitions the `/autolearn` command drives.
 */

import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { MAX_SKILL_BODY_CHARS, memoryDir, readOptional, skillsDir, validSkillName, writeAtomic } from "../shared/project-state.js";
import { MAX_SKILL_DESCRIPTION_CHARS, type ProposedSkill, skillBodyUnsafe, skillDescription, skillDocument } from "./skill.js";

/** A live skill must be grounded in at least two archived sessions; a candidate in one. */
const MIN_SKILL_SESSIONS = 2;

const MIN_CANDIDATE_SESSIONS = 1;

/** Bodies below this are placeholders, not workflows. */
const MIN_SKILL_BODY_CHARS = 160;

function candidatesDir(projectRoot: string): string {
	return path.join(memoryDir(projectRoot), "skill-candidates");
}

function candidateFile(projectRoot: string, name: string): string {
	return path.join(candidatesDir(projectRoot), `${name}.md`);
}

function candidateBody(raw: string): string {
	const match = /^---\n[\s\S]*?\n---\n/.exec(raw);
	const rest = match ? raw.slice(match[0].length) : raw;
	return rest.replace(/^\s*<!--[\s\S]*?-->\s*/, "").trim();
}

async function existingSkillNames(projectRoot: string): Promise<Set<string>> {
	const entries = await readdir(skillsDir(projectRoot), { withFileTypes: true }).catch(() => []);
	return new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name));
}

/**
 * The shape rules every skill must pass, whichever path read it. A proposal from the model and a
 * candidate file on disk are the *same document*, so judging them with two copies of the rules is
 * how `approveCandidate` ended up re-deriving four of them — and a candidate approved by hand could
 * have skipped any rule the copy forgot. One pure predicate, shared by both callers.
 *
 * The name is checked by the caller: the pass validates the model's name, the approve path validates
 * the CLI argument before it reads anything.
 */
export function shapeRejection(description: string, body: string): string | undefined {
	if (!description) return "missing description";
	if (description.length > MAX_SKILL_DESCRIPTION_CHARS) return "description too long";
	if (body.length < MIN_SKILL_BODY_CHARS) return "body too short";
	if (body.length > MAX_SKILL_BODY_CHARS) return "body too long";
	if (skillBodyUnsafe(body)) return "body looks like an instruction injection";
	return undefined;
}

function rejectionReason(skill: ProposedSkill, archived: Set<string>, existing: Set<string>, candidateExists: boolean): string | undefined {
	if (!validSkillName(skill.name)) return "invalid kebab-case name";
	const shape = shapeRejection(skill.description, skill.body);
	if (shape !== undefined) return shape;
	const cited = [...new Set(skill.evidence)].filter((id) => archived.has(id));
	const required = skill.candidate ? MIN_CANDIDATE_SESSIONS : MIN_SKILL_SESSIONS;
	if (cited.length < required) {
		return skill.candidate ? "needs at least one verified session id" : "needs evidence from at least two different sessions";
	}
	if (existing.has(skill.name)) return `skill "${skill.name}" already exists`;
	if (candidateExists) return `candidate "${skill.name}" already exists`;
	return undefined;
}

/**
 * Save a proposed skill. Returns `"live"`/`"candidate"` when written, or the rejection reason so
 * the caller can report *why* instead of claiming the model proposed nothing.
 */
export async function saveProposedSkill(projectRoot: string, skill: ProposedSkill, archived: Set<string>): Promise<"live" | "candidate" | { rejected: string }> {
	const existing = await existingSkillNames(projectRoot);
	const candidateExists = !!(await readOptional(candidateFile(projectRoot, skill.name)));
	const reason = rejectionReason(skill, archived, existing, candidateExists);
	if (reason !== undefined) return { rejected: reason };
	if (skill.candidate) {
		await writeAtomic(candidateFile(projectRoot, skill.name), skillDocument(skill));
		return "candidate";
	}
	await writeAtomic(path.join(skillsDir(projectRoot), skill.name, "SKILL.md"), skillDocument(skill));
	return "live";
}

/** Candidate names, sorted (used by `/autolearn list`). Exported for the plugin. */
export async function listCandidates(projectRoot: string): Promise<string[]> {
	const entries = await readdir(candidatesDir(projectRoot), { withFileTypes: true }).catch(() => []);
	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
		.map((entry) => entry.name.slice(0, -3))
		.sort();
}

/** Promote a candidate to a live skill. Exported for the plugin. */
export async function approveCandidate(projectRoot: string, name: string | undefined): Promise<{ ok: boolean; message: string }> {
	if (!name || !validSkillName(name)) return { ok: false, message: "Usage: /autolearn approve <name>" };
	const file = candidateFile(projectRoot, name);
	const raw = await readOptional(file);
	if (!raw) return { ok: false, message: `No candidate named "${name}".` };
	const description = skillDescription(raw);
	const body = candidateBody(raw);
	// The same rules the pass applied when it stored this candidate, minus the evidence rules (a
	// stored candidate already passed those, and its file carries no parsed evidence). Naming the rule
	// makes "incomplete or unsafe" actionable instead of a dead end.
	const shape = shapeRejection(description, body);
	if (shape !== undefined) return { ok: false, message: `Candidate "${name}" is not activatable (${shape}); not activating.` };
	if (await readOptional(path.join(skillsDir(projectRoot), name, "SKILL.md"))) {
		return { ok: false, message: `Skill "${name}" already exists; remove the candidate manually.` };
	}
	await writeAtomic(path.join(skillsDir(projectRoot), name, "SKILL.md"), `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body}\n`);
	await rm(file, { force: true });
	return { ok: true, message: `Activated project skill: ${name}` };
}

/** Drop a candidate. Exported for the plugin. */
export async function rejectCandidate(projectRoot: string, name: string | undefined): Promise<{ ok: boolean; message: string }> {
	if (!name || !validSkillName(name)) return { ok: false, message: "Usage: /autolearn reject <name>" };
	const file = candidateFile(projectRoot, name);
	if (!(await readOptional(file))) return { ok: false, message: `No candidate named "${name}".` };
	await rm(file, { force: true });
	return { ok: true, message: `Removed candidate skill: ${name}` };
}
