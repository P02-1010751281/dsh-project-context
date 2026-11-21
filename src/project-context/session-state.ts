/**
 * The session-log state machine, derived only.
 *
 * What this core has today is a directory, a `meta.json` and a row in `INDEX.md`, and its "state" was
 * whatever you inferred from whether the directory happened to exist. That inference is exactly what is
 * missing a report surface: the AOCI vocabulary the survey brought in — Missing, Orphan, Stale,
 * Unbaselined — names four failures of an index, and each one is decidable here without a model:
 *
 * - **missing**   — the index names a session whose directory is gone.
 * - **orphan**    — a directory the index does not name (the projection missed it).
 * - **unbaselined** — a directory with no `meta.json`, so nothing about it is recorded.
 * - **stale**     — the row disagrees with the directory's own `meta.json` (a mid-write, or a bug).
 *
 * Two more are this core's own: **dangling** (it continues a session that is no longer on disk) and the
 * healthy pair **live** / **settled**, split by activity so a report can say how much is still moving.
 *
 * Every state is derived from disk on each read and nothing is written: an explicit lifecycle recorded in
 * `meta.json` would be a second truth that can disagree with the directory, which is the defect this
 * module exists to report. The transitions that matter are therefore all *repairs* of the four failure
 * states (re-index, adopt the directory, rewrite the row), and none of them belongs to a read-only view.
 */

/** What one archived session's own files say about it, most certain first. */
export type SessionState = "missing" | "orphan" | "unbaselined" | "stale" | "dangling" | "live" | "settled";

/** Every state, in the order a receipt counts them. */
export const SESSION_STATES: readonly SessionState[] = ["live", "settled", "stale", "orphan", "missing", "dangling", "unbaselined"];

/** The states that mean the archive and its index disagree: what a repair would act on. */
export const BROKEN_SESSION_STATES: readonly SessionState[] = ["stale", "orphan", "missing", "dangling", "unbaselined"];

/**
 * How a receipt orders the broken states: worst first.
 *
 * A row naming a directory that is gone is evidence loss; an unindexed directory is one that can still be
 * adopted; a row that disagrees with its own meta is a projection bug, not a missing session. The order is
 * declared here rather than derived from the state list so the count order and the severity order can
 * never be silently tied together.
 */
export const SESSION_SEVERITY: readonly SessionState[] = ["missing", "orphan", "unbaselined", "stale", "dangling"];

/** Days without activity after which a healthy session reads as `settled` rather than `live`. */
export const SETTLED_DAYS = 7;

/** One row of `INDEX.md`, as the comparison needs it. */
export interface SessionRow {
	readonly date: string;
	readonly title: string;
}

/** One session directory, as the comparison needs it. */
export interface SessionDirFacts {
	/** Newest modification time among the directory's artifacts, in ms. */
	readonly activityMs: number;
	/** The parsed `meta.json`, or `undefined` when it is absent or unreadable. */
	readonly meta: (SessionRow & { readonly parentId?: string }) | undefined;
}

/** Everything the verdict reads, so the rules are testable without a filesystem. */
export interface SessionStateInput {
	/** Directory name -> its facts. */
	readonly dirs: ReadonlyMap<string, SessionDirFacts>;
	/** Row id -> its columns. */
	readonly rows: ReadonlyMap<string, SessionRow>;
	/** False when `INDEX.md` is absent: then every directory would look orphaned and nothing is claimed. */
	readonly indexPresent: boolean;
	readonly now: number;
}

/** One session's verdict. */
export interface SessionVerdict {
	readonly id: string;
	readonly state: SessionState;
	/** The concrete evidence: a path, a date, or the parent id that is gone. */
	readonly detail: string;
}

/** The whole archive's verdict. */
export interface SessionStateReport {
	readonly indexPresent: boolean;
	readonly verdicts: readonly SessionVerdict[];
	readonly counts: Record<SessionState, number>;
}

/** `n` days in milliseconds. */
function days(count: number): number {
	return count * 86_400_000;
}

/**
 * Judge every session the archive knows about, from the index side and the disk side together.
 *
 * A row with no directory and a directory with no row are different failures with different repairs, so
 * they are different states rather than one "mismatch". An absent index is reported as such instead of
 * turning every directory into an orphan — a scan that could not judge must not look like a full one.
 * @param input - both sides of the archive plus the clock.
 * @returns one verdict per session id, and the counts a receipt prints.
 */
export function sessionStates(input: SessionStateInput): SessionStateReport {
	const verdicts: SessionVerdict[] = [];
	const ids = new Set<string>([...input.dirs.keys(), ...input.rows.keys()]);
	for (const id of [...ids].sort()) {
		const dir = input.dirs.get(id);
		const row = input.rows.get(id);
		const add = (state: SessionState, detail: string): void => {
			verdicts.push({ id, state, detail });
		};
		if (dir === undefined) {
			add("missing", `the index names ${id}, but ${id}/ is not on disk`);
			continue;
		}
		if (!input.indexPresent) {
			// Nothing can be said about the index side; the disk side still decides the rest.
			add("unbaselined", `${id}/ is on disk, but INDEX.md is absent so no row was compared`);
			continue;
		}
		if (row === undefined) {
			add("orphan", `${id}/ is on disk with no row in INDEX.md`);
			continue;
		}
		if (dir.meta === undefined) {
			add("unbaselined", `${id}/ has no readable meta.json, so its row cannot be checked`);
			continue;
		}
		if (dir.meta.date !== row.date || dir.meta.title !== row.title) {
			add("stale", `INDEX.md says "${row.date} ${row.title}", meta.json says "${dir.meta.date} ${dir.meta.title}"`);
			continue;
		}
		if (dir.meta.parentId !== undefined && !input.dirs.has(dir.meta.parentId)) {
			add("dangling", `continues ${dir.meta.parentId}, which is not on disk`);
			continue;
		}
		const age = input.now - dir.activityMs;
		add(age <= days(SETTLED_DAYS) ? "live" : "settled", `last activity ${when(age)}`);
	}
	const counts: Record<SessionState, number> = { missing: 0, orphan: 0, unbaselined: 0, stale: 0, dangling: 0, live: 0, settled: 0 };
	for (const verdict of verdicts) counts[verdict.state] += 1;
	return { indexPresent: input.indexPresent, verdicts, counts };
}

/** A short, stable rendering of an age, for a receipt line. */
function when(ageMs: number): string {
	const day = Math.max(0, Math.floor(ageMs / 86_400_000));
	return day === 0 ? "within a day" : `${day} day(s) ago`;
}

/** True for the states a repair would act on. */
export function brokenSession(state: SessionState): boolean {
	return BROKEN_SESSION_STATES.includes(state);
}

/**
 * The `/session-log status` receipt.
 *
 * The first line carries the counts on purpose: the client folds a command card to one ellipsized line,
 * so a payload below it would be unreadable without expanding the card. Named entries follow, worst
 * state first, because a count with no id is not actionable.
 * @param report - the verdict for the whole archive.
 * @param named - how many broken sessions to name.
 * @returns the command text.
 */
export function sessionStatusReceipt(report: SessionStateReport, named = 10): string {
	const healthy = report.counts.live + report.counts.settled;
	const broken = report.verdicts.filter((verdict) => brokenSession(verdict.state));
	const indexNote = report.indexPresent ? "" : " (INDEX.md is absent, so no row was compared)";
	const head = `Session log: ${report.verdicts.length} session(s) — ${healthy} healthy (${report.counts.live} live, ${report.counts.settled} settled), ${broken.length} needing a repair${indexNote}.`;
	if (!report.indexPresent) return head;
	if (broken.length === 0) return `${head}\nNothing to repair: every directory has a row, every row has a directory, and every meta.json agrees with its row.`;
	const worst = [...SESSION_SEVERITY];
	const lines = broken
		.sort((left, right) => worst.indexOf(left.state) - worst.indexOf(right.state) || left.id.localeCompare(right.id))
		.slice(0, named)
		.map((verdict) => `  ${verdict.state} — ${verdict.id} — ${verdict.detail}`);
	const more = broken.length > lines.length ? `\n  … and ${broken.length - lines.length} more` : "";
	return `${head}\n${lines.join("\n")}${more}`;
}
