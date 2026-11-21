/**
 * Expiry, I/O half: read the two sources `expiry.ts` cannot open itself.
 *
 * The split is the same one `staleness.ts` / `staleness-source.ts` uses: the pure module owns the
 * recognition rules and the verdict wording, this one knows that a task is a file under
 * `.agents/memory/tasks/` and a released changelog is a file under `docs/changelog/`.
 *
 * Both reads are conditional on the document actually needing them, because a pass calls this on every
 * consolidation near the cap: a project whose memory cites no task and claims nothing unreleased pays
 * no I/O at all.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { entryTid } from "./retirement.js";
import { updateEntrySidecar } from "./entry-sidecar.js";
import { batchMarkers, claimsUnreleased, shippedFacts, taskClosedFacts, taskReferences } from "./expiry.js";
import { listTasks } from "./tasks.js";
/** Neither source was needed, so neither was read. */
export const NO_EXPIRY = { taskClosed: new Map(), shipped: new Map() };
/** The document's entries as the pure builders need them. */
function entriesOf(sections) {
    const entries = [];
    for (const key of Object.keys(sections)) {
        for (const entry of sections[key]) {
            const tid = entryTid(entry);
            if (tid !== undefined)
                entries.push({ tid, text: entry });
        }
    }
    return entries;
}
/** The released changelogs under `docs/changelog/`, read only when a claim needs them. */
async function readReleasedChangelogs(projectRoot) {
    const directory = path.join(projectRoot, "docs", "changelog");
    const names = await readdir(directory).catch(() => []);
    const released = [];
    for (const name of names.sort()) {
        if (!/^v\d+\.\d+\.\d+\.md$/.test(name))
            continue;
        const file = path.join("docs", "changelog", name);
        const text = await readFile(path.join(projectRoot, file), "utf8").catch(() => "");
        if (text !== "")
            released.push({ file, text });
    }
    return released;
}
/**
 * Measure both sources for one document.
 * @param projectRoot - the checkout the cited paths are relative to.
 * @param sections - the parsed memory document.
 * @param options - the task mode and today's date, which decide a task's derived status.
 * @returns the two fact sets; empty maps mean "nothing to report", never "not checked".
 */
export async function measureExpiry(projectRoot, sections, options) {
    const entries = entriesOf(sections);
    const citesTasks = entries.some((entry) => taskReferences(entry.text).length > 0);
    const claimsUnreleasedState = entries.some((entry) => claimsUnreleased(entry.text) && batchMarkers(entry.text).length > 0);
    const tasks = citesTasks ? (await listTasks(projectRoot)).map((record) => ({ slug: record.slug, meta: record.meta })) : [];
    const released = claimsUnreleasedState ? await readReleasedChangelogs(projectRoot) : [];
    return {
        taskClosed: citesTasks ? taskClosedFacts(entries, tasks, options) : new Map(),
        shipped: claimsUnreleasedState ? shippedFacts(entries, released) : new Map(),
    };
}
/**
 * Record that a human accepted one expiry reason for one entry, so it stops being reported.
 *
 * The exit for the two reasons no fingerprint can clear. It is keyed by reason, so accepting "the task
 * this cites is closed" never silences "a file it cites changed" — the two are independent claims. It
 * is cleared automatically when the entry's body changes, because the id is derived from the body and
 * the sidecar prunes ids the document no longer carries.
 * @param projectRoot - the project whose sidecar is written.
 * @param tid - the entry id the verdict was computed for.
 * @param reason - the state being accepted; stored as-is, validated by the caller's verdict.
 * @returns whether the marker was written (false when the sidecar could not be updated).
 */
export async function confirmExpiry(projectRoot, tid, reason) {
    let written = false;
    await updateEntrySidecar(projectRoot, (current) => {
        const known = new Set(current.confirmed.get(tid) ?? []);
        if (known.has(reason))
            return undefined;
        known.add(reason);
        const next = new Map(current.confirmed);
        next.set(tid, known);
        written = true;
        return { entries: current.entries, sources: current.sources, confirmed: next };
    });
    return written;
}
