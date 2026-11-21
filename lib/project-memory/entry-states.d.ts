/**
 * One verdict per entry, from every fact this project can afford to gather.
 *
 * The receipts, the acceptance and the consolidation pass all read this rather than re-deriving a
 * verdict — that is what stops two half-detectors from disagreeing again. It is a separate module from
 * `index.ts` so the pass can use it without importing the plugin entry (which would be a cycle).
 */
import type { PluginConfig } from "../shared/config.js";
import { type EntryState } from "./entry-state.js";
/** One entry and the state the single arbiter gave it, with the concrete evidence behind that state. */
export interface MemoryEntryState {
    readonly tid: string;
    readonly state: EntryState;
    /** Paths for `content-stale`, `tasks/<slug>.md (archived)` / `docs/changelog/v<x>.md (marker)` otherwise. */
    readonly detail: string;
}
/** What the arbiter says about a whole document, as both reconcile verbs need it. */
export interface MemoryStates {
    /** False when the sidecar or the document could not be judged: never render zero for this. */
    readonly checked: boolean;
    /** Entries in the document, for the receipt's denominator. */
    readonly total: number;
    /** Every entry that is not healthy, in document order. */
    readonly entries: readonly MemoryEntryState[];
}
/** One entry and the state the single arbiter gave it, with the concrete evidence behind that state. */
export interface MemoryEntryState {
    readonly tid: string;
    readonly state: EntryState;
    /** Paths for `content-stale`, `tasks/<slug>.md (archived)` / `docs/changelog/v<x>.md (marker)` otherwise. */
    readonly detail: string;
}
/** What the arbiter says about a whole document, as both reconcile verbs need it. */
export interface MemoryStates {
    /** False when the sidecar or the document could not be judged: never render zero for this. */
    readonly checked: boolean;
    /** Entries in the document, for the receipt's denominator. */
    readonly total: number;
    /** Every entry that is not healthy, in document order. */
    readonly entries: readonly MemoryEntryState[];
}
/**
 * The state of every entry in one document, from every fact this project can afford to gather.
 *
 * One arbiter (`entryStateOf`), one call: the receipt, the acceptance and the pass all read this rather
 * than re-deriving a verdict, which is what stops two half-detectors from disagreeing again.
 * @param projectRoot - the project the facts are read from.
 * @param text - the loaded memory document.
 * @param config - the effective plugin config, for the task mode.
 * @returns the verdict per entry, and whether anything could be judged at all.
 */
export declare function memoryEntryStates(projectRoot: string, text: string, config: PluginConfig): Promise<MemoryStates>;
