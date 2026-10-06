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
 * How much of the *requested* learned skills' own bodies one round may carry. Whole bodies only: a
 * truncated body invites a lossy merge, so a body that does not fit is left out entirely — and then
 * its name is not in `names`, which is what the write path reads before it lets a name be superseded.
 */
const MAX_SHOWN_BODY_CHARS = MAX_SKILL_BODY_CHARS;
/**
 * How many bodies one round may ask for. Enforced in `learnedBodies` rather than through the tool
 * schema's `maxItems`: the provider is not guaranteed to honour `maxItems`, so the slice has to live
 * in code, and it belongs where the bodies are actually rendered.
 */
export const MAX_INSPECT_SKILLS = 2;
/**
 * Existing project skills: `name` plus the frontmatter description. The prompt
 * offers them so the model does not re-litigate a workflow the project already
 * documents, and the names are what makes "never reuse a name" checkable.
 */
export async function collectSkillInventory(projectRoot) {
    const entries = await readdir(skillsDir(projectRoot), { withFileTypes: true }).catch(() => []);
    const skills = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || !validSkillName(entry.name))
            continue;
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
export function inventoryText(skills) {
    const lines = [];
    let used = 0;
    for (const skill of skills) {
        // Marking the pipeline's own output is what makes the one allowed name reuse checkable by the
        // model: without it, "never reuse a name" is the only rule it can apply.
        const line = `- ${skill.name}${skill.autolearn ? " (learned)" : ""}${skill.description ? `: ${skill.description}` : ""}`;
        if (used + line.length > MAX_INVENTORY_CHARS)
            break;
        lines.push(line);
        used += line.length + 1;
    }
    if (lines.length < skills.length) {
        // Say the list is incomplete rather than silently hiding its tail: a name the model cannot see is
        // then not a name that does not exist, and an operator reading the prompt can see the cap being
        // reached. The marker itself is not charged against the cap, so the text may exceed it by the
        // marker's own line. It is emitted even when the very first line overflows — `lines` is empty
        // then, and a silent `(none)`-shaped inventory would be the worst case of this defect.
        lines.push(`- (${skills.length - lines.length} more skill(s) not listed: the ${MAX_INVENTORY_CHARS}-character inventory cap was reached)`);
    }
    return lines.join("\n") || "(none)";
}
/**
 * The bodies of the *requested* learned skills, so an update can keep every still-valid step instead
 * of rewriting the procedure blind. Returns the rendered text **and** the names it managed to
 * include: "shown this pass" is what the gate and the write path read, so both have to come out of
 * one computation rather than being re-derived. Whole bodies only — see `MAX_SHOWN_BODY_CHARS`.
 */
export function learnedBodies(skills, requested) {
    const wanted = new Set(requested.slice(0, MAX_INSPECT_SKILLS));
    const sections = [];
    const names = [];
    let used = 0;
    for (const skill of skills) {
        if (!wanted.has(skill.name) || !skill.autolearn || !skill.body)
            continue;
        const section = `### ${skill.name}\n\n${skill.body}`;
        if (used + section.length > MAX_SHOWN_BODY_CHARS)
            continue;
        sections.push(section);
        names.push(skill.name);
        used += section.length + 1;
    }
    return { text: sections.join("\n\n"), names };
}
/**
 * Session ids whose canonical `session.jsonl` is actually on disk.
 *
 * An INDEX.md line is a claim about a session, not the evidence itself: an id
 * can be indexed after its log was deleted, and a model can invent one. Only
 * ids verified here may be read or cited as evidence.
 */
export async function archivedSessionIds(projectRoot) {
    const dir = logsDir(projectRoot);
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const ids = new Set();
    for (const entry of entries) {
        if (!entry.isDirectory())
            continue;
        if (await pathExists(path.join(dir, entry.name, "session.jsonl")))
            ids.add(entry.name);
    }
    return ids;
}
