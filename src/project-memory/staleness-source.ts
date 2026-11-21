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

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { anchorCandidates, isLocalArtifact } from "./anchors.js";
import { readEntrySidecar, pruneSidecar, updateEntrySidecar } from "./entry-sidecar.js";
import { entryTid } from "./retirement.js";
import type { MemorySections } from "./sections.js";
import { sectionsFromMarkdown } from "./sections.js";
import {
	type FileState,
	type SourceBindings,
	type StaleEntry,
	type StalenessFacts,
	UNCHECKED_STALENESS,
	staleEntriesOf,
	summariseStaleness,
} from "./staleness.js";

/** The memory's own directory: rewritten by the consolidation pass, so never a source. */
const MEMORY_DIR_PREFIX = ".agents/memory/";

/**
 * Directories whose contents are **generated**. Binding them would mark an entry stale after a build
 * that changed nothing it asserts: four live entries cite `lib/client.js`, which `pnpm build` rewrites
 * on every client edit. The spec's self-reference exclusion missed this class; the review caught it
 * (evidence: the preflight attributes 4 anchors to `lib/client.js`).
 */
const GENERATED_PREFIXES: readonly string[] = ["lib/"];

/** How many hex characters of the SHA-256 are kept. Change detection, not a signature. */
export const FINGERPRINT_LENGTH = 16;

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
export async function bindableAnchors(entry: string, projectRoot: string): Promise<string[]> {
	const paths: string[] = [];
	const seen = new Set<string>();
	for (const token of anchorCandidates(entry)) {
		const candidate = token.path;
		if (path.isAbsolute(candidate)) continue;
		if (candidate.startsWith(MEMORY_DIR_PREFIX) || candidate.includes("/.agents/memory/")) continue;
		if (GENERATED_PREFIXES.some((prefix) => candidate.startsWith(prefix))) continue;
		if (isLocalArtifact(candidate)) continue;
		const absolute = path.join(projectRoot, candidate);
		try {
			if (!(await stat(path.dirname(absolute))).isDirectory()) continue;
			if (!(await stat(absolute)).isFile()) continue;
		} catch {
			continue;
		}
		if (seen.has(candidate)) continue;
		seen.add(candidate);
		paths.push(candidate);
	}
	return paths;
}

/** The fingerprint of one file, or the named reason it cannot be read. */
async function fingerprint(projectRoot: string, relative: string): Promise<FileState> {
	const absolute = path.join(projectRoot, relative);
	let stats;
	try {
		stats = await stat(absolute);
	} catch (error: unknown) {
		return (error as { code?: string } | undefined)?.code === "ENOENT" ? { kind: "missing" } : { kind: "unreadable" };
	}
	// A FIFO or a directory is not a source we can hash; calling it missing would be a wrong cause.
	if (!stats.isFile()) return { kind: "unreadable" };
	try {
		return { kind: "sha", value: createHash("sha256").update(await readFile(absolute)).digest("hex").slice(0, FINGERPRINT_LENGTH) };
	} catch {
		return { kind: "unreadable" };
	}
}

/** Hash every cited path once, sharing the result across entries and across the stale and baseline miles. */
async function fingerprintAll(projectRoot: string, paths: Iterable<string>): Promise<Map<string, FileState>> {
	const states = new Map<string, FileState>();
	for (const relative of paths) {
		if (states.has(relative)) continue;
		states.set(relative, await fingerprint(projectRoot, relative));
	}
	return states;
}

/** The entries of a parsed document, as `[tid, entry]` pairs; entries without an id are skipped. */
function identifiedEntries(sections: MemorySections): Array<[string, string]> {
	const found: Array<[string, string]> = [];
	for (const key of Object.keys(sections) as (keyof MemorySections)[]) {
		for (const entry of sections[key]) {
			const tid = entryTid(entry);
			if (tid !== undefined) found.push([tid, entry]);
		}
	}
	return found;
}

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
export function mergeBaselines(
	current: ReadonlyMap<string, ReadonlyMap<string, string>>,
	next: ReadonlyMap<string, ReadonlyMap<string, string>>,
): Map<string, ReadonlyMap<string, string>> {
	const merged = new Map(current);
	for (const [tid, bindings] of next) {
		if (current.has(tid)) continue;
		merged.set(tid, bindings);
	}
	return merged;
}

/** A binding map as the pure core expects it (plain records, no Map identity). */
function asBindings(sources: ReadonlyMap<string, ReadonlyMap<string, string>>): SourceBindings {
	const out: Record<string, Record<string, string>> = {};
	for (const [tid, bindings] of sources) out[tid] = Object.fromEntries(bindings);
	return out;
}

/** Every path any binding names, for one hashing pass. */
function boundPaths(sources: ReadonlyMap<string, ReadonlyMap<string, string>>): Set<string> {
	const paths = new Set<string>();
	for (const bindings of sources.values()) for (const relative of bindings.keys()) paths.add(relative);
	return paths;
}

/** What one read of the store says, for both the count a receipt prints and the list a command shows. */
export interface StalenessReading {
	readonly facts: StalenessFacts;
	/** Every stale entry, not only the three `facts.staleIds` a short receipt may name. */
	readonly stale: readonly StaleEntry[];
}

/** The reading of a document that could not be judged: a named absence, never a clean bill of health. */
const UNCHECKED_READING: StalenessReading = { facts: UNCHECKED_STALENESS, stale: [] };

/**
 * Measure the current staleness of a document without touching the sidecar.
 *
 * Used by `/memory` status and `/memory reconcile`, both read-only: it hashes what the bindings name and
 * reports what it found, and a missing sidecar is a named `unknown` rather than a clean bill of health.
 * @param projectRoot - the project whose memory is being read.
 * @param document - the loaded memory text.
 * @returns the verdict and the per-entry detail it was folded from.
 */
export async function measureStalenessDetail(projectRoot: string, document: string): Promise<StalenessReading> {
	const sections = sectionsFromMarkdown(document);
	if (sections === undefined) return UNCHECKED_READING;
	const sidecar = await readEntrySidecar(projectRoot);
	if (!sidecar.readable) return UNCHECKED_READING;
	const files = await fingerprintAll(projectRoot, boundPaths(sidecar.sources));
	const bindings = asBindings(sidecar.sources);
	return {
		facts: summariseStaleness(sections, bindings, files),
		stale: staleEntriesOf(sections, bindings, files),
	};
}

/**
 * The counts only, for a caller that has no channel to act on a single entry.
 * @param projectRoot - the project whose memory is being read.
 * @param document - the loaded memory text.
 * @returns the verdict the receipt renders.
 */
export async function measureStaleness(projectRoot: string, document: string): Promise<StalenessFacts> {
	return (await measureStalenessDetail(projectRoot, document)).facts;
}

/** What one explicit acceptance did. Every failure is named, because the receipt repeats it. */
export type AcceptOutcome =
	/** The baseline is now what the cited files say; `paths` are the ones that had changed. */
	| { readonly status: "accepted"; readonly paths: readonly string[] }
	/** No entry in this document carries the id. */
	| { readonly status: "unknown-entry" }
	/** The entry exists but cites no checkable file: nothing to re-baseline. */
	| { readonly status: "no-binding" }
	/** Every cited file still matches its baseline: the acceptance would be a no-op. */
	| { readonly status: "not-stale" }
	/** A cited file is gone: that is anchor drift, which the retirement pass owns, not a re-baseline. */
	| { readonly status: "anchor-missing"; readonly paths: readonly string[] }
	/** A cited file could not be read: writing a baseline would freeze an unread state as truth. */
	| { readonly status: "unreadable"; readonly paths: readonly string[] }
	/** The sidecar or the document could not be parsed: nothing is judged, nothing is written. */
	| { readonly status: "unreadable-store" }
	/** Another writer replaced the entry's baseline between the read and the write. */
	| { readonly status: "raced" };

/** True when two binding maps say the same thing, order-independently. */
function sameBindings(
	left: ReadonlyMap<string, string>,
	right: ReadonlyMap<string, string>,
): boolean {
	if (left.size !== right.size) return false;
	for (const [path, fingerprint] of left) if (right.get(path) !== fingerprint) return false;
	return true;
}

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
export async function acceptStaleness(projectRoot: string, document: string, tid: string): Promise<AcceptOutcome> {
	const sections = sectionsFromMarkdown(document);
	if (sections === undefined) return { status: "unreadable-store" };
	const sidecar = await readEntrySidecar(projectRoot);
	if (!sidecar.readable) return { status: "unreadable-store" };
	if (!identifiedEntries(sections).some(([id]) => id === tid)) return { status: "unknown-entry" };
	const binding = sidecar.sources.get(tid);
	if (binding === undefined || binding.size === 0) return { status: "no-binding" };
	const states = await fingerprintAll(projectRoot, [...binding.keys()]);
	const missing = [...binding.keys()].filter((relative) => states.get(relative)?.kind === "missing");
	if (missing.length > 0) return { status: "anchor-missing", paths: missing };
	const unreadable = [...binding.keys()].filter((relative) => {
		const state = states.get(relative);
		return state === undefined || state.kind === "unreadable";
	});
	if (unreadable.length > 0) return { status: "unreadable", paths: unreadable };
	const changed = [...binding.keys()].filter((relative) => {
		const state = states.get(relative);
		// Every path is a readable sha by the two refusals above; the guard is for the type, not for a case.
		return state?.kind === "sha" && state.value !== binding.get(relative);
	});
	if (changed.length === 0) return { status: "not-stale" };
	let accepted = false;
	await updateEntrySidecar(projectRoot, (current) => {
		const now = current.sources.get(tid);
		// The compare half: a baseline refreshed after this read is newer evidence than ours.
		if (now === undefined || !sameBindings(now, binding)) return undefined;
		const refreshed = new Map<string, string>();
		for (const [relative, state] of states) if (state.kind === "sha") refreshed.set(relative, state.value);
		const next = new Map(current.sources);
		next.set(tid, refreshed);
		accepted = true;
		// Accepting a content change re-baselines, so no confirmation marker is needed: the fingerprint
		// itself is the record. A reason no fingerprint can clear is recorded by `confirmExpiry`.
		return { entries: current.entries, sources: next, confirmed: current.confirmed };
	});
	if (!accepted) return { status: "raced" };
	return { status: "accepted", paths: changed };
}

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
export async function bindAndMeasure(projectRoot: string, document: string): Promise<{ facts: StalenessFacts; written: boolean }> {
	const sections = sectionsFromMarkdown(document);
	if (sections === undefined) return { facts: UNCHECKED_STALENESS, written: false };
	const sidecar = await readEntrySidecar(projectRoot);
	if (!sidecar.readable) return { facts: UNCHECKED_STALENESS, written: false };
	const entries = identifiedEntries(sections);
	const ids = new Set(entries.map(([tid]) => tid));
	const nextSources = new Map<string, ReadonlyMap<string, string>>();
	for (const [tid, entry] of entries) {
		const existing = sidecar.sources.get(tid);
		if (existing !== undefined && existing.size > 0) {
			// Authored earlier: its baseline is evidence, not a cache. Keep it byte for byte.
			nextSources.set(tid, existing);
			continue;
		}
		const paths = await bindableAnchors(entry, projectRoot);
		if (paths.length === 0) continue;
		const states = await fingerprintAll(projectRoot, paths);
		const bindings = new Map<string, string>();
		for (const relative of paths) {
			const state = states.get(relative);
			// Only a readable file gets a baseline; a missing one is the retirement pass's business.
			if (state?.kind === "sha") bindings.set(relative, state.value);
		}
		if (bindings.size > 0) nextSources.set(tid, bindings);
	}
	const files = await fingerprintAll(projectRoot, boundPaths(nextSources));
	const facts = summariseStaleness(sections, asBindings(nextSources), files);
	await updateEntrySidecar(projectRoot, (current) => {
		const pruned = pruneSidecar({ entries: current.entries, sources: mergeBaselines(current.sources, nextSources), confirmed: current.confirmed }, ids);
		return { entries: pruned.entries, sources: pruned.sources, confirmed: pruned.confirmed };
	});
	return { facts, written: true };
}
