/**
 * The model port.
 *
 * The cores never reach for `ctx.llm`: the two calls they make (resolve a route's metadata, stream
 * one reply) are named here, and the chunk vocabulary the reply loop narrows on is declared here
 * rather than borrowed from the harness package. `model-call.ts` is the single consumer.
 */
import type { Context, GenerateOptions, LlmResolvedModelInfo } from "../contract.js";
export interface TextDeltaChunk {
    readonly type: "text-delta";
    readonly text: string;
}
export interface ToolCallDeltaChunk {
    readonly type: "tool-call-delta";
    readonly index: number;
    /** Only the first delta of a block names the tool. */
    readonly name?: string;
    readonly argumentsDelta: string;
}
export interface BlockEndChunk {
    readonly type: "block-end";
    readonly index: number;
    /** Only the tool-call block is read by the reply loop; other block kinds are ignored. */
    readonly block: {
        readonly type: "tool-call";
        readonly name: string;
        readonly arguments: string;
    };
}
export interface UsageChunk {
    readonly type: "usage";
    readonly usage: {
        readonly reasoningTokens?: number;
    };
}
export interface FinishChunk {
    readonly type: "finish";
    readonly reason: {
        readonly kind: string;
        /** Present whenever `kind` is an error or an abort; the reply loop reads it only there. */
        readonly failure: {
            readonly message: string;
            readonly code: string;
        };
    };
}
export type StreamChunk = TextDeltaChunk | ToolCallDeltaChunk | BlockEndChunk | UsageChunk | FinishChunk;
export interface LlmPort {
    resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
export declare function llmOf(ctx: Context): LlmPort;
