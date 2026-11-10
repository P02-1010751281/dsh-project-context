/**
 * Batch Z4 — the cleaning channel: the only path in this plugin that deletes.
 *
 * Four local artifacts grow without a floor: byte-level backups of `MEMORY.md`, archived journals,
 * the append-only `errors.log`, and autolearn's candidate notes. Before this module each had (at
 * most) a burst guard next to its writer, and none of them had a durable floor.
 *
 * Two rules shape every line below:
 *
 *  1. **Nothing is deleted before it is in a tarball.** The archive is written and verified against
 *     its own listing first; a plan whose bytes cannot be archived deletes nothing at all. A deletion
 *     that cannot be undone is not worth the disk space it reclaims.
 *  2. **The session archives are never candidates, and neither is the live journal.** They are the
 *     timeline, and the timeline is the audit trail two of batch Z2's three retirement triggers read
 *     ("superseded" and "unconfirmed"); deleting a session directory would silently disable them.
 *     This is why the planner only ever looks at generated names in the memory directory itself.
 *
 * The module never throws: cleaning runs after every consolidation pass, so a failure here must not
 * turn a landed write into a failed command. Every applied run appends exactly one line to
 * `purge.log` (time / targets / bytes / result); the manual preview writes nothing.
 */
import { appendFile, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { MAX_ERROR_LOG_BYTES, diagnosticMessage, errorLogAfterRotation } from "../shared/error-log.js";
import { writeAtomic } from "../shared/files.js";
import { ensureMemoryGitignore } from "../shared/gitignore.js";
import { errorLogFile, memoryDir, purgeLogFile, trashDir } from "../shared/paths.js";
import { isJournalArchiveName } from "./journal.js";
const DAY_MS = 86_400_000;
/** Byte-level backups kept, newest first. The render names the newest one, so it always survives. */
export const PRUNE_BACKUPS_KEPT = 3;
/** Archived journals (`memory-log-*.jsonl`) older than this are reclaimable. */
export const PRUNE_JOURNAL_AGE_MS = 90 * DAY_MS;
/** Autolearn candidate notes older than this are reclaimable. */
export const PRUNE_CANDIDATE_AGE_MS = 60 * DAY_MS;
/** Autolearn's candidate directory, relative to the memory directory. */
const CANDIDATES_SUBDIR = "skill-candidates";
function ageOf(mtimeMs, now) {
    return now - mtimeMs;
}
/**
 * Name the files this project may delete, without touching any of them.
 *
 * Every branch reads the directory entry's own type (`isFile()`), so a symlink is never followed and
 * never a candidate — a link's target lives outside the tree this module owns.
 * @param projectRoot - the project root.
 * @param now - the clock age rules are measured against; injectable for tests.
 * @returns the plan, deterministic in name order.
 */
export async function planPrune(projectRoot, now = Date.now()) {
    const directory = memoryDir(projectRoot);
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    const candidates = [];
    const files = [];
    for (const entry of entries) {
        if (!entry.isFile())
            continue;
        const info = await stat(path.join(directory, entry.name)).catch(() => undefined);
        if (!info)
            continue;
        files.push({ name: entry.name, mtime: info.mtimeMs, bytes: info.size });
    }
    // 1. Byte backups: keep the newest few, whatever their age. The write path keeps its own burst
    //    ceiling (5 + a one-hour floor) so a backup named in a notice stays reviewable for a while;
    //    this is the durable floor below it, so the directory cannot hold a year of copies.
    const backups = files
        .filter((file) => file.name.includes(".memory-backup-"))
        .sort((left, right) => (right.mtime - left.mtime) || right.name.localeCompare(left.name));
    for (const stale of backups.slice(PRUNE_BACKUPS_KEPT)) {
        candidates.push({ name: stale.name, bytes: stale.bytes, reason: "byte-backup", action: "remove" });
    }
    const errorLog = path.basename(errorLogFile(projectRoot));
    for (const file of files) {
        // 2. Archived journals: regenerable copies of a journal that was already collapsed into
        //    `memory.jsonl`, so an old one is a duplicate of bytes the live journal still carries.
        if (isJournalArchiveName(file.name) && ageOf(file.mtime, now) > PRUNE_JOURNAL_AGE_MS) {
            candidates.push({ name: file.name, bytes: file.bytes, reason: "journal-archive", action: "remove" });
            continue;
        }
        // 3. Journal temporaries orphaned by a crash between the atomic write and its rename. The live
        //    `memory.jsonl` is deliberately not in this branch: it is the source of truth.
        if (/^memory\.jsonl\..+\.tmp$/.test(file.name) && ageOf(file.mtime, now) > PRUNE_JOURNAL_AGE_MS) {
            candidates.push({ name: file.name, bytes: file.bytes, reason: "journal-temp", action: "remove" });
            continue;
        }
        // 4. The error log is truncated in place, never deleted: it carries the newest diagnostics.
        if (file.name === errorLog && file.bytes > MAX_ERROR_LOG_BYTES) {
            candidates.push({ name: file.name, bytes: file.bytes, reason: "error-log", action: "truncate" });
        }
    }
    // 5. Autolearn candidates that aged out. Only `<name>.md` files: the directory is ours, but a
    //    stray editor backup next to a candidate is not something this module generated.
    const candidateDirectory = path.join(directory, CANDIDATES_SUBDIR);
    for (const entry of await readdir(candidateDirectory, { withFileTypes: true }).catch(() => [])) {
        if (!entry.isFile() || !entry.name.endsWith(".md"))
            continue;
        const info = await stat(path.join(candidateDirectory, entry.name)).catch(() => undefined);
        if (!info || ageOf(info.mtimeMs, now) <= PRUNE_CANDIDATE_AGE_MS)
            continue;
        candidates.push({
            name: `${CANDIDATES_SUBDIR}/${entry.name}`,
            bytes: info.size,
            reason: "skill-candidate",
            action: "remove",
        });
    }
    candidates.sort((left, right) => left.name.localeCompare(right.name));
    return { candidates, bytes: candidates.reduce((total, candidate) => total + candidate.bytes, 0) };
}
/** A receipt- and log-friendly size: the plan can hold a megabyte-sized log next to a 300-byte note. */
export function formatBytes(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
/** One plan line, bounded: a burst of 40 backups must not write a 4 KB `purge.log` line. */
function targetSummary(plan) {
    const names = plan.candidates.map((candidate) => candidate.name);
    const shown = names.slice(0, 6).join(",");
    return names.length > 6 ? `${shown},(+${names.length - 6} more)` : shown;
}
// ---------------------------------------------------------------------------
// The archive: a plain ustar tarball, written in process
// ---------------------------------------------------------------------------
// This package ships no command capability (`test/project-root.test.mjs` pins that no shipped module
// spawns a process), so the tarball is written here rather than shelled out to the `tar` binary. The
// format is ustar, which every `tar -tf` / `tar -xf` reads; the file is uncompressed on purpose so a
// second run on the same day appends instead of replacing the morning's evidence.
const TAR_BLOCK = 512;
function octal(value, length) {
    // Octal, zero padded, NUL terminated: the numeric fields of a ustar header.
    return Buffer.from(`${Math.max(0, Math.floor(value)).toString(8).padStart(length - 1, "0")}\0`, "ascii");
}
function put(buffer, offset, value) {
    value.copy(buffer, offset, 0, Math.min(value.length, buffer.length - offset));
}
/** Split a member name into ustar's prefix/name pair, or refuse a name the format cannot carry. */
function splitMemberName(name) {
    if (Buffer.byteLength(name) <= 100)
        return { prefix: "", name };
    for (let index = name.lastIndexOf("/"); index > 0; index = name.lastIndexOf("/", index - 1)) {
        const prefix = name.slice(0, index);
        const rest = name.slice(index + 1);
        if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(rest) <= 100)
            return { prefix, name: rest };
    }
    throw new Error(`member name is too long for a ustar header: ${name}`);
}
/** One ustar header block for a regular file. */
function headerBlock(member, size, mtimeMs) {
    const block = Buffer.alloc(TAR_BLOCK, 0);
    put(block, 0, Buffer.from(member.name, "utf8"));
    put(block, 100, Buffer.from("0000644\0", "ascii"));
    put(block, 108, Buffer.from("0000000\0", "ascii"));
    put(block, 116, Buffer.from("0000000\0", "ascii"));
    put(block, 124, octal(size, 12));
    put(block, 136, octal(Math.floor(mtimeMs / 1000), 12));
    // The checksum is computed with its own field read as eight spaces, then written as six octal
    // digits, a NUL and a space — the one field whose spelling is not optional.
    put(block, 148, Buffer.from("        ", "ascii"));
    put(block, 156, Buffer.from("0", "ascii"));
    put(block, 257, Buffer.from("ustar\0", "ascii"));
    put(block, 263, Buffer.from("00", "ascii"));
    put(block, 345, Buffer.from(member.prefix, "utf8"));
    let sum = 0;
    for (const byte of block)
        sum += byte;
    put(block, 148, Buffer.from(`${sum.toString(8).padStart(6, "0")}\0 `, "ascii"));
    return block;
}
/** The members a tarball carries, by the format's own rules (how a verifying reader sees it). */
export function readTarNames(archive) {
    const names = [];
    for (let offset = 0; offset + TAR_BLOCK <= archive.length;) {
        const block = archive.subarray(offset, offset + TAR_BLOCK);
        if (block.every((byte) => byte === 0))
            break;
        const raw = block.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
        const prefix = block.subarray(345, 500).toString("utf8").replace(/\0.*$/s, "");
        const sizeText = block.subarray(124, 136).toString("ascii").replace(/\0.*$/s, "").trim();
        const size = Number.parseInt(sizeText || "0", 8);
        if (!Number.isFinite(size) || size < 0)
            throw new Error(`unreadable tar size field at offset ${offset}`);
        names.push(prefix ? `${prefix}/${raw}` : raw);
        offset += TAR_BLOCK + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
    }
    return names;
}
/** Drop the trailing zero blocks so a previous archive can be extended cleanly. */
function withoutTrailer(archive) {
    let end = archive.length;
    while (end >= TAR_BLOCK && archive.subarray(end - TAR_BLOCK, end).every((byte) => byte === 0))
        end -= TAR_BLOCK;
    return archive.subarray(0, end);
}
/** A tarball carrying every member, appended to `existing` when the day already produced one. */
function buildArchive(existing, members) {
    const blocks = [withoutTrailer(existing)];
    for (const member of members) {
        const split = splitMemberName(member.name);
        blocks.push(headerBlock(split, member.content.length, member.mtimeMs));
        blocks.push(member.content);
        const padding = (TAR_BLOCK - (member.content.length % TAR_BLOCK)) % TAR_BLOCK;
        if (padding > 0)
            blocks.push(Buffer.alloc(padding, 0));
    }
    // Two zero blocks end every archive (the format's end-of-archive marker).
    blocks.push(Buffer.alloc(TAR_BLOCK * 2, 0));
    return Buffer.concat(blocks);
}
/** Write the archive of every candidate, then prove each of them is inside it. */
async function archiveCandidates(projectRoot, plan) {
    const directory = memoryDir(projectRoot);
    const trash = trashDir(projectRoot);
    await mkdir(trash, { recursive: true, mode: 0o700 });
    await ensureMemoryGitignore(directory);
    const archive = path.join(trash, `${new Date().toISOString().slice(0, 10)}.tar`);
    // Read every byte before writing anything: a member that vanished under us must abort the run,
    // not produce an archive that is missing what the plan will then delete.
    const members = [];
    for (const candidate of plan.candidates) {
        const file = path.join(directory, candidate.name);
        const info = await stat(file).catch(() => undefined);
        if (!info?.isFile())
            throw new Error(`planned file disappeared before it could be archived: ${candidate.name}`);
        members.push({ name: candidate.name, content: await readFile(file), mtimeMs: info.mtimeMs });
    }
    const existing = await readFile(archive).catch(() => Buffer.alloc(0));
    const bytes = buildArchive(existing, members);
    const present = new Set(readTarNames(bytes));
    const missing = members.map((member) => member.name).filter((name) => !present.has(name));
    if (missing.length > 0)
        throw new Error(`archive is missing ${missing.length} planned file(s): ${missing.join(", ")}`);
    await writeAtomic(archive, bytes);
    // Verify the bytes on disk, not the buffer that was handed to the writer: the deletion below
    // depends on what a reader will actually find there.
    const onDisk = new Set(readTarNames(await readFile(archive)));
    const absent = members.map((member) => member.name).filter((name) => !onDisk.has(name));
    if (absent.length > 0)
        throw new Error(`the written archive does not carry ${absent.join(", ")}`);
    return archive;
}
/** Append one line to `purge.log`. Best effort: the deletion already happened by the time it runs. */
async function appendPurgeLine(projectRoot, line) {
    try {
        const file = purgeLogFile(projectRoot);
        await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
        await ensureMemoryGitignore(path.dirname(file));
        await appendFile(file, `${new Date().toISOString()} ${line}\n`, { encoding: "utf8", mode: 0o600 });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Clean this project's memory directory.
 *
 * `apply: false` is the preview: it reports the plan and writes nothing, not even a log line — the
 * point of a dry run is that a look leaves no trace. `apply: true` archives, deletes and logs; the
 * automatic path passes the same flag as `/memory prune --apply`, so the two can never disagree
 * about what is deleted. A run with nothing to do logs a line only when it was asked for explicitly,
 * so an idle project does not grow `purge.log` by one line per consolidation pass.
 * @param projectRoot - the project root.
 * @param options.apply - false for a preview.
 * @param options.reason - `auto` (after a consolidation pass) or `manual` (`/memory prune --apply`).
 * @param options.now - the clock age rules are measured against; injectable for tests.
 * @returns what was planned and what actually happened.
 */
export async function pruneProjectMemory(projectRoot, options) {
    const empty = { candidates: [], bytes: 0 };
    let plan;
    try {
        plan = await planPrune(projectRoot, options.now ?? Date.now());
    }
    catch (error) {
        return { status: "failed", plan: empty, removed: 0, truncated: 0, failed: 0, error: diagnosticMessage(error) };
    }
    if (!options.apply)
        return { status: plan.candidates.length > 0 ? "preview" : "nothing", plan, removed: 0, truncated: 0, failed: 0 };
    if (plan.candidates.length === 0) {
        if (options.reason === "manual")
            await appendPurgeLine(projectRoot, "reason=manual removed=0 truncated=0 bytes=0 result=nothing");
        return { status: "nothing", plan, removed: 0, truncated: 0, failed: 0 };
    }
    let trash;
    try {
        trash = await archiveCandidates(projectRoot, plan);
    }
    catch (error) {
        // Fail closed: an unarchiveable plan deletes nothing, and the receipt says why.
        const message = diagnosticMessage(error);
        await appendPurgeLine(projectRoot, `reason=${options.reason} planned=${plan.candidates.length} bytes=${plan.bytes} result=failed: ${message}`);
        return { status: "failed", plan, removed: 0, truncated: 0, failed: plan.candidates.length, error: message };
    }
    const directory = memoryDir(projectRoot);
    let removed = 0;
    let truncated = 0;
    let failed = 0;
    let firstError;
    for (const candidate of plan.candidates) {
        const file = path.join(directory, candidate.name);
        try {
            if (candidate.action === "remove") {
                await rm(file, { force: true });
                removed += 1;
            }
            else {
                await writeAtomic(file, errorLogAfterRotation(await readFile(file, "utf8")));
                truncated += 1;
            }
        }
        catch (error) {
            // One unremovable file must not stop the others; the receipt counts what was left.
            failed += 1;
            firstError ??= diagnosticMessage(error);
        }
    }
    const relative = path.relative(projectRoot, trash) || trash;
    const status = failed === 0 ? "applied" : "partial";
    const result = failed === 0 ? "ok" : `partial: ${failed} failed${firstError === undefined ? "" : ` (${firstError})`}`;
    const logged = await appendPurgeLine(projectRoot, `reason=${options.reason} removed=${removed} truncated=${truncated} bytes=${plan.bytes} trash=${relative} targets=${targetSummary(plan)} result=${result}`);
    if (!logged && failed === 0) {
        return { status: "partial", plan, trash, removed, truncated, failed, error: `the removal landed but ${purgeLogFile(projectRoot)} could not be written` };
    }
    return { status, plan, trash, removed, truncated, failed, ...(firstError === undefined ? {} : { error: firstError }) };
}
