/**
 * project-context — the session archive (pass ①, no model calls).
 *
 * Writes the per-session raw JSONL and Markdown rendering plus the mechanical
 * session index under `.agents/memory/session-logs/`. Distilling the archive
 * into CONTEXT.md/MEMORY.md is the memory feature (`project-memory`); reading
 * it back for skills is autolearn (`project-autolearn`); pointing a fresh
 * session at it is handoff (`project-handoff`).
 *
 * Commands: /context, /session-log (bare = read state, `write` = write now, `import <archive…>` = backfill)
 */
import type { Context } from "@deepseek-ai/cordis";
export declare const name = "project-context";
export declare const inject: string[];
/**
 * The settings schema the Host projects into the Plugins page, and the one namespace all four
 * plugins share: the entry id below (`project-context`) is what the web card edits, and
 * {@link publishProjectContextSettings} republishes the value this entry was applied with.
 */
export declare const Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<{
    archiveEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    memoryEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    consolidateTurns: import("@deepseek-ai/schemastery").default<number, number>;
    consolidateIntervalMs: import("@deepseek-ai/schemastery").default<number, number>;
    forceDedupeMs: import("@deepseek-ai/schemastery").default<number, number>;
    maxTokens: import("@deepseek-ai/schemastery").default<number, number>;
    maxOutputTokens: import("@deepseek-ai/schemastery").default<number, number>;
    maxMemoryChars: import("@deepseek-ai/schemastery").default<number, number>;
    provider: import("@deepseek-ai/schemastery").default<string, string>;
    model: import("@deepseek-ai/schemastery").default<string, string>;
    autolearnEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    autolearnTurns: import("@deepseek-ai/schemastery").default<number, number>;
    autolearnIntervalMs: import("@deepseek-ai/schemastery").default<number, number>;
    handoffEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    handoffThresholdAuto: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    handoffThresholdRatio: import("@deepseek-ai/schemastery").default<number, number>;
    handoffBudgetSummaryTokens: import("@deepseek-ai/schemastery").default<number, number>;
    handoffBudgetRecentTokens: import("@deepseek-ai/schemastery").default<number, number>;
    handoffThinking: import("@deepseek-ai/schemastery").default<"off" | "session", "off" | "session">;
    handoffPendingQuestion: import("@deepseek-ai/schemastery").default<"defer" | "wait", "defer" | "wait">;
    handoffLang: import("@deepseek-ai/schemastery").default<"auto" | "zh" | "en", "auto" | "zh" | "en">;
}>, Schemastery.ObjectT<{
    archiveEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    memoryEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    consolidateTurns: import("@deepseek-ai/schemastery").default<number, number>;
    consolidateIntervalMs: import("@deepseek-ai/schemastery").default<number, number>;
    forceDedupeMs: import("@deepseek-ai/schemastery").default<number, number>;
    maxTokens: import("@deepseek-ai/schemastery").default<number, number>;
    maxOutputTokens: import("@deepseek-ai/schemastery").default<number, number>;
    maxMemoryChars: import("@deepseek-ai/schemastery").default<number, number>;
    provider: import("@deepseek-ai/schemastery").default<string, string>;
    model: import("@deepseek-ai/schemastery").default<string, string>;
    autolearnEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    autolearnTurns: import("@deepseek-ai/schemastery").default<number, number>;
    autolearnIntervalMs: import("@deepseek-ai/schemastery").default<number, number>;
    handoffEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    handoffThresholdAuto: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    handoffThresholdRatio: import("@deepseek-ai/schemastery").default<number, number>;
    handoffBudgetSummaryTokens: import("@deepseek-ai/schemastery").default<number, number>;
    handoffBudgetRecentTokens: import("@deepseek-ai/schemastery").default<number, number>;
    handoffThinking: import("@deepseek-ai/schemastery").default<"off" | "session", "off" | "session">;
    handoffPendingQuestion: import("@deepseek-ai/schemastery").default<"defer" | "wait", "defer" | "wait">;
    handoffLang: import("@deepseek-ai/schemastery").default<"auto" | "zh" | "en", "auto" | "zh" | "en">;
}>>;
export declare function apply(ctx: Context, rawConfig: unknown): void;
