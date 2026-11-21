/**
 * Lost-entry repair: put back the Invariants/Pitfalls entries a reply silently dropped, verbatim.
 *
 * Why a repair and not only a better prompt: `MEMORY_KEEP_RULE` and `MEMORY_SURVIVAL_CAPTION` already
 * tell the model to carry every still-true entry verbatim, and the measure that watches for the
 * opposite (`missing-literals.ts`) has been reporting since `06a5d12` — three real passes on
 * 2026-11-21 still dropped entries, once the same pitfall twice in one evening. An instruction the
 * model may or may not follow is not a gate; this is the mechanical half.
 *
 * Why whole entries only, and why the literal test: a pass legitimately rewords and merges, so
 * "this exact line is gone" is not a loss. Two facts make the narrow case decidable without a
 * semantic model:
 *  - **A merged or reworded entry keeps at least one of its literals.** The corpus is dense in
 *    `` `code` `` names, so an entry that still states its fact still names one of them.
 *  - **A dropped entry takes its literals with it.** That is exactly what was measured: the
 *    2026-11-21 20:40 and 20:48 passes deleted the restart-verify pitfall and its three literals
 *    together (`RESULT: FAIL`, `/etc/nixos/scripts/dsh-desktop-restart.sh --verify-only`,
 *    `title-load verify`).
 * So an entry is repaired only when its normalized text is absent **and** every literal it carried is
 * absent from the new document. Entries with no literals are left alone: there is no mechanical way
 * to tell a reword from a loss, and guessing is how a repair becomes a resurrection.
 *
 * Three refusals keep the repair from doing more harm than the loss:
 *  - an entry the reply `supersedes:` is not lost, it is replaced;
 *  - `Project` and `Index` are rewritten every pass by design, so they are never repaired;
 *  - the repaired document is re-rendered and re-parsed under the real cap. A repair that would make
 *    the renderer drop something else is reported as `no-room` and the pass keeps the reply it has —
 *    trading one loss for another silently is the failure this module exists to prevent.
 *
 * The output is sections, not text: the caller owns when this runs (after batch Z2's retirement, so a
 * tombstone and a repair can never describe the same entry) and where it lands (the write path).
 */
import { type MemorySections } from "./sections.js";
/** The two sections a lost entry may be restored to: the ones a pass is not supposed to rewrite. */
export declare const REPAIRABLE_SECTIONS: readonly ["invariants", "pitfalls"];
/** One section a lost entry belongs to. */
export type RepairableSection = (typeof REPAIRABLE_SECTIONS)[number];
/** One entry the reply dropped, kept with its section so it can go back where it came from. */
export type RestoredEntry = {
    section: RepairableSection;
    entry: string;
};
/** What the repair found, and what it could do about it. */
export type LostEntryRepair = {
    kind: "nothing-lost";
} | {
    kind: "restored";
    sections: MemorySections;
    entries: RestoredEntry[];
} | {
    kind: "no-room";
    entries: RestoredEntry[];
};
/**
 * The entries `before` carries that `after` genuinely lost.
 *
 * Genuinely lost means all three: the normalized text is gone, every backticked literal it carried is
 * gone from the whole document, and the reply does not declare it superseded. See the module comment
 * for why each test is needed and which measured failure forced it.
 * @param before - the document the model was shown, after batch Z2's plan retired from it.
 * @param after - the sections this reply would store, after retirement stripped what it replaced.
 * @returns the lost entries in document order, grouped by their own section.
 */
export declare function lostEntries(before: MemorySections, after: MemorySections): RestoredEntry[];
/**
 * Restore the entries a reply dropped, if they still fit.
 *
 * The restored text is the old entry verbatim — id included, so its age and any `supersedes:` pointer
 * to it keep working. That is deliberate: rewriting it would make the repair itself a rewrite, and the
 * whole point is that this line says exactly what it said before the pass.
 * @param before - the document the model was shown.
 * @param after - the sections this reply would store.
 * @param cap - the `maxMemoryChars` the document will be stored under.
 * @returns what was lost and, when it fits, the repaired sections.
 */
export declare function repairLostEntries(before: MemorySections, after: MemorySections, cap: number): LostEntryRepair;
