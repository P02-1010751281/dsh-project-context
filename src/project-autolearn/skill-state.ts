/**
 * A learned skill's state, derived from the files it cites — the core that never had one.
 *
 * A promoted skill only ever changed by being *replaced* (`/autolearn approve`), so a skill describing
 * code that has since moved or been deleted stayed active forever: injected into every prompt and still
 * the target of memory pointers. This is the determination half of fixing that; the transition lives in
 * `skill-state-source.ts` and, deliberately, only fires on the evidence it can be sure of.
 *
 * The states reuse the AOCI vocabulary where it fits, because the questions are the same:
 *
 * - **unbaselined** — no fingerprint was ever recorded, so nothing can be judged.
 * - **expired** — every cited path is gone, and each of those paths was removed from a directory that is
 *   itself still there. The second half is what keeps a *moved* skill from being called expired: the
 *   memory core's anchor rule already refuses to judge a path whose parent vanished, because that is an
 *   abbreviation or another checkout as often as it is a deletion.
 * - **drifted** — some cited file changed or disappeared; the skill may still be useful, so this is
 *   reported and never acted on.
 * - **orphan** — nothing in the memory or context documents points at it any more.
 * - **intact** — baselined, every cited file still matches, and something still references it.
 *
 * Only `expired` is allowed to move a skill out of service, and only for a skill this pipeline
 * generated (the provenance marker) — a hand-written skill is never touched.
 */

/** What a learned skill's own evidence says about it, most certain first. */
export type SkillState = "unbaselined" | "expired" | "moved" | "drifted" | "orphan" | "intact";

/** Every state, in the order a receipt counts them. */
export const SKILL_STATES: readonly SkillState[] = ["intact", "orphan", "drifted", "moved", "expired", "unbaselined"];

/** The states worth naming in a receipt, worst first. */
export const SKILL_SEVERITY: readonly SkillState[] = ["expired", "moved", "drifted", "orphan", "unbaselined"];

/** What the measurement found about one learned skill. */
export interface SkillFacts {
	readonly name: string;
	/** How many cited paths carry a recorded fingerprint. Zero means no baseline was ever taken. */
	readonly bound: number;
	/** Cited paths whose fingerprint changed since the baseline. */
	readonly changed: readonly string[];
	/** Cited paths that are gone. */
	readonly missing: readonly string[];
	/** Of `missing`, those whose parent directory is gone too: a move, not a deletion. */
	readonly moved: readonly string[];
	/** How many lines in MEMORY.md / CONTEXT.md cite this skill by path. */
	readonly references: number;
	/**
	 * Cited paths a baseline could ever fingerprint: relative, inside the project, and not a build
	 * output or a memory document. Zero means `/autolearn bind` can never help this skill, which is a
	 * different fact from "nobody ran bind yet".
	 */
	readonly bindable: number;
}

/** One skill's verdict. */
export interface SkillVerdict {
	readonly name: string;
	readonly state: SkillState;
	/** The concrete evidence, never the bare category. */
	readonly detail: string;
}

/** The verdict for the learned corpus. */
export interface SkillStateReport {
	readonly verdicts: readonly SkillVerdict[];
	readonly counts: Record<SkillState, number>;
	/** Every skill directory, learned or not: the denominator a reader needs to see what is left out. */
	readonly total: number;
	/** Skill directories without the provenance marker: read by nobody here, and never touched. */
	readonly unmanaged: number;
}

/**
 * Judge one skill from the facts its body and the disk produced.
 * @param facts - what the source measured.
 * @returns the winning state and the evidence a receipt can print.
 */
export function skillStateOf(facts: SkillFacts): SkillVerdict {
	if (facts.bound === 0) {
		return facts.bindable === 0
			? { name: facts.name, state: "unbaselined", detail: "nothing bindable: every path it cites is a build output, a memory document, or outside the project" }
			: { name: facts.name, state: "unbaselined", detail: "no fingerprint was recorded when it was promoted" };
	}
	// Expiry needs *every* citation gone and none of them from a vanished directory: a skill whose whole
	// directory moved is stale in a different way, and retiring it would delete knowledge that still exists.
	if (facts.missing.length === facts.bound && facts.moved.length === 0) {
		return { name: facts.name, state: "expired", detail: `every cited file is gone (${facts.missing.join(", ")})` };
	}
	// Every citation vanished with its parent directory: knowledge that still exists somewhere else. Named
	// separately from drift because the remedy is a pointer rewrite, not a re-read of the body.
	if (facts.missing.length > 0 && facts.moved.length === facts.missing.length) {
		return { name: facts.name, state: "moved", detail: `every cited file moved with its directory (${facts.moved.join(", ")})` };
	}
	if (facts.changed.length > 0) {
		return { name: facts.name, state: "drifted", detail: `changed since it was promoted: ${facts.changed.join(", ")}` };
	}
	if (facts.missing.length > 0) {
		return { name: facts.name, state: "drifted", detail: `cited file(s) gone: ${facts.missing.join(", ")}` };
	}
	if (facts.references === 0) {
		return { name: facts.name, state: "orphan", detail: "no memory or context line cites it" };
	}
	return { name: facts.name, state: "intact", detail: `${facts.bound} cited file(s) unchanged, ${facts.references} reference(s)` };
}

/**
 * Judge the whole corpus, in name order so two runs produce the same receipt.
 * @param facts - one entry per learned skill.
 * @returns the verdicts and the counts.
 */
export function skillStates(facts: readonly SkillFacts[], corpus?: { readonly total: number }): SkillStateReport {
	const verdicts = [...facts].sort((left, right) => left.name.localeCompare(right.name)).map(skillStateOf);
	const counts: Record<SkillState, number> = { unbaselined: 0, expired: 0, moved: 0, drifted: 0, orphan: 0, intact: 0 };
	for (const verdict of verdicts) counts[verdict.state] += 1;
	const total = corpus?.total ?? verdicts.length;
	return { verdicts, counts, total, unmanaged: Math.max(0, total - verdicts.length) };
}

/** True for the one state the pipeline is allowed to act on by itself. */
export function retiresSkill(state: SkillState): boolean {
	return state === "expired";
}

/**
 * The `/autolearn status` receipt.
 *
 * The first line carries the counts — the client folds a command card to one ellipsized line — and the
 * named entries follow worst-first, because a count with no name is not actionable.
 * @param report - the verdict for the learned corpus.
 * @param named - how many entries to name.
 * @returns the command text.
 */
export function skillStatusReceipt(report: SkillStateReport, named = 10): string {
	const broken = report.verdicts.filter((verdict) => verdict.state !== "intact");
	const scope = report.unmanaged > 0
		? `${report.verdicts.length} of ${report.total} skill(s)`
		: `${report.verdicts.length} skill(s)`;
	// The denominator stays on the first line, the hand-written split moves below it: the client clips
	// the folded summary after roughly eighty columns, and the parenthetical used to push the
	// `needing a look` count past that edge.
	const head = `Learned skills: ${scope} — ${report.counts.intact} intact, ${broken.length} needing a look.`;
	const unmanaged = report.unmanaged > 0 ? `\n${report.unmanaged} hand-written skill(s) are not managed (only learned skills are judged).` : "";
	if (broken.length === 0) return `${head}${unmanaged}\nEvery learned skill still matches the files it cites and is still referenced.`;
	const lines = broken
		.sort((left, right) => SKILL_SEVERITY.indexOf(left.state) - SKILL_SEVERITY.indexOf(right.state) || left.name.localeCompare(right.name))
		.slice(0, named)
		.map((verdict) => `  ${verdict.state} — ${verdict.name} — ${verdict.detail}`);
	const more = broken.length > lines.length ? `\n  … and ${broken.length - lines.length} more` : "";
	return `${head}${unmanaged}\n${lines.join("\n")}${more}`;
}
