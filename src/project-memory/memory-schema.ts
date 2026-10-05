/**
 * The memory document's fixed top-level schema. A memory that follows it can be budgeted per
 * section; the consolidation prompt builds its structure and per-section character budgets from
 * this one table instead of restating them in prose. Free-form memories still load and render —
 * the schema is what the pass asks for, not a gate on what is stored.
 *
 * Ported from pi's `extensions/project-context/memory/schema.ts`.
 */

import { MEMORY_HEADER } from "./document.js";

export type MemorySectionSpec = {
	/** The `##` heading the section carries. */
	heading: string;
	/** What belongs in the section, rendered next to its heading in the prompt. */
	description: string;
	/** Share of the budgeted body this section should stay within; the shares sum to 1. */
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
 */
export const MEMORY_SECTIONS: readonly MemorySectionSpec[] = [
	{ heading: "Project", description: "purpose, stack, structure", share: 0.17 },
	{ heading: "Invariants", description: "standing decisions, conventions, hard constraints, user preferences", share: 0.45 },
	{ heading: "Pitfalls", description: "operational traps and the lessons behind them", share: 0.29 },
	{ heading: "Index", description: "pointers to docs, source files, and commands", share: 0.09 },
];

export type MemorySectionBudget = { heading: string; description: string; chars: number };

/** One blank line (two characters) terminates each section body; the last one over-reserves a character. */
export const MEMORY_SECTION_GAP_CHARS = 2;

/**
 * Characters the document header, the fixed section headings, and the blank lines around the section
 * bodies spend before any body text. The per-section budgets are shares of the remainder: shares of
 * the whole cap would let a document that exactly fills every budget exceed the cap once the header,
 * headings, and separating blank lines are added.
 */
export function memorySchemaOverheadChars(): number {
	return MEMORY_HEADER.length + MEMORY_SECTIONS.reduce((sum, section) => sum + `## ${section.heading}\n\n`.length + MEMORY_SECTION_GAP_CHARS, 0);
}

/** Per-section body budgets for a document cap, floored so they plus the overhead never exceed it. */
export function memorySectionBudgets(cap: number): MemorySectionBudget[] {
	const body = Math.max(0, cap - memorySchemaOverheadChars());
	return MEMORY_SECTIONS.map(({ heading, description, share }) => ({ heading, description, chars: Math.floor(body * share) }));
}

/**
 * Fraction of a section's hard budget the prompt asks the model to aim for.
 *
 * The budget is a refusal, not a target: a reply a few hundred characters over a section drops whole
 * entries and is refused as `lossy-refused`, and the model cannot count characters. A document
 * written to the hard budget therefore spends the headroom the next pass needs, which is how this
 * project's memory locked itself. The margin — applied to `memorySectionBudgets` rather than
 * restated as a second set of numbers — leaves the reply room for that estimation error.
 */
export const MEMORY_SECTION_PROMPT_SHARE = 0.9;

/** The per-section figure the prompt asks for: inside the hard budget, from the one table. */
export function memorySectionPromptBudgets(cap: number): MemorySectionBudget[] {
	return memorySectionBudgets(cap).map((section) => ({ ...section, chars: Math.floor(section.chars * MEMORY_SECTION_PROMPT_SHARE) }));
}
