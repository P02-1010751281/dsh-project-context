/**
 * The one auxiliary model call: its prompt, its output budgets, its timeout, and the two
 * text artifacts it feeds — the `HANDOFF.md` document and the child's first message.
 */
import { type Context } from "@deepseek-ai/cordis";
import { type LlmResolvedModelInfo } from "@deepseek-ai/dsh-llm";
import { type Session } from "@deepseek-ai/dsh-session";
import { type PluginConfig } from "../shared/config.js";
import { type HandoffLanguage } from "./language.js";
/** Summary thinking: "off" when the adapter exposes that effort, else the session's routed level. */
export declare function resolveSummaryEffort(config: PluginConfig, session: Session, resolved: LlmResolvedModelInfo): string | undefined;
/** The summarizer prompt for one handoff; the resolved language rides the format line. Exported for tests. */
export declare function handoffPrompt(projectRoot: string, memoryText: string, older: string, fileIndex: string, language: HandoffLanguage): string;
export declare function renderHandoff(session: Session, summary: string, archive: {
    log: string;
    index: string;
}, language: HandoffLanguage): string;
/** The first message of the fresh session; the archive pointers keep the raw history reachable. */
export declare function continuation(parentId: string, summary: string, tail: string, archive: {
    log: string;
    index: string;
}, language?: HandoffLanguage, pending?: string): string;
/** Bound one summary call by the caller signal and the summary timeout. */
export declare function withTimeout(signal: AbortSignal | undefined): AbortSignal;
/**
 * The output budgets one summary call may try, in order. A truncated summary retries once with more
 * room than the configured starting cap, but the retry never passes the adaptive growth boundary
 * `max(maxTokens, maxOutputTokens)` — so a lowered `maxOutputTokens` bounds the retry too, instead
 * of the fixed 32k floor overriding it. Exported so a test can pin the bounds.
 * @param config - the effective plugin config.
 * @returns one or two distinct token budgets.
 */
export declare function summaryAttemptBudgets(config: PluginConfig): number[];
/** One summary call; a token-cap truncation retries once with more output room. */
export declare function summarize(ctx: Context, target: {
    provider: string;
    model: string;
}, config: PluginConfig, prompt: string, signal: AbortSignal, reasoningEffort: string | undefined): Promise<string>;
