/**
 * The memory document as sections: code owns the headings, their order and their budgets; the model
 * only supplies the entries of each section.
 *
 * Free-form memories are a separate, unchanged path. This module is what the structured and the
 * parseable-fallback entries share, so both render through one renderer and one set of per-section
 * budgets: the old whole-document 60/40 clip dropped the middle of the document, which is exactly
 * where this project keeps its durable operating lessons.
 *
 * Ported from pi's `extensions/project-context/memory/sections.ts`.
 */
import { type PluginTool } from "../shared/model-call.js";
/** The four fixed sections, in document order; each holds one self-contained entry per bullet. */
export type MemorySections = {
    project: string[];
    invariants: string[];
    pitfalls: string[];
    index: string[];
};
/**
 * One entry, in the shape the renderer can place on a single bullet: whitespace runs collapsed (so an
 * embedded newline cannot forge a heading), no bullet prefix, no surrounding space.
 *
 * Only `- ` (dash plus whitespace) is treated as a prefix: an entry that legitimately starts with a
 * minus sign, like a negative threshold, must keep it.
 */
export declare function normalizeMemoryEntry(value: string): string;
/**
 * True when an entry carries nothing a reader could use.
 *
 * The schema is `items: {type: "string"}` and strict mode adds no `minLength`, so a non-empty array
 * says nothing about content: `[""]`, `[" "]`, and zero-width characters all arrive as "non-empty".
 * "All four sections are empty" has to be judged here, on the normalized view, or a reply with no
 * facts at all would count as a change and overwrite the stored memory with a bare skeleton.
 */
export declare function isMemoryEntryEmpty(value: string): boolean;
/** True when no section has a single entry worth storing. */
export declare function sectionsSemanticallyEmpty(sections: MemorySections): boolean;
/** What a render cost: the document plus what the document's cap had to give up. */
export type MemoryRender = {
    text: string;
    /** Sections that lost at least one entry. */
    sectionDropped: number;
    /** Entries dropped because the document's cap was full, not because a section was over its share. */
    droppedItems: number;
    /** Entries clipped to their section's per-item cap. */
    itemTruncated: number;
};
/**
 * Render the sections into the stored document, keeping the whole document within `cap`.
 *
 * The allocation runs before the packing because what a section may spend decides its per-item cap:
 * every entry is cut to that cap with the line-boundary clipper (never a raw `slice`, which can split a
 * surrogate pair), and an entry that still does not fit is dropped whole rather than halved. A section
 * is only ever over its own target because another section left room, so a drop means the document cap
 * itself is full. Because a single entry always fits an empty section, `text.length <= cap` holds by
 * construction.
 *
 * The demand the allocation is fed is an upper bound, not the packed cost: entries are measured at
 * `MAX_LIST_ITEM_CHARS` before the section knows its item cap. That can still drop an entry a
 * tighter fixed point would have kept when a section is lent less than the item cap and holds
 * several long entries; the boundary is recorded rather than closed, because the alternative —
 * iterating the allocation against the item cap — is a different design, not a one-line correction.
 *
 * The renderer writes no truncation marker: the stored marker is stripped again by the write path, so
 * the drop is reported through the returned counts instead.
 */
export declare function renderMemoryDocument(sections: MemorySections, cap: number): MemoryRender;
/**
 * What one section would give up if it were rendered now, in the renderer's own units.
 *
 * The tier-C retry prompt names sections and numbers and never content, so those numbers have to come
 * from the rule that actually stores the document. A second, drifting estimate would ask the model to
 * fix the wrong amount — worse than not retrying at all.
 */
export type MemorySectionOverage = {
    heading: string;
    /** What the renderer lets this section spend after lending and borrowing, in characters. */
    budget: number;
    /** The per-item cap this section's entries were clipped to. */
    itemCap: number;
    /** Characters the entries need beyond what the section may spend, after each is clipped to the per-item cap. */
    over: number;
    /** Entries the renderer would drop whole at this size. */
    droppedEntries: number;
    /** Entries the renderer would cut to the per-item cap and keep. */
    truncatedEntries: number;
};
/**
 * What each section would lose if it were rendered now, computed with `renderMemoryDocument`'s exact
 * arithmetic: the same allocation, the same per-item cap, the same `- ` overhead, the same whole-entry
 * drop. The allocation is what makes a section's `budget` its post-borrow allowance rather than its
 * share: once a pool exists a section over its share only loses entries when the document is full, and a
 * retry prompt that named the share would ask the model to cut the wrong amount.
 *
 * Only sections that would actually lose something are returned, so an empty result means every
 * section fits. A section whose only problem is an over-long entry comes back with `over: 0` and a
 * non-zero `truncatedEntries`: it needs rewording, not merging.
 */
export declare function memorySectionOverage(sections: MemorySections, cap: number): MemorySectionOverage[];
/** A fence line as CommonMark reads it: a run of three or more backticks or tildes plus whatever follows. */
export type FenceToken = {
    char: string;
    run: string;
    info: string;
};
/** The fence line in `value`, or `undefined` when the line is not a fence line at all. */
export declare function readFenceLine(value: string): FenceToken | undefined;
/**
 * Whether `token` closes a block opened by `open`: the same character, at least as long, and nothing but
 * whitespace after the run — an info string makes a line an opener, not a closer.
 *
 * Both readers of fences (the heading-only gate and the document-shape gate) share this, so neither can
 * mirror only half the rule. dsh had this rule inlined in the heading-only gate once; a second hand-rolled
 * reader in the shape gate is exactly the kind of near-copy that drifts.
 */
export declare function fenceCloses(token: FenceToken, open: FenceToken): boolean;
/**
 * True when a document carries no usable content at all.
 *
 * The opaque entry has no sections to judge, so this is its half of the semantic gate: a reply with
 * nothing but headings, fences and separators is a reply that lost its body (or never had one), and
 * writing it would replace a stored memory with a skeleton. A prose memory has content lines, so it
 * is unaffected — which is what keeps the opaque path's existing behaviour for real memories.
 *
 * Separators are normalized FIRST: the structural matchers are `$`-anchored, so a reply joined with
 * `\r`, `\u2028` or `\u2029` would otherwise let one fence line swallow everything after it.
 *
 * Stripping is deliberately generous. A fence family (backticks and `~~~`, with any info string), a
 * thematic break / frontmatter delimiter, an HTML comment, a line that is markup and nothing else, an
 * HTML heading, a `===` setext underline (plus the text line it underlines), and the truncation marker
 * are all structural, so a skeleton wrapped in one still reads as a skeleton. Each remaining line is
 * then read as its text — decoration (blockquote, bullet, ordered marker) and Unicode `Cf` characters
 * removed — and counts as content when it is not an ATX heading and holds a letter or a digit. Because
 * decoration is dropped first, `- # 1 rule must hold` is judged on `# 1 rule must hold`, i.e. as a
 * heading: a memory whose body is only such bullets is refused.
 *
 * The gate is a heuristic and it is deliberately one-sided: any wrapper that holds real words — a
 * prose preamble, an element with text inside, a `---` setext heading — is content, because this
 * function's only other answer would be "refuse a memory the model did write". It is therefore not the
 * last word on what may replace a stored memory: `hasMemoryDocumentShape` is the gate the opaque path
 * actually reads, and it refuses such a wrapper outright whenever the store already holds a document.
 * Markup alone is still refused here: a lone `<T>` and an `<hN>…</hN>` pair are both structural
 * (`isTagOnlyLine` / `HTML_HEADING_LINE_RE`), so the fail-open covers wrappers carrying words, not
 * empty tags.
 *
 * This is also looser than the `sectionsFromMarkdown` contract: there, anything unusual means "fall
 * back to the verbatim path"; here, anything unusual must still count as content.
 */
export declare function isHeadingOnlyDocument(value: string): boolean;
/**
 * The substance floor shared by both sides of the opaque gate: a stored memory shorter than this (once
 * its title is stripped) is a fresh project with nothing worth protecting, and a reply shorter than this
 * is not a change worth storing. `index.ts` reads the same constant for its write floor, so the number
 * that decides "too small to be a memory" is written down once.
 */
export declare const OPAQUE_DOCUMENT_MIN_CHARS = 40;
/**
 * Whether `value` carries this extension's own document shape: at least one known `## <section>` heading
 * at column 0 with at least one `- ` entry at column 0 under it, outside fenced blocks.
 *
 * This is the gate the opaque path reads before it lets a reply replace a stored memory. The defect it
 * closes: `isHeadingOnlyDocument` is one-sided and calls any wrapper holding real words content, so a
 * conversational reply carrying the canonical title (`# Project Memory\n\nI'll review the frozen
 * revision …`) replaced the whole stored memory, silently. The acceptance rule is this module's vocabulary
 * and nothing wider: a subset of the four sections is a legitimate partial document (`## Project\n- x`),
 * while another heading level, a setext or HTML heading, `*`, numbered or indented entries, prose and a
 * heading with no entry are not the shape this extension writes, so a reply carrying them never enters
 * the store — the memory is kept and a diagnostic is logged.
 *
 * Hand-rolling a wider markdown subset here (any heading, bullet or fence anywhere) was pi's round 18-21
 * review detour: four rounds, each finding another fail-open, and its only gain was accepting reply shapes
 * this extension never writes. So the gate is the schema itself. Line endings are normalized first, like
 * every other anchored reader in this module.
 */
export declare function hasMemoryDocumentShape(value: string): boolean;
/**
 * Read a stored memory document back into sections, or `undefined` when it is not a plain
 * four-section bullet document.
 *
 * Conservative on purpose: anything this cannot read with certainty goes back to the opaque path,
 * which preserves it verbatim. Guessing here would mean silently dropping content.
 */
export declare function sectionsFromMarkdown(value: string): MemorySections | undefined;
/**
 * Read the `memory` member of a `record_memory` tool call.
 *
 * Shape only: an unexpected field type means the caller falls back to the text path. `context` is
 * deliberately not touched here — a broken context must not cost a good memory.
 */
export declare function sectionsFromToolCall(value: unknown): MemorySections | undefined;
/**
 * The consolidation tool. Strict-ready: every property is required, `additionalProperties` is false,
 * no `anyOf`, and no `maxLength` / `maxItems` (the cap is enforced in code — `maxItems` is rejected by
 * Anthropic's strict mode, which would silently downgrade the route to non-strict).
 */
export declare const RECORD_MEMORY_TOOL: PluginTool;
