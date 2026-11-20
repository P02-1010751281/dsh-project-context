/**
 * The `/memory` status **core**: one report DTO in, one receipt string out.
 *
 * Nothing here touches the harness or the disk. How many lines the journal has, how many backups sit
 * next to the render, how many sessions are archived — those arrive already measured from the sibling
 * `status-source.ts`, the one file that knows the `.agents/memory` layout. A receipt is therefore a pure
 * function of what was measured, and a wording change can never disagree with a count.
 *
 * Two rules the wording enforces:
 *
 * - A value we could not measure is a *named* absence (`unknown`, `none yet`, `unparseable`), never a
 *   `0`: "no backups" and "could not list the directory" are different facts, and this repository
 *   treats a wrong cause as worse than a named gap.
 * - Nothing claims what the last consolidation did. That outcome is not persisted anywhere — not in a
 *   state file, not in a journal record — so the receipt says so instead of inferring it from an mtime
 *   or a size. A receipt that guessed would be wrong the first time two passes ran close together.
 *
 * Section counts come from `sectionsFromMarkdown`, the same conservative parser the write path uses:
 * a document it cannot read with certainty is reported as *unparseable*, not as four empty sections,
 * because "0 entries" would read as "this memory is empty" when the truth is "this is not our shape".
 */

import { isMemoryTruncated } from "./document.js";
import { MEMORY_SECTIONS } from "./memory-schema.js";
import { sectionsFromMarkdown, type MemorySections } from "./sections.js";
import { type StalenessFacts, stalenessClause } from "./staleness.js";

/**
 * The journal as the adapter measured it.
 *
 * `unreadable` is separate from `absent` on purpose: a journal that exists but cannot be opened is a
 * failure the user has to see, and folding it into "no journal yet" would hide a broken store.
 */
export type JournalFacts =
	| { readonly kind: "absent" }
	| { readonly kind: "present"; readonly lines: number; readonly bytes: number }
	| { readonly kind: "unreadable" };

/**
 * The raw facts the adapter measured around one memory document.
 *
 * `undefined` on a count means "the directory could not be listed" — unknown, never zero.
 */
export interface MemoryFileFacts {
	readonly journal: JournalFacts;
	/** Backup files this plugin wrote next to the render. */
	readonly backups: number | undefined;
	/** Directories under `session-logs/` that carry a `meta.json` (an archived session). */
	readonly archivedSessions: number | undefined;
	/** Line count only: the log's content is deliberately not read here. */
	readonly errorLogLines: number | undefined;
}

/** Everything one status receipt renders. Measured values only. */
export interface MemoryStatusReport {
	/** The loaded document — what a consolidation pass would see, cap and fold included. */
	readonly document: string;
	readonly source: string;
	/** Where a memory would live, for the "none yet" wording. */
	readonly expectedPath: string;
	/** The journal's path, named once whether the file is present or not. */
	readonly journalPath: string;
	readonly maxChars: number;
	/** Unusable journal lines this read skipped. */
	readonly damaged: number;
	readonly unreadable: boolean;
	readonly poisoned: boolean;
	/** Characters this read's cap kept back (the loader's own count, not a length difference). */
	readonly cappedDroppedChars: number;
	/**
	 * Batch V's verdict on the entries' bound source files, or `undefined` when it was not measured
	 * (an empty document, an opaque one, or a caller that did not ask). Absent is *not* "0 stale".
	 */
	readonly staleness?: StalenessFacts;
	readonly files: MemoryFileFacts;
}

/** The four sections in document order, as headings to display and the parser keys behind them. */
const COUNTED_SECTIONS: ReadonlyArray<{ heading: string; key: keyof MemorySections }> = MEMORY_SECTIONS.map((section) => ({
	heading: section.heading,
	key: section.heading.toLowerCase() as keyof MemorySections,
}));

/** `1 backup` / `2 backups`: a receipt reads as prose, so the count agrees with its noun. */
function plural(count: number, singular: string, plural: string): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

/** `138 entries (Project 12, Invariants 64, Pitfalls 44, Index 18)`, or a named refusal to count. */
function sectionsClause(document: string): string {
	const parsed = sectionsFromMarkdown(document);
	if (parsed === undefined) {
		return "sections unparseable (not a plain four-section bullet document — entry counts withheld, not reported as 0)";
	}
	const counts = COUNTED_SECTIONS.map(({ heading, key }) => `${heading} ${parsed[key].length}`);
	const total = COUNTED_SECTIONS.reduce((sum, { key }) => sum + parsed[key].length, 0);
	return `${plural(total, "entry", "entries")} (${counts.join(", ")})`;
}

/** `journal <path> 12 line(s) / 900 byte(s)`, with absence and unreadability named as themselves. */
function journalClause(path: string, facts: JournalFacts): string {
	if (facts.kind === "absent") return `journal ${path} none yet`;
	if (facts.kind === "unreadable") return `journal ${path} unreadable`;
	return `journal ${path} ${plural(facts.lines, "line", "lines")} / ${plural(facts.bytes, "byte", "bytes")}`;
}

/**
 * The `/memory` status receipt.
 *
 * The reply distinguishes the states a silent fold would otherwise hide: a torn journal line, a source
 * that exists but cannot be read, and a stored reply from the old bug. It also reports the character
 * cap, which is the one degraded state the document itself cannot surface to the user: a marker records
 * that the document was capped *at some point* (it is carried forward), while `cappedDroppedChars`
 * describes what **this** read's cap kept back — including on the no-journal read, which clips without
 * writing a marker at all. Either one is enough to warn; a memory that lost a third of itself must not
 * read as perfectly healthy, or every later append lands past the cap and is dropped on write.
 * @param report - the loaded document, its flags, and the file facts the adapter measured.
 * @returns the command result.
 */
export function formatMemoryStatus(report: MemoryStatusReport): { kind: "success" | "error"; text: string } {
	const capped = isMemoryTruncated(report.document) || report.cappedDroppedChars > 0
		? ` Warning: MEMORY.md is at the ${report.maxChars}-character cap — this read is cut, so a consolidation pass refuses to rewrite it (status read-capped-refused), and anything appended past the cap is dropped on write; raise maxMemoryChars or shorten the document.`
		: "";
	// `trim()` decides only whether there is a document; the size printed is the document's own length,
	// never a normalized count (a trimmed length would quietly disagree with the file the user opens).
	const document = report.document;
	const empty = document.trim() === "";
	const clauses: string[] = [];
	if (report.unreadable) {
		const hint = report.source.endsWith("memory.jsonl")
			? `Delete it to rebuild from MEMORY.md, or restore from memory-log-*.jsonl`
			: `check its permissions`;
		clauses.push(`Memory: exists but cannot be read — ${report.source}; ${hint}.`);
	} else if (report.damaged > 0) {
		clauses.push(`Memory: ${report.journalPath} (${report.damaged} unusable line(s) skipped; see .agents/memory/errors.log).${capped}`);
	} else if (report.poisoned) {
		clauses.push(`Memory: ${report.source} (stored as raw JSON from the old bug; the next consolidation backs it up and rewrites it as Markdown).${capped}`);
	} else if (empty) {
		clauses.push(`Memory: none yet — ${report.expectedPath}`);
	} else {
		clauses.push(`Memory: ${report.source}${capped}`);
	}
	// A document we could not load has no size or sections to report; saying `0 chars` for it would be
	// the same wrong cause the unreadable wording above refuses to tell.
	if (!report.unreadable && !empty) {
		clauses.push(`${document.length}/${report.maxChars} chars (${Math.round((document.length / report.maxChars) * 100)}%)`);
		clauses.push(sectionsClause(report.document));
		// Only a document we could parse has entries to judge; the field is absent when nothing measured.
		if (report.staleness !== undefined) clauses.push(stalenessClause(report.staleness));
	}
	clauses.push(journalClause(report.journalPath, report.files.journal));
	clauses.push(report.files.backups === undefined ? "backups unknown" : plural(report.files.backups, "backup", "backups"));
	clauses.push(report.files.archivedSessions === undefined ? "archived sessions unknown" : `${plural(report.files.archivedSessions, "archived session", "archived sessions")}`);
	clauses.push(report.files.errorLogLines === undefined ? "errors.log unknown" : `errors.log ${plural(report.files.errorLogLines, "line", "lines")}`);
	clauses.push("no last-pass result (consolidation outcomes are not persisted)");
	return { kind: report.unreadable ? "error" : "success", text: clauses.join(" · ") };
}
