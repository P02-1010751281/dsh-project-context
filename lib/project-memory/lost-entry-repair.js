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
 *  - an entry batch Z2's retirement already dropped (a `supersedes:` target, an echo of the pre-prompt
    plan, an anchor drift or an aged-out fact) is not lost, it is retired. The ids come from that pass
    rather than from a second reading of the reply: `retireReply` strips the markers before it returns,
    so a regex over the returned sections can never see a declaration;
 *  - a replacement is declared, not guessed. An entry rewritten with a new symbol and no
    `supersedes:<id>` is restored like a dropped one: the prompt makes the declaration the way to
    replace an entry (`MEMORY_ENTRY_ID_RULE`), the receipt names the restore, and a guessed
    similarity test was rejected after it suppressed a real restore in its own wiring test — the one
    failure mode a repair must not have;
  - `Project` and `Index` are rewritten every pass by design, so they are never repaired;
 *  - the repaired document is re-rendered and re-parsed under the real cap. A repair that would make
 *    the renderer drop something else is reported as `no-room` and the pass keeps the reply it has —
 *    trading one loss for another silently is the failure this module exists to prevent.
 *
 * The output is sections, not text: the caller owns when this runs (after batch Z2's retirement, so a
 * tombstone and a repair can never describe the same entry) and where it lands (the write path).
 */
import { backtickedLiterals, literalSurvives } from "./missing-literals.js";
import { entryTid, stripEntryTid } from "./retirement.js";
import { normalizeMemoryEntry, renderMemoryDocument, sectionsFromMarkdown } from "./sections.js";
/** The two sections a lost entry may be restored to: the ones a pass is not supposed to rewrite. */
export const REPAIRABLE_SECTIONS = ["invariants", "pitfalls"];
/** An entry as the comparison sees it: no id, one line, no surrounding space. */
function comparable(entry) {
    return normalizeMemoryEntry(stripEntryTid(entry));
}
/** The whole document's text, for the literal test — order and headings do not matter there. */
function documentText(sections) {
    return [...sections.project, ...sections.invariants, ...sections.pitfalls, ...sections.index].join("\n");
}
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
export function lostEntries(before, after, retired = new Set()) {
    const afterText = documentText(after);
    const kept = new Set(REPAIRABLE_SECTIONS.flatMap((section) => after[section].map(comparable)));
    const lost = [];
    for (const section of REPAIRABLE_SECTIONS) {
        for (const entry of before[section]) {
            const text = comparable(entry);
            if (text === "" || kept.has(text))
                continue;
            const literals = backtickedLiterals(stripEntryTid(entry));
            // No literal is no evidence: a plain-language entry that was reworded reads exactly like one
            // that was dropped, so it is reported by `removedSectionEntries` and never repaired.
            if (literals.length === 0)
                continue;
            if (literals.some((literal) => literalSurvives(literal, afterText)))
                continue;
            // Everything below is a refusal, in the order the failures were measured: an entry this pass
            // retired is gone on purpose, and one a new entry restates was renamed.
            const id = entryTid(entry);
            if (id !== undefined && retired.has(id))
                continue;
            lost.push({ section, entry });
        }
    }
    return lost;
}
/**
 * Restore the entries a reply dropped, if they still fit.
 *
 * The restored text is the old entry verbatim — id included, so its age and any `supersedes:` pointer
 * to it keep working. That is deliberate: rewriting it would make the repair itself a rewrite, and the
 * whole point is that this line says exactly what it said before the pass.
 * @param before - the document the model was shown.
 * @param after - the sections this reply would store.
 * @param cap - the `maxMemoryChars` the document will be stored under.
 * @param retired - ids batch Z2's retirement already dropped; never restored.
 * @returns what was lost and, when it fits, the repaired sections.
 */
export function repairLostEntries(before, after, cap, retired = new Set()) {
    const entries = lostEntries(before, after, retired);
    if (entries.length === 0)
        return { kind: "nothing-lost" };
    const sections = { ...after };
    for (const section of REPAIRABLE_SECTIONS) {
        const restored = entries.filter((entry) => entry.section === section).map((entry) => entry.entry);
        if (restored.length > 0)
            sections[section] = [...sections[section], ...restored];
    }
    const rendered = renderMemoryDocument(sections, cap);
    if (rendered.sectionDropped > 0 || rendered.droppedItems > 0 || rendered.itemTruncated > 0) {
        return { kind: "no-room", entries };
    }
    // Prove the text came back rather than trusting the renderer's counts: a parser round trip is the
    // only thing that shows the restored lines are entries the next pass will read again.
    const landed = sectionsFromMarkdown(rendered.text);
    if (landed === undefined)
        return { kind: "no-room", entries };
    const kept = new Set(REPAIRABLE_SECTIONS.flatMap((section) => landed[section].map(comparable)));
    const missing = entries.filter((entry) => !kept.has(comparable(entry.entry)));
    if (missing.length > 0)
        return { kind: "no-room", entries };
    return { kind: "restored", sections, entries };
}
