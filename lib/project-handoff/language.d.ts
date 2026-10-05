/**
 * Handoff language — follow the conversation instead of a hardcoded English
 * scaffolding, and recognize the handoff's own continuation prompts.
 *
 * A Chinese session used to continue in English because every handoff string was
 * English. `handoffLang: "auto"` now resolves from the user's own messages
 * (CJK first, then substantial Latin, then the language of the newest carried
 * continuation prompt), while an explicit `"zh"`/`"en"` wins outright. The
 * summarizer's template demands an EXACT section format, so models keep copying
 * its English (or Chinese) headings even when the directive asks otherwise; the
 * fixed heading set is mapped deterministically instead of relying on the model.
 *
 * Everything here is pure: sample extraction, detection/resolution, heading
 * localization, the scaffolding table and the continuation-prompt predicate are
 * unit-tested without a session.
 */
/** Languages the handoff scaffolding can be rendered in. */
export type HandoffLanguage = "zh" | "en";
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
/** `auto` language rule: enough Chinese in the user's own messages means Chinese scaffolding. */
export declare function detectHandoffLanguage(samples: readonly string[]): HandoffLanguage;
/** User texts for the `auto` decision: injected prompts excluded, recent messages preferred. */
export declare function languageSamples(messages: readonly HandoffLanguageMessage[]): string[];
/** Resolve the scaffolding language: explicit config wins, `auto` follows the user's own messages. */
export declare function resolveLanguage(messages: readonly HandoffLanguageMessage[], configured: HandoffLanguageSetting): HandoffLanguage;
/**
 * Localize the summarizer template's headings; only exact heading lines outside code fences are
 * touched. A fence closes only on its own marker character with at least the opening length and
 * nothing but whitespace after it, so a mismatched or info-string-bearing line cannot end a block
 * early and expose code content to translation.
 */
export declare function localizeSummaryHeadings(text: string, language: HandoffLanguage): string;
/**
 * Stand-in for a stale continuation prompt replaced in the carried-over tail. Replayed
 * verbatim a prompt reads as a fresh instruction and opens the new session with an
 * already-superseded state; the marker keeps the message in place, so real user and
 * assistant messages around it keep their order.
 */
export declare const REPLAY_MARKER = "[handoff prompt omitted]";
/** Localized scaffolding for the summary directive, the archived document and the continuation prompt. */
export interface HandoffScaffolding {
    /** Appended to the summarizer's "use exactly these sections" line. */
    readonly summaryDirective: string;
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
    readonly continuationArchive: (log: string, index: string) => string;
    readonly continuationCarried: string;
    readonly pendingHeading: string;
    readonly pendingWait: string;
    readonly continuationClosing: string;
}
export declare const SCAFFOLDING: Record<HandoffLanguage, HandoffScaffolding>;
/**
 * True for text the handoff itself generated. The preamble, both structural markers
 * and the closing line must all match, so a user message quoting the prompt (or
 * quoting it and adding their own text) is not mistaken for one and stays in the
 * carried-over conversation.
 */
export declare function isHandoffContinuationText(text: string): boolean;
