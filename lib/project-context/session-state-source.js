/**
 * The session-log state machine, I/O half: the two sides of the archive and nothing else.
 *
 * The split mirrors `staleness.ts` / `staleness-source.ts` in the memory core: `session-state.ts` owns
 * the rules and never opens anything, this module knows that a session is a directory under
 * `.agents/memory/session-logs/` with a `meta.json` and a row in `INDEX.md`.
 *
 * Read-only by construction. Every state a session can be in is derived here on each read, so a report
 * can never disagree with the disk it was built from — which is the whole reason the four AOCI failure
 * names (Missing / Orphan / Stale / Unbaselined) become checkable only now that something reads both
 * sides together.
 */
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import { logsDir, readOptional } from "../shared/project-state.js";
import { humanUserText } from "../shared/conversation.js";
import { parseSessionIndex } from "./session-index.js";
import { SETTLED_DAYS, sessionStates } from "./session-state.js";
/** The artifacts whose newest mtime is the session's activity. */
const ACTIVITY_FILES = ["session.jsonl", "session.md", "meta.json"];
/** The newest mtime among the artifacts that exist, falling back to the directory itself. */
async function activityMs(sessionDir) {
    let newest = 0;
    for (const name of ACTIVITY_FILES) {
        try {
            const stats = await stat(path.join(sessionDir, name));
            if (stats.mtimeMs > newest)
                newest = stats.mtimeMs;
        }
        catch {
            // An absent artifact says nothing about activity; the next one decides.
        }
    }
    if (newest > 0)
        return newest;
    try {
        return (await stat(sessionDir)).mtimeMs;
    }
    catch {
        return 0;
    }
}
/** The parsed `meta.json`, or `undefined` when it is absent or unreadable — a named absence, not empty. */
async function readMeta(sessionDir) {
    try {
        const parsed = JSON.parse(await readFile(path.join(sessionDir, "meta.json"), "utf8"));
        const date = parsed.date;
        const title = parsed.title;
        if (typeof date !== "string" || typeof title !== "string")
            return undefined;
        const parentId = typeof parsed.parentId === "string" ? parsed.parentId : undefined;
        const kind = typeof parsed.kind === "string" ? parsed.kind : undefined;
        return { date, title, ...(parentId === undefined ? {} : { parentId }), ...(kind === undefined ? {} : { kind }) };
    }
    catch {
        return undefined;
    }
}
/**
 * Whether a settled handoff continuation ever received a human turn.
 *
 * Streams the durable log and stops at the first one, because the only question is zero versus non-zero:
 * an abandoned handoff has nothing to find, so its whole file is read once, while a used one stops within
 * the first few megabytes (measured on this project: the latest first human turn sits at 2.9 MB).
 */
async function humanTurnCount(sessionDir) {
    const file = path.join(sessionDir, "session.jsonl");
    // A continuation that never wrote a log has nothing to read, which is the strongest form of the fact
    // this measures — and `createReadStream` would otherwise reject the whole command with ENOENT.
    try {
        if (!(await stat(file)).isFile())
            return 0;
    }
    catch {
        return 0;
    }
    const stream = createReadStream(file, { encoding: "utf8" }).on("error", () => undefined);
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    let count = 0;
    for await (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === "")
            continue;
        try {
            if (humanUserText(JSON.parse(trimmed)) !== undefined)
                count += 1;
        }
        catch {
            // A torn tail line is skipped, exactly as the durable reader skips it.
        }
        if (count > 0) {
            lines.close();
            stream.destroy();
            break;
        }
    }
    return count;
}
/**
 * Judge the whole archive against its own index.
 *
 * The index side is read from the file rather than from a projection so a wrong row is visible: reading
 * the regenerated view would compare the directory with itself and find nothing.
 * @param projectRoot - the project whose `.agents/memory/session-logs` is read.
 * @param now - the clock the live/settled split is measured against; injected for tests.
 * @returns the verdict for every session either side knows about.
 */
export async function measureSessionStates(projectRoot, now = Date.now(), settledDays = SETTLED_DAYS) {
    const directory = logsDir(projectRoot);
    const indexFile = path.join(directory, "INDEX.md");
    const indexText = await readOptional(indexFile);
    const indexPresent = await stat(indexFile).then(() => true).catch(() => false);
    const rows = parseSessionIndex(indexText);
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    const dirs = new Map();
    for (const entry of entries) {
        if (!entry.isDirectory())
            continue;
        const sessionDir = path.join(directory, entry.name);
        dirs.set(entry.name, { activityMs: await activityMs(sessionDir), meta: await readMeta(sessionDir) });
    }
    for (const [name, facts] of dirs) {
        if (facts.meta?.kind !== "handoff")
            continue;
        if (now - facts.activityMs <= settledDays * 86_400_000)
            continue;
        dirs.set(name, { ...facts, humanTurns: await humanTurnCount(path.join(directory, name)) });
    }
    return sessionStates({
        dirs,
        rows: new Map(rows.map((row) => [row.id, { date: row.date, title: row.title }])),
        indexPresent: indexPresent || rows.length > 0,
        now,
        settledDays,
    });
}
