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
    /** Share of the budgeted body this section is expected to take; the shares sum to 1. */
    share: number;
};
/**
 * Ordered top to bottom; the shares sum to 1 so the section budgets divide the body budget.
 *
 * The shares track where a project's memory actually accumulates, and the four-section port's first
 * split (0.2 / 0.4 / 0.25 / 0.15) did not: on this repo's own memory it left Invariants and Pitfalls
 * at 96–97% of their budget while Index sat at 48%. Because the renderer refuses a reply that would
 * drop a whole entry, a section written to its budget consumes exactly the room the next pass needs,
 * so consolidation became a coin flip (three passes, one write). Rebalanced 2026-10-05 to
 * `0.17 / 0.45 / 0.29 / 0.09`, which gives all four sections comparable headroom over the document
 * they hold; `memorySectionPromptBudgets` is what stops a reply from spending it.
 *
 * A share is a target, not a cap (2026-10-10, pi `e2184af`): the renderer pools what an under-target
 * section leaves and lends it to the over-target ones, so a section only ever loses entries when the
 * whole document reaches `maxMemoryChars`. The numbers here are still what the prompt shows and what
 * the pool is measured against; they stopped being a per-section refusal.
 */
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
/**
 * What the rendered document spends outside the section bodies, exactly: the header, each heading with
 * its newline, and the blank line between neighbouring sections.
 *
 * `memorySchemaOverheadChars` is deliberately more generous than this (it reserves a blank line after
 * every section rather than between them), because the per-section targets are shares of the remainder
 * and under-reserving there would let a document that fills every target exceed the cap. The renderer's
 * pool has to use this exact figure instead: charging the pool a structurally unused gap spends
 * characters as dropped entries that the document had room for.
 */
export declare function memoryStructureOverheadChars(): number;
/** Per-section body budgets for a document cap, floored so they plus the overhead never exceed it. */
export declare function memorySectionBudgets(cap: number): MemorySectionBudget[];
/**
 * Fraction of a section's share the prompt asks the model to aim for.
 *
 * The share is where the document's budget is expected to go, not a limit the renderer refuses past:
 * the model cannot count characters, and a reply that spends every share to its brim leaves the next
 * pass no room, which is how this project's memory locked itself. The margin — applied to
 * `memorySectionBudgets` rather than restated as a second set of numbers — leaves the reply room for
 * that estimation error.
 */
export declare const MEMORY_SECTION_PROMPT_SHARE = 0.9;
/** The per-section figure the prompt asks for: inside the hard budget, from the one table. */
export declare function memorySectionPromptBudgets(cap: number): MemorySectionBudget[];
