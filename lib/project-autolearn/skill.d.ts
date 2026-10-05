/**
 * The skill shapes and their rendering: the model's proposed skill, the `SKILL.md` document
 * it becomes, and the body/description safety checks every write goes through.
 */
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
export declare const MAX_SKILL_DESCRIPTION_CHARS = 1024;
/** True when this `SKILL.md` carries the pipeline's provenance marker (frontmatter or body). */
export declare function autolearnProvenance(raw: string): boolean;
/** The body with the marker stripped, so a merge prompt never carries pipeline metadata. */
export declare function withoutAutolearnProvenance(body: string): string;
/** Everything after the `SKILL.md` frontmatter, marker included. */
export declare function skillBody(raw: string): string;
/**
 * The `SKILL.md` a promoted skill becomes: frontmatter, provenance marker, then the body.
 *
 * One owner for that document, so the marker cannot be forgotten in one of the write paths — the
 * pass's live publish and `/autolearn approve` both go through here.
 */
export declare function promotedDocument(name: string, description: string, body: string): string;
export declare function skillDocument(skill: ProposedSkill): string;
export declare function skillBodyUnsafe(body: string): boolean;
/** Description from a skill/candidate document's frontmatter. Exported for the plugin. */
export declare function skillDescription(raw: string, limit?: number): string;
