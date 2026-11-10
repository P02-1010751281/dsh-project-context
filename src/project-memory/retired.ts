/**
 * The tombstone channel: `<memory>/retired.md`, one line per memory entry that was retired.
 *
 * Retirement deletes an entry from `MEMORY.md`, so the document alone cannot distinguish a fact that
 * was never learned from one that was deliberately dropped. The tombstone is that record, and it has
 * a second job: the consolidation prompt is a whole-document regeneration driven by the conversation,
 * so a fact deleted yesterday comes straight back the next time the conversation happens to mention
 * it. The digest below is the negative control — dates and titles only, never the reasoning, because
 * the point is to stop a re-write, not to re-inject the retired content.
 *
 * Deliberately not a section of `MEMORY.md`: `sectionsFromMarkdown` accepts exactly the four policy
 * sections, so a fifth heading would turn the whole stored memory opaque and every pass would refuse.
 */

import { lstat } from "node:fs/promises";
import { withMemoryLock } from "../shared/lock.js";
import { readOptional, retiredArchiveFile, retiredFile, writeAtomic } from "../shared/project-state.js";
import { clipTitle } from "../shared/text.js";

/**
 * Why an entry left the document. `superseded-by:<tid>` names the entry that replaced it; the bare
 * `superseded` is its degraded form, used when the declaring entry had no readable id.
 */
export type RetirementReason = "anchor-drift" | "unconfirmed" | "superseded" | `superseded-by:${string}`;

/** One retired fact: when, what (as a one-line title), and why. */
export type Tombstone = { date: string; title: string; reason: string };

const HEADING = "# Retired memory entries";
const ARCHIVE_HEADING = "# Retired memory entries (archived)";
const SEPARATOR = " · ";
const MAX_TITLE_CHARS = 160;

/**
 * Lines the tombstone file may hold before its oldest half moves to `retired-archive.md`.
 *
 * A move, never a delete: the archive is the only place an old tombstone survives, and a tombstone
 * that vanishes quietly is the failure this whole channel exists to prevent.
 */
export const MAX_RETIRED_LINES = 200;

/** Tombstones the consolidation prompt shows. Beyond this the *count* is reported instead. */
export const MAX_DIGEST_ENTRIES = 20;

const TOMBSTONE_RE = /^- (\d{4}-\d{2}-\d{2}) · (.*) · ([a-z][a-z-]*(?::[0-9a-f]+)?)$/;

/** One rendered tombstone line. `title` is clipped and flattened: the format is one line per fact. */
export function tombstoneLine(entry: Tombstone): string {
	return `- ${entry.date}${SEPARATOR}${clipTitle(entry.title, MAX_TITLE_CHARS)}${SEPARATOR}${entry.reason}`;
}

/**
 * Read the tombstones out of a `retired.md`.
 *
 * Anything that is not a tombstone line (the heading, a blank separator, a hand-written note) is
 * skipped rather than rejected: this file is a log, and one malformed line must not cost the pass the
 * twenty good ones next to it.
 */
export function parseTombstones(text: string): Tombstone[] {
	const entries: Tombstone[] = [];
	for (const line of text.split(/\r?\n/)) {
		const match = TOMBSTONE_RE.exec(line.trim());
		if (match === null) continue;
		entries.push({ date: match[1], title: match[2], reason: match[3] });
	}
	return entries;
}

/** Render a tombstone document. The heading is what makes the file readable without the code. */
export function renderTombstones(entries: readonly Tombstone[], heading: string = HEADING): string {
	if (entries.length === 0) return "";
	return `${heading}\n\n${entries.map((entry) => tombstoneLine(entry)).join("\n")}\n`;
}

/**
 * The stored tombstones, read FIFO-safely.
 *
 * `readOptional` is a bare `readFile`, and a path that is a FIFO with no writer blocks the read
 * forever — the same defect batch Z1 introduced and had to fix in the index adoption path. A stat
 * gate costs one syscall and makes the failure mode "no tombstones" instead of "the pass hangs".
 */
export async function readTombstones(projectRoot: string): Promise<Tombstone[]> {
	try {
		const info = await lstat(retiredFile(projectRoot));
		if (!info.isFile()) return [];
		return parseTombstones(await readOptional(retiredFile(projectRoot)));
	} catch {
		return [];
	}
}

/** Read the archived tombstones, for the compression boundary and for tests. */
export async function readArchivedTombstones(projectRoot: string): Promise<Tombstone[]> {
	try {
		const info = await lstat(retiredArchiveFile(projectRoot));
		if (!info.isFile()) return [];
		return parseTombstones(await readOptional(retiredArchiveFile(projectRoot)));
	} catch {
		return [];
	}
}

/**
 * Record tombstones, keeping the file inside `MAX_RETIRED_LINES`.
 *
 * Deduplicated on the rendered line: a fact can be retired again after it is re-learned and retired a
 * second time, and two identical lines would read as two separate facts. The dedupe is by line rather
 * than by date because the same fact retired twice on different days *is* one retirement; the earlier
 * date is the one kept, since that is when the fact was first declared dead.
 *
 * Runs under the memory lock: the read-modify-write would otherwise let two hosts each append and one
 * overwrite the other, which is exactly how a tombstone goes missing.
 */
export async function appendTombstones(projectRoot: string, entries: readonly Tombstone[]): Promise<Tombstone[]> {
	if (entries.length === 0) return readTombstones(projectRoot);
	return withMemoryLock(retiredFile(projectRoot), async () => {
		const existing = await readTombstones(projectRoot);
		const seen = new Set(existing.map((entry) => tombstoneLine(entry)));
		const added: Tombstone[] = [];
		for (const entry of entries) {
			const line = tombstoneLine(entry);
			if (seen.has(line)) continue;
			seen.add(line);
			added.push({ ...entry, title: clipTitle(entry.title, MAX_TITLE_CHARS) });
		}
		if (added.length === 0) return existing;
		const combined = [...existing, ...added];
		if (combined.length <= MAX_RETIRED_LINES) {
			await writeAtomic(retiredFile(projectRoot), renderTombstones(combined));
			return combined;
		}
		// Over the budget: the oldest half moves to the archive. Split on the *current* list before it
		// grew, so a pass that adds three lines does not reshuffle the archive boundary every time.
		const moveCount = Math.floor(combined.length / 2);
		const moved = combined.slice(0, moveCount);
		const kept = combined.slice(moveCount);
		const archived = await readArchivedTombstones(projectRoot);
		await writeAtomic(retiredArchiveFile(projectRoot), renderTombstones([...archived, ...moved], ARCHIVE_HEADING));
		await writeAtomic(retiredFile(projectRoot), renderTombstones(kept));
		return kept;
	});
}

/**
 * The prompt block that stops a retired fact from being written back.
 *
 * Dates and titles only. The reason is left out on purpose: `superseded-by:<tid>` points at a live
 * entry, and quoting it would re-inject the retired content through the back door.
 *
 * Empty when nothing has ever been retired, so a project that never retires anything sends a prompt
 * byte-identical to the one it sent before this channel existed.
 */
export function tombstoneDigest(entries: readonly Tombstone[], limit: number = MAX_DIGEST_ENTRIES): string {
	if (entries.length === 0) return "";
	// The newest entries are the ones the conversation is most likely to bring back.
	const shown = limit > 0 ? entries.slice(-limit) : [];
	const omitted = entries.length - shown.length;
	const lines = [
		"<retired-facts>",
		"These facts were retired from memory. Do not write them back, and do not restate them in other words.",
		...shown.map((entry) => `- ${entry.date} — ${entry.title}`),
		...(omitted > 0 ? [`(${omitted} more retired fact(s) not listed)`] : []),
		"</retired-facts>",
	];
	return lines.join("\n");
}

/**
 * The digest as prompt lines.
 *
 * Exists because the prompt is built by spreading arrays: `...tombstoneDigest(…)` on the empty string
 * spreads nothing, but on a non-empty one it would spread the block *character by character* into the
 * prompt. One function, one shape.
 */
export function tombstoneDigestLines(entries: readonly Tombstone[], limit: number = MAX_DIGEST_ENTRIES): string[] {
	const block = tombstoneDigest(entries, limit);
	return block === "" ? [] : [block];
}
