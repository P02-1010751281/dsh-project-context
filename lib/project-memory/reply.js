/**
 * The reply half of the consolidation pass: read one completion into the shape the write path wants,
 * measure what storing it would lose, and decide between a refusal and a targeted retry.
 *
 * Split out of `consolidate.ts` (RULES 3.2); the stateful pass and its prompt stay next door.
 */
import { firstUserText } from "../shared/conversation.js";
import { pickToolCall, requestPluginTextWithMeta, resolveTarget, } from "../shared/model-call.js";
import { parseConsolidation, parseContextMember, parseToolArguments } from "../shared/reply-json.js";
import { normalizeMemoryWithDrop } from "./document.js";
import { stripEntryTid } from "./retirement.js";
import { OPAQUE_DOCUMENT_MIN_CHARS, RECORD_MEMORY_TOOL, hasMemoryDocumentShape, isHeadingOnlyDocument, memorySectionOverage, normalizeMemoryEntry, partialSectionsFromMarkdown, sectionsFromMarkdown, sectionsFromToolCall, sectionsSemanticallyEmpty, } from "./sections.js";
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
export function memoryLoss(resolved, render, cap) {
    const sectionDropped = render?.sectionDropped ?? 0;
    const droppedItems = render?.droppedItems ?? 0;
    const itemTruncated = render?.itemTruncated ?? 0;
    const writeCapDroppedChars = render === undefined ? normalizeMemoryWithDrop(resolved.result.memory.trim(), cap).dropped : 0;
    const wholeEntriesLost = sectionDropped > 0 || droppedItems > 0 || writeCapDroppedChars > 0;
    return {
        sectionDropped,
        droppedItems,
        itemTruncated,
        writeCapDroppedChars,
        overage: resolved.sections === undefined ? [] : memorySectionOverage(resolved.sections, cap),
        retryWorthy: wholeEntriesLost || itemTruncated > 0,
        refuses: wholeEntriesLost,
    };
}
export function fallbackUpdate(session) {
    const text = firstUserText(session);
    // Return the raw value: the renderer normalizes and clips it to the summary section's budget,
    // and any clip is reported by the document's truncation marker instead of being hidden here.
    return {
        title: "Session recorded",
        summary: text || "Session recorded without a model summary.",
        key_points: [],
        open_tasks: [],
    };
}
/** Run one model call and collect its visible text. Throws on a failed or aborted stream. */
export async function requestConsolidationText(host, agent, config, prompt, signal, maxTokens, reasoningEffort, tools) {
    const target = resolveTarget(agent, config);
    if (!target)
        throw new Error("no provider/model available for the learn pass: route one request, set AgentOptions, or configure provider+model");
    return requestPluginTextWithMeta(host.llm, target, maxTokens, prompt, signal, {
        // The live session this pass was triggered for. The route may require it (opencode maps it to
        // `x-opencode-session` and answers 400 without it), and naming it is what makes the
        // checkpoint-policy half of `SessionWorkTracker`'s contract load-bearing for this pass.
        sessionId: agent.session.id,
        // Sent whenever the route declares an enabled level: naming none (or `off`, which the adapter
        // collapses into none) makes dsh write `thinking: { type: "disabled" }`, a spelling a gateway may
        // refuse. `auxiliaryReasoningEffort` carries the mechanism and the measured case.
        ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
        ...(tools === undefined ? {} : { tools }),
    });
}
/**
 * Read one reply into the shape this pass writes.
 *
 * The tool call is the preferred entry. When the model answers with text instead — because it chose
 * not to call the tool, or because the route dropped `tools` — the same sections are recovered from
 * the Markdown, so both entries render through one renderer and one set of budgets. `allowTools` is
 * false for the retry prompt, which deliberately carries no tool.
 */
export function resolveReply(completion, allowTools) {
    if (allowTools) {
        // Throws when the reply called some other tool and carried no text: there is nothing to fall
        // back to, and returning undefined would feed "" to the parser and read as a silent success.
        const argsText = pickToolCall(completion.toolCalls, RECORD_MEMORY_TOOL.name, completion.text);
        if (argsText !== undefined) {
            const parsed = parseToolArguments(argsText);
            const sections = parsed === undefined ? undefined : sectionsFromToolCall(parsed);
            if (parsed !== undefined && sections !== undefined) {
                // memory and context are validated apart: a broken context must not cost a good memory.
                const context = parseContextMember(parsed.context);
                const contextUnusable = context === undefined && parsed.context !== undefined && parsed.context !== null;
                return {
                    kind: "structured",
                    sections,
                    result: {
                        memory: "",
                        ...(context === undefined ? {} : { context }),
                        ...(contextUnusable ? { contextUnusable: true } : {}),
                    },
                };
            }
            // The expected tool was called with arguments this pass cannot read. With text to fall back
            // to the text path still applies; with nothing to parse it is an error, not an empty memory.
            if (completion.text.trim() === "")
                throw new Error(`the ${RECORD_MEMORY_TOOL.name} call carried unusable arguments and no text`);
        }
    }
    const parsed = parseConsolidation(completion.text);
    if (!parsed)
        return undefined;
    const sections = sectionsFromMarkdown(parsed.memory);
    if (sections)
        return { kind: "fallback-sections", sections, result: parsed };
    return { kind: "fallback-opaque", result: parsed };
}
/**
 * The stored-side half of the opaque gate: whether the store holds a document worth protecting.
 *
 * A canonical four-section parse is a document by definition. Anything else — a hand-written memory in
 * another shape, a legacy free-form memory — is judged by substance, because it is exactly as much to lose
 * as a canonical one; and a store below the floor (a fresh project) has nothing to protect, which is what
 * keeps a short reply's own "too short to be a change" report (`index.ts`) honest instead of turning it
 * into this refusal.
 */
export function storedIsDocument(text) {
    return (sectionsFromMarkdown(text) !== undefined ||
        text.replace(/^\s*#\s*Project Memory[ \t]*(?:\r?\n|$)/i, "").trim().length >= OPAQUE_DOCUMENT_MIN_CHARS);
}
/**
 * A conversational reply that would replace a real memory: not this extension's shape, long enough to be
 * a deliberate document, and aimed at a store that already holds one.
 */
export function isConversationalOpaque(reply, storedText) {
    return !hasMemoryDocumentShape(reply) && reply.trim().length >= OPAQUE_DOCUMENT_MIN_CHARS && storedIsDocument(storedText);
}
/** The refusal's own wording, chosen by which half could not be read (see `PartialRefusalReason`). */
export function partialRefusalMessage(reason) {
    if (reason === "store-not-sections") {
        return "the stored memory is not a plain four-section bullet document, so this partial reply could not be merged into it; the stored memory was kept unchanged";
    }
    return "the consolidation reply carried this extension's headings but not as plain `- ` entries, so it could not be merged into the stored memory; the stored memory was kept unchanged";
}
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
export function applyPartialGuard(reply, storedText) {
    if (reply.sections !== undefined)
        return reply;
    const memory = reply.result.memory;
    if (!hasMemoryDocumentShape(memory))
        return reply;
    if (!storedIsDocument(storedText))
        return reply;
    const stored = sectionsFromMarkdown(storedText);
    const partial = stored === undefined ? undefined : partialSectionsFromMarkdown(memory);
    if (stored === undefined)
        return { ...reply, kind: "unmergeable-partial", partialRefusal: "store-not-sections" };
    if (partial === undefined)
        return { ...reply, kind: "unmergeable-partial", partialRefusal: "reply-not-sections" };
    const merged = { ...stored };
    const carried = Object.keys(partial.sections);
    for (const key of carried) {
        if (!partial.missing.includes(key))
            merged[key] = partial.sections[key];
    }
    return { ...reply, kind: "merged-partial", sections: merged, mergedFromStore: partial.missing.map(String) };
}
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
export function removedSectionEntries(before, after) {
    // The id is bookkeeping, not content, so it must not decide whether an entry is the same one. Batch
    // Z2's stamping is all-or-nothing per document: a stored document can carry ids while the document
    // this pass would write does not (the id tax did not fit under the cap), and comparing the two
    // verbatim then reports every entry as gone. Measured on this project 2026-11-11T03:33Z, that was
    // "107 … no longer present" for a pair whose real difference was 11 rewritten entries (7 Invariants,
    // 4 Pitfalls): 96 of the 107 were byte-identical apart from their ids. The 11 are the signal; the ids
    // are not. The one form this cannot narrow is an id followed by a `supersedes:` declaration
    // (`（abcd）supersedes:2222`), which `stripEntryTid` deliberately leaves alone.
    const comparable = (entry) => normalizeMemoryEntry(stripEntryTid(entry));
    const gone = (key) => {
        const kept = new Set(after[key].map(comparable));
        return before[key].map(comparable).filter((entry) => entry !== "" && !kept.has(entry));
    };
    const removed = [...gone("invariants"), ...gone("pitfalls")];
    // Every entry here already went through `comparable`, so the samples are the fact text a human reads
    // in `errors.log` — never the id that `stripEntryTid` removed for the comparison above.
    return { count: removed.length, samples: removed.slice(0, 3) };
}
/** One bounded line of an entry, for a log line that points at the document rather than copying it. */
export function entrySamples(entries) {
    return entries.slice(0, 3).map(({ entry }) => (entry.length > 120 ? `${entry.slice(0, 120)}…` : entry));
}
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
export function replyIsSemanticallyEmpty(resolved, render, storedText) {
    if (resolved.sections === undefined) {
        return isHeadingOnlyDocument(resolved.result.memory) || isConversationalOpaque(resolved.result.memory, storedText);
    }
    return sectionsSemanticallyEmpty(resolved.sections) || (render !== undefined && isHeadingOnlyDocument(render.text));
}
