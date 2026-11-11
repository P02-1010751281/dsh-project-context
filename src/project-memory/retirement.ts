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

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { MEMORY_GITIGNORE_LINES } from "../shared/gitignore.js";
import { MAX_LIST_ITEM_CHARS } from "../shared/limits.js";
import { withMemoryLock } from "../shared/lock.js";
import { entryDatesFile, logsDir, readOptional, writeAtomic } from "../shared/project-state.js";
import type { MemorySections } from "./sections.js";
import { normalizeMemoryEntry, renderMemoryDocument } from "./sections.js";
import type { RetirementReason, Tombstone } from "./retired.js";

/** Days an entry may go unmentioned in the archive before it is unconfirmed. */
export const MAX_UNCONFIRMED_DAYS = 180;

/** Bytes of `session.jsonl` the unconfirmed scan may read in one pass. */
export const MENTION_SCAN_BYTE_CAP = 32 * 1024 * 1024;

/**
 * The entry id: four hex characters in a trailing full-width parenthetical.
 *
 * Six characters per entry on a document that had 1280 characters of headroom on 2026-11-10, which is
 * why the date is not part of it (see `entryDatesFile`). The id has to live in the bullet because the
 * model has to copy it: a `supersedes:` reference is meaningless if the id is only known to the code.
 */
const TID_MARKER = /（([0-9a-f]{4})）(?:\s*(?:supersedes|取代)\s*[:：]\s*[0-9a-f]{4})?\s*$/;
const TID_TAIL = /\s*（[0-9a-f]{4}）\s*$/;

/** `supersedes:4f2a` (or the Chinese `取代：4f2a`) inside a bullet body. */
const SUPERSEDES_MARKER = /\s*(?:supersedes|取代)\s*[:：]\s*([0-9a-f]{4})/g;

const HEX4 = /^[0-9a-f]{4}$/;

/** The id an entry already carries, if any. */
export function entryTid(entry: string): string | undefined {
	const match = TID_MARKER.exec(entry.trimEnd());
	return match?.[1];
}

/** The entry with its id removed. */
export function stripEntryTid(entry: string): string {
	return entry.replace(TID_TAIL, "");
}

/** The entry carrying `tid` as its trailing id, replacing any id it already had. */
export function withEntryTid(entry: string, tid: string): string {
	return `${stripEntryTid(entry).trimEnd()}（${tid}）`;
}

/**
 * A deterministic four-hex id for one entry body, salted until it is unused.
 *
 * Content-derived rather than random so the same body keeps the same id across a lost marker, a
 * restored document and a re-run test; the salt only breaks a genuine collision inside one document.
 */
function tidFor(body: string, taken: ReadonlySet<string>): string {
	const base = createHash("sha256").update(normalizeMemoryEntry(stripEntryTid(body))).digest("hex");
	for (let salt = 0; salt < 4096; salt += 1) {
		const tid = (salt === 0 ? base : createHash("sha256").update(`${salt}:${base}`).digest("hex")).slice(0, 4);
		if (!taken.has(tid)) return tid;
	}
	throw new Error("entry id space exhausted: 4096 salts could not find a free four-hex id");
}

/** A document whose entries all carry an id, plus what the stamping did. */
export type StampedSections = {
	sections: MemorySections;
	/** Ids this call minted, in document order. Their first-seen date is today. */
	added: string[];
	/** Every id the returned document carries. */
	ids: Set<string>;
};

/** Give every entry a stable id, keeping the ones already present. */
export function stampEntryIds(sections: MemorySections, taken: ReadonlySet<string>): StampedSections {
	const ids = new Set(taken);
	const added: string[] = [];
	const stamped = {} as MemorySections;
	for (const key of Object.keys(sections) as (keyof MemorySections)[]) {
		stamped[key] = sections[key].map((entry) => {
			const existing = entryTid(entry);
			if (existing !== undefined) {
				ids.add(existing);
				return entry;
			}
			const tid = tidFor(entry, ids);
			ids.add(tid);
			added.push(tid);
			return withEntryTid(entry, tid);
		});
	}
	return { sections: stamped, added, ids };
}

/** The `supersedes:` targets declared by the entries of one document, mapped to the declaring id. */
export function supersededIds(sections: MemorySections): Map<string, string> {
	const targets = new Map<string, string>();
	for (const key of Object.keys(sections) as (keyof MemorySections)[]) {
		for (const entry of sections[key]) {
			const self = entryTid(entry) ?? "";
			SUPERSEDES_MARKER.lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = SUPERSEDES_MARKER.exec(entry)) !== null) {
				// A self-declaration would retire the replacement along with the replaced: ignored rather
				// than resolved.
				if (match[1] === self) continue;
				targets.set(match[1], self);
			}
		}
	}
	return targets;
}

/** Remove every `supersedes:` declaration from a document (the tombstone already recorded it). */
export function stripSupersedesMarkers(sections: MemorySections): MemorySections {
	const stripped = {} as MemorySections;
	for (const key of Object.keys(sections) as (keyof MemorySections)[]) {
		stripped[key] = sections[key].map((entry) => {
			SUPERSEDES_MARKER.lastIndex = 0;
			return entry.replace(SUPERSEDES_MARKER, "").trimEnd();
		});
	}
	return stripped;
}

/**
 * The plugin's own local artifacts, as matchers.
 *
 * A missing `errors.log` is not a broken anchor: the file exists only once something has failed, and a
 * fresh clone has none of these at all. Built from the one list the `.gitignore` writer uses, so a new
 * artifact is covered by adding its line there and nowhere else.
 */
const LOCAL_ARTIFACTS = MEMORY_GITIGNORE_LINES.map((line) => new RegExp(`^${line.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`));

function isLocalArtifact(candidate: string): boolean {
	const base = candidate.split("/").pop() ?? "";
	return LOCAL_ARTIFACTS.some((pattern) => pattern.test(base));
}

const ANCHOR_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts", "json", "md", "yml", "yaml", "sh", "log", "txt", "lock", "toml", "html", "css", "patch"]);

/**
 * Absolute or multi-segment paths with an optional `:line` / `:line-line` suffix, preceded by a
 * boundary character so an inline code span or a parenthesis opens a candidate.
 */
const ANCHOR = /(?:^|[\s(（`'"[：:，,])((?:\/|[\w.@+-]+\/)+[\w.@+-]+)(?::(\d+)(?:[–-](\d+))?)?/g;

function anchorExtension(candidate: string): string | undefined {
	const base = candidate.split("/").pop() ?? "";
	const dot = base.lastIndexOf(".");
	return dot <= 0 ? undefined : base.slice(dot + 1).toLowerCase();
}

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
export function anchorDriftReasons(entry: string, projectRoot: string): string[] {
	const reasons: string[] = [];
	const seen = new Set<string>();
	ANCHOR.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = ANCHOR.exec(entry)) !== null) {
		const candidate = match[1];
		if (candidate.includes("{") || candidate.includes("*")) continue;
		const extension = anchorExtension(candidate);
		if (extension === undefined || !ANCHOR_EXTENSIONS.has(extension)) continue;
		// The plugin's own ignored outputs: absent until something writes them, so absence proves nothing.
		if (isLocalArtifact(candidate)) continue;
		const absolute = candidate.startsWith("/") ? candidate : path.join(projectRoot, candidate);
		// Rule 2: an unreadable or absent parent means this token is not a checkable project path.
		try {
			if (!lstatSync(path.dirname(absolute)).isDirectory()) continue;
		} catch {
			continue;
		}
		let stats;
		try {
			stats = statSync(absolute);
		} catch {
			if (seen.has(candidate)) continue;
			seen.add(candidate);
			reasons.push(`${candidate} does not exist`);
			continue;
		}
		if (match[2] === undefined) continue;
		if (!stats.isFile()) continue;
		const wanted = Number(match[3] ?? match[2]);
		let lines: number;
		try {
			lines = readFileSync(absolute, "utf8").split(/\r?\n/).length;
		} catch {
			continue;
		}
		if (wanted <= lines) continue;
		const label = `${candidate}:${wanted}`;
		if (seen.has(label)) continue;
		seen.add(label);
		reasons.push(`${label} is past the end of a ${lines}-line file`);
	}
	return reasons;
}

/** The most distinctive token of an entry, or `undefined` when it is pure prose. */
export function mentionNeedle(entry: string): string | undefined {
	const body = stripEntryTid(entry);
	const ascii = body.match(/[A-Za-z0-9_][A-Za-z0-9_./-]{7,}/g);
	const cjk = body.match(/\p{Script=Han}{8,}/gu);
	const longest = [...(ascii ?? []), ...(cjk ?? [])].sort((left, right) => right.length - left.length)[0];
	return longest === undefined ? undefined : longest.slice(0, 32);
}

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
export async function scanMentions(
	projectRoot: string,
	needles: readonly string[],
	options: { sinceMs: number; byteCap?: number },
): Promise<MentionScan> {
	const pending = new Set(needles);
	const mentioned = new Set<string>();
	let scannedBytes = 0;
	const cap = options.byteCap ?? MENTION_SCAN_BYTE_CAP;
	const root = logsDir(projectRoot);
	let names: string[];
	try {
		names = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
	} catch {
		// No archive at all: an empty scan is complete, and no fact can be shown to be mentioned.
		return { mentioned, scannedBytes, complete: true };
	}
	const sessions: { file: string; newest: number }[] = [];
	for (const name of names) {
		const file = path.join(root, name, "session.jsonl");
		let stats;
		try {
			stats = statSync(file);
		} catch {
			continue;
		}
		if (!stats.isFile()) continue;
		let newest = stats.mtimeMs;
		try {
			const meta = JSON.parse(readFileSync(path.join(root, name, "meta.json"), "utf8")) as { date?: unknown };
			if (typeof meta.date === "string") {
				const stamp = Date.parse(`${meta.date}T23:59:59Z`);
				if (Number.isFinite(stamp)) newest = stamp;
			}
		} catch {
			// No meta yet (a pre-Z1 archive): the file's own mtime is the only date it has.
		}
		if (newest < options.sinceMs) continue;
		sessions.push({ file, newest });
	}
	sessions.sort((left, right) => right.newest - left.newest);
	let complete = true;
	for (const session of sessions) {
		if (pending.size === 0) break;
		let size: number;
		try {
			size = statSync(session.file).size;
		} catch {
			continue;
		}
		if (scannedBytes + size > cap) {
			complete = false;
			break;
		}
		scannedBytes += size;
		let text: string;
		try {
			text = readFileSync(session.file, "utf8");
		} catch {
			complete = false;
			break;
		}
		for (const needle of [...pending]) {
			if (text.includes(needle)) {
				mentioned.add(needle);
				pending.delete(needle);
			}
		}
	}
	return { mentioned, scannedBytes, complete };
}

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
	/**
	 * Every id the returned document *owns*, whether or not the entry could afford to carry it this pass.
	 *
	 * The sidecar prune reads this, not `ids`: with a partial stamp the unstamped entries are still in the
	 * document, and pruning their dates would reset a clock that only the budget had postponed — the entry
	 * would come back dated today once room appears, delaying its retirement for no reason.
	 */
	keepIds: Set<string>;
	/** Ids this call minted and the returned document carries; their first-seen date is `today`. */
	added: string[];
	/** Ids this call removed from the document. An echo of one of these is dropped, not re-retired. */
	droppedIds: Set<string>;
};

/** The reason to record for a supersede, degraded gracefully when the declaring id is not a real id. */
function supersedeReason(source: string): RetirementReason {
	return HEX4.test(source) ? `superseded-by:${source}` : "superseded";
}

/**
 * Apply every trigger to one document and report what left it.
 *
 * `supersedes:` is honoured here, so a stored document that already carries a declaration retires its
 * target even when the model does not repeat it.
 */
export async function retireSections(sections: MemorySections, context: RetirementContext): Promise<RetirementResult> {
	// The id must be a pure function of the body, so the derivation is seeded with nothing: feeding it the
	// sidecar's ids made an unmarked entry collide with its own remembered id, take a salt, and change
	// identity on every pass — which reset the age of exactly the entries a partial stamp had postponed
	// (measured 2026-11-11 on the 250-entry fixture). Uniqueness inside the document is still enforced by
	// the ids already minted in this call.
	const stamps = stampEntryIds(sections, new Set());
	/** tid -> the entry that carries it, in document order. */
	const byTid = new Map<string, string>();
	for (const key of Object.keys(stamps.sections) as (keyof MemorySections)[]) {
		for (const entry of stamps.sections[key]) {
			const tid = entryTid(entry);
			if (tid !== undefined && !byTid.has(tid)) byTid.set(tid, entry);
		}
	}
	const retired: Tombstone[] = [];
	const drop = new Set<string>();
	// Echo guard first: an entry this pass already retired must not be judged a second time, and must not
	// earn a second tombstone.
	for (const tid of context.retiredIds ?? []) {
		if (byTid.has(tid)) drop.add(tid);
	}
	for (const [target, source] of context.declaredSupersedes ?? supersededIds(stamps.sections)) {
		const entry = byTid.get(target);
		if (entry === undefined || drop.has(target)) continue;
		drop.add(target);
		retired.push({ date: context.today, title: stripEntryTid(entry), reason: supersedeReason(source) });
	}
	// Anchor drift is exact and runs before the expiry scan, so an entry whose path is gone is reported
	// as drift rather than as an unconfirmed fact whose text simply stopped appearing.
	const unconfirmed: string[] = [];
	for (const [tid, entry] of byTid) {
		if (drop.has(tid)) continue;
		if (anchorDriftReasons(entry, context.projectRoot).length > 0) {
			drop.add(tid);
			retired.push({ date: context.today, title: stripEntryTid(entry), reason: "anchor-drift" });
			continue;
		}
		const first = context.firstSeen.get(tid) ?? context.today;
		const age = context.now - Date.parse(`${first}T00:00:00Z`);
		if (!Number.isFinite(age) || age <= MAX_UNCONFIRMED_DAYS * 86_400_000) continue;
		if (mentionNeedle(entry) === undefined) continue;
		unconfirmed.push(tid);
	}
	if (unconfirmed.length > 0) {
		const needles = new Map<string, string>();
		for (const tid of unconfirmed) {
			const needle = mentionNeedle(byTid.get(tid) ?? "");
			if (needle !== undefined) needles.set(tid, needle);
		}
		const scan = await scanMentions(context.projectRoot, [...needles.values()], { sinceMs: context.now - MAX_UNCONFIRMED_DAYS * 86_400_000, byteCap: context.mentionByteCap });
		// An incomplete scan proves nothing: a fact can only be called unmentioned when every session
		// inside the horizon was actually read.
		if (scan.complete) {
			for (const [tid, needle] of needles) {
				if (scan.mentioned.has(needle)) continue;
				drop.add(tid);
				retired.push({ date: context.today, title: stripEntryTid(byTid.get(tid) ?? tid), reason: "unconfirmed" });
			}
		}
	}
	const kept = {} as MemorySections;
	for (const key of Object.keys(stamps.sections) as (keyof MemorySections)[]) {
		kept[key] = stamps.sections[key].filter((entry) => {
			const tid = entryTid(entry);
			return tid === undefined || !drop.has(tid);
		});
	}
	return { sections: kept, retired, ids: documentIds(kept), keepIds: documentIds(kept), added: stamps.added, droppedIds: drop };
}

/**
 * The reply half: honour the reply's own `supersedes:` declarations, drop the echoes of what this pass
 * already retired, then run the same triggers over what is left.
 *
 * The echo guard is not paranoia. The retired entries were removed from `<existing-memory>` before the
 * model saw it, but the same fact is usually still in the conversation that drives the regeneration,
 * and a model that re-derives it from there would put back exactly what the pre-prompt pass removed.
 */
export async function retireReply(
	sections: MemorySections,
	context: RetirementContext,
	cap: number,
): Promise<RetirementResult & { stamped: boolean }> {
	// The markers are read before they are removed: `supersededIds` is what retires the target, so
	// stripping first would leave the declaration with nothing to point at — the failure this call
	// shape exists to avoid (measured: a reply whose only instruction was `supersedes:2222` retired
	// nothing, and the contradicted entry survived in the landed document).
	const declaredSupersedes = supersededIds(sections);
	return retireWithinBudget(stripSupersedesMarkers(sections), { ...context, declaredSupersedes }, cap);
}

/** All entry ids in a document, for the sidecar prune. */
export function documentIds(sections: MemorySections): Set<string> {
	const ids = new Set<string>();
	for (const key of Object.keys(sections) as (keyof MemorySections)[]) {
		for (const entry of sections[key]) {
			const tid = entryTid(entry);
			if (tid !== undefined) ids.add(tid);
		}
	}
	return ids;
}

/**
 * The entry-date sidecar: `<memory>/entries.json`, `<tid> -> YYYY-MM-DD` first seen.
 *
 * The date cannot ride in the bullet — eleven more characters per entry pushed this project's document
 * from `renderMemoryDocument` clean to 7 whole entries dropped (measured 2026-11-10) — but the 180-day
 * horizon needs it. A small plugin-owned file is the cheaper half of that trade: it is written only by
 * the plugin, and a missing entry degrades to "no known age", which keeps the fact rather than retiring
 * it.
 */
type EntryDatesDocument = { version: number; entries: Record<string, string> };

const ENTRY_DATES_VERSION = 1;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

async function readEntryDatesRaw(projectRoot: string): Promise<Map<string, string>> {
	const dates = new Map<string, string>();
	const file = entryDatesFile(projectRoot);
	try {
		if (!lstatSync(file).isFile()) return dates;
	} catch {
		return dates;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(await readOptional(file));
	} catch {
		return dates;
	}
	const entries = (parsed as EntryDatesDocument | undefined)?.entries;
	if (typeof entries !== "object" || entries === null) return dates;
	for (const [tid, date] of Object.entries(entries)) {
		if (HEX4.test(tid) && typeof date === "string" && DATE_ONLY.test(date)) dates.set(tid, date);
	}
	return dates;
}

/** When each known entry id was first seen. An unreadable file reads as "nothing known". */
export async function readEntryDates(projectRoot: string): Promise<Map<string, string>> {
	return readEntryDatesRaw(projectRoot);
}

/**
 * Merge first-seen dates into the sidecar, keeping the earliest date any writer has recorded.
 *
 * Earliest-wins rather than last-wins because the value is an *age*: two hosts that both learn an id
 * would otherwise keep resetting a fact's clock depending on which one wrote last, and an entry could
 * never age out. Runs under the memory lock for the same reason the tombstone file does.
 */
export async function recordEntryDates(projectRoot: string, dates: ReadonlyMap<string, string>, keep?: ReadonlySet<string>): Promise<void> {
	if (dates.size === 0 && keep === undefined) return;
	const file = entryDatesFile(projectRoot);
	await withMemoryLock(file, async () => {
		const existing = await readEntryDatesRaw(projectRoot);
		const merged = new Map(existing);
		for (const [tid, date] of dates) {
			const current = merged.get(tid);
			if (current === undefined || date < current) merged.set(tid, date);
		}
		// `keep` is the id set of the document that just landed: an id nothing carries any more is gone
		// for good, and leaving it would slowly grow a file that is nothing but a clock.
		if (keep !== undefined) {
			for (const tid of [...merged.keys()]) if (!keep.has(tid)) merged.delete(tid);
		}
		const document: EntryDatesDocument = { version: ENTRY_DATES_VERSION, entries: Object.fromEntries([...merged.entries()].sort(([left], [right]) => left.localeCompare(right))) };
		await writeAtomic(file, `${JSON.stringify(document, null, "\t")}\n`);
	});
}

/** Every entry id removed from each step of a pass, for the reply's echo guard. */
export function stripEntryIds(sections: MemorySections): MemorySections {
	const stripped = {} as MemorySections;
	for (const key of Object.keys(sections) as (keyof MemorySections)[]) {
		stripped[key] = sections[key].map((entry) => stripEntryTid(entry));
	}
	return stripped;
}

/**
 * Retire, then stamp ids — but never at the price of a whole entry.
 *
 * The ids are six characters per entry, and a memory that is already at its cap drops whole entries to
 * make room. Measured on this project 2026-11-10: a document at 43720 of 45000 characters stays clean
 * with the bare ids (+804) but loses 7 entries with the dated marker (+3082).
 *
 * A partial stamp, not all-or-nothing: when the whole document cannot afford every id, the ids that DO
 * fit still land, in priority order — Invariants then Pitfalls, then Project and Index, which are
 * rewritten every pass (retirement itself runs over all four sections, so the order is about which
 * identity survives a rewrite, not about which sections can be aged). The spare characters are measured
 * from the plain render, so an id can only ever spend leftover room; the alternative was that one
 * character of overflow silently dropped every id and reset every age.
 *
 * Measured on this project 2026-11-11 (read again before quoting): 44589 characters, 140 entries,
 * 45000 cap — 411 characters of headroom, so 68 ids fit: every Invariant (64) and 4 of 44 Pitfalls,
 * with Project and Index postponed. The full tax (840) would have dropped 3 whole entries. An earlier
 * check the same day read 782/130/107 on a 44218/139 document: these are snapshots, not constants.
 *
 * Ids are content-derived, so the stamped prefix keeps exactly the ids a full stamp would have minted:
 * a body's id never changes just because the budget changed (see `tidFor`).
 */
export async function retireWithinBudget(
	sections: MemorySections,
	context: RetirementContext,
	cap: number,
): Promise<RetirementResult & { stamped: boolean }> {
	const result = await retireSections(sections, context);
	const withIds = renderMemoryDocument(result.sections, cap);
	if (withIds.sectionDropped === 0 && withIds.itemTruncated === 0) return { ...result, stamped: true };
	const plain = stripEntryIds(result.sections);
	const withoutIds = renderMemoryDocument(plain, cap);
	// Both lossy: the overflow is the document's own, not the ids'. Keep the ids so the triggers work.
	if (withoutIds.sectionDropped > 0 || withoutIds.itemTruncated > 0) return { ...result, stamped: true };
	// The document only overflows once the ids are added, so this is the id tax that has to shrink. The
	// budget is what the clean plain render leaves, and every stamp costs the same six characters.
	// `stampOrder` already leaves out entries that could not carry a marker without being clipped, so a
	// single near-cap entry postpones only itself instead of spending the whole budget on a prefix the
	// renderer will always refuse.
	const order = stampOrder(result.sections);
	const budget = Math.max(0, cap - withoutIds.text.length);
	let count = Math.min(order.length, Math.floor(budget / TID_STAMP_CHARS));
	while (count > 0) {
		const partial = stampFirst(result.sections, order, count);
		const rendered = renderMemoryDocument(partial, cap);
		if (rendered.sectionDropped === 0 && rendered.itemTruncated === 0) {
			const ids = documentIds(partial);
			return { ...result, sections: partial, ids, added: result.added.filter((tid) => ids.has(tid)), stamped: true };
		}
		// A stamp can shift the packing (it moves an entry's measured demand), so the arithmetic budget is
		// an upper bound, not a proof: step down until the renderer agrees.
		count -= 1;
	}
	return { ...result, sections: plain, ids: new Set(), added: [], stamped: false };
}

/** Characters one trailing id adds: a full-width parenthesis, four hex digits, and the closing one. */
const TID_STAMP_CHARS = withEntryTid("x", "aaaa").length - 1;

/**
 * The order a partial stamp spends its budget in, and the entries that can carry a marker at all.
 *
 * Invariants and Pitfalls come first because their facts are meant to outlive a pass; Project/Index are
 * rewritten every pass, so postponing their identity costs the least. Retirement still runs over all
 * four sections, so this is a value judgement about survival, not a claim that only two are aged.
 *
 * An entry longer than the per-item cap is left out. Every entry here already carries its marker —
 * `retireSections` stamps before the budget is applied — so `entry.length` includes the six characters
 * and the test must not add them again: the clipper's cap is at most `MAX_LIST_ITEM_CHARS`, so an entry
 * over 800 can never be shown with its marker intact. Keeping it in the order made one such entry
 * reject every prefix that contained it, walking the budget to zero while 20 other entries had room.
 */
const STAMP_PRIORITY: readonly (keyof MemorySections)[] = ["invariants", "pitfalls", "project", "index"];

/** Every stampable entry slot of one document, in `STAMP_PRIORITY` order and document order inside a section. */
function stampOrder(sections: MemorySections): { key: keyof MemorySections; index: number }[] {
	const order: { key: keyof MemorySections; index: number }[] = [];
	for (const key of STAMP_PRIORITY) {
		for (const [index, entry] of sections[key].entries()) {
			if (entry.length > MAX_LIST_ITEM_CHARS) continue;
			order.push({ key, index });
		}
	}
	return order;
}

/** The document with the first `count` slots of `order` keeping their id and every other entry stripped. */
function stampFirst(sections: MemorySections, order: readonly { key: keyof MemorySections; index: number }[], count: number): MemorySections {
	const keep = new Set(order.slice(0, count).map((slot) => `${slot.key}:${slot.index}`));
	const partial = {} as MemorySections;
	for (const key of Object.keys(sections) as (keyof MemorySections)[]) {
		partial[key] = sections[key].map((entry, index) => (keep.has(`${key}:${index}`) ? entry : stripEntryTid(entry)));
	}
	return partial;
}
