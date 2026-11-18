/**
 * The on-disk **shim** for skill evidence: the only file that knows where a project keeps its skills,
 * how a `SKILL.md` frontmatter spells the evidence keys, and which legacy comment an older candidate
 * carries.
 *
 * Mirror: `<project>/.agents/skills/<name>/SKILL.md` (frontmatter `derived_from` / `evidence`, body
 * marker) and `<project>/.agents/memory/MEMORY.md` bullet entries. The domain rules — which session
 * ids count as evidence, how a receipt spells them, when two documents conflict — live in the sibling
 * core `evidence.ts` and stay pure; this file only turns files into those DTOs and the DTOs into the
 * frontmatter block a `SKILL.md` carries.
 *
 * Removal condition: dsh currently accepts only `{name, description, source, content}` for a skill
 * (`ctx.skills.register`), so provenance has to live in the file. Once the host exposes per-skill
 * metadata that round-trips arbitrary fields, the two frontmatter keys can move there and
 * {@link withEvidenceFrontmatter} / {@link evidenceOfDocument} can be deleted. Until then this shim is
 * the one place a `SKILL.md` layout change lands; it is registered as `SH-11` in the harness
 * integration registry.
 */
import { type ConflictDocument, type MemoryEntry } from "./evidence.js";
/** One existing skill, reduced to what the evidence and conflict readers need. */
export interface EvidenceSkillRow extends ConflictDocument {
    /** Session ids the skill records, already normalized; empty for a skill promoted before this batch. */
    readonly evidence: readonly string[];
    /** True when this pipeline wrote the skill (the body marker), i.e. an old learned skill with no evidence. */
    readonly learned: boolean;
}
/** The project-side corpus one conflict check reads: every skill body plus the memory bullets. */
export interface EvidenceCorpus {
    readonly skills: readonly EvidenceSkillRow[];
    readonly memory: readonly MemoryEntry[];
}
/**
 * Read the evidence a `SKILL.md` (or a candidate document) records.
 *
 * The frontmatter is authoritative. The legacy comment is the fallback for candidates written before
 * this batch: they carry the ids only there, and an approved old candidate must not silently lose
 * them. The comment also carries a free-text reason after an em dash, so the ids are taken from its
 * front and a token that is not id-shaped ends the list.
 */
export declare function evidenceOfDocument(raw: string): string[];
/**
 * Insert the optional evidence keys into a promoted document's frontmatter.
 *
 * Absent evidence leaves the bytes untouched rather than writing an empty list: a document with no
 * citation is exactly the historical shape, and `evidence: []` would claim a check that recorded
 * nothing. A document without frontmatter is returned unchanged too — this shim rewrites only the
 * layout it wrote.
 */
export declare function withEvidenceFrontmatter(document: string, evidence: readonly string[] | undefined, derivedFrom?: string): string;
/**
 * Read every project skill body plus the memory bullets the conflict check compares against.
 *
 * @param projectRoot - resolved project root.
 * @param options.exclude - a skill name to leave out (the candidate being approved already owns that
 *   name, so comparing it against its own previous body would report the supersede as a conflict with
 *   itself).
 */
export declare function readEvidenceCorpus(projectRoot: string, options?: {
    exclude?: string;
}): Promise<EvidenceCorpus>;
