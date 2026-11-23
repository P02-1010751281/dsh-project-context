/**
 * One entry's state, derived once from facts that already exist.
 *
 * Before this module the same entry could be described two ways: the retirement engine acted on
 * "the cited path is gone or its line is past the end", while the staleness bindings only reported
 * "a cited file's content changed". Both were correct and neither could see the other, so a document
 * could carry an entry that one half called retired and the other called fine, and nothing owned the
 * precedence. This module owns only the precedence: it adds no detection of its own, takes the facts
 * each caller can afford to gather, and answers with a single state per entry.
 *
 * Order matters and is the same order the retirement engine already applied: the more certain a
 * verdict is, the earlier it wins.
 * 1. `superseded` — someone wrote a replacement for it.
 * 2. `anchor-drift` — a path it cites is gone, or its line anchor is past the end.
 * 3. `task-closed` — a task it cites is archived; the fact may be moot, which is not the same as false.
 * 4. `version-shipped` — it claims something is unreleased and that marker is in a released changelog.
 * 5. `age-unconfirmed` — old enough and no longer mentioned anywhere the scan could read.
 * 6. `content-stale` — a cited file still exists but its fingerprint changed since the binding.
 * 7. `healthy`.
 *
 * Only the first two and `age-unconfirmed` may be acted on, and only by the retirement engine
 * (`retiresEntry`). The other three are labels with an explicit exit: `3`–`4` by recording that a
 * human confirmed the entry, `6` by re-baselining its fingerprints. A state nothing can leave is a
 * trap — `content-stale` was one until `/memory reconcile --accept` existed.
 */
import { pick } from "../shared/language.js";
/** The states a verdict may report without the entry being wrong: each one has an explicit exit. */
export const NON_RETIRING_STATES = ["task-closed", "version-shipped", "content-stale"];
/**
 * The state as a receipt names it, per language.
 *
 * The English column is the enum itself: a receipt, a test and the consolidation prompt all read the
 * same word, so a reader can grep for the state the code decided. The Chinese column is what
 * `/memory reconcile` prints — the state name sits inline next to the entry's id, so leaving it in
 * English made a Chinese receipt read half-translated.
 */
export const ENTRY_STATE_LABEL = {
    en: {
        superseded: "superseded",
        "anchor-drift": "anchor-drift",
        "task-closed": "task-closed",
        "version-shipped": "version-shipped",
        "age-unconfirmed": "age-unconfirmed",
        "content-stale": "content-stale",
        healthy: "healthy",
    },
    zh: {
        superseded: "已被取代",
        "anchor-drift": "锚点漂移",
        "task-closed": "任务已归档",
        "version-shipped": "版本已发布",
        "age-unconfirmed": "年龄未确认",
        "content-stale": "内容已变",
        healthy: "健康",
    },
};
/**
 * The state of one entry, from the facts the caller gathered.
 *
 * A missing fact set is "not known", not "healthy": the caller decides which facts it can afford, and
 * a state this call cannot see simply does not win. That is why the return is a plain state rather
 * than a confidence — the caller's receipt is the place that says which facts were gathered (the
 * `/memory status` line names its subset for exactly this reason).
 * @param tid - the entry's stamped id.
 * @param facts - everything the caller knows, keyed by id.
 * @param language - the language the receipt is written in; the prompt-facing callers leave it `"en"`.
 * @returns the winning state and its detail.
 */
export function entryStateOf(tid, facts, language = "en") {
    // The evidence lists are paths and reasons, so only the separator and the two sentences below are
    // language-dependent. `anchorDriftReasons` stays English on purpose: its only reader that renders
    // the text is the consolidation prompt, which is written in English.
    const separator = pick(language, "；", "; ");
    const replacement = facts.superseded?.get(tid);
    if (replacement !== undefined)
        return { state: "superseded", detail: replacement };
    const drift = facts.drifted?.get(tid);
    if (drift !== undefined && drift.length > 0)
        return { state: "anchor-drift", detail: drift.join(separator) };
    const closed = facts.taskClosed?.get(tid);
    if (closed !== undefined && closed.length > 0)
        return { state: "task-closed", detail: closed.join(separator) };
    const shipped = facts.shipped?.get(tid);
    if (shipped !== undefined && shipped.length > 0)
        return { state: "version-shipped", detail: shipped.join(separator) };
    if (facts.unconfirmed?.has(tid) === true) {
        return { state: "age-unconfirmed", detail: pick(language, "超过年龄阈值，且在扫描到的会话里不再被提及", "past the age horizon with no mention in the scanned sessions") };
    }
    if (facts.stale?.has(tid) === true) {
        return { state: "content-stale", detail: pick(language, "引用的文件内容自绑定之后已改", "a cited file's content changed since the binding") };
    }
    return { state: "healthy", detail: "" };
}
/** True for the states the retirement engine is allowed to drop an entry for. */
export function retiresEntry(state) {
    return state === "superseded" || state === "anchor-drift" || state === "age-unconfirmed";
}
/**
 * Count entries per state, for a receipt.
 *
 * Only the states named by the facts the caller gathered can appear; a receipt that passed `stale`
 * but not `drifted` reports zero `anchor-drift` because it did not look, which is why the caller must
 * say so in its own wording rather than let the zero speak.
 * @param ids - the ids the caller wants counted.
 * @param facts - the same facts `entryStateOf` reads.
 * @returns a count per state, with every state present.
 */
export function countEntryStates(ids, facts) {
    const counts = {
        superseded: 0,
        "anchor-drift": 0,
        "task-closed": 0,
        "version-shipped": 0,
        "age-unconfirmed": 0,
        "content-stale": 0,
        healthy: 0,
    };
    for (const tid of ids)
        counts[entryStateOf(tid, facts).state] += 1;
    return counts;
}
