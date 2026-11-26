/**
 * project-context — the session archive (pass ①, no model calls).
 *
 * Writes the per-session raw JSONL and Markdown rendering plus the mechanical
 * session index under `.agents/memory/session-logs/`. Distilling the archive
 * into CONTEXT.md/MEMORY.md is the memory feature (`project-memory`); reading
 * it back for skills is autolearn (`project-autolearn`); pointing a fresh
 * session at it is handoff (`project-handoff`).
 *
 * Commands: /context, /session-log (bare = read state, `write` = write now, `tree` = the handoff lineage,
 * `import <archive…>` = backfill)
 */
import type { Context } from "../host/contract.js";
export declare const name = "project-context";
export declare const inject: string[];
/**
 * The shared/archive card: ten keys read by every entry (archive, budgets, `taskMode`, the auxiliary
 * route). Each of the other three entries exports its own narrow schema, so this is one of four cards,
 * not the only one — but it is still the one that publishes, because its ten keys are what the other
 * three overlay onto their own.
 */
export declare const Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<{
    archiveEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    sessionSettledDays: import("@deepseek-ai/schemastery").default<number, number>;
    forceDedupeMs: import("@deepseek-ai/schemastery").default<number, number>;
    maxTokens: import("@deepseek-ai/schemastery").default<number, number>;
    maxOutputTokens: import("@deepseek-ai/schemastery").default<number, number>;
    maxMemoryChars: import("@deepseek-ai/schemastery").default<number, number>;
    taskMode: import("@deepseek-ai/schemastery").default<"assisted" | "delegated" | "manual", "assisted" | "delegated" | "manual">;
    provider: import("@deepseek-ai/schemastery").default<string, string>;
    model: import("@deepseek-ai/schemastery").default<string, string>;
    handoffLang: import("@deepseek-ai/schemastery").default<"zh" | "en" | "auto", "zh" | "en" | "auto">;
}>, Schemastery.ObjectT<{
    archiveEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    sessionSettledDays: import("@deepseek-ai/schemastery").default<number, number>;
    forceDedupeMs: import("@deepseek-ai/schemastery").default<number, number>;
    maxTokens: import("@deepseek-ai/schemastery").default<number, number>;
    maxOutputTokens: import("@deepseek-ai/schemastery").default<number, number>;
    maxMemoryChars: import("@deepseek-ai/schemastery").default<number, number>;
    taskMode: import("@deepseek-ai/schemastery").default<"assisted" | "delegated" | "manual", "assisted" | "delegated" | "manual">;
    provider: import("@deepseek-ai/schemastery").default<string, string>;
    model: import("@deepseek-ai/schemastery").default<string, string>;
    handoffLang: import("@deepseek-ai/schemastery").default<"zh" | "en" | "auto", "zh" | "en" | "auto">;
}>>;
/**
 * The cordis entry: resolve the config, publish the shared settings namespace, adapt the context to
 * the host-neutral façade and start the core (`start.ts`). This file is the only one in the plugin
 * that names the framework.
 */
export declare function apply(ctx: Context, rawConfig: unknown): void;
