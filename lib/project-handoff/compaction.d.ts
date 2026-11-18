/**
 * The compaction **core**: one session's compaction history, as a pure fold over records.
 *
 * This module knows nothing about dsh. A record is a three-field DTO; the host event shapes live in
 * the sibling shim `compaction-events.ts`, so a change in what dsh emits touches that file alone and
 * this fold stays testable without a session, a context or a logging host.
 *
 * Why count at all: compaction belongs to the host (`@deepseek-ai/dsh-compaction`), and this package
 * must not take that service. What is left for us is *evidence* — a user reading `/handoff status`
 * needs to know the host already compacted twice before deciding the occupancy number means what they
 * think it means.
 */
import { type HandoffLanguage } from "./language.js";
/** One compaction fact, normalized from whatever the host recorded. */
export type CompactionRecord = 
/** A transaction opened; it states no amount and its end carries the outcome. */
{
    readonly kind: "start";
}
/** A summarization that wrote a replacement; `id` is the transaction's. */
 | {
    readonly kind: "summary";
    readonly id: string;
    readonly shadowedTokens?: number;
    readonly provider?: string;
    readonly model?: string;
}
/** A transaction's outcome; `error` is present exactly when it failed. */
 | {
    readonly kind: "end";
    readonly id: string;
    readonly error?: string;
}
/** A model-free replacement of an over-budget tool result; it is not a transaction, so it has no id. */
 | {
    readonly kind: "prune";
    readonly shadowedTokens?: number;
};
/**
 * What the shim could make of the log.
 *
 * `unavailable` is a *named* gap, never a zero: a log we failed to read, or a compaction record whose
 * shape we do not recognize, must not be reported as "no compaction" — that is a wrong cause, and this
 * repository treats a wrong cause as worse than a named absence.
 */
export type CompactionFeed = {
    readonly kind: "records";
    readonly records: readonly CompactionRecord[];
} | {
    readonly kind: "unavailable";
    readonly reason: "unreadable" | "malformed";
};
/** The last replacement the log states, in log order. */
export interface CompactionSuccess {
    /** The heuristic price of the shadowed span; absent when the record did not state one. */
    readonly shadowedTokens?: number;
    readonly provider?: string;
    readonly model?: string;
}
/** A folded history. Every count is one distinct fact in the log, not an inference. */
export interface CompactionHistory {
    /** Distinct `summary` ids: summarizations that wrote a replacement. */
    readonly summarized: number;
    /** `prune` records: model-free replacements of over-budget tool results. */
    readonly pruned: number;
    /** Distinct `end` ids carrying an `error` — attempts that reclaimed nothing. */
    readonly failed: number;
    /** Sum of every stated shadowed-token count (a heuristic price, not a meter reading). */
    readonly reclaimedTokens: number;
    readonly lastSuccess?: CompactionSuccess;
    readonly lastError?: string;
}
/**
 * Fold records into a history.
 *
 * Counting rules, each chosen so the number means one thing:
 * - `summarized` counts distinct summary ids (a replayed record is the same compaction);
 * - `pruned` counts prune records, which have no id because a prune is not a transaction;
 * - `failed` counts distinct `end` ids that carry an error;
 * - `reclaimedTokens` sums only stated amounts — a missing field contributes nothing and is never
 *   read as `0`.
 */
export declare function foldCompactions(records: readonly CompactionRecord[]): CompactionHistory;
/**
 * The `/handoff status` compaction line.
 *
 * It rides next to the occupancy lines because the two are read together: a crossed threshold means
 * something different when the host already compacted twice and occupancy is *still* high. Nothing
 * here claims "occupancy after the last compaction" — that would need the meter snapshot from that
 * moment, which the log does not carry.
 */
export declare function compactionStatusLine(feed: CompactionFeed, language: HandoffLanguage): string;
