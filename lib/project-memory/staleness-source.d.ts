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
import { type StalenessFacts } from "./staleness.js";
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
 * Measure the current staleness of a document without touching the sidecar.
 *
 * Used by `/memory` status, which is a read-only receipt: it hashes what the bindings name and reports
 * the verdict, and a missing sidecar is a named `unknown` rather than a clean bill of health.
 * @param projectRoot - the project whose memory is being read.
 * @param document - the loaded memory text.
 * @returns the verdict the receipt renders.
 */
export declare function measureStaleness(projectRoot: string, document: string): Promise<StalenessFacts>;
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
