/**
 * Missing-literal measure: the backticked literals the previous memory document carried and the new
 * one no longer mentions at all.
 *
 * Tier C counts structure — whole entries dropped, entries cut to a per-item cap — so a pass that
 * regenerates the document in condensed wording reports `0 0 0` and status `updated` while facts
 * quietly vanish. This module measures that other loss by diffing the two documents' literals.
 * `docs/memory-rewrite-loss-gate-spec.md` §3 A defines the measure and §9.2 renames it: the result
 * is *missing literals*, not entry survival, because a symbol still mentioned by another entry hides
 * its loss from the one that explained it, and a legal rename reads as a loss. It is therefore
 * evidence, never an admission gate; the spec's §4 lands it as an observation first.
 *
 * Three rules, each forced by a measured failure:
 *  - **Pair the backticks first, then drop spans shorter than three characters.** Filtering
 *    `` /`([^`\n]{3,})`/ `` at the match stage lets a short span's closing backtick pair with the next
 *    opening one: the same bytes report 61 missing literals that way and 57 once pairing comes first
 *    (§9.1). Pairing first is also why this walks one line at a time — a pair split across lines would
 *    splice text that is not a literal.
 *  - **A literal that survived only without its backticks is not missing — but it must survive as a
 *    token.** The first version asked `next.includes(literal)`, which reads `memoryComparisonKey` inside
 *    `memoryComparisonKeyWithDrop` and `main` inside "the remaining domain" as present: a systematic
 *    under-report of 44 literals across the 66 transitions measured here (12% of them), in the one
 *    direction that hides what this measure exists to see. A bare mention must therefore sit on a word boundary (`dsh` in "the dsh
 *    project" is a mention; `main` in "remaining" is not) and outside every backticked span.
 *  - **The measure is document-level by construction**, so it cannot name the entry that lost a
 *    literal. That is why the count is reported with samples instead of a verdict.
 */
/** One measure, taken between the document that was replaced and the document that landed. */
export type MissingLiterals = {
    /** How many literals only the previous document carried. */
    count: number;
    /** Up to {@link MISSING_LITERAL_SAMPLES} of them in document order, for one log line. */
    samples: string[];
};
/** How many literals one report may name. A log line is a pointer to the document, not a copy of it. */
export declare const MISSING_LITERAL_SAMPLES = 10;
/**
 * Every backticked literal one document carries, deduplicated in document order.
 *
 * Each line is matched once, left to right, so a backtick only ever pairs with the next one on its
 * own line — the rule §9.1 broke by filtering short spans at the match stage.
 * @param text - a rendered memory document.
 * @returns the literals, each trimmed, with no duplicates.
 */
export declare function backtickedLiterals(text: string): string[];
/**
 * Whether one literal still names the same fact somewhere in `text`.
 *
 * Single owner of the survival rule: backticked anywhere, or a whole token outside every backticked
 * span. `missingLiteralsBetween` counts with it, and the lost-entry repair asks it per entry, so the
 * two cannot drift into disagreeing about what "still mentioned" means.
 * @param literal - a literal some document carried.
 * @param text - the document to look for it in.
 * @returns true when the literal is still mentioned.
 */
export declare function literalSurvives(literal: string, text: string): boolean;
/**
 * The literals `previous` carried that `next` no longer mentions.
 *
 * "No longer mentions" means neither backticked nor as a bare token: a literal that lost only its
 * backticks still names the same fact, and counting it would teach the reader to ignore the number.
 * A literal that merely became part of a longer word does not count as mentioned — that is a real loss
 * of the token, and the first version of this rule hid 12% of every measured loss.
 * @param previous - the document this pass replaced (what the model was shown).
 * @param next - the document that landed.
 * @returns the count and up to {@link MISSING_LITERAL_SAMPLES} samples.
 */
export declare function missingLiteralsBetween(previous: string, next: string): MissingLiterals;
