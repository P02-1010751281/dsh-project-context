/**
 * The memory document's fixed top-level schema. A memory that follows it can be budgeted per
 * section; the consolidation prompt builds its structure and per-section character budgets from
 * this one table instead of restating them in prose. Free-form memories still load and render —
 * the schema is what the pass asks for, not a gate on what is stored.
 *
 * Ported from pi's `extensions/project-context/memory/schema.ts`.
 */
import { MEMORY_HEADER } from "./document.js";
/** Ordered top to bottom; the shares sum to 1 so the section budgets divide the body budget. */
export const MEMORY_SECTIONS = [
    { heading: "Project", description: "purpose, stack, structure", share: 0.2 },
    { heading: "Invariants", description: "standing decisions, conventions, hard constraints, user preferences", share: 0.4 },
    { heading: "Pitfalls", description: "operational traps and the lessons behind them", share: 0.25 },
    { heading: "Index", description: "pointers to docs, source files, and commands", share: 0.15 },
];
/** One blank line (two characters) terminates each section body; the last one over-reserves a character. */
export const MEMORY_SECTION_GAP_CHARS = 2;
/**
 * Characters the document header, the fixed section headings, and the blank lines around the section
 * bodies spend before any body text. The per-section budgets are shares of the remainder: shares of
 * the whole cap would let a document that exactly fills every budget exceed the cap once the header,
 * headings, and separating blank lines are added.
 */
export function memorySchemaOverheadChars() {
    return MEMORY_HEADER.length + MEMORY_SECTIONS.reduce((sum, section) => sum + `## ${section.heading}\n\n`.length + MEMORY_SECTION_GAP_CHARS, 0);
}
/** Per-section body budgets for a document cap, floored so they plus the overhead never exceed it. */
export function memorySectionBudgets(cap) {
    const body = Math.max(0, cap - memorySchemaOverheadChars());
    return MEMORY_SECTIONS.map(({ heading, description, share }) => ({ heading, description, chars: Math.floor(body * share) }));
}
