/**
 * One plugin-sourced auxiliary model call: which route to use, what metadata the adapter
 * exposes, the output limit for that route, and the single-shot and meta-returning calls.
 */
import { type Context } from "@deepseek-ai/cordis";
import { type Agent } from "@deepseek-ai/dsh-agent";
import { type GenerateOptions, type LlmResolvedModelInfo, type UserMessage } from "@deepseek-ai/dsh-llm";
import { type PluginConfig } from "./config.js";
export declare const LEARN_PLUGIN_NAME = "dsh-project-context";
/**
 * This producer's message-source kind.
 *
 * dsh 0.1.7-rc.2 dropped the shared catch-all `plugin` kind: `MessageSourceMap` is merge-extensible and
 * each producer declares its own kind in its own module (in-tree, `compact-checkpoint` does the same).
 * The kind deliberately is not `user`: `userTurnCount` counts human turns by `source.kind === "user"`,
 * so tagging this synthetic message `user` would inflate the consolidation/autolearn turn counters.
 */
declare module "@deepseek-ai/dsh-llm" {
    interface MessageSourceMap {
        "dsh-project-context": {
            kind: "dsh-project-context";
        };
    }
}
/**
 * What one auxiliary call carries besides its prompt: the session identity it routes on, the tools it
 * offers, and the reasoning effort it overrides.
 */
export type PluginCallOptions = {
    /**
     * The loop's own session identity for this call (`GenerateOptions.sessionId`).
     *
     * Required rather than optional, because it is not routing decoration: the adapter maps it to
     * model-hidden transport metadata, and a route may refuse a request that arrives without it
     * (opencode answers 400 `MissingSessionID`). An auxiliary call that forgot it would fail at the
     * gateway instead of at the compiler.
     *
     * Naming a live session also enters the loop's session-checkpoint path — dsh flushes a session
     * before dispatching a request that names it — so the pass making this call must stay out of the
     * `SessionWorkTracker` while the call is in flight, or that flush would await the call it is
     * dispatching. `SessionWorkTracker` owns that half of the contract.
     */
    sessionId: NonNullable<GenerateOptions["sessionId"]>;
    /** Optional reasoning effort override for this call. */
    reasoningEffort?: string;
    /** Tools to offer this call; omitted means the request carries none at all. */
    tools?: readonly PluginTool[];
};
/** One tool offered to a plugin-authored call: the declaration the adapter forwards to the provider. */
export type PluginTool = {
    name: string;
    description: string;
    /** JSON Schema object for the arguments. */
    parameters: Record<string, unknown>;
};
/**
 * One tool call the reply carried, with its arguments left as the raw JSON text the adapter
 * streamed. Whether those arguments are usable is the caller's policy, not this module's.
 */
export type PluginToolCall = {
    name: string;
    arguments: string;
};
/** What one plugin-authored model call produced: its visible text, how the stream ended, and any tool calls. */
export type CompletionOutcome = {
    /** Trimmed visible text. */
    text: string;
    /** dsh finish reason kind (`stop`, `tool-calls`, `max-tokens`, `aborted`, `error`, or an unknown kind). */
    stopReason: string;
    /** Hidden reasoning tokens, a subset of the output count; 0 when the adapter reports none. */
    reasoningTokens: number;
    /**
     * Tool calls the reply carried, in stream order. Absent — never an empty array — when the reply
     * carried none, so a caller that offers no tools sees the same object it saw before this field
     * existed.
     */
    toolCalls?: PluginToolCall[];
};
/**
 * One plugin-authored user message, tagged with this producer's own source kind.
 *
 * The kind is deliberately never `user`: `userTurnCount` counts human turns by `source.kind === "user"`,
 * and dsh's goal tools grant `create_goal` / `update_goal edit|pause|resume` to a "direct human turn" by
 * reading that same field (`goal/tool-goal/src/authority.ts`). Anything this plugin writes on the
 * model's behalf — an auxiliary call's prompt, or the handoff seed — must therefore carry its own
 * kind instead of borrowing the person's authority.
 */
export declare function pluginUserMessage(text: string): UserMessage;
/** Resolve the learn-pass route: explicit config, then the agent's latest routed request, then AgentOptions. */
export declare function resolveTarget(agent: Agent, config: PluginConfig): {
    provider: string;
    model: string;
} | undefined;
/**
 * The routed model's own catalogue metadata: its output cap and whether it exposes reasoning
 * efforts. Model metadata is advisory, so an unknown or failing provider simply yields
 * `undefined` and the pass falls back to the configured ceiling. Consolidation reads one resolve
 * for both facts rather than spending two RPCs.
 * @param ctx - the plugin context holding the `llm` service.
 * @param target - the resolved provider/model route.
 * @param signal - the pass's abort signal.
 * @returns the resolved info, or `undefined` when the adapter cannot answer.
 */
export declare function resolveModelMetadata(ctx: Context, target: {
    provider: string;
    model: string;
}, signal: AbortSignal | undefined): Promise<LlmResolvedModelInfo | undefined>;
/**
 * The routed model's own output cap, when its adapter publishes one. Model catalog metadata is
 * advisory, so an unknown provider simply yields no cap.
 * @param ctx - the plugin context holding the `llm` service.
 * @param target - the resolved provider/model route.
 * @param signal - the pass's abort signal.
 * @returns the adapter's per-request output cap, or `undefined`.
 */
export declare function modelOutputLimit(ctx: Context, target: {
    provider: string;
    model: string;
}, signal: AbortSignal | undefined): Promise<number | undefined>;
/**
 * One auxiliary plugin-authored model call, returning its visible text.
 *
 * Carries the loop's own session identity, which every route is entitled to require; see
 * {@link PluginCallOptions.sessionId} for why it is mandatory and for the checkpoint cycle that
 * naming a live session used to create.
 */
export declare function requestPluginText(ctx: Context, target: {
    provider: string;
    model: string;
}, maxTokens: number, prompt: string, signal: AbortSignal | undefined, options: PluginCallOptions): Promise<string>;
/**
 * One auxiliary plugin-authored model call, returning its visible text plus how it ended.
 *
 * The stop reason is the only signal that says a reply was cut off: a reply that hit the output
 * limit still carries content, so it parses as a truncated document rather than a failure. dsh
 * names that reason `max-tokens` — **not** pi's `length` — and it is deliberately not an error
 * here: the caller decides whether to retry with more headroom (a genuine `error`/`aborted`
 * finish still throws, with the message this plugin has always used).
 * @param ctx - the plugin context holding the `llm` service.
 * @param target - the resolved provider/model route.
 * @param maxTokens - the output cap to request.
 * @param prompt - the plugin-authored user message.
 * @param signal - the pass's abort signal.
 * @param options - the session identity this call routes on, an optional reasoning effort override,
 * and the tools to offer this call.
 * @returns the trimmed visible text, the finish reason kind, hidden reasoning tokens, and any tool calls.
 */
export declare function requestPluginTextWithMeta(ctx: Context, target: {
    provider: string;
    model: string;
}, maxTokens: number, prompt: string, signal: AbortSignal | undefined, options: PluginCallOptions): Promise<CompletionOutcome>;
/** The harness failure code an error carries (`HarnessError.code`), or undefined when it carries none. */
export declare function failureCodeOf(error: unknown): string | undefined;
/** Per-pass state for `callWithToolsFallback`; the switch belongs to the pass, not to this module. */
export type ToolsFallbackState = {
    toolsDisabled?: boolean;
    toolsAttempted?: boolean;
};
/**
 * One auxiliary model call that may be refused because it carries `tools`, retried once without them.
 *
 * One-shot and sticky, like pi's `callAux`: only the **first** tools-carrying call of a pass may fall
 * back, and once it has, no later call of that pass carries `tools` again. The switch is real here,
 * not ceremony — the autolearn pass makes a second tools-carrying call when the first reply asks for
 * archives and the pass backtracks, and a route that refused the parameter must not be asked to take
 * it again. `toolsAttempted` is marked before the call, so a call that *succeeded* with tools also
 * counts as "this route accepts them" and a later failure stays the provider's.
 * @param state - the pass's own switch; a fresh object per pass.
 * @param offersTools - whether this call would carry tools at all.
 * @param call - runs the request with tools (`true`) or without them (`false`).
 * @returns the first outcome, or the tools-free retry's when the refusal was a request-shape one.
 */
export declare function callWithToolsFallback<T>(state: ToolsFallbackState, offersTools: boolean, call: (withTools: boolean) => Promise<T>): Promise<T>;
/**
 * Pick the tool call the caller asked for; the one place the "unusable call" policy lives.
 *
 * This module is name-agnostic, so it hands back every call it collected — including names this
 * caller does not accept, which is what lets these two be told apart:
 *
 * - a call with another name **and** readable text is the fail-open text path; `undefined` sends the
 *   caller on to parse the text;
 * - a call with another name **and** no text has nothing to fall back to, so it is an error —
 *   returning `undefined` there would feed `""` to the parser and read as a silent no-op success.
 * @param toolCalls - the calls the reply carried, when it carried any.
 * @param name - the one tool name this caller accepts.
 * @param text - the reply's visible text, which decides the no-matching-call case.
 * @returns the matching call's raw JSON argument text, or undefined when the text path should run.
 */
export declare function pickToolCall(toolCalls: readonly PluginToolCall[] | undefined, name: string, text: string): string | undefined;
/**
 * True when a reply's tool call must not be trusted as complete.
 *
 * The adapter repairs a truncated arguments string into a shape-valid object, so the *presence* of a
 * call is not evidence that its contents arrived. dsh names a cut reply `max-tokens`, and an empty
 * finish reason means no terminal event was seen at all; either way the block may have been retained
 * half-written, so both are refused. A reply that carries no call is not this predicate's business.
 */
export declare function toolCallIsTruncated(completion: CompletionOutcome): boolean;
