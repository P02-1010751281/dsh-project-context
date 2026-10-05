/**
 * The consolidation pass (②): one throttled, single-flight model call per project producing
 * durable memory and a session-context update. It lived in `shared/llm.ts` only because the
 * autolearn pass reuses the model plumbing from there; the pass itself belongs to the memory
 * plugin, and the plumbing it shares now sits in `shared/model-call.ts`.
 */
import { type Context } from "@deepseek-ai/cordis";
import { type Agent } from "@deepseek-ai/dsh-agent";
import { type Session } from "@deepseek-ai/dsh-session";
import { type PluginConfig } from "../shared/config.js";
import { type ConsolidationResult, type ContextUpdate } from "../shared/reply-json.js";
import { type MemorySectionOverage } from "./sections.js";
/** Which entry produced the memory this pass would write. */
export type ConsolidateKind = "structured" | "fallback-sections" | "fallback-opaque";
/** A consolidation result plus a monotonic version so each plugin writes a given pass at most once. */
export type ConsolidationOutcome = {
    result: ConsolidationResult;
    version: number;
    /**
     * True when the pass's view of a stored artifact was shortened — by the read cap that produced
     * `existing`, or by the output fit that produced `usedInput`. Both are pass-level facts, so this
     * is what the two diagnostic lines report; the receipt's own status is derived from the landed
     * counts instead, because a shortening can belong to an artifact that never landed.
     */
    clipped: boolean;
    /**
     * Characters of the stored memory the model was not shown: what the read cap kept back plus what
     * the input fit clipped. 0 only when the stored memory reached the model whole.
     */
    memoryHiddenChars: number;
    /**
     * Characters of the stored context the model was not shown: what the read cap kept back plus what
     * the input fit clipped. 0 only when the stored context reached the model whole.
     */
    contextHiddenChars: number;
    /**
     * The memory this pass's prompt was built from, byte for byte. The write path refuses a reply
     * whose baseline no longer matches what is stored: publishing it would overwrite a newer edit.
     */
    basisKey: string;
    /**
     * Which entry the memory came from. Reported for diagnostics and tests; no receipt reads it yet,
     * so a pass is never worded differently because of it.
     */
    kind: ConsolidateKind;
    /** No section held an entry worth storing, so the memory must not be written at all. */
    semanticEmpty: boolean;
    /** Sections that lost at least one entry to their budget. */
    sectionDropped: number;
    /** Entries dropped because their section's budget was full. */
    droppedItems: number;
    /** Entries clipped to their section's per-item cap. */
    itemTruncated: number;
    /**
     * Characters of this reply the memory cap would drop on write, measured here rather than at the
     * write so the loss can be retried and refused like any other. The write path measures the landed
     * value separately; this one describes the reply tier C decided about.
     */
    memoryWriteCapDroppedChars: number;
    /**
     * True when tier C refused this reply: it would have been stored lossily and the one targeted
     * retry did not fix it, so the write must not happen and the stored memory stays effective.
     */
    memoryLossyRefused: boolean;
    /**
     * The `maxMemoryChars` this outcome was measured under.
     *
     * A cached outcome is re-reported as it stands — the throttled path serves it without re-running —
     * so a caller that names "the cap" must read this, not the config in force at report time, or it
     * names a cap that never measured the loss it is describing.
     */
    maxMemoryChars: number;
};
export interface ConsolidationOptions {
    force?: boolean;
    signal?: AbortSignal;
}
/**
 * The cross-project boundary, stated as a rule.
 *
 * The pass hands the model the whole session conversation and asks it to regenerate the documents
 * from that, so a session that quotes a sibling repository's state (its sizes, counts, research
 * values) writes it into this project's memory — hand-cleaning does not hold, because the next pass
 * writes it again. Naming another project stays legal for recording who owns an open item: this repo
 * keeps exactly those pointers on purpose.
 */
export declare const FOREIGN_STATE_RULE = "Write only durable facts about this project itself. Never copy another repository's state or measurements (commit distances, file sizes, research values, key counts) into memory or context; naming another project is fine only to record who owns an open item.";
/**
 * The same boundary where the foreign text actually enters: the first line inside
 * `<recent-conversation>`, which is the block built from the session's own transcript.
 */
export declare const CONVERSATION_CAPTION = "[This session's working state. It may quote other projects and their numbers; those are not memory material \u2014 write only durable facts about this project.]";
/**
 * The fixed instructions of the consolidation prompt. Exported so a test can assert the shape
 * contract the model is actually given: naming the `context` keys without their types is what let
 * a mis-shaped reply hollow out CONTEXT.md silently.
 */
export declare const CONSOLIDATION_PROMPT_RULES: readonly string[];
/**
 * The memory layout the pass actually writes, stated with the real per-section budgets.
 *
 * The stored memory carries these exact sections in this order, and `renderMemoryDocument` enforces
 * each section's share of the cap by dropping whole entries. The cap is per project, so the section
 * budgets have to be built per pass instead of sitting in the static rules — and like
 * `memoryBudgetRule`, every number here is in characters.
 */
export declare function memorySectionRule(maxMemoryChars: number): string;
/**
 * The memory bound the pass actually enforces, stated with the real numbers.
 *
 * A word hint is not the enforced bound: the document is cut at `maxMemoryChars` **characters** on
 * write, so a reply that satisfies a word count can still lose whatever sat at the end — and the
 * model had no way to know. The cap is per project, so the line has to be built per pass.
 */
export declare function memoryBudgetRule(maxMemoryChars: number, currentChars: number): string;
/**
 * The targeted retry a complete-but-lossy reply is allowed (tier C).
 *
 * The reply was usable and the model simply over-filled a section, which a second, specific
 * instruction can fix — that is the whole difference between tier C and tier B. The rule names
 * sections and counts only: the previous reply is not an input to it, so it can neither leak a
 * section's text into the prompt nor invite a rewrite from memory.
 *
 * @param overage - what each section would give up, from `memorySectionOverage`.
 * @param writeCapDroppedChars - characters the memory cap would drop from the reply, 0 when it fits.
 */
export declare function memoryLossRetryRule(overage: readonly MemorySectionOverage[], writeCapDroppedChars: number): string;
export declare function fallbackUpdate(session: Session): ContextUpdate;
/**
 * Run the consolidation pass (durable memory + session context).
 * Callers own persisting their artifact; results are cached per project so the memory and
 * session-context plugins can consume the same pass without a second model call.
 */
export declare function consolidateProjectState(ctx: Context, agent: Agent, config: PluginConfig, options?: ConsolidationOptions): Promise<ConsolidationOutcome | undefined>;
