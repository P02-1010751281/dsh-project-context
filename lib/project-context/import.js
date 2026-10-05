/**
 * Backfill entry points: import one parsed session, one archive file, or a whole directory tree,
 * idempotently and with the canonical artifacts written last.
 */
import path from "node:path";
import { logsDir, pathExists, safeSessionId, writeAtomic } from "../shared/project-state.js";
import { ensureLogsIgnored, renderSessionMarkdown } from "./session-log.js";
import { queueIndexLine, sessionIndexLineFrom, sessionTitleFromEntries } from "./session-index.js";
import { markdownHeaderView, parseSessionJsonl } from "./session-jsonl.js";
import { readArchiveFile } from "./zip.js";
/** Write one parsed archive into the project's session-log layout and index it. */
export async function importSessionJsonl(text, options) {
    const archive = parseSessionJsonl(text);
    const { id, entries } = archive;
    const safe = safeSessionId(id);
    const dir = path.join(logsDir(options.projectRoot), safe);
    const rawPath = path.join(dir, "session.jsonl");
    const markdownPath = path.join(dir, "session.md");
    const withMarkdown = options.markdown ?? true;
    await ensureLogsIgnored(options.projectRoot);
    // Render before writing anything: a rendering failure must not leave a raw
    // JSONL behind that later runs then report as an already-imported session.
    const markdown = withMarkdown ? renderSessionMarkdown(markdownHeaderView(archive), entries) : undefined;
    // "Imported" means every artifact is present. Testing the JSONL alone would
    // treat a half-written import (raw copy present, Markdown/INDEX missing) as
    // done, and no later pass could ever repair it.
    const exists = await pathExists(rawPath) && (!withMarkdown || await pathExists(markdownPath));
    if (exists && !options.replace)
        return { id, status: "skipped", dir, entries: entries.length };
    if (markdown !== undefined)
        await writeAtomic(markdownPath, markdown);
    await queueIndexLine(options.projectRoot, safe, sessionIndexLineFrom(id, archive.createdAt, sessionTitleFromEntries(entries)));
    // Verbatim copy, written last so its presence marks a complete import: the
    // archive is evidence, so the canonical JSONL keeps the source bytes (headers
    // of older exports carry fields later versions dropped, e.g. `delegationDepth`);
    // only the trailing newline is normalized to one.
    await writeAtomic(rawPath, text.endsWith("\n") ? text : `${text}\n`);
    return { id, status: "created", dir, entries: entries.length };
}
/** Import one archive file; parse/write failures come back as `failed`, never thrown. */
export async function importArchiveFile(file, options) {
    try {
        const outcome = await importSessionJsonl(await readArchiveFile(file), options);
        return { ...outcome, source: file };
    }
    catch (error) {
        return { id: path.basename(file), status: "failed", source: file, error: error.message };
    }
}
/** Import a batch of archives (files passed in order; no ordering assumption inside). */
export async function importArchiveFiles(files, options) {
    const outcomes = [];
    for (const file of files)
        outcomes.push(await importArchiveFile(file, options));
    return outcomes;
}
