/**
 * Reading the session: the rendered split a handoff drops, the pending question it
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
/**
 * The question the session is waiting on, when its last conversational message is an assistant
 * question. Exported for tests, and this is the definition `auto.ts`'s `defer` gate has always used:
 * every user-role message counts as the last conversational one, injected context included, so an
 * injected block after a question means "no pending question" here, exactly as it did before the
 * decision carry existed.
 *
 * {@link handoffCarry} deliberately does NOT reuse this notion: it compares the last assistant
 * question against the user's own last input, because it must never present an answered question as
 * open. The two can disagree when an injected user-role block follows an open question — this rule
 * then reports no pending question while the carry still reports the question, which is the safe
 * direction: the child waits for the user instead of re-asking.
 */
export declare function pendingQuestion(session: Session): string | undefined;
/** One question of a carried decision, with the answer the result supplied for it. */
export interface UserDecisionEntry {
    readonly question: string;
    readonly options: readonly string[];
    /** Labels the user picked; empty when they typed an answer instead. */
    readonly selected: readonly string[];
    /** Text the user typed instead of picking a label; empty when they picked. */
    readonly custom: string;
}
/**
 * The user's own last input, whichever channel carried it.
 *
 * A decision reaches a session two ways and both were lost the same way: the user types a message
 * (`kind: "message"`), or they answer `ask_user_question`, which lands as a *tool result* rather than
 * a user message (`kind: "answer"`). Reading only the tool channel misses plain conversation; reading
 * only text blocks of user messages misses an answer and any decision the summary prose dropped.
 * `handoffBudgetRecentTokens: 0` leaves no verbatim tail, so this is the only carrier that survives
 * independently of that budget.
 *
 * "Input" is meant strictly: a question the user skipped and the timed tool's `pending` placeholder
 * are not inputs and produce no decision at all (see {@link decisionEntries}).
 */
export interface UserDecision {
    readonly kind: "message" | "answer";
    /** The user's own words for `kind: "message"`; empty for an answer. */
    readonly text: string;
    /** The questions the user actually answered; empty for a message, and never empty for an answer. */
    readonly entries: readonly UserDecisionEntry[];
}
/**
 * What the continuation carries. At most one block owns the closing, so the seed can never tell the
 * child both "wait for the user" and "the user has already decided".
 */
export interface HandoffCarry {
    /** The assistant question still awaiting an answer, when it is the newest of the two. */
    readonly pending?: string;
    /** The user's own last input, when it is the newest of the two. */
    readonly decision?: UserDecision;
}
/**
 * The current state to carry into the continuation. Exported for tests.
 *
 * The newest of the user's own last input and the last assistant question wins, compared by position
 * on their own axes. A fixed precedence cannot do this job: an answered `ask_user_question` leaves
 * the assistant's asking text as the last conversational message, so a question that outranked the
 * answer would tell the child to wait for something the user already supplied — while a question
 * asked *after* an answer is genuinely newer and must not be dropped for the older input.
 *
 * `pendingEnabled` is the `handoffPendingQuestion: "wait"` opt-in. With `defer` no question is carried
 * here, because the automatic path defers the whole handoff instead (`auto.ts`) and only a manual
 * `/handoff now` reaches this with the opt-in off; a question newer than the user's input then carries
 * nothing at all, rather than the superseded input under a "do not ask again" closing.
 */
export declare function handoffCarry(session: Session, pendingEnabled: boolean): HandoffCarry;
/**
 * The label a handoff puts after `HANDOFF_TITLE_PREFIX`, or the parent's short id when it has none.
 *
 * The prefix is the browser half's switch signal, so it is fixed; only this part is ours. A message
 * the user actually typed is the most useful thing to name the continuation after, and it is already
 * in the session — so the handoff stays model-free. Two filters, and the second is not redundant:
 * `source.kind === "user"` drops the injected runtime-context snapshots, this plugin's own seed
 * banner and a subagent's messages, which each carry their own kind; `isHandoffContinuationText`
 * drops that same banner arriving as a *human* message, which is how seeding wrote it before
 * `perform.ts` stopped using the RPC that hardcodes `kind: "user"`. Those legacy banners are real,
 * and titling a continuation after the session its own parent was continued from is worse than
 * titling it after the parent's id. These are the same two filters the other readers of "what the
 * user said" apply ({@link readSessionInputs}, `humanUserText`).
 *
 * The loop deliberately is not `readSessionInputs(...).decision`: an `ask_user_question` answer
 * *replaces* that decision with an entry carrying no text of its own, while a title is better served
 * by the last thing the person typed even when they then answered a question. A session with no typed
 * input at all keeps the id — the title is never empty, which `rename()` would refuse. What the
 * service *stores* is its own normalized form, so that the prefix survives it is checked after the
 * call rather than assumed — see `retitleAfterRename` in `perform.ts`; a label with no visible
 * character never reaches the service at all, see {@link hasVisibleText}.
 * The label names the continuation after the parent's **last human input**, and it reads that input
 * from the append-origin log for the same reason {@link handoffSplit} does: a compaction that
 * summarizes the user's instruction (realistic — one sentence followed by a long tool span can fall
 * out of the retained window) leaves only the checkpoint node on the surface, whose `source.kind` is
 * not `user`. The filter below would then skip every candidate and fall back to the parent id, so the
 * seed would quote the user's words while its own title said `↪ handoff · 9f3c1a2b`.
 * @param session - the session being handed off.
 * @param fallback - the parent's short id, used when the session carries no human input.
 * @returns the label, without the prefix.
 */
export declare function handoffLabel(session: Session, fallback: string): string;
/**
 * Whether a label says anything a reader can see.
 *
 * This is a policy about our labels, not a copy of the title service's cleaner: controls (`\p{Cc}`),
 * invisible formatters (`\p{Cf}`: zero-width spaces and joiners, bidi controls, a soft hyphen, a BOM)
 * and whitespace all render as nothing, so a label made only of them names no session. It runs before
 * the write, so the class never produces the prefix-less intermediate title the service would store.
 * The class is deliberately wider than what the service strips — its directional-control list plus most
 * C0/C1, whitespace collapsed, the end trimmed — because it keeps the rest (a soft hyphen, ZWNJ/ZWJ and
 * other `\p{Cf}` code points), so withholding those is policy rather than preservation. What this test
 * cannot see is an escape sequence: its introducer (`\u001B`/`\u009B`/`\u009D`) is in the class but the
 * body is printable, and the service swallows the whole sequence — caught after the call by
 * `retitleAfterRename` in `perform.ts`.
 * @param label - a clipped, single-line label.
 * @returns true when at least one character of it is not a control, an invisible formatter or whitespace.
 */
export declare function hasVisibleText(label: string): boolean;
/**
 * The first input that may name a continuation, with the seq of the log event that carried it.
 *
 * {@link handoffLabel} names a fresh continuation after its *parent's* last input, which is all the
 * handoff has at that moment; this is the deferred half, read once the continuation itself has been
 * talked to. Both apply the same judgments — `source.kind === "user"`, `isHandoffContinuationText`,
 * {@link hasVisibleText} — and differ only in which end of the conversation they read.
 *
 * Two deliberate choices, both in service of a rewrite that happens exactly once with no process
 * state (see `relabel.ts`). The messages are read from the **durable log** through {@link humanUserText}
 * rather than from `deriveMessages()`: a compaction replaces surface nodes, so a derived first message
 * can vanish and the "first" input would quietly become a different one — the log keeps it, and it is
 * what the host's own title readers fold. And the input's own `seq` comes back with the label, so the
 * caller can require the event that carried it to be the one being handled; the *stored* title is the
 * service's normalized form, so comparing titles could never be a fixed point for a label it rewrites.
 *
 * The judgments are the shared ones and are not re-applied here: `humanUserText` already selects a
 * human `user/message` and rejects a generated continuation banner, and {@link hasVisibleText} decides
 * the rest. An input whose clip names nothing is skipped rather than ending the search, so an invisible
 * first message does not consume the continuation's single chance at a label.
 * @param session - the continuation.
 * @returns the label without the prefix plus its `user/message` seq, or `undefined` while nothing names it.
 */
export declare function firstHandoffInput(session: Session): {
    seq: number;
    label: string;
} | undefined;
/**
 * File index from tool calls (read/write/edit), mirroring pi's compaction file tracking.
 *
 * Read from the append-origin log rather than the surface. A compaction shadows the span it
 * summarized, so every `read`/`write`/`edit` call inside that span would leave the index — the
 * successor would be handed "what this session touched" minus everything it did early on, which is
 * the misattribution this repo treats as its worst defect class. pi avoided the same loss by
 * cancelling the compaction before it happened; dsh has no cancellable pre-compaction hook, but it
 * does keep the log, and upstream names append-origin events as a transcript's durable source.
 * @param session - the session being handed off.
 * @returns the `<read-files>` / `<modified-files>` blocks, or `""` when no call qualifies.
 */
export declare function fileOperations(session: Session): string;
/**
 * Raw messages of a whole session, for a status read that does not split it.
 *
 * The same **append-origin** source {@link handoffSplit} feeds the `auto` decision from, so the
 * language a receipt names is the language the seed was rendered in. Reading the surface here let a
 * compaction summarize away every message in the user's own language: the detector samples the whole
 * conversation ({@link languageSamples}), the checkpoint that replaced the span is not the user's text
 * (`sourceKind` filters it out), so the receipt could report `en` while the seed carried Chinese.
 */
export declare function sessionLanguageMessages(session: Session): HandoffLanguageMessage[];
export interface HandoffSplit {
    /** The older part, dropped from the continuation and reachable only through the session log. */
    older: string;
    /** The recent tail carried verbatim; stale continuation prompts are already marked. */
    tail: string;
    /** Raw user messages of both parts, for `auto` language resolution. */
    languageMessages: HandoffLanguageMessage[];
    /**
     * True when at least one carried section was cut at its render cap, so the tail is not that
     * conversation verbatim. The seed reads it to choose between the "verbatim" and "trimmed" carry
     * statements (pi's `carryKept` / `carryTrimmed`); `false` for an empty tail, which gets the
     * "nothing was carried" statement instead.
     */
    trimmedTail: boolean;
}
/**
 * Split of the rendered conversation for a handoff. Works from `conversationMessageSections` so it
 * can (a) replace a recognized continuation prompt in the carried tail with {@link REPLAY_MARKER}
 * and (b) hand `auto` detection the unclipped text, since the rendered section cuts user text at
 * 4000 characters — shorter than a real continuation, which would hide its closing line.
 *
 * The section list is read from **append-origin** events, not the model-visible surface. This is the
 * dsh-native answer to pi's `session_before_compact` cancel: pi stopped the compaction from running
 * so the handoff could carry an intact branch, while dsh cannot cancel one and does not need to — the
 * log is append-only and a compaction's checkpoint is itself a surface *replacement*, so reading
 * append-origin events renders the summarized span and drops the summary that stood in for it.
 * Reading the surface here would hand the successor a compressed branch as if it were the
 * conversation, which is exactly the wrong-cause defect this repo treats as its worst.
 * @param session - the session being handed off.
 * @param keepChars - characters of the most recent messages to carry verbatim; `0` carries no tail.
 * @returns the older span, the verbatim tail and whether that tail was clipped at a render cap.
 */
export declare function handoffSplit(session: Session, keepChars: number): HandoffSplit;
/** Resolve the language for one handoff: explicit config wins, otherwise the conversation decides. */
export declare function resolveHandoffLanguage(messages: readonly HandoffLanguageMessage[], config: PluginConfig): HandoffLanguage;
