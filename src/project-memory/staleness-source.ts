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
	type StalenessFacts,
	UNCHECKED_STALENESS,
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

/**
 * Measure the current staleness of a document without touching the sidecar.
 *
 * Used by `/memory` status, which is a read-only receipt: it hashes what the bindings name and reports
 * the verdict, and a missing sidecar is a named `unknown` rather than a clean bill of health.
 * @param projectRoot - the project whose memory is being read.
 * @param document - the loaded memory text.
 * @returns the verdict the receipt renders.
 */
export async function measureStaleness(projectRoot: string, document: string): Promise<StalenessFacts> {
	const sections = sectionsFromMarkdown(document);
	if (sections === undefined) return UNCHECKED_STALENESS;
	const sidecar = await readEntrySidecar(projectRoot);
	if (!sidecar.readable) return UNCHECKED_STALENESS;
	const files = await fingerprintAll(projectRoot, boundPaths(sidecar.sources));
	return summariseStaleness(sections, asBindings(sidecar.sources), files);
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
		const merged = new Map(current.sources);
		for (const [tid, bindings] of nextSources) merged.set(tid, bindings);
		const pruned = pruneSidecar({ entries: current.entries, sources: merged }, ids);
		return { entries: pruned.entries, sources: pruned.sources };
	});
	return { facts, written: true };
}
