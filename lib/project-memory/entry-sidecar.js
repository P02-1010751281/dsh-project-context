/**
 * The one owner of `.agents/memory/entries.json`, the plugin's sidecar for facts **about entries**
 * that must not ride in the bullet text.
 *
 * Two such facts live here:
 *
 * - `entries`: `<tid> -> YYYY-MM-DD`, when the entry was first seen (batch Z2's age clock). It cannot
 *   ride in the bullet because eleven extra characters per entry pushed this project's document from
 *   a clean render to seven dropped entries (measured 2026-11-10).
 * - `sources`: `<tid> -> { <path>: <sha256-prefix> }`, what the entry cited when it was authored
 *   (batch V). It cannot ride in the bullet either — the tid is derived from the body, so a
 *   fingerprint inside the body would change the entry's identity every time a cited file changed,
 *   resetting both the age clock and the very comparison the fingerprint exists for.
 *
 * Both maps are pruned by the same `keep` set, so an id that no longer exists in the document leaves
 * nothing behind. The file is deliberately gitignored: it is a clock and a cache, not a fact — the
 * journal remains the authority, and losing this file degrades to "no known age / no known baseline",
 * which keeps entries rather than retiring them.
 *
 * Version 2 added `sources`. A v2 file is readable by v1 code (it only reads `entries`) and a v1 file
 * is readable here (`sources` defaults to `{}`), so the upgrade needs no migration step.
 *
 * Version 3 added `confirmed`: `<tid> -> [reason]`, the reasons a human has looked at and accepted
 * (`/memory reconcile --accept`). It is the exit for the states no fingerprint can clear — a cited task
 * closed, a claimed release shipped — and it is keyed by reason so accepting one never silences another.
 */
import { lstatSync } from "node:fs";
import { withMemoryLock } from "../shared/lock.js";
import { entryDatesFile, readOptional, writeAtomic } from "../shared/project-state.js";
/** The write-side version. A reader that predates it still finds `entries` where it expects it. */
export const ENTRY_SIDECAR_VERSION = 3;
const ENTRY_ID = /^[0-9a-f]{3,4}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** A fingerprint is a lower-case hex prefix of a SHA-256; 16 characters is the writer's length. */
const FINGERPRINT = /^[0-9a-f]{16}$/;
/** A reason token: the state vocabulary, lower-case and dash-separated. */
const REASON = /^[a-z][a-z-]{0,39}$/;
/**
 * Read the sidecar. A missing, unreadable or malformed file reads as "nothing known": the caller must
 * then keep entries rather than treat them as ageless or unbound.
 * @param projectRoot - the project whose `.agents/memory` holds the file.
 * @returns both maps, with legacy four-hex ids published under the three-hex id the document carries.
 */
export async function readEntrySidecar(projectRoot) {
    const file = entryDatesFile(projectRoot);
    try {
        if (!lstatSync(file).isFile())
            return { entries: new Map(), sources: new Map(), confirmed: new Map(), readable: true };
    }
    catch (error) {
        // An absent file is "never recorded"; anything else (permissions, a FIFO) is unreadable.
        return { entries: new Map(), sources: new Map(), confirmed: new Map(), readable: error?.code === "ENOENT" };
    }
    let parsed;
    try {
        parsed = JSON.parse(await readOptional(file));
    }
    catch {
        return { entries: new Map(), sources: new Map(), confirmed: new Map(), readable: false };
    }
    const raw = (parsed ?? {});
    const entries = new Map();
    const sources = new Map();
    if (typeof raw.entries === "object" && raw.entries !== null) {
        for (const [tid, date] of Object.entries(raw.entries)) {
            if (!ENTRY_ID.test(tid) || typeof date !== "string" || !DATE_ONLY.test(date))
                continue;
            // A legacy four-hex key is published under the id the document now carries, earliest wins,
            // and the obsolete key is dropped: the next write lands only three-hex keys.
            const key = tid.length === 4 ? tid.slice(0, 3) : tid;
            const known = entries.get(key);
            if (known === undefined || date < known)
                entries.set(key, date);
        }
    }
    const confirmed = new Map();
    if (typeof raw.confirmed === "object" && raw.confirmed !== null) {
        for (const [tid, reasons] of Object.entries(raw.confirmed)) {
            if (!ENTRY_ID.test(tid) || !Array.isArray(reasons))
                continue;
            const key = tid.length === 4 ? tid.slice(0, 3) : tid;
            const target = confirmed.get(key) ?? new Set();
            for (const reason of reasons)
                if (typeof reason === "string" && REASON.test(reason))
                    target.add(reason);
            if (target.size > 0)
                confirmed.set(key, target);
        }
    }
    if (typeof raw.sources === "object" && raw.sources !== null) {
        for (const [tid, bindings] of Object.entries(raw.sources)) {
            if (!ENTRY_ID.test(tid) || typeof bindings !== "object" || bindings === null)
                continue;
            const key = tid.length === 4 ? tid.slice(0, 3) : tid;
            const target = sources.get(key) ?? new Map();
            for (const [path, fingerprint] of Object.entries(bindings)) {
                if (typeof fingerprint !== "string" || !FINGERPRINT.test(fingerprint))
                    continue;
                if (target.has(path))
                    continue;
                target.set(path, fingerprint);
            }
            if (target.size > 0)
                sources.set(key, target);
        }
    }
    return { entries, sources, confirmed, readable: true };
}
/**
 * Read-modify-write the sidecar under the memory lock.
 *
 * The update runs inside the lock on purpose: every caller merges into what is on disk (an earliest-wins
 * date, a binding the other process recorded), so a merge computed outside the lock would silently drop
 * a concurrent writer's newer fact. Returning `undefined` means "nothing to write" and skips the file.
 * @param projectRoot - the project whose `.agents/memory` holds the file.
 * @param update - turns the current maps into the maps to persist, or `undefined` to write nothing.
 */
export async function updateEntrySidecar(projectRoot, update) {
    const file = entryDatesFile(projectRoot);
    await withMemoryLock(file, async () => {
        const next = update(await readEntrySidecar(projectRoot));
        if (next === undefined)
            return;
        const document = next;
        // Preserve keys this version does not know about: a future field must not be erased by a writer
        // that predates it, and the same rule keeps a hand-added note from vanishing on the next pass.
        const raw = await readRawObject(file);
        const entries = {};
        for (const [tid, date] of [...document.entries.entries()].sort(([left], [right]) => left.localeCompare(right)))
            entries[tid] = date;
        const sources = {};
        for (const [tid, bindings] of [...document.sources.entries()].sort(([left], [right]) => left.localeCompare(right))) {
            const paths = {};
            for (const [path, fingerprint] of [...bindings.entries()].sort(([left], [right]) => left.localeCompare(right)))
                paths[path] = fingerprint;
            sources[tid] = paths;
        }
        const confirmed = {};
        for (const [tid, reasons] of [...document.confirmed.entries()].sort(([left], [right]) => left.localeCompare(right))) {
            confirmed[tid] = [...reasons].sort();
        }
        await writeAtomic(file, `${JSON.stringify({ ...raw, version: ENTRY_SIDECAR_VERSION, entries, sources, confirmed }, null, "\t")}\n`);
    });
}
/** The file as a plain object, or `{}` when it is absent or unreadable (the write then starts clean). */
async function readRawObject(file) {
    try {
        const parsed = JSON.parse(await readOptional(file));
        return typeof parsed === "object" && parsed !== null ? { ...parsed } : {};
    }
    catch {
        return {};
    }
}
/** Drop every id the landed document no longer carries, from both maps. */
export function pruneSidecar(document, keep) {
    const entries = new Map([...document.entries].filter(([tid]) => keep.has(tid)));
    const sources = new Map([...document.sources].filter(([tid]) => keep.has(tid)));
    const confirmed = new Map([...document.confirmed].filter(([tid]) => keep.has(tid)));
    return { entries, sources, confirmed };
}
