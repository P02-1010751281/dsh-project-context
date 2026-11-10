/**
 * Context-document rendering: the rolling session summary, key points, and open tasks.
 *
 * `CONTEXT.md` is one instance; a task document (`tasks/<slug>.md`) is the same document bound to a
 * different owner, differing only in its header and stamp lines. Both render through one section
 * path so the schema, the budgets and the marker stay single-sourced.
 *
 * The fixed sections and their per-section budgets come from `context-schema.ts`, shared with the
 * consolidation prompt. Over budget a section is clipped on a line boundary and the document ends
 * with an explicit truncation marker instead of a bare `slice()`: a silently clipped CONTEXT.md
 * used to be indistinguishable from a complete one.
 *
 * Ported from pi's `extensions/project-context/memory/context-doc.ts`.
 */
import { MAX_LIST_ENTRIES, MAX_LIST_ITEM_CHARS } from "../shared/project-state.js";
import {} from "../shared/reply-json.js";
import { CONTEXT_HEADER, CONTEXT_TITLE_CHARS, contextSectionBudgets, contextTruncationMarker } from "./context-schema.js";
import { taskHeader, taskMetaLine } from "./tasks.js";
import { clipToLineBoundary } from "./document.js";
/** Collapse whitespace and trim; the shared normalization for titles, items, and summaries. */
function normalizeLine(value) {
    return value.replace(/\s+/g, " ").trim();
}
/** A whitespace-normalized value cut to `limit` at a line (and surrogate-safe) boundary. */
function trimLine(value, limit = MAX_LIST_ITEM_CHARS) {
    return clipToLineBoundary(normalizeLine(value), limit);
}
function listMarkdown(lines) {
    return lines.length === 0 ? "- None recorded" : lines.join("\n");
}
/** Clip a prose body to its budget on a line boundary, counting the dropped characters. */
function clipProse(value, limit) {
    const normalized = normalizeLine(value);
    if (normalized.length <= limit)
        return { text: normalized, dropped: 0 };
    const text = clipToLineBoundary(normalized, limit);
    return { text, dropped: normalized.length - text.length };
}
/**
 * Clip a bullet list to its section budget: every item is trimmed to `MAX_LIST_ITEM_CHARS` and the
 * list to `MAX_LIST_ENTRIES` entries, then whole trailing items are dropped until the section fits.
 * `dropped` counts every character the untrimmed render would have carried — including the per-item
 * trim and the entry-cap drop, not only the budget drop — so the marker reports the real loss. The
 * smallest section budget exceeds the per-item cap, so a surviving item can never overflow alone.
 */
function clipList(items, limit) {
    // Blank/whitespace items carry no content; drop them before measuring so they render as no items.
    const content = items.map(normalizeLine).filter((item) => item.length > 0);
    const full = content.map((item) => `- ${item}`);
    let kept = content.map((item) => `- ${trimLine(item)}`).slice(0, MAX_LIST_ENTRIES);
    while (kept.length > 1 && kept.join("\n").length > limit)
        kept = kept.slice(0, -1);
    return { lines: kept, dropped: full.join("\n").length - kept.join("\n").length };
}
/**
 * Render a context-shaped document: the caller's preamble, the three section bodies clipped to their
 * budgets, and the trailing session-title comment. `CONTEXT.md` and a task document both go through
 * this one path, so the schema, the budgets and the truncation marker cannot drift apart.
 * @param update - the model's (or fallback) context section values.
 * @param preamble - the document's own header and stamp lines, already laid out top to bottom.
 * @returns the document and the characters its own clips dropped.
 */
function renderSections(update, preamble) {
    const title = trimLine(update.title, CONTEXT_TITLE_CHARS) || "Untitled session";
    const budgets = contextSectionBudgets();
    const budgetByEntry = { summary: 0, key_points: 0, open_tasks: 0 };
    for (const section of budgets)
        budgetByEntry[section.entry] = section.chars;
    const summary = clipProse(update.summary, budgetByEntry.summary);
    const keyPoints = clipList(update.key_points, budgetByEntry.key_points);
    const openTasks = clipList(update.open_tasks, budgetByEntry.open_tasks);
    // `entry` picks both the field and the clipper: summary is prose, the other two are lists.
    const rendered = {
        summary: summary.text || "No summary recorded yet.",
        key_points: listMarkdown(keyPoints.lines),
        open_tasks: listMarkdown(openTasks.lines),
    };
    const parts = [
        ...preamble,
        ...budgets.flatMap((section) => [`## ${section.heading}\n\n${rendered[section.entry]}`, ""]),
        `<!-- latest-session-title: ${title} -->`,
    ];
    const document = `${parts.join("\n")}\n`;
    const dropped = summary.dropped + keyPoints.dropped + openTasks.dropped;
    // A cut document must never look complete: say how much was dropped, in the stored file itself.
    return dropped > 0 ? { text: `${document.trimEnd()}\n\n${contextTruncationMarker(dropped)}\n`, dropped } : { text: document, dropped };
}
export function renderContextDocument(update, options) {
    return renderSections(update, [CONTEXT_HEADER.trimEnd(), "", `Last updated: ${options.updatedAt}`, ""]).text;
}
/**
 * The document for one task: the same three sections, with the task's own header and metadata line
 * where the context carries its `Last updated` stamp.
 *
 * A task file is not a second context format — it is the same document bound to a different owner,
 * so the model's reply renders here unchanged. The metadata line is the only authored state in the
 * file (`created`), the status is re-derived from `lastSeen` on every read, and `title` gives the
 * "other tasks" list a label without opening the body.
 * @param update - the consolidation reply's context section.
 * @param options - the document's date, slug and metadata as stored before this write.
 * @returns the rendered task document and the characters its section clips dropped.
 */
export function renderTaskDocument(update, options) {
    return renderSections(update, [taskHeader(options.slug), "", taskMetaLine(options.meta), ""]);
}
