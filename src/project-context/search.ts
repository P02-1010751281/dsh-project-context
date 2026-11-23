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

import { type DocumentLanguage, pick } from "../shared/language.js";

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
export type SearchResult =
	| {
		readonly kind: "hits";
		readonly query: string;
		readonly hits: readonly SearchHit[];
		/** Every matching line, including the ones the budget kept back. */
		readonly matched: number;
		/** Matching lines the character budget did not print. */
		readonly hidden: number;
		readonly documents: number;
	}
	| { readonly kind: "no-matches"; readonly query: string; readonly documents: number }
	| { readonly kind: "empty-corpus" }
	| { readonly kind: "empty-query" };

export interface SearchOptions {
	/** Hits to print at most; the default is the plan's Top 8. */
	readonly maxHits?: number;
	/** Character budget for the whole printed block, header and omission note included; default 8 KiB. */
	readonly maxChars?: number;
	/** Longest snippet per hit, ellipsis included. */
	readonly snippetChars?: number;
	/**
	 * Hits one document may contribute; the rest of its matches stay counted but unprinted.
	 *
	 * The archive is the reason this exists: a `session.md` is a pretty-printed dump of every event, so
	 * one transcript can hold thousands of matching lines and would otherwise fill the Top N by itself.
	 * The command answers "which document mentions this, and where", and a receipt that is eight lines
	 * of the same transcript does not answer it.
	 */
	readonly perDocument?: number;
}

export const DEFAULT_MAX_HITS = 8;
export const DEFAULT_MAX_CHARS = 8_000;
const DEFAULT_SNIPPET_CHARS = 200;
const DEFAULT_PER_DOCUMENT_HITS = 3;

/** Ideographs, kana and hangul: scripts written without spaces, so they need the bigram fallback. */
const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;

/** Letters/digits/underscore: the ASCII term's own boundary alphabet. */
const WORD_RE = /[a-z0-9_]/;

/** One query word: its normalized text plus the bigrams that stand in for it. */
interface QueryTerm {
	readonly text: string;
	readonly cjk: boolean;
	readonly bigrams: readonly string[];
}

function isWordChar(char: string | undefined): boolean {
	return char !== undefined && WORD_RE.test(char);
}

/**
 * Does `needle` occur in `haystack` at a word boundary?
 *
 * Manual rather than a `\b` regex: the needle is user input, and escaping it into a pattern would
 * make one stray `(` change the meaning of a search instead of matching it.
 */
function containsWord(haystack: string, needle: string): boolean {
	for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
		if (!isWordChar(haystack[at - 1]) && !isWordChar(haystack[at + needle.length])) return true;
	}
	return false;
}

/** The adjacent ideograph pairs of a term, its no-space fallback. */
function bigramsOf(text: string): string[] {
	const pairs: string[] = [];
	for (let index = 0; index + 1 < text.length; index += 1) {
		const pair = text.slice(index, index + 2);
		if (CJK_RE.test(pair[0]) && CJK_RE.test(pair[1])) pairs.push(pair);
	}
	return pairs;
}

function termOf(text: string): QueryTerm | undefined {
	const trimmed = text.replace(/^[^\p{L}\p{N}_]+|[^\p{L}\p{N}_]+$/gu, "").toLowerCase();
	if (trimmed === "") return undefined;
	const cjk = CJK_RE.test(trimmed);
	return { text: trimmed, cjk, bigrams: cjk ? bigramsOf(trimmed) : [] };
}

/**
 * The query's terms.
 *
 * Exported because the receipt and the tests both need to know what the command actually searched
 * for; a query that normalizes to nothing is `empty-query`, never a search for the empty string
 * (which would match every line).
 */
export function queryTerms(query: string): QueryTerm[] {
	const terms: QueryTerm[] = [];
	for (const word of query.trim().split(/\s+/)) {
		const term = termOf(word);
		if (term !== undefined) terms.push(term);
	}
	return terms;
}

/**
 * One term against one lowercased line.
 *
 * An ASCII term matches only at a word boundary: `find cat` must not report every `catalog`, so the
 * boundary check *is* the test rather than a fallback after a substring hit. A CJK term has no
 * boundaries to speak of, so it matches its own run or any adjacent bigram of it.
 */
function containsTerm(line: string, term: QueryTerm): boolean {
	if (!term.cjk) return containsWord(line, term.text);
	return line.includes(term.text) || term.bigrams.some((pair) => line.includes(pair));
}

/**
 * Score one line against the query: `3` whole query, `2` every term, `1` some term, `0` no hit.
 *
 * The whole query is scored as one term, so a multi-word phrase that occurs contiguously outranks a
 * line that merely contains all of its words.
 */
function scoreLine(line: string, whole: QueryTerm | undefined, terms: readonly QueryTerm[]): number {
	if (whole !== undefined && containsTerm(line, whole)) return 3;
	if (terms.every((term) => containsTerm(line, term))) return 2;
	return terms.some((term) => containsTerm(line, term)) ? 1 : 0;
}

/** Room reserved for the `… and N more not shown` line, so the printed block stays inside its budget. */
const OMISSION_NOTE_CHARS = 80;

/**
 * One line rendered for the receipt: whitespace collapsed, clipped, never a newline.
 *
 * Markdown markers are **kept**: the snippet is quoted as the document's own line, so a reader who
 * follows `path:line` sees the same bytes here as in the file. Stripping a leading `- ` or `# ` would
 * make the receipt a paraphrase of the line it claims to quote.
 */
function snippetOf(line: string, maxChars: number): string {
	const collapsed = line.replace(/\s+/g, " ").trim();
	return collapsed.length <= maxChars ? collapsed : `${collapsed.slice(0, maxChars - 1)}…`;
}

/** Codepoint order; `localeCompare` would make the rank depend on the host's locale. */
function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

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
export function search(docs: readonly SearchDoc[], query: string, options: SearchOptions = {}): SearchResult {
	const terms = queryTerms(query);
	if (terms.length === 0) return { kind: "empty-query" };
	if (docs.length === 0) return { kind: "empty-corpus" };
	const whole = termOf(query.trim());
	const maxHits = options.maxHits ?? DEFAULT_MAX_HITS;
	const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
	const snippetChars = options.snippetChars ?? DEFAULT_SNIPPET_CHARS;
	const perDocument = options.perDocument ?? DEFAULT_PER_DOCUMENT_HITS;
	const matched: { doc: SearchDoc; index: number; score: number }[] = [];
	for (const doc of docs) {
		for (const [index, line] of doc.lines.entries()) {
			const score = scoreLine(line.toLowerCase(), whole, terms);
			if (score > 0) matched.push({ doc, index, score });
		}
	}
	if (matched.length === 0) return { kind: "no-matches", query, documents: docs.length };
	// Newest first on a tie, then a stable tiebreak that does not depend on the filesystem's order.
	matched.sort((left, right) => left.score !== right.score
		? right.score - left.score
		: left.doc.age !== right.doc.age
			? left.doc.age - right.doc.age
			: compareText(left.doc.path, right.doc.path) !== 0
				? compareText(left.doc.path, right.doc.path)
				: left.index - right.index);
	const header = `Found ${matched.length} line(s) for "${query}" in ${docs.length} document(s):`;
	const hits: SearchHit[] = [];
	// The omission note is printed outside the hit lines, so its room is reserved up front: the
	// receipt then keeps the budget it advertises instead of exceeding it by one sentence whenever
	// the budget bit. The note itself is far shorter than this reservation.
	let used = header.length + OMISSION_NOTE_CHARS;
	// One document's matches may crowd every other document out of a Top N; the cap keeps the receipt
	// a map of *where* the fact lives rather than eight lines of one transcript. Matches it keeps back
	// are still counted, so `hidden` stays truthful.
	const printedPerDocument = new Map<string, number>();
	for (const match of matched) {
		if (hits.length >= maxHits) break;
		if ((printedPerDocument.get(match.doc.path) ?? 0) >= perDocument) continue;
		const line = (match.doc.lineNumbers?.[match.index] ?? match.index + 1);
		const snippet = snippetOf(match.doc.lines[match.index], snippetChars);
		const rendered = `- ${match.doc.path}:${line}: ${snippet}`;
		// The budget covers the printed block, so a long hit cannot push the receipt past the cap it
		// advertises. The first hit is always shown: an empty answer is worse than a long line.
		if (hits.length > 0 && used + rendered.length + 1 > maxChars) break;
		used += rendered.length + 1;
		printedPerDocument.set(match.doc.path, (printedPerDocument.get(match.doc.path) ?? 0) + 1);
		hits.push({ path: match.doc.path, line, snippet, score: match.score });
	}
	return { kind: "hits", query, hits, matched: matched.length, hidden: matched.length - hits.length, documents: docs.length };
}

/**
 * The receipt for one search.
 *
 * Zero is described by *which* zero it is: a query that matched nothing names the query and the
 * document count, an empty project names the absence of a corpus, and an empty query is a usage
 * error rather than "no matches" — the three need different next steps from the reader.
 */
export function renderSearchReport(result: SearchResult, language: DocumentLanguage = "en"): { kind: "success" | "error"; text: string } {
	if (result.kind === "empty-query") return { kind: "error", text: pick(language, "用法：/context find <query> —— 查询是空的。", "Usage: /context find <query> — the query is empty.") };
	if (result.kind === "empty-corpus") {
		return {
			kind: "success",
			text: pick(
				language,
				"还没有可搜索的内容 —— .agents/memory 下没有找到 MEMORY.md、CONTEXT.md、任务文档或归档会话。",
				"Nothing to search yet — no MEMORY.md, CONTEXT.md, task document or archived session was found under .agents/memory.",
			),
		};
	}
	if (result.kind === "no-matches") {
		return {
			kind: "success",
			text: pick(
				language,
				`没有匹配「${result.query}」的内容（共 ${result.documents} 个文档）。`,
				`No matches for "${result.query}" in ${result.documents} document(s).`,
			),
		};
	}
	const lines = [pick(
		language,
		`在 ${result.documents} 个文档里找到 ${result.matched} 行匹配「${result.query}」：`,
		`Found ${result.matched} line(s) for "${result.query}" in ${result.documents} document(s):`,
	)];
	for (const hit of result.hits) lines.push(`- ${hit.path}:${hit.line}: ${hit.snippet}`);
	if (result.hidden > 0) {
		lines.push(pick(language, `… 另有 ${result.hidden} 行未显示；请缩小查询范围。`, `… and ${result.hidden} more not shown; narrow the query.`));
	}
	return { kind: "success", text: lines.join("\n") };
}
