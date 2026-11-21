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
/** How many literals one report may name. A log line is a pointer to the document, not a copy of it. */
export const MISSING_LITERAL_SAMPLES = 10;
/** Shortest span treated as a literal: a one- or two-character span names no fact. */
const MIN_LITERAL_CHARS = 3;
/** A character that continues a word, including CJK: a literal resting against one is part of it. */
const WORD_CHAR = /[\p{L}\p{N}_]/u;
/**
 * Every backticked literal one document carries, deduplicated in document order.
 *
 * Each line is matched once, left to right, so a backtick only ever pairs with the next one on its
 * own line — the rule §9.1 broke by filtering short spans at the match stage.
 * @param text - a rendered memory document.
 * @returns the literals, each trimmed, with no duplicates.
 */
export function backtickedLiterals(text) {
    const seen = new Set();
    for (const line of text.split("\n")) {
        for (const match of line.matchAll(/`([^`]*)`/g)) {
            const literal = match[1].trim();
            if (literal.length >= MIN_LITERAL_CHARS)
                seen.add(literal);
        }
    }
    return [...seen];
}
/**
 * The document with every backticked span cut out, line by line.
 *
 * This is the half a literal may still be mentioned in without being lost: prose that names the same
 * symbol. Each line is stripped with the same pairing rule as {@link backtickedLiterals}, so a span is
 * never removed across a newline.
 * @param text - a rendered memory document.
 * @returns the text outside backticks, spaces in their place.
 */
function outsideBackticks(text) {
    return text.split("\n").map((line) => line.replace(/`[^`]*`/g, " ")).join("\n");
}
/**
 * Whether `literal` appears in `bare` as a whole token.
 *
 * Word boundaries, not `\b`: a literal may start with `/` or `-`, where a word boundary asserts the
 * wrong thing. A CJK literal rests against CJK letters, which the character class counts, so
 * `记忆` inside `记忆整理` is not a mention of the same token.
 * @param literal - the literal to look for, already known to be absent as a backticked span.
 * @param bare - text with its backticked spans removed (see {@link outsideBackticks}).
 */
function mentionedAsToken(literal, bare) {
    for (let at = bare.indexOf(literal); at >= 0; at = bare.indexOf(literal, at + 1)) {
        const before = at === 0 ? "" : bare[at - 1];
        const after = bare[at + literal.length] ?? "";
        if (!WORD_CHAR.test(before) && !WORD_CHAR.test(after))
            return true;
    }
    return false;
}
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
export function literalSurvives(literal, text) {
    if (backtickedLiterals(text).includes(literal))
        return true;
    return mentionedAsToken(literal, outsideBackticks(text));
}
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
export function missingLiteralsBetween(previous, next) {
    const kept = new Set(backtickedLiterals(next));
    const bare = outsideBackticks(next);
    const missing = backtickedLiterals(previous).filter((literal) => !kept.has(literal) && !mentionedAsToken(literal, bare));
    return { count: missing.length, samples: missing.slice(0, MISSING_LITERAL_SAMPLES) };
}
