/**
 * Backfill entry points: import one parsed session, one archive file, or a whole directory tree,
 * idempotently and with the canonical artifacts written last.
 */
export interface ImportOptions {
    /** Project root whose `.agents/memory/session-logs/` receives the archive. */
    projectRoot: string;
    /** Render `session.md` next to the canonical JSONL (default true). */
    markdown?: boolean;
    /** Overwrite an already-imported session instead of skipping it. */
    replace?: boolean;
}
export interface ImportOutcome {
    /** Session id taken from the archive header. */
    id: string;
    /** `created` wrote the artifacts, `skipped` found an existing copy, `failed` carried an error. */
    status: "created" | "skipped" | "failed";
    /** Absolute directory of the session artifacts (absent when parsing failed). */
    dir?: string;
    entries?: number;
    error?: string;
    /** Archive file this outcome came from. */
    source?: string;
}
/** Write one parsed archive into the project's session-log layout and index it. */
export declare function importSessionJsonl(text: string, options: ImportOptions): Promise<ImportOutcome>;
/** Import one archive file; parse/write failures come back as `failed`, never thrown. */
export declare function importArchiveFile(file: string, options: ImportOptions): Promise<ImportOutcome>;
/** Import a batch of archives (files passed in order; no ordering assumption inside). */
export declare function importArchiveFiles(files: readonly string[], options: ImportOptions): Promise<ImportOutcome[]>;
