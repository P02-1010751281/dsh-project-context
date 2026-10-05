/**
 * The CONTEXT.md document's fixed top-level schema. The consolidation prompt and the renderer both
 * build the section list and the per-section character budgets from this one table, so the two
 * cannot drift. A context that does not follow it still loads (the stored file is injected as-is);
 * the schema is what the pass asks for, not a gate on what is stored.
 *
 * Ported from pi's `extensions/project-context/memory/context-schema.ts`.
 */
/** The canonical heading every rendered context document carries. */
export declare const CONTEXT_HEADER = "# Project Context\n\n";
/** Which `ContextUpdate` field feeds a section; also picks its prose/list rendering. */
export type ContextSectionEntry = "summary" | "key_points" | "open_tasks";
export type ContextSectionSpec = {
    /** The `##` heading the section carries. */
    heading: string;
    /** What belongs in the section, rendered next to its heading in the prompt. */
    description: string;
    /** Selects both the `ContextUpdate` field and the prose/list rendering. */
    entry: ContextSectionEntry;
    /** Share of the budgeted body this section should stay within; the shares sum to 1. */
    share: number;
    /** Optional hard per-section cap; the effective budget is the smaller of the share and this. */
    maxChars?: number;
};
/** Ordered top to bottom; the shares sum to 1 so the section budgets divide the body budget. */
export declare const CONTEXT_SECTIONS: readonly ContextSectionSpec[];
export type ContextSectionBudget = {
    heading: string;
    description: string;
    entry: ContextSectionEntry;
    chars: number;
};
/**
 * The `context` member of the `record_memory` tool, as a plain JSON Schema.
 *
 * Every property is required and `additionalProperties` is false so the schema passes a strict-mode
 * validator unchanged: an optional property would be wrapped into `anyOf: [<prop>, {type: "null"}]`
 * and forced back into `required`, which strict mode rejects.
 */
export declare const CONTEXT_TOOL_SCHEMA: {
    type: string;
    additionalProperties: boolean;
    required: string[];
    description: string;
    properties: {
        summary: {
            type: string;
            description: string;
        };
        title: {
            type: string;
            description: string;
        };
        key_points: {
            type: string;
            items: {
                type: string;
            };
            description: string;
        };
        open_tasks: {
            type: string;
            items: {
                type: string;
            };
            description: string;
        };
    };
};
/** One blank line (two characters) terminates each section body; the last one over-reserves a character. */
export declare const CONTEXT_SECTION_GAP_CHARS = 2;
/** `new Date().toISOString()` always renders this many characters. */
export declare const CONTEXT_TIMESTAMP_CHARS = 24;
/** Longest session title the trailing comment carries (`renderContextDocument` trims to this). */
export declare const CONTEXT_TITLE_CHARS = 160;
/** The line a truncated document ends with: a cut context must never look like a complete one. */
export declare function contextTruncationMarker(dropped: number): string;
/**
 * The dropped count a truncated document reports, or undefined when it is not marked. Only the
 * document's last non-empty line counts: the renderer appends its marker last, so a model-authored
 * line that merely looks like one inside a section is never mistaken for a real clip.
 */
export declare function contextTruncationDropped(text: string): number | undefined;
/** True when a context document reports that a section was clipped. */
export declare function isContextTruncated(text: string): boolean;
/**
 * Characters the fixed layout spends before any section body: the header, the `Last updated` line,
 * the three headings with their blank lines, the worst-case trailing comment, and room for the
 * truncation marker when one is appended. Shares of the whole cap would let a document that exactly
 * fills every budget overflow once the layout and the marker are added.
 */
export declare function contextSchemaOverheadChars(): number;
/** Per-section body budgets for a document cap, floored so they plus the overhead never exceed it. */
export declare function contextSectionBudgets(cap?: number): ContextSectionBudget[];
/**
 * The notice logged once per project when a rendered context had to be clipped. It names the three
 * clamps because the marker's count alone cannot say which of them fired.
 */
export declare function contextClipNotice(dropped: number): string;
