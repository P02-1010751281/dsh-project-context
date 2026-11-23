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
/** Count how many times `pattern` matches across every sample. */
export declare function countMatches(samples: readonly string[], pattern: RegExp): number;
/**
 * Enough Chinese in the samples means Chinese. The caller decides what a sample is: a conversation
 * for the handoff scaffolding, the document itself for an injected pointer block.
 */
export declare function detectDocumentLanguage(samples: readonly string[]): DocumentLanguage;
/**
 * Pick the sample for the receipt's language.
 *
 * Every receipt line goes through this, so a session never sees one language's sentence next to the
 * other's: the head, the detail lines and the remedy all follow the same resolved language. English
 * is the fallback because it is the language the identifiers and paths are written in.
 * @param language - the receipt's resolved language.
 * @param zh - the Chinese sample.
 * @param en - the English sample.
 * @returns the sample for `language`.
 */
export declare function pick(language: DocumentLanguage, zh: string, en: string): string;
/**
 * A counted noun, with the language's own plural rule.
 *
 * Chinese does not inflect, so `zh` is one sample for every count; English picks between `one` and
 * `many`. Callers must not build the English plural by appending "s" — `entry(ies)` is the shape that
 * reaches a user when a receipt forgets.
 * @param language - the receipt's resolved language.
 * @param count - the number being counted.
 * @param one - the English singular.
 * @param many - the English plural.
 * @param zh - the Chinese noun.
 * @returns the counted noun.
 */
export declare function counted(language: DocumentLanguage, count: number, one: string, many: string, zh: string): string;
