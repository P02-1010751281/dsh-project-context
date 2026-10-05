/**
 * Reading the session: the rendered split a handoff summarizes, the pending question it
 * may have to carry, the file index beside the prompt, and the language of the messages.
 *
 * Pure functions over a `Session`; nothing here talks to the host or the model.
 */
import { type Session } from "@deepseek-ai/dsh-session";
import { type PluginConfig } from "../shared/config.js";
import { type HandoffLanguage, type HandoffLanguageMessage } from "./language.js";
/** Rough character budget per token for the carried-over recent tail. */
export declare const CHARS_PER_TOKEN = 3.5;
/** Exported for tests: whether an assistant message ends in a question. */
export declare function textAsksQuestion(text: string): boolean;
/** The question the session is waiting on, when its last conversational message is an assistant question. Exported for tests. */
export declare function pendingQuestion(session: Session): string | undefined;
/** File index from tool calls (read/write/edit), mirroring pi's compaction file tracking. */
export declare function fileOperations(session: Session): string;
/** Raw derived messages of a whole session, for a status read that does not split it. */
export declare function sessionLanguageMessages(session: Session): HandoffLanguageMessage[];
export interface HandoffSplit {
    /** The older part, summarized by the model. */
    older: string;
    /** The recent tail carried verbatim; stale continuation prompts are already marked. */
    tail: string;
    /** Raw user messages of both parts, for `auto` language resolution. */
    languageMessages: HandoffLanguageMessage[];
}
/**
 * Split of the rendered conversation for a handoff. Works from `conversationMessageSections` so it
 * can (a) replace a recognized continuation prompt in the carried tail with {@link REPLAY_MARKER}
 * and (b) hand `auto` detection the unclipped text, since the rendered section cuts user text at
 * 4000 characters — shorter than a real continuation, which would hide its closing line.
 */
export declare function handoffSplit(session: Session, keepChars: number): HandoffSplit;
/** The pending question carried into the continuation when the config opts into `wait`. */
export declare function pendingQuestionFor(config: PluginConfig, session: Session): string | undefined;
/** Resolve the language for one handoff: explicit config wins, otherwise the conversation decides. */
export declare function resolveHandoffLanguage(messages: readonly HandoffLanguageMessage[], config: PluginConfig): HandoffLanguage;
