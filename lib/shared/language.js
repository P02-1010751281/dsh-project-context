/**
 * The CJK language primitive two plugins share.
 *
 * `project-handoff` resolves the handoff scaffolding language from the user's own messages, and
 * `project-memory` picks the language of the pointer text it injects from the document itself.
 * Both need the same threshold, so it is defined once here: two copies of "enough Chinese" could
 * disagree about the same session or about the same file.
 */
/** CJK ideographs; the user's own messages are the most reliable language signal. */
export const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
/** CJK characters needed in the samples before the detector picks Chinese. */
export const LANGUAGE_CJK_MIN = 2;
/** Count how many times `pattern` matches across every sample. */
export function countMatches(samples, pattern) {
    let count = 0;
    for (const sample of samples)
        count += sample.match(pattern)?.length ?? 0;
    return count;
}
/**
 * Enough Chinese in the samples means Chinese. The caller decides what a sample is: a conversation
 * for the handoff scaffolding, the document itself for an injected pointer block.
 */
export function detectDocumentLanguage(samples) {
    return countMatches(samples, CJK_PATTERN) >= LANGUAGE_CJK_MIN ? "zh" : "en";
}
