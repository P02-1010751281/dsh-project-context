/**
 * The reply half of the consolidation pass: read one completion into the shape the write path wants,
 * measure what storing it would lose, and decide between a refusal and a targeted retry.
 *
 * Split out of `consolidate.ts` (RULES 3.2); the stateful pass and its prompt stay next door.
 */
import type { Agent, HostPorts, Session } from "../host/contract.js";
import type { PluginConfig } from "../shared/config.js";
import { type CompletionOutcome, type PluginTool } from "../shared/model-call.js";
import { type ContextUpdate } from "../shared/reply-json.js";
import type { PartialRefusalReason, ResolvedReply } from "./consolidate-types.js";
import type { RestoredEntry } from "./lost-entry-repair.js";
import { type MemoryRender, type MemorySectionOverage, type MemorySections } from "./sections.js";
/** What storing this reply right now would lose. */
export type ReplyLoss = {
    sectionDropped: number;
    droppedItems: number;
    itemTruncated: number;
    writeCapDroppedChars: number;
    overage: MemorySectionOverage[];
    /** Something would be lost, so a targeted retry is worth one call. */
    retryWorthy: boolean;
    /** A whole entry (or the write cap) would be lost: that is what tier C refuses to store. */
    refuses: boolean;
};
/**
 * Measure one resolved reply against the cap it would be stored under.
 *
 * A section render reports its own drops; an opaque reply never reaches the renderer, so the write cap
 * is the only place its loss exists — measuring it here is what lets that loss share the one retry
 * instead of only being logged after the fact.
 *
 * The refusal is deliberately narrower than the retry: an entry cut to the per-item cap may be fixed by
 * rewording, but a legitimate entry longer than that cap has no legal form inside it, so refusing on
 * truncation alone would refuse the project forever.
 */
export declare function memoryLoss(resolved: ResolvedReply, render: MemoryRender | undefined, cap: number): ReplyLoss;
export declare function fallbackUpdate(session: Session): ContextUpdate;
/** Run one model call and collect its visible text. Throws on a failed or aborted stream. */
export declare function requestConsolidationText(host: HostPorts, agent: Agent, config: PluginConfig, prompt: string, signal: AbortSignal | undefined, maxTokens: number, reasoningEffort: string | undefined, tools: readonly PluginTool[] | undefined): Promise<CompletionOutcome>;
/**
 * Read one reply into the shape this pass writes.
 *
 * The tool call is the preferred entry. When the model answers with text instead — because it chose
 * not to call the tool, or because the route dropped `tools` — the same sections are recovered from
 * the Markdown, so both entries render through one renderer and one set of budgets. `allowTools` is
 * false for the retry prompt, which deliberately carries no tool.
 */
export declare function resolveReply(completion: CompletionOutcome, allowTools: boolean): ResolvedReply | undefined;
/**
 * The stored-side half of the opaque gate: whether the store holds a document worth protecting.
 *
 * A canonical four-section parse is a document by definition. Anything else — a hand-written memory in
 * another shape, a legacy free-form memory — is judged by substance, because it is exactly as much to lose
 * as a canonical one; and a store below the floor (a fresh project) has nothing to protect, which is what
 * keeps a short reply's own "too short to be a change" report (`index.ts`) honest instead of turning it
 * into this refusal.
 */
export declare function storedIsDocument(text: string): boolean;
/**
 * A conversational reply that would replace a real memory: not this extension's shape, long enough to be
 * a deliberate document, and aimed at a store that already holds one.
 */
export declare function isConversationalOpaque(reply: string, storedText: string): boolean;
/** The refusal's own wording, chosen by which half could not be read (see `PartialRefusalReason`). */
export declare function partialRefusalMessage(reason: PartialRefusalReason | undefined): string;
/**
 * Batch Q2's acceptance guard: a reply that carries our shape but is not a complete document must not
 * replace the store (that was a silent whole-store loss — `sectionsFromMarkdown` needs all four sections,
 * so a partial reply used to land as opaque text, verbatim).
 *
 * Three outcomes, in this order, and the order is the design:
 *
 *  - **merge** — the store parses into sections and the reply reads into sections: the sections the reply
 *    carries win, the ones it omits stay exactly as the store had them, and the merge is rendered like any
 *    other sectioned reply. Nothing is lost by omission, so nothing has to be refused.
 *  - **refuse** — the reply has our shape but cannot be read into sections (prose inside a section, an
 *    unknown heading, `*`/indented entries), or the store itself is not a four-section document. Then the
 *    reply would replace content this pass cannot account for, so it is refused loudly and the store stays
 *    byte-identical. Conservative on purpose: `sectionsFromMarkdown`'s contract is "anything this cannot
 *    read with certainty is preserved", and the only way to preserve it here is not to write.
 *  - **leave alone** — a conversational reply, or a store with nothing to protect (a fresh project): both
 *    keep the behaviour they had, the gate in `replyIsSemanticallyEmpty` and the verbatim write included.
 */
export declare function applyPartialGuard(reply: ResolvedReply, storedText: string): ResolvedReply;
/**
 * Entries the new memory no longer carries — pi's regression guard (`pass.ts:123-133`), kept in shape
 * but not verbatim: batch Z8d compares the entries after stripping this project's entry id, which pi
 * does not have.
 *
 * `Project` and `Index` are deliberately excluded: they are meant to be rewritten every pass, and
 * reporting them would bury the signal. This cannot judge whether a removal was *right* — only that it
 * happened — so it reports and never blocks: refusing here would turn every compression into a permanent
 * refusal, and the consolidation prompt asks for compression.
 */
export declare function removedSectionEntries(before: MemorySections, after: MemorySections): {
    count: number;
    samples: string[];
};
/** One bounded line of an entry, for a log line that points at the document rather than copying it. */
export declare function entrySamples(entries: readonly RestoredEntry[]): string[];
/**
 * True when a resolved reply carries nothing worth storing.
 *
 * The opaque entry has no sections, so its half of the gate is "is this a document at all", in two steps:
 * a body-less reply is refused outright, and any other opaque reply must carry this extension's own shape
 * whenever the store holds a document. That second step closes the silent whole-document replacement:
 * `isHeadingOnlyDocument` is one-sided by design and calls any wrapper holding real words content, so
 * `# Project Memory\n\nI'll review the frozen revision …` used to replace the stored memory. Refusing it
 * costs a legitimately written but unparseable reply — the stored memory is kept and a diagnostic is
 * logged — which is the trade the shape gate accepted over a silent replacement.
 *
 * The sectioned entries are judged on the document the renderer would actually store, not only on the
 * section arrays: an entry that is itself a heading (`"## Project"`) contains letters, so the array-level
 * check passes, but it renders to a structural line — the very bytes the opaque half refuses. Judging both
 * keeps the two halves agreeing on the same document; a real entry (`- p1`, `- #1 rule must hold`,
 * `- a durable fact`) is content in both, so nothing genuine is refused.
 */
export declare function replyIsSemanticallyEmpty(resolved: ResolvedReply, render: MemoryRender | undefined, storedText: string): boolean;
