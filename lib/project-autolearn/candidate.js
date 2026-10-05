/**
 * Candidate skills on disk: the pending `<name>.md` files, the admission rules a proposal must
 * pass, and the approve/reject transitions the `/autolearn` command drives.
 */
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { MAX_SKILL_BODY_CHARS, memoryDir, readOptional, skillsDir, validSkillName, writeAtomic } from "../shared/project-state.js";
import { collectSkillInventory } from "./inventory.js";
import { MAX_SKILL_DESCRIPTION_CHARS, autolearnProvenance, promotedDocument, skillBody, skillBodyUnsafe, skillDescription, skillDocument } from "./skill.js";
/** A live skill must be grounded in at least two archived sessions; a candidate in one. */
const MIN_SKILL_SESSIONS = 2;
const MIN_CANDIDATE_SESSIONS = 1;
/** Bodies below this are placeholders, not workflows. */
const MIN_SKILL_BODY_CHARS = 160;
function candidatesDir(projectRoot) {
    return path.join(memoryDir(projectRoot), "skill-candidates");
}
function candidateFile(projectRoot, name) {
    return path.join(candidatesDir(projectRoot), `${name}.md`);
}
function candidateBody(raw) {
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
export function shapeRejection(description, body) {
    if (!description)
        return "missing description";
    if (description.length > MAX_SKILL_DESCRIPTION_CHARS)
        return "description too long";
    if (body.length < MIN_SKILL_BODY_CHARS)
        return "body too short";
    if (body.length > MAX_SKILL_BODY_CHARS)
        return "body too long";
    if (skillBodyUnsafe(body))
        return "body looks like an instruction injection";
    return undefined;
}
function rejectionReason(skill, archived, existing, candidateExists, shownNames = new Set()) {
    if (!validSkillName(skill.name))
        return "invalid kebab-case name";
    const shape = shapeRejection(skill.description, skill.body);
    if (shape !== undefined)
        return shape;
    const cited = [...new Set(skill.evidence)].filter((id) => archived.has(id));
    const required = skill.candidate ? MIN_CANDIDATE_SESSIONS : MIN_SKILL_SESSIONS;
    if (cited.length < required) {
        return skill.candidate ? "needs at least one verified session id" : "needs evidence from at least two different sessions";
    }
    // A name this pipeline generated may be reused to supersede that skill — and only when this pass
    // actually showed its body, because the merge has to be over the text being replaced rather than a
    // blind rewrite. Every other existing name (hand-written or imported) belongs to someone else, and
    // a learned name whose body was not shown is off limits too. The guard reads the marker off the
    // artifact, so it is the same fact `/autolearn approve` reads before it replaces a file.
    const collision = existing.find((entry) => entry.name === skill.name);
    if (collision) {
        if (!collision.autolearn)
            return `skill "${skill.name}" already exists`;
        if (!shownNames.has(collision.name))
            return "body not shown this pass";
    }
    if (candidateExists)
        return `candidate "${skill.name}" already exists`;
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
export async function saveProposedSkill(projectRoot, skill, archived, shownNames = new Set()) {
    // Read the corpus fresh rather than trusting the caller's list: the marker is the deciding fact
    // and it can change between the prompt and this write.
    const existing = await collectSkillInventory(projectRoot);
    const candidateExists = !!(await readOptional(candidateFile(projectRoot, skill.name)));
    const reason = rejectionReason(skill, archived, existing, candidateExists, shownNames);
    if (reason !== undefined)
        return { rejected: reason };
    const destination = path.join(skillsDir(projectRoot), skill.name, "SKILL.md");
    // The second, independent read of the same boundary: the gate judged the inventory collected
    // above, this reads the file a promote would replace. Both have to agree that this pass showed
    // the body, so a one-sided change to either rule cannot let a blind supersede through.
    const replaced = await readOptional(destination);
    if (replaced && autolearnProvenance(replaced) && !shownNames.has(skill.name))
        return { rejected: "body not shown this pass" };
    if (skill.candidate) {
        await writeAtomic(candidateFile(projectRoot, skill.name), skillDocument(skill));
        return "candidate";
    }
    // The publish path keeps its blanket refusal, whatever the destination carries: it is the belt to
    // the approve path's braces, so a model that asks for a direct supersede cannot bypass the gate.
    if (replaced)
        return { rejected: `skill "${skill.name}" already exists` };
    await writeAtomic(destination, skillDocument(skill));
    return "live";
}
/** Candidate names, sorted (used by `/autolearn list`). Exported for the plugin. */
export async function listCandidates(projectRoot) {
    const entries = await readdir(candidatesDir(projectRoot), { withFileTypes: true }).catch(() => []);
    return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => entry.name.slice(0, -3))
        .sort();
}
/** Promote a candidate to a live skill. Exported for the plugin. */
export async function approveCandidate(projectRoot, name) {
    if (!name || !validSkillName(name))
        return { ok: false, message: "Usage: /autolearn approve <name>" };
    const file = candidateFile(projectRoot, name);
    const raw = await readOptional(file);
    if (!raw)
        return { ok: false, message: `No candidate named "${name}".` };
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
    if (shape !== undefined)
        return { ok: false, message: `Candidate "${name}" is not activatable (${shape}); not activating.` };
    const destination = path.join(skillsDir(projectRoot), name, "SKILL.md");
    const existing = await readOptional(destination);
    // The same boundary the proposal path applies, read off the file being replaced rather than a
    // cached inventory: only a skill this pipeline generated may be superseded, so a name freed by
    // deleting a skill and later taken by a hand-written one is never overwritten.
    if (existing && !autolearnProvenance(existing)) {
        return { ok: false, message: `Skill "${name}" already exists; remove the candidate manually.` };
    }
    await writeAtomic(destination, promotedDocument(name, description, body));
    await rm(file, { force: true });
    // Approving is a human decision that runs no prompt, so when it replaces a file the overwrite is
    // blind by construction and the message says so instead of implying the body was merged. It is
    // worded around the approval, not "this pass", because the pass that stored the candidate may
    // well have shown the body — what never saw it is the approval.
    return { ok: true, message: `${existing ? "Updated" : "Activated"} project skill: ${name}${existing ? " — approved by hand; the body was not shown to the approval" : ""}` };
}
/** Drop a candidate. Exported for the plugin. */
export async function rejectCandidate(projectRoot, name) {
    if (!name || !validSkillName(name))
        return { ok: false, message: "Usage: /autolearn reject <name>" };
    const file = candidateFile(projectRoot, name);
    if (!(await readOptional(file)))
        return { ok: false, message: `No candidate named "${name}".` };
    await rm(file, { force: true });
    return { ok: true, message: `Removed candidate skill: ${name}` };
}
