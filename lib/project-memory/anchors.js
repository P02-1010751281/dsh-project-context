/**
 * The lexical half of "which files does this memory entry point at": one pure pass over the entry's
 * text, with no disk access at all.
 *
 * Two consumers need the same answer and must never drift apart:
 *
 * - `retirement.ts` decides whether a cited path still exists (a missing path retires the entry);
 * - the staleness pass (batch V) decides whether a cited file changed after the entry was written.
 *
 * They differ only in what they do with a candidate — one stats it, the other hashes it — so the
 * recognition rules (the boundary character, the extension whitelist, the `{`/`*` skip) live here and
 * each consumer keeps only its own filtering. A second copy of this regex is how the two answers
 * start disagreeing, and a memory entry that is retired but still "fresh" (or the reverse) is exactly
 * the wrong-cause defect this repository refuses.
 *
 * Deliberately lexical: whether a candidate is a real project path depends on the directory it lives
 * in (a missing parent means it may be an abbreviation or another checkout), and that judgement needs
 * the filesystem. Consumers apply it.
 */
import { MEMORY_GITIGNORE_LINES } from "../shared/gitignore.js";
/**
 * The plugin's own local artifacts, as matchers.
 *
 * A missing `errors.log` is not a broken anchor: the file exists only once something has failed, and a
 * fresh clone has none of these at all. Built from the one list the `.gitignore` writer uses, so a new
 * artifact is covered by adding its line there and nowhere else.
 */
const LOCAL_ARTIFACTS = MEMORY_GITIGNORE_LINES.map((line) => new RegExp(`^${line.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`));
/** True when the token names one of this plugin's own ignored outputs (a clock, not a fact). */
export function isLocalArtifact(candidate) {
    const base = candidate.split("/").pop() ?? "";
    return LOCAL_ARTIFACTS.some((pattern) => pattern.test(base));
}
/** Extensions a memory entry may cite as a checkable file. A slug like `turn/start` has none. */
export const ANCHOR_EXTENSIONS = new Set([
    "ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts", "json", "md", "yml", "yaml", "sh", "log",
    "txt", "lock", "toml", "html", "css", "patch",
]);
/**
 * Absolute or multi-segment paths with an optional `:line` / `:line-line` suffix, preceded by a
 * boundary character so an inline code span or a parenthesis opens a candidate.
 */
const ANCHOR = /(?:^|[\s(（`'"[：:，,])((?:\/|[\w.@+-]+\/)+[\w.@+-]+)(?::(\d+)(?:[–-](\d+))?)?/g;
/** The lower-case extension of a candidate, or `undefined` when it has none. */
export function anchorExtension(candidate) {
    const base = candidate.split("/").pop() ?? "";
    const dot = base.lastIndexOf(".");
    return dot <= 0 ? undefined : base.slice(dot + 1).toLowerCase();
}
/**
 * Every path-shaped token in one entry, in document order, duplicates included.
 *
 * Duplicates are kept because the two consumers dedupe differently (drift reports one reason per
 * path, staleness hashes once per path) and the shared half must not pre-empt either. Braces and
 * stars are skipped: they mark a glob or a template, not a file that can be checked.
 * @param entry - one memory bullet, tid included or not.
 * @returns the tokens this entry names, before any filesystem judgement.
 */
export function anchorCandidates(entry) {
    const tokens = [];
    // A fresh instance per call: `lastIndex` on a module-level `g` regex is shared state, and two
    // consumers iterating inside one another would silently skip matches.
    const pattern = new RegExp(ANCHOR.source, "g");
    let match;
    while ((match = pattern.exec(entry)) !== null) {
        const candidate = match[1];
        if (candidate.includes("{") || candidate.includes("*"))
            continue;
        const extension = anchorExtension(candidate);
        if (extension === undefined || !ANCHOR_EXTENSIONS.has(extension))
            continue;
        const line = match[3] ?? match[2];
        tokens.push(line === undefined ? { path: candidate } : { path: candidate, line: Number(line) });
    }
    return tokens;
}
