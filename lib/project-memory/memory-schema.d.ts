/**
 * The memory document's fixed top-level schema. A memory that follows it can be budgeted per
 * section; the consolidation prompt builds its structure and per-section character budgets from
 * this one table instead of restating them in prose. Free-form memories still load and render —
 * the schema is what the pass asks for, not a gate on what is stored.
 *
 * Ported from pi's `extensions/project-context/memory/schema.ts`.
 */
export type MemorySectionSpec = {
    /** The `##` heading the section carries. */
    heading: string;
    /** What belongs in the section, rendered next to its heading in the prompt. */
    description: string;
    /** Share of the budgeted body this section should stay within; the shares sum to 1. */
    share: number;
};
/** Ordered top to bottom; the shares sum to 1 so the section budgets divide the body budget. */
export declare const MEMORY_SECTIONS: readonly MemorySectionSpec[];
export type MemorySectionBudget = {
    heading: string;
    description: string;
    chars: number;
};
/** One blank line (two characters) terminates each section body; the last one over-reserves a character. */
export declare const MEMORY_SECTION_GAP_CHARS = 2;
/**
 * Characters the document header, the fixed section headings, and the blank lines around the section
 * bodies spend before any body text. The per-section budgets are shares of the remainder: shares of
 * the whole cap would let a document that exactly fills every budget exceed the cap once the header,
 * headings, and separating blank lines are added.
 */
export declare function memorySchemaOverheadChars(): number;
/** Per-section body budgets for a document cap, floored so they plus the overhead never exceed it. */
export declare function memorySectionBudgets(cap: number): MemorySectionBudget[];
