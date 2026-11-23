/**
 * Why an `/autolearn` pass wrote nothing, as a **code plus its parameters** rather than a sentence.
 *
 * The reasons used to be English sentences produced inside the pass core and printed verbatim after a
 * Chinese lead-in (`技能被拒：body too short。`). A Chinese receipt is not allowed to carry an English
 * clause, but the pass core runs before a session — and therefore before a language — exists: the
 * automatic pass fires on `turn/end`, and the receipt is built later by whichever command asks. So the
 * core emits a stable machine identity and the receipt renders the sentence, which also keeps the
 * English log lines and the Chinese receipt from drifting apart.
 *
 * Two vocabularies, one owner: {@link AutolearnRejection} (the model proposed a skill and the admission
 * rules refused it) and {@link AutolearnSkip} (the pass did not ask the model at all). They stay
 * separate because the reader's next move differs — rewrite the proposal vs re-prompt later or add
 * material.
 */
import { type DocumentLanguage } from "../shared/language.js";
/** A proposal the admission rules refused. `name` is carried where the sentence has to quote it. */
export type AutolearnRejection = {
    readonly code: "invalid-name";
} | {
    readonly code: "missing-description";
} | {
    readonly code: "description-too-long";
} | {
    readonly code: "body-too-short";
} | {
    readonly code: "body-too-long";
} | {
    readonly code: "injection";
} | {
    readonly code: "needs-candidate-evidence";
} | {
    readonly code: "needs-two-sessions";
} | {
    readonly code: "skill-exists";
    readonly name: string;
} | {
    readonly code: "body-not-shown";
} | {
    readonly code: "candidate-exists";
    readonly name: string;
};
/** A pass that declined to call the model at all. */
export type AutolearnSkip = {
    readonly code: "recent-pass";
} | {
    readonly code: "no-material";
} | {
    readonly code: "no-archive";
};
/**
 * The refusal as a receipt (or a log line) names it.
 *
 * The English column is byte-identical to the sentences the core used to return, so existing logs,
 * tests and docs keep meaning what they said. The Chinese column is what a Chinese session reads.
 * @param reason - the code the pass produced.
 * @param language - the language the sentence is written in.
 * @returns one clause, without a trailing full stop (the caller owns the punctuation).
 */
export declare function rejectedText(reason: AutolearnRejection, language?: DocumentLanguage): string;
/**
 * The skip as a receipt names it.
 *
 * Every branch says the same load-bearing half — *no model call was made* — because that is the fact
 * the old single `{skill: null}` shape hid: a reply about "the model proposed nothing" would have been
 * false.
 * @param reason - the code the pass produced.
 * @param language - the language the sentence is written in.
 * @returns one clause, without a trailing full stop.
 */
export declare function skippedText(reason: AutolearnSkip, language?: DocumentLanguage): string;
