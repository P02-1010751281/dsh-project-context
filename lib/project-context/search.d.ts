/**
 * `/context find` **core**: query normalization, line scoring, ranking and the budgeted report.
 *
 * Nothing here knows about dsh or the filesystem. A corpus is a list of {@link SearchDoc} DTOs — a
 * project-relative path, a recency rank and the document's lines — and the sibling shim
 * `search-source.ts` walks `.agents/memory` into that shape. A change in the archive layout therefore
 * touches the shim alone, and this module stays testable with plain strings.
 *
 * The score is deliberately coarse: whole query, then all terms, then any term. The command answers
 * "where is this mentioned" and every hit it prints is a real line at a real `path:line`; a finer
 * relevance model would be unfalsifiable from the receipt, and an unfalsifiable ranker turning up a
 * wrong file is exactly the misattribution this repository refuses.
 *
 * CJK has no spaces to split on, so a term containing ideographs also matches through its adjacent
 * bigrams — that is the documented fallback, not a second ranker: it widens *which* lines count as a
 * term hit, never the score. ASCII terms match on word boundaries, so `find cat` does not report
 * every `catalog`.
 */
/** One document as the shim hands it over. */
export interface SearchDoc {
    /** Project-relative path shown on every hit, POSIX separators. */
    readonly path: string;
    /** Recency rank: `0` is newest. Only ever breaks a score tie. */
    readonly age: number;
    /** The lines to search, in document order. */
    readonly lines: readonly string[];
    /**
     * The 1-based line number of each entry of `lines`, when the shim kept only some of them.
     * Absent means `index + 1` — the document was taken whole.
     */
    readonly lineNumbers?: readonly number[];
}
/** One matched line, already clipped for display. */
export interface SearchHit {
    readonly path: string;
    readonly line: number;
    readonly snippet: string;
    readonly score: number;
}
/** The command's answer: hits, a named zero, or a named reason there was nothing to read. */
export type SearchResult = {
    readonly kind: "hits";
    readonly query: string;
    readonly hits: readonly SearchHit[];
    /** Every matching line, including the ones the budget kept back. */
    readonly matched: number;
    /** Matching lines the character budget did not print. */
    readonly hidden: number;
    readonly documents: number;
} | {
    readonly kind: "no-matches";
    readonly query: string;
    readonly documents: number;
} | {
    readonly kind: "empty-corpus";
} | {
    readonly kind: "empty-query";
};
export interface SearchOptions {
    /** Hits to print at most; the default is the plan's Top 8. */
    readonly maxHits?: number;
    /** Character budget for the whole printed block, header and omission note included; default 8 KiB. */
    readonly maxChars?: number;
    /** Longest snippet per hit, ellipsis included. */
    readonly snippetChars?: number;
}
export declare const DEFAULT_MAX_HITS = 8;
export declare const DEFAULT_MAX_CHARS = 8000;
/** One query word: its normalized text plus the bigrams that stand in for it. */
interface QueryTerm {
    readonly text: string;
    readonly cjk: boolean;
    readonly bigrams: readonly string[];
}
/**
 * The query's terms.
 *
 * Exported because the receipt and the tests both need to know what the command actually searched
 * for; a query that normalizes to nothing is `empty-query`, never a search for the empty string
 * (which would match every line).
 */
export declare function queryTerms(query: string): QueryTerm[];
/**
 * Search the corpus for one query.
 *
 * Ranking: score first, then recency (`age`), then path, then line number — every later key exists
 * so that an equal-score pair cannot come back in readdir order, which is not stable across hosts.
 * @param docs - the corpus the shim read.
 * @param query - the raw user input.
 * @param options - hit count, character budget and snippet width.
 * @returns the hits within budget, or a named reason there are none.
 */
export declare function search(docs: readonly SearchDoc[], query: string, options?: SearchOptions): SearchResult;
/**
 * The receipt for one search.
 *
 * Zero is described by *which* zero it is: a query that matched nothing names the query and the
 * document count, an empty project names the absence of a corpus, and an empty query is a usage
 * error rather than "no matches" — the three need different next steps from the reader.
 */
export declare function renderSearchReport(result: SearchResult): {
    kind: "success" | "error";
    text: string;
};
export {};
