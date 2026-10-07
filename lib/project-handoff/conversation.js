/**
 * Reading the session: the rendered split a handoff drops, the pending question it
 * may have to carry, the file index beside the prompt, and the language of the messages.
 *
 * Pure functions over a `Session`; nothing here talks to the host or the model.
 */
import {} from "@deepseek-ai/dsh-session";
import {} from "../shared/config.js";
import { conversationMessageSections } from "../shared/conversation.js";
import { clipTitle, truncateMiddle } from "../shared/text.js";
import { MAX_CONVERSATION_CHARS } from "../shared/project-state.js";
import { REPLAY_MARKER, isHandoffContinuationText, resolveLanguage } from "./language.js";
/** Rough character budget per token for the carried-over recent tail. */
export const CHARS_PER_TOKEN = 3.5;
/** Phrasings that mark the assistant's last message as awaiting a user decision. */
const PENDING_QUESTION_PATTERNS = /would you like|shall i\b|should i\b|do you want|let me know|your call|which (?:one|option|approach|direction|do you)|please (?:confirm|choose|decide)|awaiting your|waiting for your|需要我|要不要|是否需要|是否要|请你(?:确认|选择|决定)|等你(?:确认|回复|决定)/i;
function messageText(content) {
    return content
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("\n")
        .trim();
}
/** Exported for tests: whether an assistant message ends in a question. */
export function textAsksQuestion(text) {
    // Fenced code must not contribute a stray "?" to the check.
    const clean = text.replace(/```[\s\S]*?```/g, " ");
    const lines = clean.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
    const lastLine = lines.length > 0 ? lines[lines.length - 1] : "";
    const stripped = lastLine.replace(/[*_`~)\]"'）】》]+$/g, "").trimEnd();
    if (stripped.endsWith("?") || stripped.endsWith("？"))
        return true;
    return PENDING_QUESTION_PATTERNS.test(clean.slice(-400));
}
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
export function pendingQuestion(session) {
    const { conversational } = readSessionInputs(session);
    if (conversational === undefined || conversational.role !== "assistant")
        return undefined;
    return textAsksQuestion(conversational.text) ? conversational.text : undefined;
}
/** The tool whose result carries a user's choice, and the only one whose call/result pair is read. */
const ASK_USER_QUESTION = "ask_user_question";
/**
 * Parse an `ask_user_question` call's `arguments`. `undefined` when the payload is not the expected
 * shape, so an unreadable call carries nothing instead of a guess.
 */
function askedQuestions(argumentsText) {
    let parsed;
    try {
        parsed = JSON.parse(argumentsText);
    }
    catch {
        return undefined;
    }
    const questions = parsed?.questions;
    if (!Array.isArray(questions))
        return undefined;
    const asked = [];
    for (const entry of questions) {
        const record = entry;
        const question = typeof record?.question === "string" ? record.question.trim() : "";
        const id = typeof record?.id === "string" ? record.id : String(asked.length);
        const options = Array.isArray(record?.options)
            ? record.options
                .map((option) => (typeof option?.label === "string" ? option.label : ""))
                .filter((label) => label.length > 0)
            : [];
        asked.push({ id, question, options });
    }
    return asked.length > 0 ? asked : undefined;
}
/**
 * Parse an `ask_user_question` result's answer batch.
 *
 * Upstream defines exactly two result shapes: `{answers:[{id,selected,custom?}]}` (one item per
 * question) and, in the opt-in timed mode, `{pending:true,callId,message}`. Only the first carries an
 * answer, and this returns `undefined` for anything else — including the timed `pending` placeholder,
 * whose `message` must never be mistaken for something the user said. A selection arrives as
 * `selected` and a free-form answer as `custom`; both are read, because a carrier that dropped
 * `custom` would lose exactly the replies a user bothered to write out.
 */
function givenAnswers(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return undefined;
    }
    const answers = parsed?.answers;
    if (!Array.isArray(answers))
        return undefined;
    const given = [];
    for (const entry of answers) {
        const record = entry;
        const id = typeof record?.id === "string" ? record.id : String(given.length);
        const selected = Array.isArray(record?.selected)
            ? record.selected.filter((label) => typeof label === "string" && label.length > 0)
            : [];
        const custom = typeof record?.custom === "string" ? record.custom.trim() : "";
        given.push({ id, selected, custom });
    }
    return given.length > 0 ? given : undefined;
}
/**
 * Pair each asked question with the answer recorded for it, dropping the questions the user did not
 * answer.
 *
 * The tool documents `answers` as "one item per question", so POSITION is the contract and a matching
 * `id` confirms it; the id is only a fallback, and only while it is unambiguous. Looking the id up
 * first would let one answer answer every question that repeats that id, and the blocking tool does
 * not require unique ids — only the opt-in timed one validates them.
 *
 * A skipped question arrives as `selected: []` with no `custom` ("the user explicitly skipped this
 * question"), which is not something the user said; it is dropped rather than rendered as an answer,
 * so an all-skipped batch carries nothing at all. An unreadable result is likewise not an answer: it
 * may be the timed form's `{pending:true, …}` notice, and printing that notice as the user's own
 * words is exactly the misattribution this repo treats as its worst defect.
 */
function decisionEntries(asked, rawResult) {
    const answers = givenAnswers(rawResult) ?? [];
    const entries = [];
    asked.forEach((question, index) => {
        const at = answers[index];
        const unambiguousId = answers.filter((entry) => entry.id === question.id).length === 1 && asked.filter((other) => other.id === question.id).length === 1;
        const answer = at !== undefined && at.id === question.id ? at : unambiguousId ? answers.find((entry) => entry.id === question.id) : undefined;
        if (answer === undefined)
            return;
        if (answer.selected.length === 0 && answer.custom.length === 0)
            return;
        entries.push({ question: question.question, options: question.options, selected: answer.selected, custom: answer.custom });
    });
    return entries;
}
/**
 * One pass over the derived messages, in order. See {@link UserDecision} for why this exists.
 *
 * Positions are kept, not just the winners: the user's last input and an open question can both be
 * present, and which of them owns the continuation's closing depends on which came last. The question
 * is tracked on its own axis rather than as "the last conversational message", because an injected
 * user-role block arriving after an open question would otherwise look like it superseded it.
 */
function readSessionInputs(session) {
    const asked = new Map();
    let conversational;
    let question;
    let decision;
    let decisionIndex = -1;
    let index = 0;
    for (const message of session.deriveMessages()) {
        const at = index;
        index += 1;
        if (message.role === "assistant") {
            for (const block of message.content) {
                if (block.type !== "tool-call" || block.name !== ASK_USER_QUESTION)
                    continue;
                const questions = askedQuestions(block.arguments);
                if (questions !== undefined)
                    asked.set(block.id, questions);
            }
            const text = messageText(message.content);
            if (text.length > 0) {
                conversational = { role: "assistant", text, index: at };
                if (textAsksQuestion(text))
                    question = { text, index: at };
            }
            continue;
        }
        if (message.role === "tool") {
            // A failed invocation is not an answer. Carrying its error text as the user's own words
            // would be the misattribution this repo treats as its worst defect class, so an errored
            // result contributes nothing and any earlier real input stays the carried decision.
            if (message.isError === true)
                continue;
            const questions = asked.get(message.toolCallId);
            if (questions === undefined)
                continue;
            const entries = decisionEntries(questions, messageText(message.content));
            // Nothing was answered — a skipped batch, the timed form's `pending` notice, or an
            // unreadable result — so the user said nothing and this channel records no decision.
            if (entries.length === 0)
                continue;
            decision = { kind: "answer", text: "", entries };
            decisionIndex = at;
            continue;
        }
        if (message.role !== "user")
            continue;
        const text = messageText(message.content);
        if (text.length === 0)
            continue;
        // `conversational` counts every user-role message — injected context and the handoff's own
        // banner included — because that is exactly what {@link pendingQuestion} has always counted.
        // Only the decision below skips them, so the carrier never hands the child our own prompt back
        // as something the user said. The asymmetry is deliberate and observable: a session whose last
        // message is an injected context block has no question to defer on, exactly as before.
        conversational = { role: "user", text, index: at };
        if (message.source.kind !== "user" || isHandoffContinuationText(text))
            continue;
        decision = { kind: "message", text, entries: [] };
        decisionIndex = at;
    }
    return { conversational, question, decision, decisionIndex };
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
export function handoffCarry(session, pendingEnabled) {
    const { question, decision, decisionIndex } = readSessionInputs(session);
    if (question !== undefined && question.index > decisionIndex) {
        return pendingEnabled ? { pending: question.text } : {};
    }
    if (decision !== undefined)
        return { decision };
    return pendingEnabled && question !== undefined ? { pending: question.text } : {};
}
/**
 * Characters of the parent's own input kept in the child's title.
 *
 * The service caps a title at 80 UTF-8 bytes (`maxTitleBytes`) and clips silently, so the budget is
 * really bytes, not characters: the 15-byte prefix plus a 20-character label is at most 75 bytes,
 * because even an all-CJK label is 3 bytes per character and the trailing `…` is one of the 20, not an
 * extra one. A longer label would be cut by the service instead of by us, mid-word and at a cut we
 * never chose.
 */
const HANDOFF_LABEL_CHARS = 20;
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
 * @param session - the session being handed off.
 * @param fallback - the parent's short id, used when the session carries no human input.
 * @returns the label, without the prefix.
 */
export function handoffLabel(session, fallback) {
    let last = "";
    for (const message of session.deriveMessages()) {
        if (message.role !== "user" || message.source.kind !== "user")
            continue;
        const text = messageText(message.content);
        if (text.length === 0 || isHandoffContinuationText(text))
            continue;
        last = text;
    }
    if (last.length === 0)
        return fallback;
    const label = clipTitle(last, HANDOFF_LABEL_CHARS);
    return hasVisibleText(label) ? label : fallback;
}
/**
 * Whether a label says anything a reader can see.
 *
 * `\p{Cc}` (controls) and `\p{Cf}` (invisible formatting: zero-width spaces and joiners, bidi controls,
 * a soft hyphen, a BOM) have no visible form, so a label made only of them names nothing — and the
 * title service deletes them before storing, which would take the switch prefix's own trailing space
 * with them. This is a policy about our labels, not a copy of the service's cleaner: the check runs
 * before the write so the realistic class never produces a prefix-less intermediate title, while
 * anything it cannot see (an escape sequence whose bytes include printable characters) is caught
 * afterwards by `retitleAfterRename` in `perform.ts`.
 * @param label - a clipped, single-line label.
 * @returns true when at least one character of it is neither a control nor an invisible formatter.
 */
export function hasVisibleText(label) {
    return /[^\p{Cc}\p{Cf}]/u.test(label);
}
/** File index from tool calls (read/write/edit), mirroring pi's compaction file tracking. */
export function fileOperations(session) {
    const read = new Set();
    const modified = new Set();
    for (const message of session.deriveMessages()) {
        if (message.role !== "assistant")
            continue;
        for (const block of message.content) {
            if (block.type !== "tool-call")
                continue;
            if (block.name !== "read" && block.name !== "write" && block.name !== "edit")
                continue;
            let parsed;
            try {
                parsed = JSON.parse(block.arguments);
            }
            catch {
                continue;
            }
            const file = parsed?.path;
            if (typeof file !== "string" || file.length === 0)
                continue;
            if (block.name === "read")
                read.add(file);
            else
                modified.add(file);
        }
    }
    const readOnly = [...read].filter((file) => !modified.has(file)).sort();
    const sections = [];
    if (readOnly.length > 0)
        sections.push(`<read-files>\n${readOnly.join("\n")}\n</read-files>`);
    if (modified.size > 0)
        sections.push(`<modified-files>\n${[...modified].sort().join("\n")}\n</modified-files>`);
    return sections.join("\n\n");
}
/** Raw user-source messages for `auto` language resolution. */
function languageMessagesOf(sections) {
    const messages = [];
    for (const section of sections) {
        if (section.userText === undefined || section.sourceKind === undefined)
            continue;
        messages.push({ role: "user", sourceKind: section.sourceKind, text: section.userText });
    }
    return messages;
}
/** Raw derived messages of a whole session, for a status read that does not split it. */
export function sessionLanguageMessages(session) {
    return languageMessagesOf(conversationMessageSections(session));
}
/** A previous continuation prompt is replaced in place, keeping the message order around it. */
function replaySection(section) {
    if (section.userText !== undefined && isHandoffContinuationText(section.userText)) {
        return `## user\n${REPLAY_MARKER}`;
    }
    return section.rendered;
}
/**
 * Split of the rendered conversation for a handoff. Works from `conversationMessageSections` so it
 * can (a) replace a recognized continuation prompt in the carried tail with {@link REPLAY_MARKER}
 * and (b) hand `auto` detection the unclipped text, since the rendered section cuts user text at
 * 4000 characters — shorter than a real continuation, which would hide its closing line.
 */
export function handoffSplit(session, keepChars) {
    const sections = conversationMessageSections(session);
    let start = sections.length;
    if (keepChars > 0) {
        let used = 0;
        while (start > 0) {
            const size = sections[start - 1].rendered.length + 2;
            if (used > 0 && used + size > keepChars)
                break;
            used += size;
            start -= 1;
        }
    }
    // The cut lands between whole messages, so the tail may exceed the budget by at most the one
    // message this loop is forced to keep (`used > 0`). That floor is also why the pi fix
    // "cut mid-turn so one huge turn cannot block the handoff" (pi 093dbf3) has no dsh counterpart:
    // pi pulled the cut back to a turn start and could leave nothing to drop, while every
    // rendered section here is clipped to 4000 chars (`conversationMessageSections`), far below a
    // realistic keep budget, so a session larger than the budget always leaves an older span —
    // only a conversation that genuinely fits the window has none (the empty-span guard).
    const olderSections = sections.slice(0, start);
    const tailSections = sections.slice(start);
    return {
        older: truncateMiddle(olderSections.map((section) => section.rendered).join("\n\n"), MAX_CONVERSATION_CHARS),
        tail: tailSections.map(replaySection).join("\n\n"),
        languageMessages: languageMessagesOf([...olderSections, ...tailSections]),
    };
}
/** Resolve the language for one handoff: explicit config wins, otherwise the conversation decides. */
export function resolveHandoffLanguage(messages, config) {
    return resolveLanguage(messages, config.handoffLang);
}
