/**
 * Batch V, layout half: read the cited files, fingerprint them, and keep the sidecar's binding map in
 * step with the memory document.
 *
 * The split mirrors `status-report.ts` (pure wording) + `status-source.ts` (the `.agents/memory` layout):
 * `staleness.ts` decides freshness from plain maps and never opens anything, while this file is the only
 * one that knows a binding is a path on this disk and that the fingerprints live in `entries.json`.
 *
 * Two rules from the retirement side are reused rather than re-implemented: the lexical recognition
 * (`anchorCandidates`) and the local-artifact exclusion (`isLocalArtifact`). The extra guards here are
 * the ones that only matter for *reading* a file: it must be repo-relative, it must be a regular file
 * (a FIFO with no writer blocks `readFile` forever, the hang batch Z1 had to fix), and it must not live
 * under `.agents/memory/` — that directory is rewritten by this very pass, so binding it would mark
 * every entry stale the moment anything is written.
 */
import { type StaleEntry, type StalenessFacts } from "./staleness.js";
/** How many hex characters of the SHA-256 are kept. Change detection, not a signature. */
export declare const FINGERPRINT_LENGTH = 16;
/**
 * The files one entry may be bound to, as repo-relative paths in document order.
 *
 * Ambiguity is skipped rather than guessed, exactly like drift detection: a token whose parent
 * directory does not exist could be an abbreviation or another checkout, and binding it would produce a
 * permanent false `missing`.
 * @param entry - one memory bullet.
 * @param projectRoot - the checkout the paths are relative to.
 * @returns paths that exist as regular files inside this project.
 */
export declare function bindableAnchors(entry: string, projectRoot: string): Promise<string[]>;
/**
 * The merge half of `bindAndMeasure`, pure so the raced state can be tested without interleaving.
 *
 * Only a tid that had no baseline is written. For an existing one, `next` holds the value this pass read
 * *before* it hashed the files, so writing it would undo a baseline another writer recorded in between —
 * an explicit `/memory reconcile --accept` is exactly that writer, and the overwrite is invisible: the
 * entry is simply reported stale again, and the user re-runs the command that appeared to work.
 * A single writer cannot tell the difference, because in that case `next` copies the stored value.
 * @param current - the sidecar's baseline map, re-read inside the write lock.
 * @param next - the map this pass computed, including entries it just bound for the first time.
 * @returns the map to write.
 */
export declare function mergeBaselines(current: ReadonlyMap<string, ReadonlyMap<string, string>>, next: ReadonlyMap<string, ReadonlyMap<string, string>>): Map<string, ReadonlyMap<string, string>>;
/** What one read of the store says, for both the count a receipt prints and the list a command shows. */
export interface StalenessReading {
    readonly facts: StalenessFacts;
    /** Every stale entry, not only the three `facts.staleIds` a short receipt may name. */
    readonly stale: readonly StaleEntry[];
}
/**
 * Measure the current staleness of a document without touching the sidecar.
 *
 * Used by `/memory` status and `/memory reconcile`, both read-only: it hashes what the bindings name and
 * reports what it found, and a missing sidecar is a named `unknown` rather than a clean bill of health.
 * @param projectRoot - the project whose memory is being read.
 * @param document - the loaded memory text.
 * @returns the verdict and the per-entry detail it was folded from.
 */
export declare function measureStalenessDetail(projectRoot: string, document: string): Promise<StalenessReading>;
/**
 * The counts only, for a caller that has no channel to act on a single entry.
 * @param projectRoot - the project whose memory is being read.
 * @param document - the loaded memory text.
 * @returns the verdict the receipt renders.
 */
export declare function measureStaleness(projectRoot: string, document: string): Promise<StalenessFacts>;
/** What one explicit acceptance did. Every failure is named, because the receipt repeats it. */
export type AcceptOutcome = 
/** The baseline is now what the cited files say; `paths` are the ones that had changed. */
{
    readonly status: "accepted";
    readonly paths: readonly string[];
}
/** No entry in this document carries the id. */
 | {
    readonly status: "unknown-entry";
}
/** The entry exists but cites no checkable file: nothing to re-baseline. */
 | {
    readonly status: "no-binding";
}
/** Every cited file still matches its baseline: the acceptance would be a no-op. */
 | {
    readonly status: "not-stale";
}
/** A cited file is gone: that is anchor drift, which the retirement pass owns, not a re-baseline. */
 | {
    readonly status: "anchor-missing";
    readonly paths: readonly string[];
}
/** A cited file could not be read: writing a baseline would freeze an unread state as truth. */
 | {
    readonly status: "unreadable";
    readonly paths: readonly string[];
}
/** The sidecar or the document could not be parsed: nothing is judged, nothing is written. */
 | {
    readonly status: "unreadable-store";
}
/** Another writer replaced the entry's baseline between the read and the write. */
 | {
    readonly status: "raced";
};
/**
 * Re-baseline one entry: record the current fingerprints of the files it cites, so it stops being
 * reported as stale.
 *
 * The one write path that may refresh a baseline for an unchanged body. `bindAndMeasure` never does —
 * a body change mints a new id and therefore a new baseline, which is what "re-read and re-verified"
 * looks like mechanically — so without this an entry confirmed still true would be reported stale
 * forever and the count could only grow.
 *
 * Three refusals are deliberate: a missing anchor belongs to the retirement pass, an unreadable one
 * must not be frozen as truth, and a baseline that changed under the read is not overwritten (the
 * compare-and-swap below), because that write would silently undo a concurrent acceptance.
 * @param projectRoot - the project whose sidecar is written.
 * @param document - the loaded memory text the id was read from.
 * @param tid - the entry id to accept.
 * @returns what happened, named.
 */
export declare function acceptStaleness(projectRoot: string, document: string, tid: string): Promise<AcceptOutcome>;
/**
 * Record baselines for entries that have none, then measure the whole document.
 *
 * Run after the memory landed. The invariant that makes the comparison meaningful: a binding is written
 * **once**, when the entry is authored, and is never refreshed while the entry's body stays the same.
 * The entry id is a hash of the body, so the model re-authoring the fact mints a new id and therefore a
 * new baseline — that is what "re-read and re-verified" looks like mechanically. Refreshing a baseline
 * for an unchanged entry would erase the very drift the feature exists to report.
 * @param projectRoot - the project whose memory just landed.
 * @param document - the memory text that landed.
 * @returns the verdict, plus whether the sidecar was written.
 */
export declare function bindAndMeasure(projectRoot: string, document: string): Promise<{
    facts: StalenessFacts;
    written: boolean;
}>;
