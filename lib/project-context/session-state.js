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
import { pick } from "../shared/language.js";
/** Every state, in the order a receipt counts them. */
export const SESSION_STATES = ["live", "settled", "stale", "orphan", "missing", "abandoned", "dangling", "unbaselined"];
/** The states that mean the archive and its index disagree: what a repair would act on. */
export const BROKEN_SESSION_STATES = ["stale", "orphan", "missing", "abandoned", "dangling", "unbaselined"];
/**
 * How a receipt orders the broken states: worst first.
 *
 * A row naming a directory that is gone is evidence loss; an unindexed directory is one that can still be
 * adopted; a row that disagrees with its own meta is a projection bug, not a missing session. The order is
 * declared here rather than derived from the state list so the count order and the severity order can
 * never be silently tied together.
 */
export const SESSION_SEVERITY = ["missing", "orphan", "unbaselined", "stale", "abandoned", "dangling"];
/** Days without activity after which a healthy session reads as `settled` rather than `live`. */
export const SETTLED_DAYS = 7;
/** `n` days in milliseconds. */
function days(count) {
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
export function sessionStates(input, language = "en") {
    const verdicts = [];
    const ids = new Set([...input.dirs.keys(), ...input.rows.keys()]);
    for (const id of [...ids].sort()) {
        const dir = input.dirs.get(id);
        const row = input.rows.get(id);
        const add = (state, detail) => {
            verdicts.push({ id, state, detail });
        };
        if (dir === undefined) {
            add("missing", pick(language, `索引里有 ${id}，但磁盘上没有 ${id}/`, `the index names ${id}, but ${id}/ is not on disk`));
            continue;
        }
        if (!input.indexPresent) {
            // Nothing can be said about the index side; the disk side still decides the rest.
            add("unbaselined", pick(language, `${id}/ 在磁盘上，但 INDEX.md 不存在，所以没有可比对的行`, `${id}/ is on disk, but INDEX.md is absent so no row was compared`));
            continue;
        }
        if (row === undefined) {
            add("orphan", pick(language, `${id}/ 在磁盘上，但 INDEX.md 里没有它的行`, `${id}/ is on disk with no row in INDEX.md`));
            continue;
        }
        if (dir.meta === undefined) {
            add("unbaselined", pick(language, `${id}/ 没有可读的 meta.json，无法核对它的行`, `${id}/ has no readable meta.json, so its row cannot be checked`));
            continue;
        }
        if (dir.meta.date !== row.date || dir.meta.title !== row.title) {
            add("stale", pick(language, `INDEX.md 写的是「${row.date} ${row.title}」，meta.json 写的是「${dir.meta.date} ${dir.meta.title}」`, `INDEX.md says "${row.date} ${row.title}", meta.json says "${dir.meta.date} ${dir.meta.title}"`));
            continue;
        }
        const age = input.now - dir.activityMs;
        // A handoff continuation nobody ever wrote in: the seed arrived, the session sat, and the work it
        // was created for went elsewhere. Judged before `dangling`, because a dead continuation whose parent
        // is also gone is still primarily dead weight — the missing parent is the smaller fact.
        if (dir.meta.kind === "handoff" && dir.humanTurns === 0 && age > days(input.settledDays)) {
            add("abandoned", pick(language, `交接续接的会话在 ${when(age, language)} 之后仍没有人类回合`, `a handoff continuation with no human turn after ${when(age, language)}`));
            continue;
        }
        if (dir.meta.parentId !== undefined && !input.dirs.has(dir.meta.parentId)) {
            add("dangling", pick(language, `续接 ${dir.meta.parentId}，但它不在磁盘上`, `continues ${dir.meta.parentId}, which is not on disk`));
            continue;
        }
        add(age <= days(input.settledDays) ? "live" : "settled", pick(language, `最后活动于 ${when(age, language)}`, `last activity ${when(age, language)}`));
    }
    const counts = { missing: 0, orphan: 0, unbaselined: 0, stale: 0, abandoned: 0, dangling: 0, live: 0, settled: 0 };
    for (const verdict of verdicts)
        counts[verdict.state] += 1;
    return { indexPresent: input.indexPresent, verdicts, counts };
}
/** A short, stable rendering of an age, for a receipt line. */
function when(ageMs, language = "en") {
    const day = Math.max(0, Math.floor(ageMs / 86_400_000));
    return day === 0 ? pick(language, "一天内", "within a day") : pick(language, `${day} 天前`, `${day} day(s) ago`);
}
/** True for the states a repair would act on. */
export function brokenSession(state) {
    return BROKEN_SESSION_STATES.includes(state);
}
/** The state as a receipt names it, per language. */
const SESSION_STATE_LABEL = {
    en: { missing: "missing", orphan: "orphan", unbaselined: "unbaselined", stale: "stale", abandoned: "abandoned", dangling: "dangling", live: "live", settled: "settled" },
    zh: { missing: "缺失", orphan: "无行", unbaselined: "未对账", stale: "已过期", abandoned: "已遗弃", dangling: "悬挂", live: "进行中", settled: "已结束" },
};
/**
 * The `/session-log status` receipt.
 *
 * The first line carries the counts on purpose: the client folds a command card to one ellipsized line,
 * so a payload below it would be unreadable without expanding the card. Named entries follow, worst
 * state first, because a count with no id is not actionable.
 * @param report - the verdict for the whole archive.
 * @param language - the language the receipt is written in.
 * @param named - how many broken sessions to name.
 * @returns the command text.
 */
export function sessionStatusReceipt(report, language = "en", named = 10) {
    const healthy = report.counts.live + report.counts.settled;
    const broken = report.verdicts.filter((verdict) => brokenSession(verdict.state));
    // The counts lead and the absent-index note gets its own line: the client clips the folded summary
    // after roughly eighty columns, so a parenthetical here would push the repair count out of view.
    const head = pick(language, `会话日志：${report.verdicts.length} 个会话 —— ${broken.length} 个需要修复。`, `Session log: ${report.verdicts.length} session(s) — ${broken.length} needing a repair.`);
    const healthyLine = pick(language, `${healthy} 个健康（${report.counts.live} 个进行中，${report.counts.settled} 个已结束）。`, `${healthy} healthy (${report.counts.live} live, ${report.counts.settled} settled).`);
    if (!report.indexPresent)
        return `${head}\n${healthyLine}\n${pick(language, "INDEX.md 不存在，因此没有比对任何行。", "INDEX.md is absent, so no row was compared.")}`;
    if (broken.length === 0) {
        return `${head}\n${healthyLine}\n${pick(language, "无需修复：每个目录都有行、每一行都有目录，每个 meta.json 都与它的行一致。", "Nothing to repair: every directory has a row, every row has a directory, and every meta.json agrees with its row.")}`;
    }
    const worst = [...SESSION_SEVERITY];
    const lines = broken
        .sort((left, right) => worst.indexOf(left.state) - worst.indexOf(right.state) || left.id.localeCompare(right.id))
        .slice(0, named)
        .map((verdict) => `  ${SESSION_STATE_LABEL[language][verdict.state]} — ${verdict.id} — ${verdict.detail}`);
    const more = broken.length > lines.length
        ? `\n  ${pick(language, `… 另有 ${broken.length - lines.length} 个`, `… and ${broken.length - lines.length} more`)}`
        : "";
    return `${head}\n${healthyLine}\n${lines.join("\n")}${more}`;
}
