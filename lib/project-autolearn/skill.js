/**
 * The skill shapes and their rendering: the model's proposed skill, the `SKILL.md` document
 * it becomes, and the body/description safety checks every write goes through.
 */
import { MAX_SKILL_BODY_CHARS } from "../shared/project-state.js";
export const MAX_SKILL_DESCRIPTION_CHARS = 1024;
/**
 * The provenance marker every `SKILL.md` this pipeline writes carries in its body.
 *
 * It is what makes "autolearn may only supersede its own output" checkable *on the artifact* instead
 * of booked in a side file: the marker dies with the skill, so a name freed by deleting a skill and
 * later taken by a hand-written one can never be mistaken for ours. It sits in the body and not the
 * frontmatter because `skillDescription` and the candidate parser read the frontmatter, so an unknown
 * key there would be read as a candidate field.
 */
const PROVENANCE_PATTERN = /<!--\s*autolearn-generated[^>]*-->/g;
const PROVENANCE_COMMENT = "<!-- autolearn-generated: this skill may be superseded by a later autolearn pass -->";
/** True when this `SKILL.md` carries the pipeline's provenance marker (frontmatter or body). */
export function autolearnProvenance(raw) {
    // A fresh non-global regex: `.test` on a shared `g` pattern would carry `lastIndex` between calls.
    return new RegExp(PROVENANCE_PATTERN.source).test(raw);
}
/** The body with the marker stripped, so a merge prompt never carries pipeline metadata. */
export function withoutAutolearnProvenance(body) {
    return body.replace(PROVENANCE_PATTERN, "").replace(/^\s+/, "").trimEnd();
}
/** Everything after the `SKILL.md` frontmatter, marker included. */
export function skillBody(raw) {
    const match = /^---\n[\s\S]*?\n---\n/.exec(raw);
    return (match ? raw.slice(match[0].length) : raw).trim();
}
/**
 * The `SKILL.md` a promoted skill becomes: frontmatter, provenance marker, then the body.
 *
 * One owner for that document, so the marker cannot be forgotten in one of the write paths — the
 * pass's live publish and `/autolearn approve` both go through here.
 */
export function promotedDocument(name, description, body) {
    return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${PROVENANCE_COMMENT}\n\n${withoutAutolearnProvenance(body)}\n`;
}
export function skillDocument(skill) {
    const description = skill.description.replace(/\s+/g, " ").trim().slice(0, MAX_SKILL_DESCRIPTION_CHARS);
    const body = skill.body.trim().slice(0, MAX_SKILL_BODY_CHARS);
    // A candidate is a proposal, not a promoted skill: it carries no marker, so approving it is what
    // records provenance. That asymmetry is the point — the marker only ever means "the pipeline
    // wrote the live skill".
    if (!skill.candidate)
        return promotedDocument(skill.name, description, body);
    const header = `---\nname: ${skill.name}\ndescription: ${JSON.stringify(description)}\ncandidate: true\n---\n\n<!-- evidence: ${[...new Set(skill.evidence)].join(", ")}${skill.reason ? ` — ${skill.reason}` : ""} -->\n\n`;
    return `${header}${body}\n`;
}
/**
 * Learned skills are discovered natively by dsh and injected into future
 * sessions, so refuse bodies that try to steer the agent instead of describing
 * a workflow. Heuristic, but it catches the common injection phrasings a
 * summarizer might copy out of untrusted repository content.
 */
const UNSAFE_SKILL_PATTERNS = [
    /ignore (?:all |any |the )?(?:previous|prior|earlier|above) (?:instructions|rules|prompts)/i,
    /override (?:the )?(?:system|developer|user) (?:prompt|instructions|rules)/i,
    /(?:do not|don't|never) (?:tell|inform|mention (?:this |it )?to|reveal (?:this |it )?to) the user/i,
    /hide (?:this|it) from the user/i,
    /忽略(?:之前|以上|上述|先前|前面)(?:的)?(?:所有)?(?:指令|指示|规则|要求)/,
    /(?:不要|别)(?:告诉|告知|提醒|透露给)用户/,
    /绕过(?:安全|权限|限制)/,
];
export function skillBodyUnsafe(body) {
    return UNSAFE_SKILL_PATTERNS.some((pattern) => pattern.test(body));
}
/** Description from a skill/candidate document's frontmatter. Exported for the plugin. */
export function skillDescription(raw, limit = MAX_SKILL_DESCRIPTION_CHARS) {
    const line = raw.split("\n").find((candidate) => candidate.trim().startsWith("description:"));
    if (!line)
        return "";
    let value = line.trim().slice("description:".length).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        try {
            value = String(JSON.parse(value));
        }
        catch {
            value = value.slice(1, -1);
        }
    }
    return value.replace(/\s+/g, " ").trim().slice(0, limit);
}
