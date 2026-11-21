/**
 * Expiry, I/O half: read the two sources `expiry.ts` cannot open itself.
 *
 * The split is the same one `staleness.ts` / `staleness-source.ts` uses: the pure module owns the
 * recognition rules and the verdict wording, this one knows that a task is a file under
 * `.agents/memory/tasks/` and a released changelog is a file under `docs/changelog/`.
 *
 * Both reads are conditional on the document actually needing them, because a pass calls this on every
 * consolidation near the cap: a project whose memory cites no task and claims nothing unreleased pays
 * no I/O at all.
 */
import type { TaskMode } from "../shared/config.js";
import type { MemorySections } from "./sections.js";
/** The two fact sets `entryStateOf` reads for these reasons. */
export interface ExpiryFacts {
    /** Id -> the archived task documents it cites. */
    readonly taskClosed: ReadonlyMap<string, readonly string[]>;
    /** Id -> the released changelog that falsifies its unreleased claim. */
    readonly shipped: ReadonlyMap<string, readonly string[]>;
}
/** Neither source was needed, so neither was read. */
export declare const NO_EXPIRY: ExpiryFacts;
/**
 * Measure both sources for one document.
 * @param projectRoot - the checkout the cited paths are relative to.
 * @param sections - the parsed memory document.
 * @param options - the task mode and today's date, which decide a task's derived status.
 * @returns the two fact sets; empty maps mean "nothing to report", never "not checked".
 */
export declare function measureExpiry(projectRoot: string, sections: MemorySections, options: {
    readonly mode: TaskMode;
    readonly today: string;
}): Promise<ExpiryFacts>;
/**
 * Record that a human accepted one expiry reason for one entry, so it stops being reported.
 *
 * The exit for the two reasons no fingerprint can clear. It is keyed by reason, so accepting "the task
 * this cites is closed" never silences "a file it cites changed" — the two are independent claims. It
 * is cleared automatically when the entry's body changes, because the id is derived from the body and
 * the sidecar prunes ids the document no longer carries.
 * @param projectRoot - the project whose sidecar is written.
 * @param tid - the entry id the verdict was computed for.
 * @param reason - the state being accepted; stored as-is, validated by the caller's verdict.
 * @returns whether the marker was written (false when the sidecar could not be updated).
 */
export declare function confirmExpiry(projectRoot: string, tid: string, reason: string): Promise<boolean>;
