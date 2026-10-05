/**
 * What the project already knows: the skill inventory injected into the prompt, and the archived
 * session ids evidence may cite.
 */
/**
 * How many bodies one round may ask for. Enforced in `learnedBodies` rather than through the tool
 * schema's `maxItems`: the provider is not guaranteed to honour `maxItems`, so the slice has to live
 * in code, and it belongs where the bodies are actually rendered.
 */
export declare const MAX_INSPECT_SKILLS = 2;
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
export declare function collectSkillInventory(projectRoot: string): Promise<SkillInventory[]>;
/** Budgeted prompt rendering of the inventory; `(none)` when the project has no skills. */
export declare function inventoryText(skills: readonly SkillInventory[]): string;
/**
 * The bodies of the *requested* learned skills, so an update can keep every still-valid step instead
 * of rewriting the procedure blind. Returns the rendered text **and** the names it managed to
 * include: "shown this pass" is what the gate and the write path read, so both have to come out of
 * one computation rather than being re-derived. Whole bodies only — see `MAX_SHOWN_BODY_CHARS`.
 */
export declare function learnedBodies(skills: readonly SkillInventory[], requested: readonly string[]): {
    text: string;
    names: string[];
};
/**
 * Session ids whose canonical `session.jsonl` is actually on disk.
 *
 * An INDEX.md line is a claim about a session, not the evidence itself: an id
 * can be indexed after its log was deleted, and a model can invent one. Only
 * ids verified here may be read or cited as evidence.
 */
export declare function archivedSessionIds(projectRoot: string): Promise<Set<string>>;
