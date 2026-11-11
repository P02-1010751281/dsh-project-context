/**
 * Retirement: the mechanical triggers that take an entry out of `MEMORY.md`.
 *
 * The consolidation pass is a whole-document regeneration, so nothing in it ever *deletes* a fact on
 * purpose — an entry that stopped being true is simply copied forward by the model, forever, until a
 * human notices. These are the deletion half, and every trigger is decidable from the filesystem or
 * from the archive, never from the model's opinion:
 *
 * - **anchor-drift** — the entry points at a path (or a line in it) that no longer exists.
 * - **superseded-by:<tid>** — a newer entry declares itself the replacement of an older one.
 * - **unconfirmed** — the entry is older than 180 days and no archived session mentions it any more.
 *
 * The first two are cheap and exact. The third is a scan over the archive, so it is bounded and
 * deliberately conservative: it only fires when the scan *finished*, and only for entries whose
 * recorded age is past the horizon.
 */
import type { MemorySections } from "./sections.js";
import type { Tombstone } from "./retired.js";
/** Days an entry may go unmentioned in the archive before it is unconfirmed. */
export declare const MAX_UNCONFIRMED_DAYS = 180;
/** Bytes of `session.jsonl` the unconfirmed scan may read in one pass. */
export declare const MENTION_SCAN_BYTE_CAP: number;
/** The id an entry already carries, if any. */
export declare function entryTid(entry: string): string | undefined;
/** The entry with its id removed. */
export declare function stripEntryTid(entry: string): string;
/** The entry carrying `tid` as its trailing id, replacing any id it already had. */
export declare function withEntryTid(entry: string, tid: string): string;
/** A document whose entries all carry an id, plus what the stamping did. */
export type StampedSections = {
    sections: MemorySections;
    /** Ids this call minted, in document order. Their first-seen date is today. */
    added: string[];
    /** Every id the returned document carries. */
    ids: Set<string>;
};
/** Give every entry a stable id, keeping the ones already present. */
export declare function stampEntryIds(sections: MemorySections, taken: ReadonlySet<string>): StampedSections;
/** The `supersedes:` targets declared by the entries of one document, mapped to the declaring id. */
export declare function supersededIds(sections: MemorySections): Map<string, string>;
/** Remove every `supersedes:` declaration from a document (the tombstone already recorded it). */
export declare function stripSupersedesMarkers(sections: MemorySections): MemorySections;
/**
 * The paths in one entry that no longer resolve, as human-readable reasons.
 *
 * The narrowing matters more than the detection. A first pass that treated "contains a slash" as a
 * path reported 30 of 134 entries as stale on this project, and every one was prose (`turn/start`,
 * `origin/main`, `provider/model`, `W/450000`). Two rules cut that to the honest set, calibrated
 * against the real document on 2026-11-10 (35 checked and clean, 7 unverifiable, 0 drift):
 *
 * 1. The token must end in a source/document extension, so a slash-separated phrase is not a path.
 * 2. The **parent directory must exist**. A missing parent means the token could be an abbreviation
 *    (`2026-10-06-…/roundtrip.mjs`, sharing the `.agents/evidence/` prefix of the path before it) or a
 *    path belonging to another checkout (`packages/subagent/…`, and `scripts/dsh-plugin-patches/…`
 *    which lives under `/etc/nixos`), and neither is drift. Retiring a true fact is far worse than
 *    keeping a stale one, so anything ambiguous is skipped rather than guessed.
 *
 * The cost of rule 2 is a blind spot: deleting an entire directory goes unnoticed here. That is
 * deliberate — the alternative flags every cross-repo reference as dead.
 */
export declare function anchorDriftReasons(entry: string, projectRoot: string): string[];
/** The most distinctive token of an entry, or `undefined` when it is pure prose. */
export declare function mentionNeedle(entry: string): string | undefined;
export type MentionScan = {
    /** Needles an archived session still mentions. */
    mentioned: Set<string>;
    /** Bytes of archive text actually read. */
    scannedBytes: number;
    /**
     * Whether the scan covered every session inside the horizon. `false` means the byte cap stopped
     * it, and no entry may be called unconfirmed on an incomplete scan.
     */
    complete: boolean;
};
/**
 * Look for needles in the archive of the last `sinceMs`-to-now window.
 *
 * Newest first, so a bounded scan covers the conversations most likely to mention a live fact. The
 * answer is tri-state by design: a needle found is "still in play", a needle absent from a *complete*
 * scan is "gone", and an incomplete scan answers nothing at all.
 */
export declare function scanMentions(projectRoot: string, needles: readonly string[], options: {
    sinceMs: number;
    byteCap?: number;
}): Promise<MentionScan>;
export type RetirementContext = {
    projectRoot: string;
    /** `<tid> -> YYYY-MM-DD`, when the id was first seen. Missing ids are stamped today. */
    firstSeen: ReadonlyMap<string, string>;
    /** `YYYY-MM-DD` for entries minted by this pass. */
    today: string;
    /** Epoch ms, injected so the horizon is testable. */
    now: number;
    /**
     * Ids an earlier step of this pass already retired. Their reappearance in the reply is dropped
     * without a second tombstone: the retirement is already on record, and inventing a reason here
     * would name a cause that never applied.
     */
    retiredIds?: ReadonlySet<string>;
    /**
     * Supersede targets read from the raw reply before its `supersedes:` markers were stripped.
     *
     * They have to be captured first and applied second: the marker sits *after* the entry id
     * (`…（5555）supersedes:2222`), so a document still carrying one has an unreadable trailing id and
     * would be stamped with a second one.
     */
    declaredSupersedes?: ReadonlyMap<string, string>;
    /** Injected byte budget for the archive scan, so the incomplete-scan branch is testable. */
    mentionByteCap?: number;
};
export type RetirementResult = {
    /** The document with every retired entry removed and every entry carrying an id. */
    sections: MemorySections;
    /** Tombstones to record if the write lands. */
    retired: Tombstone[];
    /** Every id the returned document carries. */
    ids: Set<string>;
    /** Ids minted by this call, whose first-seen date is `today`. */
    added: string[];
    /** Ids this call removed from the document. An echo of one of these is dropped, not re-retired. */
    droppedIds: Set<string>;
};
/**
 * Apply every trigger to one document and report what left it.
 *
 * `supersedes:` is honoured here, so a stored document that already carries a declaration retires its
 * target even when the model does not repeat it.
 */
export declare function retireSections(sections: MemorySections, context: RetirementContext): Promise<RetirementResult>;
/**
 * The reply half: honour the reply's own `supersedes:` declarations, drop the echoes of what this pass
 * already retired, then run the same triggers over what is left.
 *
 * The echo guard is not paranoia. The retired entries were removed from `<existing-memory>` before the
 * model saw it, but the same fact is usually still in the conversation that drives the regeneration,
 * and a model that re-derives it from there would put back exactly what the pre-prompt pass removed.
 */
export declare function retireReply(sections: MemorySections, context: RetirementContext, cap: number): Promise<RetirementResult & {
    stamped: boolean;
}>;
/** Whether a four-section document still holds at least one entry. */
export declare function sectionsHaveEntries(sections: MemorySections): boolean;
/** All entry ids in a document, for the sidecar prune. */
export declare function documentIds(sections: MemorySections): Set<string>;
/** When each known entry id was first seen. An unreadable file reads as "nothing known". */
export declare function readEntryDates(projectRoot: string): Promise<Map<string, string>>;
/**
 * Merge first-seen dates into the sidecar, keeping the earliest date any writer has recorded.
 *
 * Earliest-wins rather than last-wins because the value is an *age*: two hosts that both learn an id
 * would otherwise keep resetting a fact's clock depending on which one wrote last, and an entry could
 * never age out. Runs under the memory lock for the same reason the tombstone file does.
 */
export declare function recordEntryDates(projectRoot: string, dates: ReadonlyMap<string, string>, keep?: ReadonlySet<string>): Promise<void>;
/** Every entry id removed from each step of a pass, for the reply's echo guard. */
export declare function stripEntryIds(sections: MemorySections): MemorySections;
/**
 * Retire, then stamp ids — but never at the price of a whole entry.
 *
 * The ids are six characters per entry, and a memory that is already at its cap drops whole entries to
 * make room. Measured on this project 2026-11-10: a document at 43720 of 45000 characters stays clean
 * with the bare ids (+804) but loses 7 entries with the dated marker (+3082).
 *
 * A partial stamp, not all-or-nothing: when the whole document cannot afford every id, the ids that DO
 * fit still land, in priority order — Invariants then Pitfalls, the two sections retirement ages and
 * `supersedes:` read, then Project and Index, which are rewritten every pass. The spare characters are
 * measured from the plain render, so an id can only ever spend leftover room; the alternative was that
 * one character of overflow silently dropped every id and reset every age. Measured here 2026-11-11:
 * 782 characters of headroom = 130 ids, enough for all 107 Invariants/Pitfalls entries.
 *
 * Ids are content-derived, so the stamped prefix keeps exactly the ids a full stamp would have minted:
 * a body's id never changes just because the budget changed (see `tidFor`).
 */
export declare function retireWithinBudget(sections: MemorySections, context: RetirementContext, cap: number): Promise<RetirementResult & {
    stamped: boolean;
}>;
