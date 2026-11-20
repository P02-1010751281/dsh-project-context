/**
 * The one owner of `.agents/memory/entries.json`, the plugin's sidecar for facts **about entries**
 * that must not ride in the bullet text.
 *
 * Two such facts live here:
 *
 * - `entries`: `<tid> -> YYYY-MM-DD`, when the entry was first seen (batch Z2's age clock). It cannot
 *   ride in the bullet because eleven extra characters per entry pushed this project's document from
 *   a clean render to seven dropped entries (measured 2026-11-10).
 * - `sources`: `<tid> -> { <path>: <sha256-prefix> }`, what the entry cited when it was authored
 *   (batch V). It cannot ride in the bullet either — the tid is derived from the body, so a
 *   fingerprint inside the body would change the entry's identity every time a cited file changed,
 *   resetting both the age clock and the very comparison the fingerprint exists for.
 *
 * Both maps are pruned by the same `keep` set, so an id that no longer exists in the document leaves
 * nothing behind. The file is deliberately gitignored: it is a clock and a cache, not a fact — the
 * journal remains the authority, and losing this file degrades to "no known age / no known baseline",
 * which keeps entries rather than retiring them.
 *
 * Version 2 added `sources`. A v2 file is readable by v1 code (it only reads `entries`) and a v1 file
 * is readable here (`sources` defaults to `{}`), so the upgrade needs no migration step.
 */
/** The sidecar document, both halves optional on read and always both present on write. */
export interface EntrySidecar {
    readonly entries: ReadonlyMap<string, string>;
    readonly sources: ReadonlyMap<string, ReadonlyMap<string, string>>;
    /**
     * False when the file exists but could not be parsed. Distinct from "read, nothing recorded": a
     * caller that printed `stale 0` for an unreadable sidecar would report a clean memory it never read.
     * An absent file is readable-and-empty (a project that has never recorded anything).
     */
    readonly readable: boolean;
}
/** What a write replaces: the merged maps the caller computed under the lock. */
export interface EntrySidecarDocument {
    readonly entries: ReadonlyMap<string, string>;
    readonly sources: ReadonlyMap<string, ReadonlyMap<string, string>>;
}
/** The write-side version. A reader that predates it still finds `entries` where it expects it. */
export declare const ENTRY_SIDECAR_VERSION = 2;
/**
 * Read the sidecar. A missing, unreadable or malformed file reads as "nothing known": the caller must
 * then keep entries rather than treat them as ageless or unbound.
 * @param projectRoot - the project whose `.agents/memory` holds the file.
 * @returns both maps, with legacy four-hex ids published under the three-hex id the document carries.
 */
export declare function readEntrySidecar(projectRoot: string): Promise<EntrySidecar>;
/**
 * Read-modify-write the sidecar under the memory lock.
 *
 * The update runs inside the lock on purpose: every caller merges into what is on disk (an earliest-wins
 * date, a binding the other process recorded), so a merge computed outside the lock would silently drop
 * a concurrent writer's newer fact. Returning `undefined` means "nothing to write" and skips the file.
 * @param projectRoot - the project whose `.agents/memory` holds the file.
 * @param update - turns the current maps into the maps to persist, or `undefined` to write nothing.
 */
export declare function updateEntrySidecar(projectRoot: string, update: (current: EntrySidecar) => EntrySidecarDocument | undefined): Promise<void>;
/** Drop every id the landed document no longer carries, from both maps. */
export declare function pruneSidecar(document: EntrySidecarDocument, keep: ReadonlySet<string>): EntrySidecarDocument;
