/**
 * The autolearn **core** for promotion evidence: session citations, the receipt text that shows them,
 * and the mechanical conflict check between a candidate body and what the project already documents.
 *
 * Nothing here reads a file, a context or a host type. The input is a string or a plain data row; the
 * output is data or a string. The on-disk layout — where a project keeps its skills, how a `SKILL.md`
 * frontmatter spells the evidence keys, which legacy comment an older candidate carries — belongs to
 * the sibling shim `evidence-source.ts`, so a layout change touches that file alone and these rules
 * stay testable from plain strings.
 *
 * Why evidence at all: `/autolearn approve` promotes a candidate that a human never saw the *source*
 * of. Recording the session ids the pass verified is what makes the skill's provenance checkable
 * later, without a side file that can drift from the artifact.
 *
 * Why a mechanical conflict check: two learned skills describing the same procedure is the failure a
 * memory/skill corpus accumulates silently. The check is deliberately narrow — it compares backticked
 * key tokens (paths, line references, commands) and reports overlaps; it never decides semantics, never
 * blocks a write, and never calls a model. A false "no conflict" costs nothing (the report is advice);
 * a false conflict on every shared `pnpm test` would train the reader to ignore it.
 */
/** The provenance value a promoted skill records: the pipeline that produced it. */
export declare const EVIDENCE_DERIVED_FROM = "autolearn";
/** Text the receipt shows when a skill (usually one promoted before evidence was recorded) cites none. */
export declare const NO_EVIDENCE_TEXT = "no evidence recorded";
/**
 * Normalize a citation list: trimmed, blanks dropped, duplicates collapsed, original order kept.
 *
 * Order is kept rather than sorted because the frontmatter is read by a human as much as by the code:
 * the order the pass verified the ids in is the order they meant something.
 */
export declare function normalizeEvidence(ids: readonly string[] | undefined): string[];
/** The shortened id the receipts show; see {@link SHORT_SESSION_ID_CHARS} for why the prefix is cut. */
export declare function shortSessionId(id: string): string;
/**
 * The evidence clause a receipt carries: the count plus every id, shortened.
 *
 * Every id is listed, not the first few: the pass verifies at most a handful (the model asks for up
 * to three sessions), and "2 sessions" without the ids would be a claim the reader cannot check.
 */
export declare function evidenceText(ids: readonly string[] | undefined): string;
/** One place the candidate overlaps what the project already documents. */
export interface ConflictFinding {
    /** What it overlaps: a skill name, or the memory entry it restates. */
    readonly target: string;
    /** The overlapping key tokens, in the candidate's order. */
    readonly shared: readonly string[];
}
/** A document the conflict check compares against, already reduced to its body text. */
export interface ConflictDocument {
    readonly name: string;
    readonly text: string;
}
/** One `MEMORY.md` bullet, as the shim read it. */
export type MemoryEntry = string;
/**
 * The key tokens of one document, deduplicated in first-seen order.
 *
 * Only backticked spans are read. A path written as prose (``run the release script``) is not a token
 * this check can compare without becoming a semantics engine, and the prompt already asks for exact
 * commands and paths in backticks, so the corpus speaks this shape.
 */
export declare function keyTokens(text: string): string[];
/**
 * Compare one candidate body against the existing skills and memory entries.
 *
 * The rule is narrow on purpose, and each branch is a *shape* signal rather than a similarity score:
 *
 * 1. A shared **path** (one containing `/`) or a shared `path:line` reference fires immediately —
 *    two procedures that name the same concrete file are describing the same ground, even if only one
 *    token overlaps.
 * 2. Otherwise three or more shared key tokens fire: one or two shared file names can be incidental,
 *    three is a procedure-shaped overlap.
 *
 * A `MEMORY.md` entry is judged by containment instead: every one of the candidate's key tokens
 * (three or more) sits inside the single entry. Memory names every file in the project, so a shared
 * path there means nothing; a whole-token containment does mean the entry already records this
 * workflow. That branch is containment-only because the shared-count rule would fire on any memory
 * line that happens to mention the same three files.
 *
 * @param candidate - the proposed document's name and body.
 * @param skills - existing skills' names and body text (the caller excludes the candidate's own name).
 * @param memory - `MEMORY.md` bullets, already split by the shim.
 */
export declare function conflictFindings(candidate: {
    readonly name: string;
    readonly text: string;
}, skills: readonly ConflictDocument[], memory: readonly MemoryEntry[]): ConflictFinding[];
/**
 * The conflict verdict a receipt carries. Always one line per finding, and always a verdict — "no
 * conflict" is a conclusion the check reached, not the absence of a conclusion.
 */
export declare function conflictText(findings: readonly ConflictFinding[]): string;
