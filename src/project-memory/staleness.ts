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

import { MEMORY_SECTIONS } from "./memory-schema.js";
import type { MemorySections } from "./sections.js";
import { entryTid } from "./retirement.js";

/** `tid -> path -> fingerprint` as recorded when the entry was last authored. */
export type SourceBindings = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** What re-reading one cited file produced now. A missing or unreadable file is never "fresh". */
export type FileState =
	| { readonly kind: "sha"; readonly value: string }
	| { readonly kind: "missing" }
	| { readonly kind: "unreadable" };

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
export const UNCHECKED_STALENESS: StalenessFacts = { bound: 0, stale: 0, staleIds: [], missing: 0, unverifiable: 0, checked: false };

/** How many ids a receipt may name before it stops being a receipt. */
const MAX_NAMED_IDS = 3;

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
export function summariseStaleness(
	sections: MemorySections,
	bindings: SourceBindings,
	files: ReadonlyMap<string, FileState>,
): StalenessFacts {
	let bound = 0;
	let stale = 0;
	let missing = 0;
	let unverifiable = 0;
	const staleIds: string[] = [];
	for (const key of Object.keys(sections) as (keyof MemorySections)[]) {
		for (const entry of sections[key]) {
			const tid = entryTid(entry);
			if (tid === undefined) continue;
			const binding = bindings[tid];
			if (binding === undefined) continue;
			const paths = Object.keys(binding);
			if (paths.length === 0) continue;
			bound += 1;
			let changed = false;
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
				if (current.value !== binding[path]) changed = true;
			}
			if (changed) {
				stale += 1;
				if (staleIds.length < MAX_NAMED_IDS) staleIds.push(tid);
			}
			if (gone) missing += 1;
			if (unknown) unverifiable += 1;
		}
	}
	return { bound, stale, staleIds, missing, unverifiable, checked: true };
}

/**
 * The receipt clause, in the same voice as the `/memory` status line next to it.
 *
 * Zero is printed as zero (`stale 0`), because "checked and clean" is a fact worth stating; an
 * unmeasured verdict prints `stale unknown` and never `0`.
 * @param facts - the summarised verdict.
 * @returns one clause, no trailing separator.
 */
export function stalenessClause(facts: StalenessFacts): string {
	if (!facts.checked) return "stale unknown (source bindings could not be read)";
	if (facts.bound === 0) return "stale 0 (no entry cites a bound file yet)";
	const named = facts.staleIds.length > 0 ? `: ${facts.staleIds.join(", ")}` : "";
	const parts = [`${facts.bound} bound entr${facts.bound === 1 ? "y" : "ies"}`, `stale ${facts.stale}${named}`];
	if (facts.missing > 0) parts.push(`missing ${facts.missing}`);
	if (facts.unverifiable > 0) parts.push(`unverifiable ${facts.unverifiable}`);
	return parts.join(" · ");
}

/** Section headings the document may carry, exported for the adapter's own sanity checks. */
export const STALENESS_SECTIONS: readonly string[] = MEMORY_SECTIONS.map((section) => section.heading);
