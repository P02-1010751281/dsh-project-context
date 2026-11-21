/**
 * One verdict per entry, from every fact this project can afford to gather.
 *
 * The receipts, the acceptance and the consolidation pass all read this rather than re-deriving a
 * verdict — that is what stops two half-detectors from disagreeing again. It is a separate module from
 * `index.ts` so the pass can use it without importing the plugin entry (which would be a cycle).
 */
import { entryStateOf } from "./entry-state.js";
import { readEntrySidecar } from "./entry-sidecar.js";
import { measureExpiry } from "./expiry-source.js";
import { entryTid } from "./retirement.js";
import { sectionsFromMarkdown } from "./sections.js";
import { measureStalenessDetail } from "./staleness-source.js";
import { dateStamp } from "./tasks.js";
/**
 * The state of every entry in one document, from every fact this project can afford to gather.
 *
 * One arbiter (`entryStateOf`), one call: the receipt, the acceptance and the pass all read this rather
 * than re-deriving a verdict, which is what stops two half-detectors from disagreeing again.
 * @param projectRoot - the project the facts are read from.
 * @param text - the loaded memory document.
 * @param config - the effective plugin config, for the task mode.
 * @returns the verdict per entry, and whether anything could be judged at all.
 */
export async function memoryEntryStates(projectRoot, text, config) {
    const reading = await measureStalenessDetail(projectRoot, text);
    const sections = sectionsFromMarkdown(text);
    if (sections === undefined || !reading.facts.checked)
        return { checked: false, total: 0, entries: [] };
    const expiry = await measureExpiry(projectRoot, sections, { mode: config.taskMode, today: dateStamp() });
    const confirmed = (await readEntrySidecar(projectRoot)).confirmed;
    // A confirmed reason must not be reported again; the other reasons for the same entry still must —
    // they are independent claims, and accepting one says nothing about the rest.
    const open = (facts, reason) => new Map([...facts].filter(([tid]) => confirmed.get(tid)?.has(reason) !== true));
    const stalePaths = new Map(reading.stale.map((entry) => [entry.tid, entry.paths.join(", ")]));
    const facts = {
        stale: new Set(stalePaths.keys()),
        taskClosed: open(expiry.taskClosed, "task-closed"),
        shipped: open(expiry.shipped, "version-shipped"),
    };
    const entries = [];
    let total = 0;
    for (const key of Object.keys(sections)) {
        for (const entry of sections[key]) {
            const tid = entryTid(entry);
            if (tid === undefined)
                continue;
            total += 1;
            const verdict = entryStateOf(tid, facts);
            if (verdict.state === "healthy")
                continue;
            entries.push({ tid, state: verdict.state, detail: verdict.state === "content-stale" ? (stalePaths.get(tid) ?? verdict.detail) : verdict.detail });
        }
    }
    return { checked: true, total, entries };
}
