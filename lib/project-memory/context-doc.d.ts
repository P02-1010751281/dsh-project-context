/**
 * CONTEXT.md rendering: the rolling session summary, key points, and open tasks.
 *
 * The fixed sections and their per-section budgets come from `context-schema.ts`, shared with the
 * consolidation prompt. Over budget a section is clipped on a line boundary and the document ends
 * with an explicit truncation marker instead of a bare `slice()`: a silently clipped CONTEXT.md
 * used to be indistinguishable from a complete one.
 *
 * Ported from pi's `extensions/project-context/memory/context-doc.ts`.
 */
import { type ContextUpdate } from "../shared/reply-json.js";
export declare function renderContextDocument(update: ContextUpdate, options: {
    updatedAt: string;
}): string;
