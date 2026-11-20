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
import type { MemorySections } from "./sections.js";
/** `tid -> path -> fingerprint` as recorded when the entry was last authored. */
export type SourceBindings = Readonly<Record<string, Readonly<Record<string, string>>>>;
/** What re-reading one cited file produced now. A missing or unreadable file is never "fresh". */
export type FileState = {
    readonly kind: "sha";
    readonly value: string;
} | {
    readonly kind: "missing";
} | {
    readonly kind: "unreadable";
};
/**
 * The staleness verdict for one document.
 *
 * Four counts, each a different fact, and none of them folded into another:
 * `stale` (a cited file changed), `missing` (the file is gone — the retirement pass owns that),
 * `unverifiable` (we could not read it), and `bound` (entries that carry at least one binding). A
 * caller that printed `stale 0` for an unreadable sidecar would report a healthy memory it never
 * checked.
 */
export interface StalenessFacts {
    /** Entries that carry at least one path binding. */
    readonly bound: number;
    /** Entries with at least one cited file whose fingerprint changed since it was recorded. */
    readonly stale: number;
    /** Up to three stale entry ids, for a receipt that must stay short. */
    readonly staleIds: readonly string[];
    /** Entries citing a bound file that no longer exists (the retirement pass, not this one, acts). */
    readonly missing: number;
    /** Entries whose binding could not be checked at all. */
    readonly unverifiable: number;
    /** False when the bindings or the readings were unavailable: the verdict is a named absence. */
    readonly checked: boolean;
}
/** Nothing was checked — the wording must say so instead of implying a clean memory. */
export declare const UNCHECKED_STALENESS: StalenessFacts;
/**
 * Judge every entry of one document against its bindings and the current readings.
 *
 * An entry is stale when **at least one** of its bound files changed: the entry makes one claim, and
 * a claim resting on a changed file is unverified even if its other files are intact. Entries without
 * a binding are not judged at all — no binding means nothing was ever recorded to compare against,
 * which is a different fact from "checked and clean".
 * @param sections - the parsed memory document.
 * @param bindings - fingerprints recorded when each entry was authored.
 * @param files - what re-reading each bound path produced now.
 * @returns the counts the receipt renders.
 */
export declare function summariseStaleness(sections: MemorySections, bindings: SourceBindings, files: ReadonlyMap<string, FileState>): StalenessFacts;
/**
 * The receipt clause, in the same voice as the `/memory` status line next to it.
 *
 * Zero is printed as zero (`stale 0`), because "checked and clean" is a fact worth stating; an
 * unmeasured verdict prints `stale unknown` and never `0`.
 * @param facts - the summarised verdict.
 * @returns one clause, no trailing separator.
 */
export declare function stalenessClause(facts: StalenessFacts): string;
/** Section headings the document may carry, exported for the adapter's own sanity checks. */
export declare const STALENESS_SECTIONS: readonly string[];
