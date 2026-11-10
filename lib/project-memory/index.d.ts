/**
 * project-memory — the memory feature (pass ②, consolidation).
 *
 * One high-frequency, throttled consolidation pass produces both durable
 * project memory (`.agents/memory/MEMORY.md`) and the rolling project context
 * (`.agents/memory/CONTEXT.md`); both documents are injected back into the
 * model context as dynamic runtime context. Skill distillation is a separate
 * feature (`project-autolearn`), and the raw archive is `project-context`.
 *
 * Commands: /memory (status | update | prune [--apply])
 */
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { type PluginConfig } from "../shared/config.js";
import { type PartialRefusalReason } from "./consolidate.js";
import { loadMemory } from "./memory-store.js";
import { type PruneOutcome } from "./prune.js";
export declare const name = "project-memory";
export declare const inject: string[];
interface ConsolidateOptions {
    force: boolean;
    silent: boolean;
    signal?: AbortSignal | undefined;
    /**
     * Hand this pass's write phase to the caller's durability tracker.
     *
     * The pass registers **only** the half that follows its model call, because a registered span that
     * contained the model call would be awaited by that call's own checkpoint flush
     * (`SessionWorkTracker`). Callers that do not track pass nothing.
     */
    track?: ((work: Promise<unknown>) => void) | undefined;
}
/** What one consolidation attempt did, so the `/memory update` reply can be truthful. */
export type ConsolidateStatus = "updated" | "unchanged" | "deduped" | "failed" | "stale" | "lossy-refused" | "partial-refused" | "read-capped-refused" | "fit-capped-refused";
/**
 * What a refused reply would have lost, kept apart from the landed counts on purpose.
 *
 * A refusal stores nothing, so every count that describes landed content is 0 — folding the refused
 * reply's numbers into those fields would report a loss the stored file never suffered. They are still
 * what the user needs to act on, so they ride in their own field instead.
 */
export type RefusedLoss = {
    /** Sections that would have lost at least one entry because the document reached its cap. */
    sectionDropped: number;
    /** Entries that would have been dropped whole. */
    droppedItems: number;
    /** Characters the memory cap would have dropped from the reply itself. */
    writeCapDroppedChars: number;
};
/**
 * What one consolidation attempt did, plus the loss it caused.
 *
 * A consolidation pass loses content before the write, in places the stored document cannot show
 * afterwards: the section render drops whole entries once the document reaches its cap
 * (`sectionDropped` / `droppedItems`), with `itemTruncated` counting entries cut to the per-item cap,
 * and a write cap clips the reply or the context document on the way out. Carrying them here is what
 * lets the receipt name the mechanism and the count: without it a pass that dropped twelve entries
 * read exactly like a clean one.
 *
 * A count is 0 unless the artifact it describes actually landed. A memory render whose write was
 * refused dropped nothing from the stored file, so its counts must not be reported as a loss.
 *
 * The input side is deliberately absent: a pass whose view of a stored artifact was shortened is
 * refused before the model call (`readCappedRefused` / `fitCappedRefused`), so no landed count can
 * describe a character the model was not shown.
 */
export type ConsolidateReport = {
    status: ConsolidateStatus;
    /** True when this pass's memory landed. A receipt must never claim an artifact that did not. */
    memoryWritten: boolean;
    /** True when this pass's context landed. */
    contextWritten: boolean;
    /** Characters the landed CONTEXT.md render dropped to fit its section budgets. */
    contextDroppedChars: number;
    /**
     * Characters the landed MEMORY.md write dropped because the reply itself exceeded the memory cap.
     * A reply that is not a four-section bullet document never reaches the section renderer, so this
     * cap is the only place its loss is recorded: without it such a write is completely silent.
     */
    memoryWriteDroppedChars: number;
    /** Sections of the landed memory that lost at least one entry because the document reached its cap. */
    sectionDropped: number;
    /** Entries dropped whole from the landed memory because its character cap was full. */
    droppedItems: number;
    /** Entries of the landed memory cut to their section's per-item cap and kept. */
    itemTruncated: number;
    /**
     * Project-relative path of the context half that landed when it was a task document rather than
     * `CONTEXT.md`. The receipt names this file, because "updated CONTEXT.md" would be false for a
     * bound session — the project-level document was not touched at all.
     */
    contextTarget?: string;
    /**
     * What a refused reply would have lost. Set only by `lossy-refused`, and never folded into the
     * landed counts above: tier C refuses the write, so the stored document lost none of it.
     */
    refusedLoss?: RefusedLoss;
    /**
     * True when batch Q2's guard refused the reply: it carried this extension's document shape but could
     * not be merged into the stored document, so the write was skipped and `MEMORY.md` is byte-identical.
     * Kept apart from `refusedLoss` (tier C's cap refusal) because the causes are different: naming the
     * cap here would point the operator at a knob that has nothing to do with the refusal.
     */
    partialRefused: boolean;
    /** Which half of the merge could not be read, when `partialRefused` is set (batch Q2). */
    partialRefusal?: PartialRefusalReason;
    /** Headings the stored document contributed to a merged partial reply (batch Q2); empty otherwise. */
    mergedFromStore?: string[];
    /** Invariants/Pitfalls entries a written reply no longer carries (batch Q2's report layer). */
    removedEntries?: {
        count: number;
        samples: string[];
    };
    /**
     * Set by the read-cap gate: the pass was refused before any model call because a stored artifact was
     * longer than the cap that decides what the model is shown (`maxMemoryChars` for the memory,
     * `MAX_CONTEXT_CHARS` for the context). The reply would have been built from the shortened view and
     * would have replaced the stored file with it, deleting the hidden characters — a loss tier C cannot
     * see, because it measures the reply against the write cap the reply fits.
     */
    readCappedRefused?: {
        cap: number;
        memoryHiddenChars: number;
        contextHiddenChars: number;
    };
    /**
     * Set by the output-budget gate: the pass was refused before any model call because `fitMemoryInput`
     * could not hold both stored documents inside the output budget, so the model would have been shown a
     * shortened view and its whole-document reply would have replaced the stored file with it. The same
     * loss as `readCappedRefused`, cut on a different budget, so the levers differ: this one is
     * `maxOutputTokens` (or a shorter document), never `maxMemoryChars`.
     */
    fitCappedRefused?: {
        maxOutputTokens: number;
        memoryHiddenChars: number;
        contextHiddenChars: number;
    };
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
/**
 * The `/memory prune` reply for one cleaning run. Exported for tests.
 *
 * A preview and an applied run answer different questions and must never read alike: the preview
 * exists so a user can see what would leave the directory before anything does, and the applied
 * receipt has to name the archive, because that tarball is the only way back.
 * @param outcome - what the cleaning channel planned and what it did.
 * @param projectRoot - the project root, for paths relative to it.
 * @returns the command result.
 */
export declare function memoryPruneReply(outcome: PruneOutcome, projectRoot: string): {
    kind: "success" | "error";
    text: string;
};
export {};
