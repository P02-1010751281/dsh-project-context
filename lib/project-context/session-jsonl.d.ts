/**
 * Reading one `session.jsonl` (or pi's JSONL): the header, the events, and the index metadata
 * derived from them. Both the file and the zip path parse through here.
 */
import { type SessionFileHeader } from "./session-log.js";
export interface ParsedArchive {
    /** Header exactly as parsed — never rewritten: unknown fields (e.g. `delegationDepth`) are preserved. */
    header: Record<string, unknown>;
    /** Session id from the header (the only field required for archiving). */
    id: string;
    /** Harness that wrote the header, when it says: dsh writes `harness`, pi writes none. */
    harness: "dsh" | "pi" | "unknown";
    /** Header timestamp, or `Date.now()` when the archive predates the field (index display only). */
    createdAt: number;
    entries: unknown[];
}
/**
 * Parse a canonical `session.jsonl`: a `type: "session"` header line followed
 * by one event per line. Blank lines are ignored; a malformed header or a
 * malformed event line is a hard error so a bad archive cannot be archived as
 * if it were healthy.
 */
export declare function parseSessionJsonl(text: string): ParsedArchive;
/**
 * Build the Markdown header for a parsed archive.
 *
 * The `harness` field is typed as dsh's literal, but this function is the one
 * place the two formats meet, and writing `"dsh"` into a pi session's header
 * would be a false statement about where the log came from. The value is
 * display-only (nothing reads it back) and dsh archives are unaffected.
 */
export declare function markdownHeaderView(archive: ParsedArchive): SessionFileHeader;
