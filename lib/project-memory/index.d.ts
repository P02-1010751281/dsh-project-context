/**
 * project-memory — the memory feature (pass ②, consolidation).
 *
 * One high-frequency, throttled consolidation pass produces both durable
 * project memory (`.agents/memory/MEMORY.md`) and the rolling project context
 * (`.agents/memory/CONTEXT.md`); both documents are injected back into the
 * model context as dynamic runtime context. Skill distillation is a separate
 * feature (`project-autolearn`), and the raw archive is `project-context`.
 *
 * Commands: /memory (status | update)
 */
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { type PluginConfig } from "../shared/config.js";
import { loadMemory } from "./memory-store.js";
export declare const name = "project-memory";
export declare const inject: string[];
interface ConsolidateOptions {
    force: boolean;
    silent: boolean;
    signal?: AbortSignal | undefined;
}
/** What one consolidation attempt did, so the `/memory update` reply can be truthful. */
export type ConsolidateStatus = "updated" | "clipped" | "unchanged" | "deduped" | "failed" | "stale" | "stale-context" | "lossy-refused";
/**
 * What a refused reply would have lost, kept apart from the landed counts on purpose.
 *
 * A refusal stores nothing, so every count that describes landed content is 0 — folding the refused
 * reply's numbers into those fields would report a loss the stored file never suffered. They are still
 * what the user needs to act on, so they ride in their own field instead.
 */
export type RefusedLoss = {
    /** Sections that would have lost at least one entry to their budget. */
    sectionDropped: number;
    /** Entries that would have been dropped whole. */
    droppedItems: number;
    /** Characters the memory cap would have dropped from the reply itself. */
    writeCapDroppedChars: number;
};
/**
 * What one consolidation attempt did, plus the loss it caused.
 *
 * A consolidation pass loses content in two places that the stored document cannot show afterwards,
 * because both happen before the write: the input fit hides characters of the stored artifacts from
 * the model (`memoryHiddenChars` / `contextHiddenChars`), and the section render drops whole entries
 * that overflow a section's share (`sectionDropped` / `droppedItems`), with `itemTruncated` counting
 * entries cut to the per-item cap. Carrying them here is what lets the receipt name the mechanism and
 * the count: without it a pass that dropped twelve entries read exactly like a clean one.
 *
 * A count is 0 unless the artifact it describes actually landed. A memory render whose write was
 * refused dropped nothing from the stored file, so its counts must not be reported as a loss.
 */
export type ConsolidateReport = {
    status: ConsolidateStatus;
    /** True when this pass's memory landed. A receipt must never claim an artifact that did not. */
    memoryWritten: boolean;
    /** True when this pass's context landed. */
    contextWritten: boolean;
    /**
     * Characters of the stored memory the model was not shown (the read cap plus the input fit),
     * reported only when this pass's memory landed. The document the count describes is the *stored*
     * one the pass read, not the one it wrote.
     */
    memoryHiddenChars: number;
    /** Characters of the stored context the model was not shown (the read cap plus the input fit), reported only when the context landed. */
    contextHiddenChars: number;
    /** Characters the landed CONTEXT.md render dropped to fit its section budgets. */
    contextDroppedChars: number;
    /**
     * Characters the landed MEMORY.md write dropped because the reply itself exceeded the memory cap.
     * A reply that is not a four-section bullet document never reaches the section renderer, so this
     * cap is the only place its loss is recorded: without it such a write is completely silent.
     */
    memoryWriteDroppedChars: number;
    /** Sections of the landed memory that lost at least one entry to their budget. */
    sectionDropped: number;
    /** Entries dropped whole from the landed memory because their section's budget was full. */
    droppedItems: number;
    /** Entries of the landed memory cut to their section's per-item cap and kept. */
    itemTruncated: number;
    /**
     * What a refused reply would have lost. Set only by `lossy-refused`, and never folded into the
     * landed counts above: tier C refuses the write, so the stored document lost none of it.
     */
    refusedLoss?: RefusedLoss;
};
/** The no-loss half of a report: nothing landed and nothing was dropped. */
export type ConsolidateLoss = Omit<ConsolidateReport, "status">;
/** One pass updates both artifacts so MEMORY.md and CONTEXT.md never disagree about the pass. */
/** One consolidation pass. Exported so the version-claim/backoff behaviour is testable. */
export declare function consolidateProject(ctx: Context, config: PluginConfig, agent: Agent, options: ConsolidateOptions): Promise<ConsolidateReport>;
export declare function apply(ctx: Context, rawConfig: unknown): void;
/**
 * The `/memory` status reply for one loaded memory. Exported for tests.
 *
 * The reply distinguishes the states a silent fold would otherwise hide: a torn journal line, a
 * source that exists but cannot be read, and a stored reply from the old bug. It also reports the
 * character cap, which is the one degraded state the document itself cannot surface to the user:
 * a marker records that the document was capped *at some point* (it is carried forward), while
 * `cappedDroppedChars` describes what **this** read's cap kept back — including on the no-journal
 * read, which clips without writing a marker at all. Either one is enough to warn.
 * Measure the current state rather than quoting one: `loadMemory(root, maxMemoryChars)` reports
 * `cappedDroppedChars` and the marker through `isMemoryTruncated(loaded.text)`. Without the note the
 * receipt calls a memory that lost a third of itself perfectly healthy, and every later append lands
 * past the cap and is dropped on write.
 * @param memory - the loaded memory document and its status flags.
 * @param context - the paths and the cap this project is configured with.
 * @returns the command result.
 */
export declare function memoryStatusReply(memory: Awaited<ReturnType<typeof loadMemory>>, context: {
    projectRoot: string;
    journal: string;
    maxMemoryChars: number;
}): {
    kind: "success" | "error";
    text: string;
};
/**
 * The `/memory update` reply for one pass result. The pass swallows its own
 * error (it is also logged to `errors.log`), so the reply must not claim success
 * for a failure or for a deduped no-op. Exported for tests.
 *
 * A loss count only ever extends the sentence, so `detail === ""` keeps meaning "what the sentence
 * names landed, and nothing was lost" — a reworded base is caught rather than silently accepted.
 * @param report - what the consolidation attempt did, including the loss it caused.
 * @returns the command result.
 */
export declare function memoryUpdateReply(report: ConsolidateReport): {
    kind: "success" | "error";
    text: string;
};
export {};
