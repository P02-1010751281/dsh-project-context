/**
 * The automatic trigger's decision, as a pure function.
 *
 * It exists to keep two things apart (`docs/batch-w-decision-seam-spec.md`): *what the decision
 * needs* and *how a host supplies it*. This file takes plain data — no `Session`, no `Context`, no
 * `await` — so the same chain can run on a host whose trigger event and capability reads differ, and
 * so the chain is testable without a session fixture.
 *
 * The order below **is** the semantics, not an implementation convenience. The threshold is compared
 * first because a session that has not crossed it has nothing to defer *from* — an open question below
 * the threshold is not a deferral, it is a session that is simply not handing off. The two guards come
 * after it, and the drop minimum last, because "there is nothing worth dropping" is only a fact once
 * the guards have let the attempt through.
 */
import { type PluginConfig } from "../shared/config.js";
import { type MeasuredContext } from "./measure.js";
/**
 * The measurement's threshold, structurally. `threshold.ts`'s `resolveThreshold` returns this shape
 * plus an optional `override`, so a caller may pass its result unchanged.
 */
interface ThresholdTerms {
    /** The occupancy at which a handoff is attempted. */
    readonly tokens: number;
    /** The human-readable name of the term that set it (rendered in the receipt and the pressure line). */
    readonly label: string;
}
/**
 * Everything the decision reads, already resolved by the host adapter.
 *
 * `measurement` is passed whole rather than as a single number on purpose: `envelopeSource` records
 * which read supplied `overheadTokens`, and `contextBreakdown` is a characters-div-4 heuristic. A bare
 * `totalTokens` would let two measurement bases be compared as if they were one quantity — the
 * cross-base subtraction this repo already paid for once.
 */
export interface GateInputs {
    /** Meter occupancy plus the envelope the harness reported, if any. */
    readonly measurement: MeasuredContext;
    /** The routed window the threshold was computed against; carried for the caller's assertions. */
    readonly contextWindow: number;
    /** The resolved threshold, or `undefined` when a guardrail refused to produce one. */
    readonly threshold: ThresholdTerms | undefined;
    /** The model's newest unanswered question, or `undefined` when nothing is open. */
    readonly pendingQuestion: string | undefined;
    /** Continuable child sessions still running; a non-empty list holds the handoff. */
    readonly pendingSubagents: readonly string[];
    /** `handoffSplit`'s older span in tokens — the material a handoff would actually drop. */
    readonly olderTokens: number;
}
/**
 * The outcome, with every exit named.
 *
 * `unmeasurable` is "this session has no resolvable trigger", which covers both a session the host
 * could not measure and one whose threshold a guardrail refused. They share one kind because the
 * caller does the same thing in both cases — nothing — and the cause is not carried through: the
 * `/handoff status` receipt derives it from the same measurement with `thresholdRefusal`, so a second
 * copy here would be a field with no reader.
 */
export type Decision = {
    readonly kind: "handoff";
    readonly measurement: MeasuredContext;
    readonly threshold: ThresholdTerms;
    readonly olderTokens: number;
} | {
    readonly kind: "defer";
    readonly reason: "question" | "subagents";
} | {
    readonly kind: "skip";
    readonly reason: "nothing-to-drop";
} | {
    readonly kind: "below-threshold";
    readonly tokens: number;
    readonly threshold: number;
} | {
    readonly kind: "unmeasurable";
};
/**
 * Decide whether this session hands off now.
 *
 * `config` defaults to the shipped defaults, which is what makes a single-argument call meaningful for
 * a caller that only wants the chain (a test, or a host with no settings layer): the only setting the
 * chain reads is whether an open question defers.
 * @param inputs - the resolved decision inputs.
 * @param config - effective plugin config.
 * @returns the decision; never `undefined`, so a caller cannot mistake "no decision" for an outcome.
 */
export declare function decideAutoHandoff(inputs: GateInputs, config?: PluginConfig): Decision;
export {};
