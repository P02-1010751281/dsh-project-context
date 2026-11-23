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
import { pick } from "../shared/language.js";
/** Every state, in the order a receipt counts them. */
export const SKILL_STATES = ["intact", "orphan", "drifted", "moved", "expired", "unbaselined"];
/** The states worth naming in a receipt, worst first. */
export const SKILL_SEVERITY = ["expired", "moved", "drifted", "orphan", "unbaselined"];
/**
 * Judge one skill from the facts its body and the disk produced.
 * @param facts - what the source measured.
 * @returns the winning state and the evidence a receipt can print.
 */
export function skillStateOf(facts, language = "en") {
    if (facts.bound === 0) {
        return facts.bindable === 0
            ? { name: facts.name, state: "unbaselined", detail: pick(language, "没有可绑定的路径：它引用的每个路径要么是构建产物、要么是记忆文档、要么在项目之外", "nothing bindable: every path it cites is a build output, a memory document, or outside the project") }
            : { name: facts.name, state: "unbaselined", detail: pick(language, "提升时没有记录指纹", "no fingerprint was recorded when it was promoted") };
    }
    // Expiry needs *every* citation gone and none of them from a vanished directory: a skill whose whole
    // directory moved is stale in a different way, and retiring it would delete knowledge that still exists.
    if (facts.missing.length === facts.bound && facts.moved.length === 0) {
        return { name: facts.name, state: "expired", detail: pick(language, `引用的文件全都不在了（${facts.missing.join("、")}）`, `every cited file is gone (${facts.missing.join(", ")})`) };
    }
    // Every citation vanished with its parent directory: knowledge that still exists somewhere else. Named
    // separately from drift because the remedy is a pointer rewrite, not a re-read of the body.
    if (facts.missing.length > 0 && facts.moved.length === facts.missing.length) {
        return { name: facts.name, state: "moved", detail: pick(language, `引用的文件都随目录搬走了（${facts.moved.join("、")}）`, `every cited file moved with its directory (${facts.moved.join(", ")})`) };
    }
    if (facts.changed.length > 0) {
        return { name: facts.name, state: "drifted", detail: pick(language, `提升之后有改动：${facts.changed.join("、")}`, `changed since it was promoted: ${facts.changed.join(", ")}`) };
    }
    if (facts.missing.length > 0) {
        return { name: facts.name, state: "drifted", detail: pick(language, `引用的文件缺失：${facts.missing.join("、")}`, `cited file(s) gone: ${facts.missing.join(", ")}`) };
    }
    if (facts.references === 0) {
        return { name: facts.name, state: "orphan", detail: pick(language, "没有记忆或上下文行引用它", "no memory or context line cites it") };
    }
    return {
        name: facts.name,
        state: "intact",
        detail: pick(language, `${facts.bound} 个引用文件未变，${facts.references} 处引用`, `${facts.bound} cited file(s) unchanged, ${facts.references} reference(s)`),
    };
}
/**
 * Judge the whole corpus, in name order so two runs produce the same receipt.
 * @param facts - one entry per learned skill.
 * @returns the verdicts and the counts.
 */
export function skillStates(facts, corpus, language = "en") {
    const verdicts = [...facts].sort((left, right) => left.name.localeCompare(right.name)).map((entry) => skillStateOf(entry, language));
    const counts = { unbaselined: 0, expired: 0, moved: 0, drifted: 0, orphan: 0, intact: 0 };
    for (const verdict of verdicts)
        counts[verdict.state] += 1;
    const total = corpus?.total ?? verdicts.length;
    return { verdicts, counts, total, unmanaged: Math.max(0, total - verdicts.length) };
}
/** The state as a receipt names it, per language. */
const SKILL_STATE_LABEL = {
    en: { unbaselined: "unbaselined", expired: "expired", moved: "moved", drifted: "drifted", orphan: "orphan", intact: "intact" },
    zh: { unbaselined: "未建基线", expired: "已过期", moved: "已搬走", drifted: "已漂移", orphan: "无引用", intact: "完好" },
};
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
export function skillStatusReceipt(report, named = 10, language = "en") {
    const broken = report.verdicts.filter((verdict) => verdict.state !== "intact");
    const scope = report.unmanaged > 0
        ? pick(language, `${report.verdicts.length} / ${report.total} 个技能`, `${report.verdicts.length} of ${report.total} skill(s)`)
        : pick(language, `${report.verdicts.length} 个技能`, `${report.verdicts.length} skill(s)`);
    // The denominator stays on the first line, the hand-written split moves below it: the client clips
    // the folded summary after roughly eighty columns, and the parenthetical used to push the
    // `needing a look` count past that edge.
    const head = pick(language, `已学技能：${scope} —— ${report.counts.intact} 个完好，${broken.length} 个需要处理。`, `Learned skills: ${scope} — ${report.counts.intact} intact, ${broken.length} needing a look.`);
    const unmanaged = report.unmanaged > 0
        ? `\n${pick(language, `${report.unmanaged} 个手写技能不受管（只判定学到的技能）。`, `${report.unmanaged} hand-written skill(s) are not managed (only learned skills are judged).`)}`
        : "";
    if (broken.length === 0)
        return `${head}${unmanaged}\n${pick(language, "每个已学技能仍与它引用的文件一致，且仍被引用。", "Every learned skill still matches the files it cites and is still referenced.")}`;
    const lines = broken
        .sort((left, right) => SKILL_SEVERITY.indexOf(left.state) - SKILL_SEVERITY.indexOf(right.state) || left.name.localeCompare(right.name))
        .slice(0, named)
        .map((verdict) => `  ${SKILL_STATE_LABEL[language][verdict.state]} — ${verdict.name} — ${verdict.detail}`);
    const more = broken.length > lines.length
        ? `\n  ${pick(language, `… 另有 ${broken.length - lines.length} 个`, `… and ${broken.length - lines.length} more`)}`
        : "";
    return `${head}${unmanaged}\n${lines.join("\n")}${more}`;
}
