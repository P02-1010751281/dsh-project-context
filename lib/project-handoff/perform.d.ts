/**
 * One handoff transaction, in order: summarize, persist `HANDOFF.md`, seed the child,
 * publish the switch marker. The seed happens before the marker, and the document is
 * written last, so an abandoned attempt leaves nothing behind in the project.
 */
import { type Context } from "@deepseek-ai/cordis";
import { type LlmResolvedModelInfo } from "@deepseek-ai/dsh-llm";
import { type Session } from "@deepseek-ai/dsh-session";
import { type PluginConfig } from "../shared/config.js";
import { type HandoffLanguage } from "./language.js";
import { type HandoffSplit } from "./conversation.js";
/**
 * The two language-dependent artifacts of one handoff: the `HANDOFF.md` document and the child's
 * first message. The summary headings are normalized to the resolved language here, so the stored
 * document and the seed prompt can never disagree about it. Exported so a test can pin the wiring
 * (the resolved language, the pending-question carry and the carried user decision) rather than only
 * the pure helpers.
 * @param args - session, resolved language, the raw model summary, archive pointers and the tail.
 * @returns the document to persist and the prompt to admit to the child.
 */
export declare function handoffArtifacts(args: {
    session: Session;
    config: PluginConfig;
    language: HandoffLanguage;
    rawSummary: string;
    archive: {
        log: string;
        index: string;
    };
    pointers: {
        log: string;
        index: string;
    };
    tail: string;
}): {
    document: string;
    prompt: string;
};
/**
 * The span a handoff summarizes, or an error when there is none. Two cases reach this: a session
 * with no messages at all, and — with the default `handoffBudgetRecentTokens` — a short conversation that
 * fits entirely inside the carried-over window. Both would otherwise pay for a model call and seed
 * the child with a fabricated summary; the error names the `budget recent 0` escape for the second case.
 * The automatic path cannot reach it (it refuses a span below `MIN_SUMMARIZE_TOKENS` first).
 * Exported so a test can pin the guard instead of only the happy path.
 * @param older - the rendered conversation before the kept tail.
 */
export declare function assertHandoffSummarizable(older: string): void;
/**
 * Summarize the session, persist the document, and start the seeded child session.
 * @param reason - the path that decided this handoff.
 * @param signal - the caller's cancellation signal, when the profile supplies one.
 * @param split - the span decided by the caller, when it already computed one.
 * @param triggerSeq - the automatic path's triggering `turn/end` offset; the handoff is deferred
 *   (never performed) once this session has started a turn after it. Absent on the manual path:
 *   `/handoff now` runs *inside* a turn, so "a turn is open" cannot mean the user moved on.
 */
export declare function performHandoff(ctx: Context, session: Session, target: {
    provider: string;
    model: string;
}, config: PluginConfig, resolved: LlmResolvedModelInfo, reason: "auto" | "manual", signal: AbortSignal | undefined, split?: HandoffSplit, triggerSeq?: number): Promise<{
    childId: string;
    file: string;
}>;
