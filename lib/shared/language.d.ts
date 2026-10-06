/**
 * The CJK language primitive two plugins share.
 *
 * `project-handoff` resolves the handoff scaffolding language from the user's own messages, and
 * `project-memory` picks the language of the pointer text it injects from the document itself.
 * Both need the same threshold, so it is defined once here: two copies of "enough Chinese" could
 * disagree about the same session or about the same file.
 */
/** Languages this repo renders scaffolding or injected text in. */
export type DocumentLanguage = "zh" | "en";
/** CJK ideographs; the user's own messages are the most reliable language signal. */
export declare const CJK_PATTERN: RegExp;
/** CJK characters needed in the samples before the detector picks Chinese. */
export declare const LANGUAGE_CJK_MIN = 2;
/** Count how many times `pattern` matches across every sample. */
export declare function countMatches(samples: readonly string[], pattern: RegExp): number;
/**
 * Enough Chinese in the samples means Chinese. The caller decides what a sample is: a conversation
 * for the handoff scaffolding, the document itself for an injected pointer block.
 */
export declare function detectDocumentLanguage(samples: readonly string[]): DocumentLanguage;
