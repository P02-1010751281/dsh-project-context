/**
 * What the host's own compaction did to this session, folded read-only from its durable log.
 *
 * Compaction belongs to the host (`@deepseek-ai/dsh-compaction`): `compaction-basic` decides pressure,
 * summarizes, and replaces a span; this package must not take that service, follow `agent/pre-step`, or
 * rewrite a surface node. What is left for us is *evidence*: a compaction leaves durable
 * `compaction/start|summary|end` events (and the model-free `compaction-tool-result-pruner` leaves
 * `compaction/prune`), so `/handoff status` can say "this session already compacted twice and is still
 * above the knee" instead of leaving the user to infer it from a growing occupancy number.
 *
 * The event shapes are declared by `@deepseek-ai/dsh-compaction/types` through a module augmentation
 * this package deliberately does not depend on — adding it would pull the compaction service into a
 * plugin whose whole boundary is not touching it — so records are read structurally, the way
 * `project-context/session-index.ts` reads `session/title`. A `compaction/*` type we do not know is
 * reported as unavailable rather than counted as zero: a future host that adds one would otherwise
 * make every count quietly understate, and a wrong number is worse than a named gap.
 */
import { type HandoffLanguage } from "./language.js";
/** The last replacement the log states, in log order. */
export interface CompactionSuccess {
    /** The heuristic price of the shadowed span; absent when the record did not state one. */
    readonly shadowedTokens?: number;
    readonly provider?: string;
    readonly model?: string;
}
/** A readable compaction history. Every count is a distinct fact in the log, not an inference. */
export interface CompactionHistory {
    readonly available: true;
    /** Distinct `compaction/summary` ids: summarizations that wrote a replacement. */
    readonly summarized: number;
    /** `compaction/prune` events: model-free replacements of over-budget tool results. */
    readonly pruned: number;
    /** Distinct `compaction/end` ids carrying an `error` — attempts that reclaimed nothing. */
    readonly failed: number;
    /** Sum of every `shadowedTokenCount` the log states (a heuristic price, not a meter reading). */
    readonly reclaimedTokens: number;
    readonly lastSuccess?: CompactionSuccess;
    readonly lastError?: string;
}
/**
 * Either a folded history or a named reason it could not be folded.
 *
 * `unreadable` is "the event array itself was not an array" (a host-shape break); `malformed` is "a
 * `compaction/*` record whose payload cannot be trusted". Neither is `0`: the receipt must not report
 * "no compaction" for a log it failed to read.
 */
export type CompactionStats = CompactionHistory | {
    readonly available: false;
    readonly reason: "unreadable" | "malformed";
};
/**
 * Fold one session's durable events into a compaction history.
 *
 * Counting rules, each chosen so the number means one thing:
 * - `summarized` counts distinct `compaction/summary` ids (a replayed record is the same compaction);
 * - `pruned` counts `compaction/prune` events, which have no id because a prune is not a transaction;
 * - `failed` counts distinct `compaction/end` ids that carry an `error`;
 * - `reclaimedTokens` sums only stated `shadowedTokenCount`s — a missing field contributes nothing and
 *   is never read as `0`.
 */
export declare function compactionStats(events: readonly unknown[] | undefined): CompactionStats;
/**
 * The `/handoff status` compaction line.
 *
 * It rides next to the occupancy lines because the two are read together: a crossed threshold means
 * something different when the host already compacted twice and occupancy is *still* high. Nothing here
 * claims "occupancy after the last compaction" — that would need the meter snapshot from that moment,
 * which the log does not carry.
 */
export declare function compactionStatusLine(stats: CompactionStats, language: HandoffLanguage): string;
