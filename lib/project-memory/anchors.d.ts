/**
 * The lexical half of "which files does this memory entry point at": one pure pass over the entry's
 * text, with no disk access at all.
 *
 * Two consumers need the same answer and must never drift apart:
 *
 * - `retirement.ts` decides whether a cited path still exists (a missing path retires the entry);
 * - the staleness pass (batch V) decides whether a cited file changed after the entry was written.
 *
 * They differ only in what they do with a candidate — one stats it, the other hashes it — so the
 * recognition rules (the boundary character, the extension whitelist, the `{`/`*` skip) live here and
 * each consumer keeps only its own filtering. A second copy of this regex is how the two answers
 * start disagreeing, and a memory entry that is retired but still "fresh" (or the reverse) is exactly
 * the wrong-cause defect this repository refuses.
 *
 * Deliberately lexical: whether a candidate is a real project path depends on the directory it lives
 * in (a missing parent means it may be an abbreviation or another checkout), and that judgement needs
 * the filesystem. Consumers apply it.
 */
/** True when the token names one of this plugin's own ignored outputs (a clock, not a fact). */
export declare function isLocalArtifact(candidate: string): boolean;
/** Extensions a memory entry may cite as a checkable file. A slug like `turn/start` has none. */
export declare const ANCHOR_EXTENSIONS: ReadonlySet<string>;
/** One path-shaped token, with the last line number it names (`:42` or `:42-58`), when it names one. */
export interface AnchorToken {
    /** The path exactly as written in the entry (relative, absolute, or ambiguous). */
    readonly path: string;
    /** The highest line the token names, when it carries a `:line` or `:line-line` suffix. */
    readonly line?: number;
}
/** The lower-case extension of a candidate, or `undefined` when it has none. */
export declare function anchorExtension(candidate: string): string | undefined;
/**
 * Every path-shaped token in one entry, in document order, duplicates included.
 *
 * Duplicates are kept because the two consumers dedupe differently (drift reports one reason per
 * path, staleness hashes once per path) and the shared half must not pre-empt either. Braces and
 * stars are skipped: they mark a glob or a template, not a file that can be checked.
 * @param entry - one memory bullet, tid included or not.
 * @returns the tokens this entry names, before any filesystem judgement.
 */
export declare function anchorCandidates(entry: string): AnchorToken[];
