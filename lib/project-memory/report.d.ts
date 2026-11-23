/**
 * project-memory — what one consolidation pass did, and how it reads back.
 *
 * Split out of `index.ts` so the report layer (the shapes a pass returns, and the receipt sentences a
 * user reads) can be reviewed and tested apart from the pass itself and from the plugin wiring. The
 * module owns no host interface and no registration: it takes plain values and returns plain text.
 */
import { type MissingLiterals } from "./missing-literals.js";
import { type PartialRefusalReason } from "./consolidate.js";
import { type AcceptOutcome } from "./staleness-source.js";
import { type EntryState } from "./entry-state.js";
import { type MemoryStates } from "./entry-states.js";
import { type StalenessFacts } from "./staleness.js";
import { type DocumentLanguage } from "../shared/language.js";
import { type PruneOutcome } from "./prune.js";
import { loadMemory } from "./memory-store.js";
export interface ConsolidateOptions {
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
     * Batch V's verdict on the source bindings, present only when this pass landed a memory and the
     * bindings could be measured. A pass that wrote nothing measured nothing, so the field stays
     * absent rather than reporting a `0` it never earned.
     */
    staleness?: StalenessFacts;
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
     * Entries this pass put back verbatim because the reply dropped them and their literals vanished
     * with them (batch AC, `lost-entry-repair.ts`). They are in the landed document — the receipt names
     * them so a repaired pass does not read like a clean one.
     */
    restoredEntries?: {
        count: number;
        samples: string[];
    };
    /** Entries the repair found lost but could not restore without exceeding the cap. */
    unrestoredEntries?: {
        count: number;
        samples: string[];
    };
    /**
     * The literals the memory this pass replaced carried and the document that landed no longer
     * mentions — the rewrite loss gate's observation half (`docs/memory-rewrite-loss-gate-spec.md`
     * §3 A). Measured from the landed bytes, never from the reply: the write path caps the document
     * once more, so only a read-back describes what replaced the old file. Reported and never used as
     * a gate (§9.2: a legal rename reads as a loss, and a symbol another entry still mentions hides its
     * own loss). Absent when this pass landed no memory, because a document that did not land replaced
     * nothing.
     */
    missingLiterals?: MissingLiterals;
    /**
     * The same rewrite-loss measure, taken on the other artifact: the context document is rewritten
     * whole on every pass and had no survival measure at all before batch AA2b. Reported only, for the
     * same reason as the memory half — a legal rename reads as a loss — and absent when nothing landed
     * or when there was no previous document to lose anything from.
     */
    contextMissingLiterals?: MissingLiterals;
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
export declare const NO_LOSS: ConsolidateLoss;
/** A report for a status that landed no write, so it can never claim a loss. */
export declare function cleanReport(status: ConsolidateStatus): ConsolidateReport;
/**
 * The `/memory` status reply for one loaded memory. Exported for tests.
 *
 * This is only composition: the loader has already measured the document and its flags, `sections.ts`
 * knows the document's shape, and `status-source.ts` measures the store around it. The receipt's
 * wording lives in `status-report.ts`, so "what the user reads" and "what was measured" are two files
 * that can be reviewed apart — and a test can render a receipt from plain objects without touching a
 * disk.
 * @param memory - the loaded memory document and its status flags.
 * @param context - the paths and the cap this project is configured with.
 * @returns the command result.
 */
export declare function memoryStatusReply(memory: Awaited<ReturnType<typeof loadMemory>>, context: {
    projectRoot: string;
    journal: string;
    maxMemoryChars: number;
}, language?: DocumentLanguage): Promise<{
    kind: "success" | "error";
    text: string;
}>;
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
/** What one acceptance did. A flat union: every branch is a different sentence and a different next move. */
type AcceptResult = {
    readonly kind: "content-stale";
    readonly outcome: AcceptOutcome;
} | {
    readonly kind: "confirmed";
    readonly reason: EntryState;
} | {
    readonly kind: "healthy";
} | {
    readonly kind: "retirable";
    readonly state: EntryState;
} | {
    readonly kind: "unknown-entry";
} | {
    readonly kind: "unreadable-store";
};
/**
 * Accept one entry's current state: the single exit, dispatched by what the arbiter says.
 *
 * `content-stale` is cleared by re-baselining fingerprints; `task-closed` and `version-shipped` have no
 * fingerprint to refresh, so they are cleared by recording that a human confirmed the entry. A
 * retirable state is refused on purpose — the remedy there is the retirement pass, and accepting it
 * would keep an entry the document already superseded.
 * @param projectRoot - the project the sidecar lives in.
 * @param text - the loaded memory document.
 * @param states - the arbiter's verdict, already computed for this document.
 * @param tid - the entry id the user named.
 * @returns what happened, for the receipt.
 */
export declare function acceptEntryState(projectRoot: string, text: string, states: MemoryStates, tid: string): Promise<AcceptResult>;
/**
 * The `/memory reconcile` reply: every entry the arbiter will not call healthy, with its reason.
 *
 * The first line carries the count on purpose — the client folds a command card to one ellipsized line,
 * so a payload below it would be unreadable without expanding the card. Each line names the entry, the
 * state, and the evidence; an id alone gives the reader nothing to confirm.
 * @param states - the arbiter's verdict for the document.
 * @param context - the read-cap count, so a truncated view is named instead of implied complete.
 * @returns the command result.
 */
export declare function memoryReconcileReply(states: MemoryStates, context: {
    cappedDroppedChars: number;
}): {
    kind: "success" | "error";
    text: string;
};
/**
 * The `/memory reconcile --accept <id>` reply.
 *
 * Every refusal is a different cause and says which, because the reader's next move differs: a missing
 * anchor or a superseded entry is the retirement pass's business, an unreadable file must not be frozen
 * as truth, and a raced acceptance only needs to be run again.
 * @param result - what the acceptance did.
 * @param tid - the entry id the user named.
 * @returns the command result.
 */
export declare function memoryAcceptReply(result: AcceptResult, tid: string): {
    kind: "success" | "error";
    text: string;
};
export {};
