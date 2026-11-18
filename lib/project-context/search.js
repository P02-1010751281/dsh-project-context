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
export const DEFAULT_MAX_HITS = 8;
export const DEFAULT_MAX_CHARS = 8_000;
const DEFAULT_SNIPPET_CHARS = 200;
/** Ideographs, kana and hangul: scripts written without spaces, so they need the bigram fallback. */
const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;
/** Letters/digits/underscore: the ASCII term's own boundary alphabet. */
const WORD_RE = /[a-z0-9_]/;
function isWordChar(char) {
    return char !== undefined && WORD_RE.test(char);
}
/**
 * Does `needle` occur in `haystack` at a word boundary?
 *
 * Manual rather than a `\b` regex: the needle is user input, and escaping it into a pattern would
 * make one stray `(` change the meaning of a search instead of matching it.
 */
function containsWord(haystack, needle) {
    for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
        if (!isWordChar(haystack[at - 1]) && !isWordChar(haystack[at + needle.length]))
            return true;
    }
    return false;
}
/** The adjacent ideograph pairs of a term, its no-space fallback. */
function bigramsOf(text) {
    const pairs = [];
    for (let index = 0; index + 1 < text.length; index += 1) {
        const pair = text.slice(index, index + 2);
        if (CJK_RE.test(pair[0]) && CJK_RE.test(pair[1]))
            pairs.push(pair);
    }
    return pairs;
}
function termOf(text) {
    const trimmed = text.replace(/^[^\p{L}\p{N}_]+|[^\p{L}\p{N}_]+$/gu, "").toLowerCase();
    if (trimmed === "")
        return undefined;
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
export function queryTerms(query) {
    const terms = [];
    for (const word of query.trim().split(/\s+/)) {
        const term = termOf(word);
        if (term !== undefined)
            terms.push(term);
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
function containsTerm(line, term) {
    if (!term.cjk)
        return containsWord(line, term.text);
    return line.includes(term.text) || term.bigrams.some((pair) => line.includes(pair));
}
/**
 * Score one line against the query: `3` whole query, `2` every term, `1` some term, `0` no hit.
 *
 * The whole query is scored as one term, so a multi-word phrase that occurs contiguously outranks a
 * line that merely contains all of its words.
 */
function scoreLine(line, whole, terms) {
    if (whole !== undefined && containsTerm(line, whole))
        return 3;
    if (terms.every((term) => containsTerm(line, term)))
        return 2;
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
function snippetOf(line, maxChars) {
    const collapsed = line.replace(/\s+/g, " ").trim();
    return collapsed.length <= maxChars ? collapsed : `${collapsed.slice(0, maxChars - 1)}…`;
}
/** Codepoint order; `localeCompare` would make the rank depend on the host's locale. */
function compareText(left, right) {
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
export function search(docs, query, options = {}) {
    const terms = queryTerms(query);
    if (terms.length === 0)
        return { kind: "empty-query" };
    if (docs.length === 0)
        return { kind: "empty-corpus" };
    const whole = termOf(query.trim());
    const maxHits = options.maxHits ?? DEFAULT_MAX_HITS;
    const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
    const snippetChars = options.snippetChars ?? DEFAULT_SNIPPET_CHARS;
    const matched = [];
    for (const doc of docs) {
        for (const [index, line] of doc.lines.entries()) {
            const score = scoreLine(line.toLowerCase(), whole, terms);
            if (score > 0)
                matched.push({ doc, index, score });
        }
    }
    if (matched.length === 0)
        return { kind: "no-matches", query, documents: docs.length };
    // Newest first on a tie, then a stable tiebreak that does not depend on the filesystem's order.
    matched.sort((left, right) => left.score !== right.score
        ? right.score - left.score
        : left.doc.age !== right.doc.age
            ? left.doc.age - right.doc.age
            : compareText(left.doc.path, right.doc.path) !== 0
                ? compareText(left.doc.path, right.doc.path)
                : left.index - right.index);
    const header = `Found ${matched.length} line(s) for "${query}" in ${docs.length} document(s):`;
    const hits = [];
    // The omission note is printed outside the hit lines, so its room is reserved up front: the
    // receipt then keeps the budget it advertises instead of exceeding it by one sentence whenever
    // the budget bit. The note itself is far shorter than this reservation.
    let used = header.length + OMISSION_NOTE_CHARS;
    for (const match of matched) {
        if (hits.length >= maxHits)
            break;
        const line = (match.doc.lineNumbers?.[match.index] ?? match.index + 1);
        const snippet = snippetOf(match.doc.lines[match.index], snippetChars);
        const rendered = `- ${match.doc.path}:${line}: ${snippet}`;
        // The budget covers the printed block, so a long hit cannot push the receipt past the cap it
        // advertises. The first hit is always shown: an empty answer is worse than a long line.
        if (hits.length > 0 && used + rendered.length + 1 > maxChars)
            break;
        used += rendered.length + 1;
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
export function renderSearchReport(result) {
    if (result.kind === "empty-query")
        return { kind: "error", text: "Usage: /context find <query> — the query is empty." };
    if (result.kind === "empty-corpus") {
        return {
            kind: "success",
            text: "Nothing to search yet — no MEMORY.md, CONTEXT.md, task document or archived session was found under .agents/memory.",
        };
    }
    if (result.kind === "no-matches") {
        return { kind: "success", text: `No matches for "${result.query}" in ${result.documents} document(s).` };
    }
    const lines = [`Found ${result.matched} line(s) for "${result.query}" in ${result.documents} document(s):`];
    for (const hit of result.hits)
        lines.push(`- ${hit.path}:${hit.line}: ${hit.snippet}`);
    if (result.hidden > 0)
        lines.push(`… and ${result.hidden} more not shown; narrow the query.`);
    return { kind: "success", text: lines.join("\n") };
}
