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
/** Every state, in the order a receipt counts them. */
export const SKILL_STATES = ["intact", "orphan", "drifted", "expired", "unbaselined"];
/** The states worth naming in a receipt, worst first. */
export const SKILL_SEVERITY = ["expired", "drifted", "orphan", "unbaselined"];
/**
 * Judge one skill from the facts its body and the disk produced.
 * @param facts - what the source measured.
 * @returns the winning state and the evidence a receipt can print.
 */
export function skillStateOf(facts) {
    if (facts.bound === 0) {
        return { name: facts.name, state: "unbaselined", detail: "no fingerprint was recorded when it was promoted" };
    }
    // Expiry needs *every* citation gone and none of them from a vanished directory: a skill whose whole
    // directory moved is stale in a different way, and retiring it would delete knowledge that still exists.
    if (facts.missing.length === facts.bound && facts.moved.length === 0) {
        return { name: facts.name, state: "expired", detail: `every cited file is gone (${facts.missing.join(", ")})` };
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
export function skillStates(facts) {
    const verdicts = [...facts].sort((left, right) => left.name.localeCompare(right.name)).map(skillStateOf);
    const counts = { unbaselined: 0, expired: 0, drifted: 0, orphan: 0, intact: 0 };
    for (const verdict of verdicts)
        counts[verdict.state] += 1;
    return { verdicts, counts };
}
/** True for the one state the pipeline is allowed to act on by itself. */
export function retiresSkill(state) {
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
export function skillStatusReceipt(report, named = 10) {
    const broken = report.verdicts.filter((verdict) => verdict.state !== "intact");
    const head = `Learned skills: ${report.verdicts.length} skill(s) — ${report.counts.intact} intact, ${broken.length} needing a look.`;
    if (broken.length === 0)
        return `${head}\nEvery learned skill still matches the files it cites and is still referenced.`;
    const lines = broken
        .sort((left, right) => SKILL_SEVERITY.indexOf(left.state) - SKILL_SEVERITY.indexOf(right.state) || left.name.localeCompare(right.name))
        .slice(0, named)
        .map((verdict) => `  ${verdict.state} — ${verdict.name} — ${verdict.detail}`);
    const more = broken.length > lines.length ? `\n  … and ${broken.length - lines.length} more` : "";
    return `${head}\n${lines.join("\n")}${more}`;
}
