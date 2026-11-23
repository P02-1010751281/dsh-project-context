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
import { type DocumentLanguage } from "../shared/language.js";
/** What a learned skill's own evidence says about it, most certain first. */
export type SkillState = "unbaselined" | "expired" | "moved" | "drifted" | "orphan" | "intact";
/** Every state, in the order a receipt counts them. */
export declare const SKILL_STATES: readonly SkillState[];
/** The states worth naming in a receipt, worst first. */
export declare const SKILL_SEVERITY: readonly SkillState[];
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
export declare function skillStateOf(facts: SkillFacts, language?: DocumentLanguage): SkillVerdict;
/**
 * Judge the whole corpus, in name order so two runs produce the same receipt.
 * @param facts - one entry per learned skill.
 * @returns the verdicts and the counts.
 */
export declare function skillStates(facts: readonly SkillFacts[], corpus?: {
    readonly total: number;
}, language?: DocumentLanguage): SkillStateReport;
/** True for the one state the pipeline is allowed to act on by itself. */
export declare function retiresSkill(state: SkillState): boolean;
/**
 * The `/autolearn status` receipt.
 *
 * The first line carries the counts — the client folds a command card to one ellipsized line — and the
 * named entries follow worst-first, because a count with no name is not actionable.
 * @param report - the verdict for the learned corpus.
 * @param named - how many entries to name.
 * @returns the command text.
 */
export declare function skillStatusReceipt(report: SkillStateReport, named?: number, language?: DocumentLanguage): string;
