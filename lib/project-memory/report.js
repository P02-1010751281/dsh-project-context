/**
 * project-memory — what one consolidation pass did, and how it reads back.
 *
 * Split out of `index.ts` so the report layer (the shapes a pass returns, and the receipt sentences a
 * user reads) can be reviewed and tested apart from the pass itself and from the plugin wiring. The
 * module owns no host interface and no registration: it takes plain values and returns plain text.
 */
import path from "node:path";
import {} from "./missing-literals.js";
import {} from "./consolidate.js";
import { acceptStaleness, measureStaleness } from "./staleness-source.js";
import {} from "./entry-state.js";
import {} from "./entry-states.js";
import { stalenessClause } from "./staleness.js";
import {} from "../shared/language.js";
import { MAX_CONTEXT_CHARS, memoryDir, memoryFile, purgeLogFile } from "../shared/project-state.js";
import { formatBytes } from "./prune.js";
import { formatMemoryStatus } from "./status-report.js";
import { loadMemory } from "./memory-store.js";
import { readMemoryFileFacts } from "./status-source.js";
import { entryTid } from "./retirement.js";
import { retiresEntry } from "./entry-state.js";
import { confirmExpiry } from "./expiry-source.js";
import { sectionsFromMarkdown } from "./sections.js";
export const NO_LOSS = {
    memoryWritten: false,
    contextWritten: false,
    contextDroppedChars: 0,
    memoryWriteDroppedChars: 0,
    sectionDropped: 0,
    droppedItems: 0,
    itemTruncated: 0,
    partialRefused: false,
};
/** A report for a status that landed no write, so it can never claim a loss. */
export function cleanReport(status) {
    return { status, ...NO_LOSS };
}
/**
 * The `/memory` status reply for one loaded memory. Exported for tests.
 *
 * This is only composition: the loader has already measured the document and its flags, `sections.ts`
 * knows the document's shape, and `status-source.ts` measures the store around it. The receipt's
 * wording lives in `status-report.ts`, so "what the user reads" and "what was measured" are two files
 * that can be reviewed apart — and a test can render a receipt from plain objects without touching a
 * disk.
 * @param memory - the loaded memory document and its status flags.
 * @param context - the paths and the cap this project is configured with.
 * @returns the command result.
 */
export async function memoryStatusReply(memory, context, language = "en") {
    return formatMemoryStatus({
        document: memory.text,
        source: memory.source,
        expectedPath: memoryFile(context.projectRoot),
        journalPath: context.journal,
        maxChars: context.maxMemoryChars,
        damaged: memory.damaged ?? 0,
        unreadable: memory.unreadable === true,
        poisoned: memory.poisoned === true,
        cappedDroppedChars: memory.cappedDroppedChars ?? 0,
        staleness: memory.text.trim() === "" ? undefined : await measureStaleness(context.projectRoot, memory.text).catch(() => undefined),
        files: await readMemoryFileFacts(context.projectRoot),
    }, language);
}
/**
 * Name what a pass gave up, mechanism by mechanism, so a lossy receipt cannot read as a clean one.
 *
 * The mechanisms are worded separately because they fail differently: the write-cap count is the
 * memory the cap dropped from the reply itself, and the drop counts are a renderer refusing to write
 * an entry whole. An empty string means the report carries no loss at all. The input side is not
 * here: a pass shown a shortened view is refused before the model call, so it lands nothing.
 * @param report - the pass result, whose counts are already filtered to what landed.
 * @returns the loss clause, or `""` when the pass was clean.
 */
function memoryLossDetail(report) {
    const parts = [];
    if (report.memoryWriteDroppedChars > 0)
        parts.push(`${report.memoryWriteDroppedChars} character(s) of the reply exceeded the memory cap and were dropped on write`);
    if (report.sectionDropped > 0)
        parts.push(`${report.droppedItems} whole entry(ies) were dropped from ${report.sectionDropped} section(s) because the memory document reached its character cap`);
    if (report.itemTruncated > 0)
        parts.push(`${report.itemTruncated} entry(ies) exceeded their section's per-item cap and were truncated`);
    if (report.contextDroppedChars > 0)
        parts.push(`${report.contextDroppedChars} character(s) of the context were dropped to fit its section budgets`);
    return parts.join("; ");
}
/**
 * The refused reply's own loss, as a clause that starts mid-sentence, or `""` when this pass refused
 * nothing.
 *
 * It is a separate field from `memoryLossDetail` on purpose: every count in that one describes what
 * landed, and a refused reply landed nothing. Sharing a field would have to break one contract or the
 * other, which is exactly how a refusal would end up reading like a lossy write.
 */
function refusedLossCause(report) {
    const refused = report.refusedLoss;
    if (refused === undefined)
        return "";
    const parts = [];
    if (refused.sectionDropped > 0) {
        parts.push(`${refused.droppedItems} whole entry(ies) would have been dropped from ${refused.sectionDropped} section(s) because the memory document reached its character cap`);
    }
    if (refused.writeCapDroppedChars > 0) {
        parts.push(`${refused.writeCapDroppedChars} character(s) of the reply exceeded the memory cap`);
    }
    return parts.length === 0 ? "the reply would have been stored lossily" : `the reply would have been stored lossily (${parts.join("; ")})`;
}
/**
 * Name the artifact(s) a pass wrote, so no receipt claims one that did not land.
 *
 * The files are named rather than the layer word repeated after the `Memory: ` prefix, so "both
 * landed" stays distinguishable from "only one did" without reading as `Memory: memory …`.
 */
function writtenTarget(report) {
    // A bound session writes its task's document instead of the project-level one, and the receipt has
    // to name the file that actually changed: "CONTEXT.md" would be a landed write reported against a
    // document this pass never opened.
    const context = report.contextTarget ?? "CONTEXT.md";
    if (report.memoryWritten && report.contextWritten)
        return `MEMORY.md and ${context}`;
    return report.memoryWritten ? "MEMORY.md" : context;
}
/**
 * The `/memory update` reply for one pass result. The pass swallows its own
 * error (it is also logged to `errors.log`), so the reply must not claim success
 * for a failure or for a deduped no-op. Exported for tests.
 *
 * A loss count only ever extends the sentence, so `detail === ""` keeps meaning "what the sentence
 * names landed, and nothing was lost" — a reworded base is caught rather than silently accepted.
 * @param report - what the consolidation attempt did, including the loss it caused.
 * @returns the command result.
 */
export function memoryUpdateReply(report) {
    const detail = memoryLossDetail(report);
    const refused = refusedLossCause(report);
    if (report.status === "failed") {
        const base = "Memory: update failed; see .agents/memory/errors.log.";
        // A write that landed before the failure is not part of the failure; say which one survived.
        if (!report.memoryWritten && !report.contextWritten) {
            // A refusal decided before the failure is not the failure either: the memory was kept on
            // purpose, and dropping that from the receipt would report the pass as a plain error.
            return { kind: "error", text: refused === "" ? base : `${base} The memory was not written: ${refused}, and the one targeted retry did not fix it.` };
        }
        const what = report.memoryWritten && report.contextWritten ? "The memory and the context" : report.memoryWritten ? "The memory" : "The context";
        return { kind: "error", text: `${base} ${what} had already landed${detail === "" ? "" : `, with this loss: ${detail}`}.` };
    }
    if (report.status === "deduped")
        return { kind: "success", text: "Memory: already up to date (deduped recently); nothing was rewritten." };
    if (report.status === "unchanged")
        return { kind: "success", text: "Consolidation ran but produced no new memory or context." };
    const target = writtenTarget(report);
    // A refused reply is not a write: the memory changed while the reply was being built, so the newer
    // bytes stay effective, and neither artifact was published. The wording may not claim either one.
    if (report.status === "stale") {
        return {
            kind: "success",
            text: [
                "Memory: was not rewritten — it changed while this pass's reply was being built.",
                "The newer memory stays effective; run /memory update again to consolidate from it.",
            ].join("\n"),
        };
    }
    if (report.status === "partial-refused") {
        // Batch Q2's refusal: the reply was in this extension's shape but could not be merged, so writing
        // it would have replaced content this pass cannot account for. Saying "lossy" or naming the cap
        // would point at the wrong cause; the lever is the reply's shape, and a complete document (or a
        // subset of the four sections) is what unblocks it.
        // Two causes, two levers: a store that is not a four-section document can only be replaced by a
        // complete one, while a reply whose sections are not plain `- ` entries is fixed in the reply.
        // Offering the wrong one is a dead lever, so the reason decides the sentence.
        const lever = report.partialRefusal === "store-not-sections"
            ? "Send the complete four-section document (## Project / ## Invariants / ## Pitfalls / ## Index) to replace the stored one."
            : "Rewrite the reply so every line under a section is a `- ` entry at column 0, or send a subset of the four sections to merge the rest from the stored memory.";
        return {
            kind: "success",
            text: [
                "Memory: was kept unchanged — the reply could not be merged into the stored memory.",
                lever,
                "See .agents/memory/errors.log for the merge failure.",
            ].join("\n"),
        };
    }
    if (report.status === "read-capped-refused") {
        // A refusal decided before the model call: the pass was shown only part of a stored artifact, and
        // writing a reply built from that view would have deleted the rest. The advice must follow the
        // side that was cut — `maxMemoryChars` cannot raise the context read cap (it is a constant), and
        // shortening the memory cannot un-cut the context, so a single generic lever would be a dead one.
        const refused = report.readCappedRefused;
        const hidden = [];
        const levers = [];
        if (refused !== undefined && refused.memoryHiddenChars > 0) {
            hidden.push(`${refused.memoryHiddenChars} character(s) of the stored memory (its ${refused.cap}-character cap)`);
            levers.push("raise maxMemoryChars above the stored memory's length, or shorten that document");
        }
        if (refused !== undefined && refused.contextHiddenChars > 0) {
            hidden.push(`${refused.contextHiddenChars} character(s) of the stored context (its ${MAX_CONTEXT_CHARS}-character read cap)`);
            levers.push("shorten CONTEXT.md");
        }
        const what = hidden.length > 0 ? hidden.join(" and ") : "part of the stored memory";
        const lever = levers.length > 0 ? levers.join("; ") : "raise maxMemoryChars";
        return {
            kind: "success",
            text: [
                "Memory: was kept unchanged — the pass did not run.",
                `${what} would have been hidden from the model, and a reply built from that shortened view would have replaced the stored file with it.`,
                `To unblock: ${lever}, then run /memory update again.`,
            ].join("\n"),
        };
    }
    if (report.status === "fit-capped-refused") {
        // The read caps were satisfied, so `maxMemoryChars` cannot be the lever here: the documents are
        // within both read caps and the output budget still cannot hold them whole. Naming the memory cap
        // would send the operator to a knob that cannot buy the pass a token, which is the dead-lever
        // failure the read-cap receipt was written to avoid — on the other side of the same budget.
        const refused = report.fitCappedRefused;
        const hidden = [];
        const levers = [];
        if (refused !== undefined && refused.memoryHiddenChars > 0) {
            hidden.push(`${refused.memoryHiddenChars} character(s) of the stored memory`);
            levers.push("shorten MEMORY.md");
        }
        if (refused !== undefined && refused.contextHiddenChars > 0) {
            hidden.push(`${refused.contextHiddenChars} character(s) of the stored context`);
            levers.push("shorten CONTEXT.md");
        }
        const what = hidden.length > 0 ? hidden.join(" and ") : "part of the stored documents";
        const budget = refused !== undefined ? `the ${refused.maxOutputTokens}-token output budget` : "the output budget";
        const lever = levers.length > 0
            ? `raise maxOutputTokens, or ${levers.join(" and ")}`
            : "raise maxOutputTokens";
        return {
            kind: "success",
            text: [
                `Memory: was kept unchanged — the pass did not run.`,
                `${budget} cannot hold both stored documents, and ${what} would have been hidden from the model; a reply built from that shortened view would have replaced the stored file with it.`,
                `To unblock: ${lever}, then run /memory update again.`,
            ].join("\n"),
        };
    }
    if (report.status === "lossy-refused") {
        // A refusal is neither a failure nor a write: the stored memory is byte-identical, and the reply
        // is named through its own counts so the operator can act (usually by raising `maxMemoryChars`).
        // Both artifacts are withheld with the refusal, so no landed count can describe this pass.
        // The pass itself is cached for `forceDedupeMs`, so an immediate re-run can only re-report this
        // refusal; the lever that actually gives the reply room is the cap.
        return {
            kind: "success",
            text: [
                "Memory: was kept unchanged — the reply would have lost content.",
                `${refused}; the one targeted retry did not fix it.`,
                "Raise maxMemoryChars, or retry the pass later, to give the reply more room.",
            ].join("\n"),
        };
    }
    // One fact per line, and the numbers stay on the first one. The client folds a receipt into a single
    // ellipsized row and offers the expandable body only when the text contains a newline; the loss
    // counters used to trail four long sentences, so the clip ate them and there was no body to open.
    // The verdict plus the counts is what a reader needs at a glance; each sentence and sample follows.
    const counts = [];
    if (report.missingLiterals !== undefined && report.missingLiterals.count > 0)
        counts.push(`missing literals ${report.missingLiterals.count}`);
    if (report.restoredEntries !== undefined && report.restoredEntries.count > 0)
        counts.push(`restored ${report.restoredEntries.count}`);
    if (report.unrestoredEntries !== undefined && report.unrestoredEntries.count > 0)
        counts.push(`not restored ${report.unrestoredEntries.count}`);
    if (report.contextMissingLiterals !== undefined && report.contextMissingLiterals.count > 0)
        counts.push(`context missing ${report.contextMissingLiterals.count}`);
    const head = `${detail === "" ? `Memory: updated ${target}` : `Memory: updated ${target}, but the rewrite was lossy`}${counts.length > 0 ? ` · ${counts.join(" · ")}` : ""}.`;
    const lines = [head];
    if (detail !== "")
        lines.push(`Rewrite loss: ${detail}.`);
    // The verdict is its own line: it describes the sources, not the write, and a pass that measured
    // nothing must not borrow the write's certainty. Only a verdict that judged something earns a line:
    // "stale 0 (no entry cites a bound file)" on every update would teach the reader to skip it.
    if (report.staleness !== undefined && report.staleness.checked && report.staleness.bound > 0) {
        lines.push(`Source bindings: ${stalenessClause(report.staleness)}.`);
    }
    // The rewrite loss gate's sentence: `detail` reports structure, so a document regenerated in
    // condensed wording lands with a clean detail while facts leave. This is the only receipt line that
    // names that loss. Two samples here and `MISSING_LITERAL_SAMPLES` in `errors.log`: the count is the
    // evidence, the log is where to look. `count > 0` implies at least one sample, so the parenthetical
    // cannot be empty.
    if (report.missingLiterals !== undefined && report.missingLiterals.count > 0) {
        lines.push(`Missing literals: ${report.missingLiterals.count} backticked literal(s) the previous memory carried no longer appear (e.g. ${report.missingLiterals.samples.slice(0, 2).join(" | ")}).`);
    }
    // The repair's own line: a pass that silently dropped an entry and had it put back is not a clean
    // pass, and the reader needs to know the document grew without the model saying so. It never appears
    // together with `unrestored` for the same entries.
    if (report.restoredEntries !== undefined && report.restoredEntries.count > 0) {
        lines.push(`Restored: ${report.restoredEntries.count} entry(ies) the reply had dropped (e.g. ${report.restoredEntries.samples.slice(0, 2).join(" | ")}).`);
    }
    if (report.unrestoredEntries !== undefined && report.unrestoredEntries.count > 0) {
        lines.push(`Not restored: ${report.unrestoredEntries.count} entry(ies) the reply dropped did not fit back under the cap (e.g. ${report.unrestoredEntries.samples.slice(0, 2).join(" | ")}).`);
    }
    // The context half of the same measure. It names the document it came from because `/memory update`
    // answers for both artifacts, and a bound session writes a task document instead of `CONTEXT.md`.
    if (report.contextMissingLiterals !== undefined && report.contextMissingLiterals.count > 0) {
        lines.push(`Context missing literals: ${report.contextMissingLiterals.count} backticked literal(s) the previous ${report.contextTarget ?? "CONTEXT.md"} carried no longer appear (e.g. ${report.contextMissingLiterals.samples.slice(0, 2).join(" | ")}).`);
    }
    return { kind: "success", text: lines.join("\n") };
}
/**
 * The `/memory prune` reply for one cleaning run. Exported for tests.
 *
 * A preview and an applied run answer different questions and must never read alike: the preview
 * exists so a user can see what would leave the directory before anything does, and the applied
 * receipt has to name the archive, because that tarball is the only way back.
 * @param outcome - what the cleaning channel planned and what it did.
 * @param projectRoot - the project root, for paths relative to it.
 * @returns the command result.
 */
export function memoryPruneReply(outcome, projectRoot) {
    const memory = path.relative(projectRoot, memoryDir(projectRoot)) || memoryDir(projectRoot);
    const size = formatBytes(outcome.plan.bytes);
    // One fact per line: the client folds a receipt into a single ellipsized row and only offers the
    // expandable body when the text contains a newline, so a one-line prune report was both clipped and
    // impossible to open. The verdict leads; the file list and the remedy follow.
    const candidateLines = outcome.plan.candidates
        .slice(0, 8)
        .map((candidate) => `  ${candidate.name} (${candidate.reason}, ${formatBytes(candidate.bytes)})`);
    const hidden = outcome.plan.candidates.length - candidateLines.length;
    const more = hidden > 0 ? [`  … and ${hidden} more`] : [];
    const trash = outcome.trash === undefined ? undefined : path.relative(projectRoot, outcome.trash) || outcome.trash;
    const log = path.relative(projectRoot, purgeLogFile(projectRoot)) || purgeLogFile(projectRoot);
    if (outcome.status === "failed") {
        // Fail closed: the archive is written before the first removal, so a failure here means the
        // directory is untouched. Say that, and do not imply a partial cleanup.
        return {
            kind: "error",
            text: [
                `Memory prune: nothing was deleted — ${outcome.error ?? "the bytes could not be archived"}.`,
                `The ${outcome.plan.candidates.length} planned file(s) (${size}) are still in ${memory}; nothing was logged as removed.`,
            ].join("\n"),
        };
    }
    if (outcome.status === "nothing") {
        return {
            kind: "success",
            text: [
                "Memory prune: nothing to clean.",
                "The retention rules: backups keep the newest 3, archived journals and stray journal temporaries are kept 90 days, errors.log is truncated above 1 MB, skill candidates for 60 days.",
            ].join("\n"),
        };
    }
    if (outcome.status === "preview") {
        return {
            kind: "success",
            text: [
                `Memory prune: ${outcome.plan.candidates.length} file(s), ${size}, could be cleaned from ${memory}.`,
                ...candidateLines,
                ...more,
                `Nothing was deleted; /memory prune --apply removes them after archiving the bytes to ${memory}/trash/<date>.tar and appending one line to ${log}.`,
            ].join("\n"),
        };
    }
    const actions = [];
    if (outcome.removed > 0)
        actions.push(`removed ${outcome.removed} file(s)`);
    if (outcome.truncated > 0)
        actions.push(`truncated ${outcome.truncated} file(s) in place`);
    const did = actions.join(" and ");
    if (outcome.status === "partial") {
        return {
            kind: "success",
            text: [
                `Memory prune: ${did} of ${outcome.plan.candidates.length} planned (${size}); ${outcome.failed} file(s) could not be cleaned${outcome.error === undefined ? "" : ` (${outcome.error})`}.`,
                `The bytes that left are archived in ${trash}; one line was appended to ${log}.`,
            ].join("\n"),
        };
    }
    return {
        kind: "success",
        text: [
            `Memory prune: ${did} (${size}).`,
            `Bytes archived in ${trash}; one line appended to ${log}.`,
        ].join("\n"),
    };
}
/** How many entries a reconciliation receipt lists before it stops being a receipt. */
const MAX_RECONCILE_LINES = 10;
/**
 * Accept one entry's current state: the single exit, dispatched by what the arbiter says.
 *
 * `content-stale` is cleared by re-baselining fingerprints; `task-closed` and `version-shipped` have no
 * fingerprint to refresh, so they are cleared by recording that a human confirmed the entry. A
 * retirable state is refused on purpose — the remedy there is the retirement pass, and accepting it
 * would keep an entry the document already superseded.
 * @param projectRoot - the project the sidecar lives in.
 * @param text - the loaded memory document.
 * @param states - the arbiter's verdict, already computed for this document.
 * @param tid - the entry id the user named.
 * @returns what happened, for the receipt.
 */
export async function acceptEntryState(projectRoot, text, states, tid) {
    if (!states.checked)
        return { kind: "unreadable-store" };
    if (!states.entries.some((entry) => entry.tid === tid) && !(await documentHasEntry(text, tid)))
        return { kind: "unknown-entry" };
    const found = states.entries.find((entry) => entry.tid === tid);
    if (found === undefined)
        return { kind: "healthy" };
    if (retiresEntry(found.state))
        return { kind: "retirable", state: found.state };
    if (found.state === "content-stale")
        return { kind: "content-stale", outcome: await acceptStaleness(projectRoot, text, tid) };
    await confirmExpiry(projectRoot, tid, found.state);
    return { kind: "confirmed", reason: found.state };
}
/** True when the document carries this id at all, which "healthy" and "no such entry" must not conflate. */
async function documentHasEntry(text, tid) {
    const sections = sectionsFromMarkdown(text);
    if (sections === undefined)
        return false;
    for (const key of Object.keys(sections)) {
        for (const entry of sections[key])
            if (entryTid(entry) === tid)
                return true;
    }
    return false;
}
/**
 * The `/memory reconcile` reply: every entry the arbiter will not call healthy, with its reason.
 *
 * The first line carries the count on purpose — the client folds a command card to one ellipsized line,
 * so a payload below it would be unreadable without expanding the card. Each line names the entry, the
 * state, and the evidence; an id alone gives the reader nothing to confirm.
 * @param states - the arbiter's verdict for the document.
 * @param context - the read-cap count, so a truncated view is named instead of implied complete.
 * @returns the command result.
 */
export function memoryReconcileReply(states, context) {
    const hidden = context.cappedDroppedChars > 0
        ? `\nThe read cap hid ${context.cappedDroppedChars} character(s), so entries past that point were not judged.`
        : "";
    if (!states.checked) {
        return { kind: "error", text: `Memory reconcile: unknown — the entry sidecar or the memory document could not be read, so nothing was judged.${hidden}` };
    }
    if (states.entries.length === 0) {
        return { kind: "success", text: `Memory reconcile: no entry has a reason to re-verify — all ${states.total} entr${states.total === 1 ? "y is" : "ies are"} healthy.${hidden}` };
    }
    const lines = states.entries
        .slice(0, MAX_RECONCILE_LINES)
        .map((entry) => `  ${entry.tid} — ${entry.state} — ${entry.detail}`);
    const more = states.entries.length > MAX_RECONCILE_LINES ? `\n  … and ${states.entries.length - MAX_RECONCILE_LINES} more` : "";
    const count = states.entries.length;
    return {
        kind: "success",
        text: `Memory reconcile: ${count} of ${states.total} entr${count === 1 ? "y has" : "ies have"} a reason to re-verify — the claim is unverified, not necessarily wrong.\n${lines.join("\n")}${more}\n/memory reconcile --accept <id> records that you confirmed one; a pass rewrites the rest.${hidden}`,
    };
}
/**
 * The `/memory reconcile --accept <id>` reply.
 *
 * Every refusal is a different cause and says which, because the reader's next move differs: a missing
 * anchor or a superseded entry is the retirement pass's business, an unreadable file must not be frozen
 * as truth, and a raced acceptance only needs to be run again.
 * @param result - what the acceptance did.
 * @param tid - the entry id the user named.
 * @returns the command result.
 */
export function memoryAcceptReply(result, tid) {
    if (result.kind === "confirmed") {
        return {
            kind: "success",
            // Verdict first, cause second: the folded summary shows the first line only, and the cause is
            // the part a reader can act on.
            text: `Memory reconcile: accepted ${tid} — recorded that you confirmed it.\n"${result.reason}" stops being reported; any other reason for the same entry still is.`,
        };
    }
    if (result.kind === "healthy") {
        return { kind: "success", text: `Memory reconcile: entry ${tid} has no reason to re-verify.` };
    }
    if (result.kind === "unknown-entry") {
        return { kind: "error", text: `Memory reconcile: no entry ${tid} in this memory.\nRun /memory reconcile to list the entries that carry a reason.` };
    }
    if (result.kind === "retirable") {
        return { kind: "error", text: `Memory reconcile: entry ${tid} is ${result.state} — the retirement engine owns that state.\nRun /memory update instead of accepting it.` };
    }
    if (result.kind === "unreadable-store") {
        return { kind: "error", text: "Memory reconcile: the memory document or its entry sidecar could not be read; nothing was changed." };
    }
    const outcome = result.outcome;
    switch (outcome.status) {
        case "accepted":
            return {
                kind: "success",
                text: `Memory reconcile: accepted ${tid} — ${outcome.paths.length} changed file(s) re-baselined.\n${outcome.paths.join(", ")}; this entry stops being reported as stale.`,
            };
        case "unknown-entry":
            return { kind: "error", text: `Memory reconcile: no entry ${tid} in this memory.` };
        case "no-binding":
            return { kind: "error", text: `Memory reconcile: entry ${tid} cites no checkable file, so it has no baseline to accept.` };
        case "not-stale":
            return { kind: "success", text: `Memory reconcile: entry ${tid} is not stale; its baseline already matches every file it cites.` };
        case "anchor-missing":
            return {
                kind: "error",
                text: `Memory reconcile: entry ${tid} cites a file that no longer exists (${outcome.paths.join(", ")}).\nThat is anchor drift, which retires the entry — run /memory update instead of accepting it.`,
            };
        case "unreadable":
            return {
                kind: "error",
                text: `Memory reconcile: entry ${tid} cites a file that could not be read (${outcome.paths.join(", ")}).\nA baseline is not written from an unread state.`,
            };
        case "unreadable-store":
            return { kind: "error", text: "Memory reconcile: the memory document or its entry sidecar could not be read; nothing was changed." };
        case "raced":
            return { kind: "error", text: `Memory reconcile: entry ${tid} changed while it was being accepted, so nothing was written. Run the command again.` };
    }
}
