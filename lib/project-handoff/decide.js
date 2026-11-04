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
import { DEFAULT_CONFIG } from "../shared/config.js";
import {} from "./measure.js";
import { MIN_DROP_TOKENS } from "./threshold.js";
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
export function decideAutoHandoff(inputs, config = DEFAULT_CONFIG) {
    const { measurement, threshold } = inputs;
    // A keyless literal on purpose: a caller comparing decisions structurally (a test, or a report that
    // diffs two passes) must not see a field that exists only to be empty.
    if (threshold === undefined)
        return { kind: "unmeasurable" };
    if (measurement.totalTokens < threshold.tokens) {
        return { kind: "below-threshold", tokens: measurement.totalTokens, threshold: threshold.tokens };
    }
    // dsh has no editor draft mode, so by default an open question defers the handoff instead of being
    // answered by the continuation (pi's `wait`); `handoffPendingQuestion: "wait"` opts into carrying it.
    if (config.handoffPendingQuestion === "defer" && inputs.pendingQuestion !== undefined) {
        return { kind: "defer", reason: "question" };
    }
    // A running continuable subagent will wake this session again when it settles, so handing off now
    // would leave two sessions working the same project.
    if (inputs.pendingSubagents.length > 0)
        return { kind: "defer", reason: "subagents" };
    // Nothing worth dropping: the conversation fits the recent window.
    if (inputs.olderTokens < MIN_DROP_TOKENS)
        return { kind: "skip", reason: "nothing-to-drop" };
    return { kind: "handoff", measurement, threshold, olderTokens: inputs.olderTokens };
}
