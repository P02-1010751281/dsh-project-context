/**
 * Candidate skills on disk: the pending `<name>.md` files, the admission rules a proposal must
 * pass, and the approve/reject transitions the `/autolearn` command drives.
 */

import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { pick, type DocumentLanguage } from "../shared/language.js";
import { MAX_SKILL_BODY_CHARS, memoryDir, readOptional, skillsDir, validSkillName, writeAtomic } from "../shared/project-state.js";
import { conflictFindings, conflictText, evidenceText, normalizeEvidence } from "./evidence.js";
import { evidenceOfDocument, readEvidenceCorpus, withEvidenceFrontmatter } from "./evidence-source.js";
import { collectSkillInventory, type SkillInventory } from "./inventory.js";
import { rejectedText, type AutolearnRejection } from "./reasons.js";
import { bindSkills } from "./skill-state-source.js";
import { MAX_SKILL_DESCRIPTION_CHARS, type ProposedSkill, autolearnProvenance, promotedDocument, skillBody, skillBodyUnsafe, skillDescription, skillDocument } from "./skill.js";

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
	return skillBody(raw).replace(/^\s*<!--[\s\S]*?-->\s*/, "").trim();
}

/**
 * The shape rules every skill must pass, whichever path read it. A proposal from the model and a
 * candidate file on disk are the *same document*, so judging them with two copies of the rules is
 * how `approveCandidate` ended up re-deriving four of them — and a candidate approved by hand could
 * have skipped any rule the copy forgot. One pure predicate, shared by both callers.
 *
 * The name is deliberately not part of this predicate: `rejectionReason` checks it, and the
 * approve/reject CLI paths validate their argument themselves. The pass path does **not**
 * pre-validate it — `parseAutolearnReply` only requires `typeof name === "string"` (then trims it) — so the
 * name rule in `rejectionReason` is load-bearing, not caller-guaranteed. That rule also runs before
 * the shape rules, so a doubly-invalid proposal reports the name; both facts are pinned by tests.
 */
export function shapeRejection(description: string, body: string): AutolearnRejection | undefined {
	if (!description) return { code: "missing-description" };
	if (description.length > MAX_SKILL_DESCRIPTION_CHARS) return { code: "description-too-long" };
	if (body.length < MIN_SKILL_BODY_CHARS) return { code: "body-too-short" };
	if (body.length > MAX_SKILL_BODY_CHARS) return { code: "body-too-long" };
	if (skillBodyUnsafe(body)) return { code: "injection" };
	return undefined;
}

/**
 * The citations the pass could verify on disk: the exact filter the admission gate counts, so the ids
 * a promoted skill records are the ids that admitted it — never an unverified one the model named.
 */
function verifiedEvidence(evidence: readonly string[], archived: ReadonlySet<string>): string[] {
	return normalizeEvidence(evidence.filter((id) => archived.has(id)));
}

function rejectionReason(
	skill: ProposedSkill,
	archived: Set<string>,
	existing: readonly SkillInventory[],
	candidateExists: boolean,
	shownNames: ReadonlySet<string> = new Set(),
): AutolearnRejection | undefined {
	if (!validSkillName(skill.name)) return { code: "invalid-name" };
	const shape = shapeRejection(skill.description, skill.body);
	if (shape !== undefined) return shape;
	const cited = verifiedEvidence(skill.evidence, archived);
	const required = skill.candidate ? MIN_CANDIDATE_SESSIONS : MIN_SKILL_SESSIONS;
	if (cited.length < required) {
		return skill.candidate ? { code: "needs-candidate-evidence" } : { code: "needs-two-sessions" };
	}
	// A name this pipeline generated may be reused to supersede that skill — and only when this pass
	// actually showed its body, because the merge has to be over the text being replaced rather than a
	// blind rewrite. Every other existing name (hand-written or imported) belongs to someone else, and
	// a learned name whose body was not shown is off limits too. The guard reads the marker off the
	// artifact, so it is the same fact `/autolearn approve` reads before it replaces a file.
	const collision = existing.find((entry) => entry.name === skill.name);
	if (collision) {
		if (!collision.autolearn) return { code: "skill-exists", name: skill.name };
		if (!shownNames.has(collision.name)) return { code: "body-not-shown" };
	}
	if (candidateExists) return { code: "candidate-exists", name: skill.name };
	return undefined;
}

/**
 * Save a proposed skill. Returns `"live"`/`"candidate"` when written, or the rejection reason so
 * the caller can report *why* instead of claiming the model proposed nothing.
 *
 * A supersede always lands through the candidate gate: the gate lets a marked name through, but the
 * direct publish below may only *create* a name, never replace one. So the only path that replaces
 * a marked skill is `/autolearn approve`, and "the pipeline updated a skill" is always a change a
 * human approved.
 *
 * `shownNames` is the set of learned names whose body this pass actually rendered. A marked name
 * outside it is refused, because a merge over text the model never saw is a blind rewrite wearing a
 * merge's clothes.
 */
export async function saveProposedSkill(
	projectRoot: string,
	skill: ProposedSkill,
	archived: Set<string>,
	shownNames: ReadonlySet<string> = new Set(),
): Promise<"live" | "candidate" | { rejected: AutolearnRejection }> {
	// Read the corpus fresh rather than trusting the caller's list: the marker is the deciding fact
	// and it can change between the prompt and this write.
	const existing = await collectSkillInventory(projectRoot);
	const candidateExists = !!(await readOptional(candidateFile(projectRoot, skill.name)));
	const reason = rejectionReason(skill, archived, existing, candidateExists, shownNames);
	if (reason !== undefined) return { rejected: reason };
	const destination = path.join(skillsDir(projectRoot), skill.name, "SKILL.md");
	// The second, independent read of the same boundary: the gate judged the inventory collected
	// above, this reads the file a promote would replace. Both have to agree that this pass showed
	// the body, so a one-sided change to either rule cannot let a blind supersede through.
	const replaced = await readOptional(destination);
	if (replaced && autolearnProvenance(replaced) && !shownNames.has(skill.name)) return { rejected: { code: "body-not-shown" } };
	if (skill.candidate) {
		// The candidate carries the verified ids in its frontmatter, so the approval that promotes it
		// later reads a fact out of the file instead of re-deriving one from the reply that stored it.
		await writeAtomic(candidateFile(projectRoot, skill.name), withEvidenceFrontmatter(skillDocument(skill), verifiedEvidence(skill.evidence, archived)));
		return "candidate";
	}
	// The publish path keeps its blanket refusal, whatever the destination carries: it is the belt to
	// the approve path's braces, so a model that asks for a direct supersede cannot bypass the gate.
	if (replaced) return { rejected: { code: "skill-exists", name: skill.name } };
	await writeAtomic(destination, withEvidenceFrontmatter(skillDocument(skill), verifiedEvidence(skill.evidence, archived)));
	return "live";
}

/** One stored candidate and the citations it records, for `/autolearn list`. */
export interface CandidateDetail {
	readonly name: string;
	readonly evidence: readonly string[];
}

/**
 * Stored candidates with their recorded evidence, sorted by name.
 *
 * The evidence is read from the candidate's own file: it is the same fact `/autolearn approve` later
 * writes into the promoted skill, so the list cannot show one set of ids and the approval record
 * another.
 */
export async function listCandidateDetails(projectRoot: string): Promise<CandidateDetail[]> {
	const entries = await readdir(candidatesDir(projectRoot), { withFileTypes: true }).catch(() => []);
	const names = entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
		.map((entry) => entry.name.slice(0, -3))
		.sort();
	const details: CandidateDetail[] = [];
	for (const name of names) {
		details.push({ name, evidence: evidenceOfDocument(await readOptional(candidateFile(projectRoot, name))) });
	}
	return details;
}

/** Candidate names, sorted (used by the tests and the reject path's siblings). */
export async function listCandidates(projectRoot: string): Promise<string[]> {
	return (await listCandidateDetails(projectRoot)).map((candidate) => candidate.name);
}

/** Promote a candidate to a live skill. Exported for the plugin. */
export async function approveCandidate(projectRoot: string, name: string | undefined, language: DocumentLanguage = "en"): Promise<{ ok: boolean; message: string }> {
	if (!name || !validSkillName(name)) return { ok: false, message: pick(language, "用法：/autolearn approve <name>", "Usage: /autolearn approve <name>") };
	const file = candidateFile(projectRoot, name);
	const raw = await readOptional(file);
	if (!raw) return { ok: false, message: pick(language, `没有名为「${name}」的候选。`, `No candidate named "${name}".`) };
	const description = skillDescription(raw);
	const body = candidateBody(raw);
	// The same rules the pass applied when it stored this candidate, minus the evidence rules (a
	// stored candidate already passed those, and its file carries no parsed evidence). Naming the rule
	// makes "incomplete or unsafe" actionable instead of a dead end.
	//
	// The description rule must see the *untruncated* frontmatter value: `skillDescription` caps what
	// it returns, so validating the normalized string would leave an over-cap description as a rule the
	// pass applies and this path silently skips — a hand-written candidate could then activate a
	// document the pass refused. Only the value that gets written is the capped one.
	const shape = shapeRejection(skillDescription(raw, Number.MAX_SAFE_INTEGER), body);
	if (shape !== undefined) {
		const reason = rejectedText(shape, language);
		return { ok: false, message: pick(language, `候选「${name}」不可激活（${reason}）；未激活。`, `Candidate "${name}" is not activatable (${reason}); not activating.`) };
	}
	const destination = path.join(skillsDir(projectRoot), name, "SKILL.md");
	const existing = await readOptional(destination);
	// The same boundary the proposal path applies, read off the file being replaced rather than a
	// cached inventory: only a skill this pipeline generated may be superseded, so a name freed by
	// deleting a skill and later taken by a hand-written one is never overwritten.
	if (existing && !autolearnProvenance(existing)) {
		return { ok: false, message: pick(language, `技能「${name}」已存在；请手动移除该候选。`, `Skill "${name}" already exists; remove the candidate manually.`) };
	}
	// The citations travel from the candidate file to the promoted one. They are not re-verified here
	// on purpose: the pass verified them when it stored the candidate, and re-reading the archive at
	// approval time would make the record depend on a directory that changed after the human decided.
	const evidence = evidenceOfDocument(raw);
	// The candidate's own name owns the destination, so its previous body is not a conflict with itself.
	const corpus = await readEvidenceCorpus(projectRoot, { exclude: name });
	const conflicts = conflictFindings({ name, text: body }, corpus.skills, corpus.memory, language);
	await writeAtomic(destination, withEvidenceFrontmatter(promotedDocument(name, description, body), evidence));
	// The baseline is taken here, once, from the document that actually landed: a skill approved today
	// must not be judged against a body it never had, and a later refresh would erase drift.
	await bindSkills(projectRoot, [name]);
	await rm(file, { force: true });
	// Approving is a human decision that runs no prompt, so when it replaces a file the overwrite is
	// blind by construction and the message says so instead of implying the body was merged. It is
	// worded around the approval, not "this pass", because the pass that stored the candidate may
	// well have shown the body — what never saw it is the approval.
	//
	// Two more lines follow: what the skill records as its evidence, and the mechanical token overlap
	// with the rest of the corpus. Both are verdicts about the document that just landed, so a reader
	// never has to open the file to know either one.
	return {
		ok: true,
		message: [
			pick(language,
				`${existing ? "已更新" : "已激活"}项目技能：${name}${existing ? "——手工批准；正文未展示给审批" : ""}`,
				`${existing ? "Updated" : "Activated"} project skill: ${name}${existing ? " — approved by hand; the body was not shown to the approval" : ""}`),
			pick(language, `证据：${evidenceText(evidence, language)}`, `Evidence: ${evidenceText(evidence, language)}`),
			conflictText(conflicts, language),
		].join("\n"),
	};
}

/** Drop a candidate. Exported for the plugin. */
export async function rejectCandidate(projectRoot: string, name: string | undefined, language: DocumentLanguage = "en"): Promise<{ ok: boolean; message: string }> {
	if (!name || !validSkillName(name)) return { ok: false, message: pick(language, "用法：/autolearn reject <name>", "Usage: /autolearn reject <name>") };
	const file = candidateFile(projectRoot, name);
	if (!(await readOptional(file))) return { ok: false, message: pick(language, `没有名为「${name}」的候选。`, `No candidate named "${name}".`) };
	await rm(file, { force: true });
	return { ok: true, message: pick(language, `已移除候选技能：${name}`, `Removed candidate skill: ${name}`) };
}
