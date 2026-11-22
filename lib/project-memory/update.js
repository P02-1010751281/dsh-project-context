/**
 * project-memory — one consolidation pass.
 *
 * The pass owns the serialization (one pass per process at a time) and the version claim that makes a
 * deduplicated run cheap. It was 390 lines of `index.ts`; split out so the plugin entry is wiring and
 * the report layer (`report.ts`) stays pure text. No host registration happens here.
 */
import { projectionsOf } from "../host/dsh/services.js";
import {} from "../shared/config.js";
import { contextClipNotice, contextTruncationDropped } from "./context-schema.js";
import { SerialQueue, projectCwd } from "../shared/lifecycle.js";
import { consolidateProjectState, fallbackUpdate } from "./consolidate.js";
import { contextFile, memoryFile, diagnosticMessage, getProjectRoot, logError, readOptional, taskFile, writeAtomic, } from "../shared/project-state.js";
import { backupMemoryBeforeWrite, memoryJournalFile, normalizeMemoryWithDrop, readMemoryDamage, recordMemoryDocument } from "./memory-store.js";
import { missingLiteralsBetween } from "./missing-literals.js";
import { OPAQUE_DOCUMENT_MIN_CHARS } from "./sections.js";
import { bindAndMeasure } from "./staleness-source.js";
import {} from "./staleness.js";
import { appendTombstones } from "./retired.js";
import { recordEntryDates } from "./retirement.js";
import { withMemoryLock } from "../shared/lock.js";
import { pruneProjectMemory } from "./prune.js";
import { renderContextDocument, renderTaskDocument } from "./context-doc.js";
import { dateStamp, parseTaskMeta, taskRelativePath } from "./tasks.js";
import { projectTodoLines, todoFitNotice, todoLinesIn, withTodoLines } from "./todo.js";
import { cleanReport, NO_LOSS, } from "./report.js";
/** Last consolidation version each project's artifacts were written from. */
const written = new Map();
/** Serialize consolidation so a forced shutdown pass always runs last. */
const updates = new SerialQueue();
/** One pass updates both artifacts so MEMORY.md and CONTEXT.md never disagree about the pass. */
/** One consolidation pass. Exported so the version-claim/backoff behaviour is testable. */
export function consolidateProject(host, config, agent, options) {
    return updates.run(async () => {
        const session = agent.session;
        const projectRoot = await getProjectRoot(projectCwd(session));
        let wroteMemory = false;
        let wroteContext = false;
        /** What had already landed if something throws later: a failure receipt must not hide it. */
        let loss = NO_LOSS;
        /**
         * The half of the pass that runs after the model call: every durable write this pass makes
         * happens here, and nothing in it dispatches a request. Only this half is handed to the
         * durability tracker — this pass's auxiliary call names a live session, so a registration that
         * spanned it would make that request's own checkpoint flush await the call it is dispatching
         * (`SessionWorkTracker`).
         */
        const write = async (outcome) => {
            const memoryText = outcome.result.memory.trim();
            // A reply that carried no entries renders as a bare four-heading skeleton, and a conversational
            // opaque reply is one that carries no section of ours at all: both are over the length floor but
            // are not memories, so the pass's gate must win over the length heuristic.
            // A refused reply is excluded for the opposite reason: it is a real memory this plugin
            // deliberately did not store, and writing it would be the silent loss the refusal exists to
            // prevent. The floor is the same constant the opaque gate reads, so "too small to be a
            // memory" is one number, not two.
            // The read-cap gate is a refusal too, but of a different kind: no reply exists, so the reasons
            // below (tier C's loss counts, batch Q2's merge) describe nothing. It still withholds both
            // artifacts, for the same reason the other refusals do — a pass that decided nothing publishes
            // nothing.
            // The output-budget gate is a refusal of the same kind and is folded in here for the same
            // reason: no reply exists, so the sizes and the merge below describe nothing it produced.
            const readCapped = outcome.readCappedRefused;
            const fitCapped = outcome.fitCappedRefused;
            const memoryRefused = outcome.memoryLossyRefused || outcome.partialRefused || readCapped !== undefined || fitCapped !== undefined;
            const memoryChanged = !memoryRefused && !outcome.semanticEmpty && memoryText.length >= OPAQUE_DOCUMENT_MIN_CHARS;
            if (!memoryChanged && !memoryRefused && !outcome.semanticEmpty && memoryText.length > 0) {
                // The length floor discards a short reply with no other trace at all: a tiny but real
                // memory must not vanish while the receipt still reports the pass as clean.
                await logError(projectRoot, "memory", `the consolidation reply carried a ${memoryText.length}-character memory, below the ${OPAQUE_DOCUMENT_MIN_CHARS}-character floor; the stored memory was kept unchanged`);
            }
            /** What a refused reply would have lost, named per refusal and never counted as landed. */
            let refusedLoss;
            // Tier C only. Batch Q2's refusal has no loss to name — its counts are all 0 — so running this
            // block for it would produce a zero-valued `refusedLoss` and the receipt would then report the
            // reply as "would have been stored lossily", naming the cap for a refusal about shape.
            if (outcome.memoryLossyRefused) {
                refusedLoss = {
                    sectionDropped: outcome.sectionDropped,
                    droppedItems: outcome.droppedItems,
                    writeCapDroppedChars: outcome.memoryWriteCapDroppedChars,
                };
                // Not gated per project: a project whose replies keep overflowing is refused every pass,
                // and reporting only the first refusal would leave every later one silent.
                const parts = [];
                if (refusedLoss.sectionDropped > 0) {
                    parts.push(`${refusedLoss.droppedItems} whole entry(ies) would have been dropped from ${refusedLoss.sectionDropped} section(s) because the memory document reached its character cap`);
                }
                if (refusedLoss.writeCapDroppedChars > 0) {
                    // The cap this loss was measured under, not the setting in force now: a cached refusal is
                    // re-reported as it stands, and naming the current cap would attribute the loss to a cap
                    // that never measured it.
                    parts.push(`${refusedLoss.writeCapDroppedChars} character(s) of the reply exceeded the ${outcome.maxMemoryChars}-character memory cap`);
                }
                await logError(projectRoot, "memory", `the consolidation reply would have been stored lossily (${parts.join("; ")}), and the one targeted retry did not fix it; the stored memory was kept unchanged`);
                // Carry it now: the memory write just below can throw (the lock, the journal), and a failure
                // must not hide a decision this pass already made. The landed-loss reset further down
                // carries it across again.
                loss = { ...loss, refusedLoss };
            }
            // Claim the version before the first await: another pass reaching this point while the
            // writes below are in flight must see it as done, not run a second time.
            written.set(projectRoot, outcome.version);
            let memoryKeptStale = false;
            let memoryWriteDroppedChars = 0;
            /** The rewrite loss gate's observation of the bytes that landed. */
            let memoryLiteralLoss;
            /** Batch V's verdict, measured only for a document that landed. */
            let staleness;
            if (memoryChanged) {
                // Always keep the bytes on disk right now, whatever this pass believed earlier; the
                // lock keeps another process from replacing them mid-write, and the journal is the
                // source of truth (this pass appends its document, then MEMORY.md is rendered). The
                // reply is refused when the memory moved on since the prompt was built, so the write
                // path is asked with the baseline it must still match — and the claim below follows
                // what actually landed, not what was attempted.
                const snapshot = await withMemoryLock(memoryFile(projectRoot), async () => {
                    const backup = await backupMemoryBeforeWrite(memoryFile(projectRoot));
                    const result = await recordMemoryDocument(projectRoot, memoryText, config.maxMemoryChars, { basisKey: outcome.basisKey });
                    // The bytes this pass wrote, read while the lock still holds them. Read after it is
                    // released and a concurrent host may have replaced the file already: the measure would
                    // then describe a document that did not land here — a wrong cause, which is the one
                    // failure this repository treats as worse than a missing number.
                    const landed = result.written ? await readOptional(memoryFile(projectRoot)) : "";
                    return { backup, written: result.written, landed };
                });
                wroteMemory = snapshot.written;
                memoryKeptStale = !snapshot.written;
                // The write path caps the document once more: an opaque reply never reaches the section
                // renderer, and an oversized one lands with a truncation marker instead. Nothing else
                // reports that, so the count comes from the same normalizer the write used — its own cut,
                // not the marker line, which may describe a cap an earlier pass applied.
                memoryWriteDroppedChars = snapshot.written ? normalizeMemoryWithDrop(memoryText, config.maxMemoryChars).dropped : 0;
                if (memoryWriteDroppedChars > 0) {
                    await logError(projectRoot, "memory", `MEMORY.md was capped at ${config.maxMemoryChars} characters on write: ${memoryWriteDroppedChars} character(s) of the reply were dropped`);
                }
                // The rewrite loss gate's observation half: tier C counts structure, so a document
                // regenerated in condensed wording reports no loss while facts vanish. Two baselines matter
                // and both are deliberate:
                //  - the **previous** side is `shownMemory`, the view the model was handed, not the store:
                //    batch Z2's plan may have retired an entry before the prompt was built, and a deletion
                //    this pass already made and reported must not return as an unexplained lost fact;
                //  - the **next** side is the bytes that landed, not the reply: the write path caps the
                //    document once more, so only the landed bytes describe what replaced the old file.
                // Reported only, never refused (§3 A, §9.2: a legal rename reads as a loss, so this cannot
                // decide anything). An empty read is no observation at all: `readOptional` cannot tell an
                // unreadable file from an empty one, and measuring against either would report every
                // literal as lost — the wrong-cause failure this gate is supposed to catch, not commit.
                if (snapshot.written && snapshot.landed !== "") {
                    memoryLiteralLoss = missingLiteralsBetween(outcome.shownMemory, snapshot.landed);
                    if (memoryLiteralLoss.count > 0) {
                        const alsoTruncated = outcome.itemTruncated > 0
                            ? `; ${outcome.itemTruncated} entry(ies) were also cut at their per-item cap, and part of that count comes from them`
                            : "";
                        await logError(projectRoot, "memory", `${memoryLiteralLoss.count} backticked literal(s) the previous memory carried no longer appear in the new document, e.g. ${memoryLiteralLoss.samples.join(" | ")}${alsoTruncated}`);
                    }
                }
                // Batch Q2's report layer, at the write site: the claim describes the document that landed,
                // so a reply tier C or the basis-key race refused does not leave a removal claim behind.
                if (snapshot.written && outcome.removedEntries !== undefined && outcome.removedEntries.count > 0) {
                    await logError(projectRoot, "memory", `memory regression: ${outcome.removedEntries.count} Invariants/Pitfalls entry(ies) are no longer present, e.g. ${outcome.removedEntries.samples.join(" | ")}`);
                }
                // The repair's two lines, at the write site like every other loss claim: the decision is
                // made before the write, but a pass the basis-key race refuses wrote nothing, and a log
                // line that says an entry came back would then describe a document that never landed.
                if (snapshot.written && outcome.restoredEntries !== undefined) {
                    await logError(projectRoot, "memory", `restored ${outcome.restoredEntries.count} Invariants/Pitfalls entry(ies) this reply had dropped and whose backticked literals disappeared with them: ${outcome.restoredEntries.samples.join(" | ")}`);
                }
                if (snapshot.written && outcome.unrestoredEntries !== undefined) {
                    await logError(projectRoot, "memory", `${outcome.unrestoredEntries.count} Invariants/Pitfalls entry(ies) this reply dropped could not be restored: putting them back would have exceeded the memory cap or the per-item limit, so they stay lost: ${outcome.unrestoredEntries.samples.join(" | ")}`);
                }
                if (snapshot.written && snapshot.backup.poisoned) {
                    await logError(projectRoot, "memory", `replaced a stored JSON reply with markdown; original kept at ${snapshot.backup.path ?? "(none)"}`);
                }
                // A section render keeps the document inside the cap by dropping whole entries; the document
                // itself no longer carries a marker, so the counts are the only trace of what was given up.
                // Report them for every write that actually landed: this used to be gated to once per
                // project, which made every later loss on the same project silent.
                if (snapshot.written && (outcome.sectionDropped > 0 || outcome.itemTruncated > 0)) {
                    const parts = [];
                    // A whole-entry drop means the document itself is full: the per-section shares are targets,
                    // so naming a section's budget as the limit would point at a number that is not one.
                    if (outcome.sectionDropped > 0)
                        parts.push(`${outcome.droppedItems} whole entry(ies) were dropped from ${outcome.sectionDropped} section(s) because the memory document reached its character cap`);
                    if (outcome.itemTruncated > 0)
                        parts.push(`${outcome.itemTruncated} entry(ies) exceeded their section's per-item cap and were truncated`);
                    await logError(projectRoot, "memory", `MEMORY.md was rendered lossily: ${parts.join("; ")}`);
                }
                // Batch Z2's record half, at the write site and nowhere earlier: a tombstone claims an entry
                // left the document, so it may only be written for a document that actually landed. The
                // memory write is already durable at this point, which is why a failure here is reported
                // rather than rethrown — losing the record must not turn a landed write into a failed
                // command, but it must be visible, because an unrecorded retirement is a fact that returns.
                if (snapshot.written && outcome.retirement !== undefined) {
                    try {
                        await appendTombstones(projectRoot, outcome.retirement.tombstones);
                        await recordEntryDates(projectRoot, new Map(outcome.retirement.added), outcome.retirement.ids === undefined ? undefined : new Set(outcome.retirement.ids));
                    }
                    catch (error) {
                        await logError(projectRoot, "memory", `the retired-fact record could not be written after MEMORY.md landed: ${diagnosticMessage(error)}`);
                    }
                }
                // Batch V's record half, at the same write site and with the same failure semantics: the
                // bindings describe the document that landed, and losing them must not turn a landed write
                // into a failed command — but it must be visible, because the next receipt would otherwise
                // report a staleness verdict it never measured.
                if (snapshot.written) {
                    try {
                        const landed = await readOptional(memoryFile(projectRoot));
                        staleness = (await bindAndMeasure(projectRoot, landed)).facts;
                    }
                    catch (error) {
                        await logError(projectRoot, "memory", `the source bindings could not be recorded after MEMORY.md landed: ${diagnosticMessage(error)}`);
                    }
                }
            }
            // What landed is recorded as soon as it lands: a later throw must not erase it.
            loss = {
                ...NO_LOSS,
                // A refusal decided above outlives this reset: it describes what did NOT land, and a throw
                // after this point must not turn that decision into a plain failure.
                ...(refusedLoss === undefined ? {} : { refusedLoss }),
                memoryWritten: wroteMemory,
                memoryWriteDroppedChars: wroteMemory ? memoryWriteDroppedChars : 0,
                sectionDropped: wroteMemory ? outcome.sectionDropped : 0,
                droppedItems: wroteMemory ? outcome.droppedItems : 0,
                itemTruncated: wroteMemory ? outcome.itemTruncated : 0,
                // Batch Q2's two facts describe the document that landed, so they ride with the landed
                // counts: a merge the write path then refused describes nothing on disk.
                ...(wroteMemory && outcome.mergedFromStore.length > 0 ? { mergedFromStore: outcome.mergedFromStore } : {}),
                ...(wroteMemory && outcome.removedEntries !== undefined ? { removedEntries: outcome.removedEntries } : {}),
                ...(wroteMemory && outcome.restoredEntries !== undefined ? { restoredEntries: outcome.restoredEntries } : {}),
                ...(wroteMemory && outcome.unrestoredEntries !== undefined ? { unrestoredEntries: outcome.unrestoredEntries } : {}),
                ...(wroteMemory && memoryLiteralLoss !== undefined ? { missingLiterals: memoryLiteralLoss } : {}),
            };
            // A refused pass publishes neither artifact. The reply was built from a memory that is no
            // longer the stored one, or it is a document this plugin declined to store; either way its
            // context half is just as untrustworthy, and a context write replaces the whole file — which
            // is exactly how a curated open-task list can come back. The session-derived placeholder is
            // not the reply's context, but a refused pass is a pass that decided nothing, so it publishes
            // nothing either; the line below names which of the two was skipped.
            // A skeleton reply is a refusal of the reply as a whole, but it never sets `memoryKeptStale`:
            // `memoryChanged` excludes `semanticEmpty`, so the write block above is skipped outright and the
            // flag stays false. Without this third arm the context half still lands — measured 2026-11-06
            // 22:28:58, a pass whose memory was judged "not a writable memory document" replaced a
            // 11439-character CONTEXT.md with a 3160-character one, and nothing reported the difference.
            // The condition mirrors the diagnostic below, which logs only when a stored document existed:
            // with an empty store there is no memory to have been kept, and a first context write loses
            // nothing by landing.
            const memoryKeptUnderSkeleton = outcome.semanticEmpty && outcome.basisKey.trim().length > 0;
            const contextRefused = memoryRefused || memoryKeptStale || memoryKeptUnderSkeleton;
            // The document this session owns: its task's, or the project-level context. Both halves of
            // this block read and write the same path, so a bound session can never replace `CONTEXT.md`
            // and an unbound one can never touch a task file.
            const taskSlug = outcome.taskSlug;
            const contextPath = taskSlug === undefined ? contextFile(projectRoot) : taskFile(projectRoot, taskSlug);
            const contextName = taskSlug === undefined ? "CONTEXT.md" : taskRelativePath(taskSlug);
            const existing = await readOptional(contextPath);
            // A read-cap refusal publishes nothing at all: no reply exists to carry a context section, its own
            // log line above already named what was hidden, and the session-derived placeholder is not the
            // reply's context — a refusal that writes one is exactly the silent half-write batch T2 removed.
            const update = readCapped !== undefined || fitCapped !== undefined
                ? undefined
                : outcome.result.context ?? (existing.trim() ? undefined : fallbackUpdate(session));
            let contextDroppedChars = 0;
            /** The rewrite loss measure's observation of the context bytes that landed. */
            let contextLiteralLoss;
            if (update && contextRefused) {
                // Silent no-ops are this repo's standing failure class: say what did not land, and do not
                // call the session-derived placeholder "the reply's context section".
                const carried = outcome.result.context !== undefined || outcome.result.contextUnusable === true;
                const kept = existing.trim() ? `the previous ${contextName} stays effective` : `no ${contextName} was written`;
                await logError(projectRoot, "memory", carried
                    ? `the refused reply's context section was not published; ${kept}`
                    : `the refused pass wrote no ${contextName} (the reply carried no context section)`);
            }
            else if (update) {
                const updatedAt = new Date().toISOString();
                // A task document keeps its own authored `created` date and stored status; only `lastSeen`
                // moves, because this pass is proof of activity. Everything else about the file is the
                // pass's reply, exactly as `CONTEXT.md` is.
                const previousMeta = taskSlug === undefined ? undefined : parseTaskMeta(existing);
                const renderedContext = taskSlug === undefined
                    ? renderContextDocument(update, { updatedAt })
                    : renderTaskDocument(update, {
                        updatedAt,
                        slug: taskSlug,
                        meta: {
                            created: previousMeta?.created ?? dateStamp(),
                            status: previousMeta?.status ?? "active",
                            lastSeen: dateStamp(),
                            title: update.title.trim() === "" ? previousMeta?.title ?? taskSlug : update.title,
                        },
                    }).text;
                // The session's todo list is not the model's to restate, so a pass must not erase the
                // mechanic lines the turn/end write just placed: re-apply the projection, or — when it has
                // no opinion this turn — the lines the stored document already carried. Without this every
                // pass (which runs on the idle right after a turn end) would silently undo the write.
                const plannedTodoLines = projectTodoLines(projectionsOf(host.services), session) ?? todoLinesIn(existing);
                const mechanic = withTodoLines(renderedContext, plannedTodoLines);
                const contextDocument = mechanic.text;
                if (mechanic.droppedItems > 0) {
                    await logError(projectRoot, "memory", todoFitNotice(contextName, mechanic.droppedItems));
                }
                await writeAtomic(contextPath, contextDocument);
                wroteContext = true;
                // The context half of the rewrite loss measure (batch AA2b). The baseline is what the model was
                // shown, and a first write has none: with no previous document there is nothing to lose. Reported
                // only — deciding anything from it is the reader's job, and AA2 is where a lever gets built.
                if (existing.trim() !== "") {
                    contextLiteralLoss = missingLiteralsBetween(outcome.shownContext, contextDocument);
                    if (contextLiteralLoss.count > 0) {
                        await logError(projectRoot, "memory", `${contextLiteralLoss.count} backticked literal(s) the previous ${contextName} carried no longer appear in the new document, e.g. ${contextLiteralLoss.samples.join(" | ")}`);
                    }
                }
                const dropped = contextTruncationDropped(contextDocument);
                contextDroppedChars = dropped ?? 0;
                if (dropped !== undefined) {
                    // The marker is the durable trace; this line is the live one. It is not deduped per
                    // project: a project whose context stays over budget loses content on every pass, and
                    // reporting only the first loss leaves the rest silent.
                    await logError(projectRoot, "memory", contextClipNotice(dropped));
                }
            }
            // A torn journal tail is skipped at read time; record it so a silent loss of history is
            // diagnosable. This is the only place the damage counter is reported.
            const damage = await readMemoryDamage(projectRoot);
            if (damage.unreadable || damage.damaged > 0) {
                await logError(projectRoot, "memory", damage.unreadable
                    ? `memory journal exists but cannot be read: ${memoryJournalFile(projectRoot)}`
                    : `memory journal has ${damage.damaged} unusable line(s); they were skipped`);
            }
            const wrote = wroteMemory || wroteContext;
            if (!options.silent && wrote) {
                // Name what actually landed: a kept memory must not be reported as written.
                const target = wroteMemory && wroteContext ? "project memory and context" : wroteMemory ? "project memory" : "project context";
                host.log.info(`dsh-project-context: ${target} updated: ${memoryFile(projectRoot)}`);
            }
            // The counts still describe only what landed: a refused memory write dropped nothing from
            // the stored file, and a context that was never written kept all of its characters.
            loss = {
                ...loss,
                contextWritten: wroteContext,
                contextDroppedChars: wroteContext ? contextDroppedChars : 0,
                ...(wroteContext && contextLiteralLoss !== undefined ? { contextMissingLiterals: contextLiteralLoss } : {}),
                ...(wroteContext && taskSlug !== undefined ? { contextTarget: taskRelativePath(taskSlug) } : {}),
                ...(staleness === undefined ? {} : { staleness }),
            };
            if (memoryKeptStale)
                return { status: "stale", ...loss };
            if (memoryRefused) {
                // A refusal is a terminal outcome of this pass but not a write, so the claim is released
                // on the catch block's own rule: a later forced pass must really re-run instead of
                // answering "already up to date" for a memory that never landed.
                if (!wroteMemory)
                    written.delete(projectRoot);
                // Two refusals share this release and nothing else: batch Q2's shape refusal has no loss
                // to name, so it must not borrow tier C's "would have been stored lossily" wording.
                if (readCapped !== undefined) {
                    // Its own status and its own wording: the lever is the read cap that hid the content, not
                    // the write cap tier C measures against, and not the reply's shape.
                    return { status: "read-capped-refused", ...loss, readCappedRefused: readCapped };
                }
                if (fitCapped !== undefined) {
                    // Same shape of refusal, different budget behind it: the read caps were satisfied and the
                    // content was still hidden, so the receipt must name `maxOutputTokens` and never
                    // `maxMemoryChars` — raising the memory cap cannot buy the output budget a single token.
                    return { status: "fit-capped-refused", ...loss, fitCappedRefused: fitCapped };
                }
                if (outcome.partialRefused) {
                    return { status: "partial-refused", ...loss, partialRefused: true, ...(outcome.partialRefusal === undefined ? {} : { partialRefusal: outcome.partialRefusal }) };
                }
                return { status: "lossy-refused", ...loss, refusedLoss };
            }
            // A pass that wrote here was shown both stored documents whole: either input gate would have
            // refused it before the model call, so its counts describe only the render's own drops.
            return wrote ? { status: "updated", ...loss } : cleanReport("unchanged");
        };
        try {
            const outcome = await consolidateProjectState(host, agent, config, { force: options.force, signal: options.signal });
            // A deduped pass has nothing to write, so it never reaches the tracker: there is no pending
            // write to await, and the report already says the artifacts are unchanged.
            if (!outcome || (written.get(projectRoot) ?? 0) >= outcome.version)
                return cleanReport("deduped");
            const work = write(outcome);
            options.track?.(work);
            const report = await work;
            // Batch Z4's cleaning channel runs after a pass that really ran, never after a deduped one
            // (nothing happened, so nothing aged). It is deliberately outside the reported outcome: a
            // cleanup failure must not turn a landed write into a failed command, and the receipt has no
            // business mentioning a deletion — `purge.log` is where a removal is recorded.
            const cleanup = await pruneProjectMemory(projectRoot, { apply: true, reason: "auto" });
            if (cleanup.status === "failed" && !options.silent) {
                host.log.warn(`dsh-project-context: memory cleanup failed: ${cleanup.error ?? "unknown"}`);
            }
            return report;
        }
        catch (error) {
            // Release the claimed version when nothing was written: otherwise the next forced pass
            // inside `forceDedupeMs` would answer "already up to date" for a write that never landed.
            if (!wroteMemory)
                written.delete(projectRoot);
            await logError(projectRoot, "memory", error);
            if (!options.silent)
                host.log.warn(`dsh-project-context: project memory update failed: ${diagnosticMessage(error)}`);
            return { status: "failed", ...loss };
        }
    });
}
