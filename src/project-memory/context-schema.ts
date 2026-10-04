/**
 * The CONTEXT.md document's fixed top-level schema. The consolidation prompt and the renderer both
 * build the section list and the per-section character budgets from this one table, so the two
 * cannot drift. A context that does not follow it still loads (the stored file is injected as-is);
 * the schema is what the pass asks for, not a gate on what is stored.
 *
 * Ported from pi's `extensions/project-context/memory/context-schema.ts`.
 */

import { MAX_CONTEXT_CHARS, MAX_LIST_ENTRIES, MAX_LIST_ITEM_CHARS, MAX_SUMMARY_CHARS } from "../shared/project-state.js";

/** The canonical heading every rendered context document carries. */
export const CONTEXT_HEADER = "# Project Context\n\n";

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
export const CONTEXT_SECTIONS: readonly ContextSectionSpec[] = [
	{ heading: "Summary", description: "what this session is about and where it stands", entry: "summary", share: 0.4, maxChars: MAX_SUMMARY_CHARS },
	{ heading: "Key points", description: "facts, decisions, and findings worth carrying forward", entry: "key_points", share: 0.35 },
	{ heading: "Open tasks", description: "unfinished work and the agreed next steps", entry: "open_tasks", share: 0.25 },
];

export type ContextSectionBudget = { heading: string; description: string; entry: ContextSectionEntry; chars: number };

/** One blank line (two characters) terminates each section body; the last one over-reserves a character. */
export const CONTEXT_SECTION_GAP_CHARS = 2;

/** `new Date().toISOString()` always renders this many characters. */
export const CONTEXT_TIMESTAMP_CHARS = 24;

/** Longest session title the trailing comment carries (`renderContextDocument` trims to this). */
export const CONTEXT_TITLE_CHARS = 160;

/** Leading text of the marker line a truncated context carries; the full shape is matched below. */
const CONTEXT_TRUNCATION_PREFIX = "_[context truncated";

/** The marker line in full: `_[context truncated: <dropped> characters dropped]_`. */
const CONTEXT_TRUNCATION_LINE = /^_\[context truncated: (\d+) characters dropped\]_$/;

/** The line a truncated document ends with: a cut context must never look like a complete one. */
export function contextTruncationMarker(dropped: number): string {
	return `${CONTEXT_TRUNCATION_PREFIX}: ${dropped} characters dropped]_`;
}

/**
 * The dropped count a truncated document reports, or undefined when it is not marked. Only the
 * document's last non-empty line counts: the renderer appends its marker last, so a model-authored
 * line that merely looks like one inside a section is never mistaken for a real clip.
 */
export function contextTruncationDropped(text: string): number | undefined {
	const lines = text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
	const match = lines.length > 0 ? CONTEXT_TRUNCATION_LINE.exec(lines[lines.length - 1]) : null;
	return match ? Number(match[1]) : undefined;
}

/** True when a context document reports that a section was clipped. */
export function isContextTruncated(text: string): boolean {
	return contextTruncationDropped(text) !== undefined;
}

/**
 * Characters the fixed layout spends before any section body: the header, the `Last updated` line,
 * the three headings with their blank lines, the worst-case trailing comment, and room for the
 * truncation marker when one is appended. Shares of the whole cap would let a document that exactly
 * fills every budget overflow once the layout and the marker are added.
 */
export function contextSchemaOverheadChars(): number {
	const stamp = "Last updated: ".length + CONTEXT_TIMESTAMP_CHARS + 2;
	const headings = CONTEXT_SECTIONS.reduce((sum, section) => sum + `## ${section.heading}\n\n`.length + CONTEXT_SECTION_GAP_CHARS, 0);
	const trailing = "<!-- latest-session-title: ".length + CONTEXT_TITLE_CHARS + " -->\n".length;
	// The marker replaces the document's final newline with a blank line, the marker, and a newline.
	const marker = contextTruncationMarker(MAX_CONTEXT_CHARS).length + 3;
	return CONTEXT_HEADER.length + stamp + headings + trailing + marker;
}

/** Per-section body budgets for a document cap, floored so they plus the overhead never exceed it. */
export function contextSectionBudgets(cap: number = MAX_CONTEXT_CHARS): ContextSectionBudget[] {
	const body = Math.max(0, cap - contextSchemaOverheadChars());
	return CONTEXT_SECTIONS.map(({ heading, description, entry, share, maxChars }) => ({
		heading,
		description,
		entry,
		chars: Math.max(0, Math.min(Math.floor(body * share), maxChars ?? Number.POSITIVE_INFINITY)),
	}));
}

/**
 * The notice logged once per project when a rendered context had to be clipped. It names the three
 * clamps because the marker's count alone cannot say which of them fired.
 */
export function contextClipNotice(dropped: number): string {
	return `CONTEXT.md was clipped (a section budget, the ${MAX_LIST_ITEM_CHARS}-character item cap, or the ${MAX_LIST_ENTRIES}-entry list cap); ${dropped} characters were dropped`;
}
