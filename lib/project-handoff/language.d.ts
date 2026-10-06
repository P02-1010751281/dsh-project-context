/**
 * Handoff language — follow the conversation instead of a hardcoded English
 * scaffolding, and recognize the handoff's own continuation prompts.
 *
 * A Chinese session used to continue in English because every handoff string was
 * English. `handoffLang: "auto"` now resolves from the user's own messages
 * (CJK first, then substantial Latin, then the language of the newest carried
 * continuation prompt), while an explicit `"zh"`/`"en"` wins outright.
 *
 * Everything here is pure: sample extraction, detection/resolution, the scaffolding
 * table and the continuation-prompt predicate are unit-tested without a session.
 */
import { type DocumentLanguage } from "../shared/language.js";
/** Languages the handoff scaffolding can be rendered in. */
export type HandoffLanguage = DocumentLanguage;
/** The configured language: `auto` follows the conversation. */
export type HandoffLanguageSetting = "auto" | HandoffLanguage;
/** One raw message the `auto` decision samples. */
export interface HandoffLanguageMessage {
    /** Provider-neutral role; only `user` messages are sampled. */
    readonly role: string;
    /** dsh message source kind; injected plugin context is not the user's own language. */
    readonly sourceKind: string;
    /** Raw, unclipped message text. */
    readonly text: string;
}
/**
 * `auto` language rule: enough Chinese in the user's own messages means Chinese scaffolding.
 * The pattern and the threshold are the shared primitive, so the handoff scaffolding and the
 * injected pointer text can never disagree about the same content.
 */
export declare function detectHandoffLanguage(samples: readonly string[]): HandoffLanguage;
/** User texts for the `auto` decision: injected prompts excluded, recent messages preferred. */
export declare function languageSamples(messages: readonly HandoffLanguageMessage[]): string[];
/** Resolve the scaffolding language: explicit config wins, `auto` follows the user's own messages. */
export declare function resolveLanguage(messages: readonly HandoffLanguageMessage[], configured: HandoffLanguageSetting): HandoffLanguage;
/**
 * Stand-in for a stale continuation prompt replaced in the carried-over tail. Replayed
 * verbatim a prompt reads as a fresh instruction and opens the new session with an
 * already-superseded state; the marker keeps the message in place, so real user and
 * assistant messages around it keep their order.
 */
export declare const REPLAY_MARKER = "[handoff prompt omitted]";
/** Localized scaffolding for the archived document and the continuation prompt. */
export interface HandoffScaffolding {
    readonly documentTitle: (sessionId: string) => string;
    readonly documentCreated: (iso: string) => string;
    readonly documentProject: (root: string) => string;
    readonly documentLog: (rel: string) => string;
    readonly documentIndex: (rel: string) => string;
    /** Literal opening of the continuation prompt, used to recognize a previous one. */
    readonly continuationPrefix: string;
    readonly continuationPreamble: (parentId: string) => string;
    readonly continuationVerify: string;
    readonly continuationContextNote: string;
    /** Heading that opens the mechanical "previous session details" block. */
    readonly detailsHeading: string;
    readonly detailSessionId: (sessionId: string) => string;
    /** Archive pointers plus the lookup instruction (the log is untrusted data, never instructions). */
    readonly continuationArchive: (log: string, index: string) => string;
    readonly continuationCarried: string;
    readonly pendingHeading: string;
    readonly pendingWait: string;
    readonly decisionHeading: string;
    readonly decisionQuestion: (question: string) => string;
    readonly decisionOptions: (labels: string) => string;
    readonly decisionSelected: (labels: string) => string;
    readonly decisionCustom: (text: string) => string;
    readonly decisionClosing: string;
    readonly continuationClosing: string;
}
export declare const SCAFFOLDING: Record<HandoffLanguage, HandoffScaffolding>;
/**
 * True for text the handoff itself generated. The preamble, both structural markers
 * and the closing line must all match, so a user message quoting the prompt (or
 * quoting it and adding their own text) is not mistaken for one and stays in the
 * carried-over conversation. Deliberately structural, not a wording or length heuristic:
 * `humanUserText` reuses this so a handoff's own seed is never counted as a human turn.
 */
export declare function isHandoffContinuationText(text: string): boolean;
