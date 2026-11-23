/**
 * Batch V, core half: decide whether a memory entry's cited files changed **after the entry was
 * written**, and word that verdict for a receipt.
 *
 * Why this is not the retirement channel: `retirement.ts` *deletes* an entry whose anchor stopped
 * resolving and records a tombstone. A file that merely changed is not a dead fact — it is a fact that
 * needs re-reading — so this module's verdict is a label, never an action. Keeping the two decisions
 * apart is the whole point: folding them would let one source edit silently delete a still-true
 * invariant, which is the exact failure class this repository treats as worst.
 *
 * Disk-free by construction: the caller measures the hashes (`staleness-source.ts`) and hands them in
 * as a plain map, so every rule about "what counts as stale" is testable without a fixture tree.
 */
import { pick } from "../shared/language.js";
import { MEMORY_SECTIONS } from "./memory-schema.js";
import { entryTid } from "./retirement.js";
/** Nothing was checked — the wording must say so instead of implying a clean memory. */
export const UNCHECKED_STALENESS = { bound: 0, stale: 0, staleIds: [], missing: 0, unverifiable: 0, checked: false };
/** How many ids a receipt may name before it stops being a receipt. */
const MAX_NAMED_IDS = 3;
/**
 * Judge every entry that carries a binding, once, for both readers below.
 *
 * An entry is stale when **at least one** of its bound files changed: the entry makes one claim, and
 * a claim resting on a changed file is unverified even if its other files are intact. Entries without
 * a binding are not judged at all — no binding means nothing was ever recorded to compare against,
 * which is a different fact from "checked and clean".
 */
function judgeEntries(sections, bindings, files) {
    const judged = [];
    for (const key of Object.keys(sections)) {
        for (const entry of sections[key]) {
            const tid = entryTid(entry);
            if (tid === undefined)
                continue;
            const binding = bindings[tid];
            if (binding === undefined)
                continue;
            const paths = Object.keys(binding);
            if (paths.length === 0)
                continue;
            const changed = [];
            let gone = false;
            let unknown = false;
            for (const path of paths) {
                const current = files.get(path);
                if (current === undefined) {
                    unknown = true;
                    continue;
                }
                if (current.kind === "unreadable") {
                    unknown = true;
                    continue;
                }
                if (current.kind === "missing") {
                    gone = true;
                    continue;
                }
                if (current.value !== binding[path])
                    changed.push(path);
            }
            judged.push({ tid, changed, gone, unknown });
        }
    }
    return judged;
}
/**
 * The counts a receipt renders, folded from the same judgement `staleEntriesOf` exposes.
 *
 * @param sections - the parsed memory document.
 * @param bindings - fingerprints recorded when each entry was authored.
 * @param files - what re-reading each bound path produced now.
 * @returns the counts the receipt renders.
 */
export function summariseStaleness(sections, bindings, files) {
    let bound = 0;
    let stale = 0;
    let missing = 0;
    let unverifiable = 0;
    const staleIds = [];
    for (const judged of judgeEntries(sections, bindings, files)) {
        bound += 1;
        if (judged.changed.length > 0) {
            stale += 1;
            if (staleIds.length < MAX_NAMED_IDS)
                staleIds.push(judged.tid);
        }
        if (judged.gone)
            missing += 1;
        if (judged.unknown)
            unverifiable += 1;
    }
    return { bound, stale, staleIds, missing, unverifiable, checked: true };
}
/**
 * Every stale entry with the paths that changed under it, for a channel that has to act on one.
 *
 * `StalenessFacts` names at most three ids because a receipt must stay short, and "which entries" is
 * the whole question `/memory reconcile` answers. Both views come from one judgement, so the count a
 * receipt prints and the list a command shows cannot disagree.
 * @param sections - the parsed memory document.
 * @param bindings - fingerprints recorded when each entry was authored.
 * @param files - what re-reading each bound path produced now.
 * @returns the stale entries, in document order.
 */
export function staleEntriesOf(sections, bindings, files) {
    return judgeEntries(sections, bindings, files)
        .filter((judged) => judged.changed.length > 0)
        .map((judged) => ({ tid: judged.tid, paths: judged.changed }));
}
/**
 * The receipt clause, in the same voice as the `/memory` status line next to it.
 *
 * Zero is printed as zero (`stale 0`), because "checked and clean" is a fact worth stating; an
 * unmeasured verdict prints `stale unknown` and never `0`.
 * @param facts - the summarised verdict.
 * @returns one clause, no trailing separator.
 */
export function stalenessClause(facts, language = "en") {
    if (!facts.checked)
        return pick(language, "stale 未知（无法读取来源绑定）", "stale unknown (source bindings could not be read)");
    if (facts.bound === 0)
        return pick(language, "stale 0（还没有条目引用已绑定的文件）", "stale 0 (no entry cites a bound file yet)");
    const named = facts.staleIds.length > 0 ? pick(language, `：${facts.staleIds.join("、")}`, `: ${facts.staleIds.join(", ")}`) : "";
    const parts = [
        pick(language, `${facts.bound} 条已绑定条目`, `${facts.bound} bound entr${facts.bound === 1 ? "y" : "ies"}`),
        pick(language, `过期 ${facts.stale}${named}`, `stale ${facts.stale}${named}`),
    ];
    if (facts.missing > 0)
        parts.push(pick(language, `缺失 ${facts.missing}`, `missing ${facts.missing}`));
    if (facts.unverifiable > 0)
        parts.push(pick(language, `无法核验 ${facts.unverifiable}`, `unverifiable ${facts.unverifiable}`));
    return parts.join(" · ");
}
/** Section headings the document may carry, exported for the adapter's own sanity checks. */
export const STALENESS_SECTIONS = MEMORY_SECTIONS.map((section) => section.heading);
