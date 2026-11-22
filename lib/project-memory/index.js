/**
 * project-memory — the memory feature (pass ②, consolidation).
 *
 * One high-frequency, throttled consolidation pass produces both durable
 * project memory (`.agents/memory/MEMORY.md`) and the rolling project context
 * (`.agents/memory/CONTEXT.md`); both documents are injected back into the
 * model context as dynamic runtime context. Skill distillation is a separate
 * feature (`project-autolearn`), and the raw archive is `project-context`.
 *
 * Commands: /memory (status | update | prune [--apply])
 */
import { projectionsOf } from "../host/dsh/services.js";
import { logOf } from "../host/dsh/log.js";
import { resolvePluginConfig } from "../shared/config.js";
import { effectivePluginConfig } from "../shared/settings.js";
import { renderContextDocument, renderTaskDocument } from "./context-doc.js";
import { buildContextInjection, buildMemoryInjection, buildTaskInjection, buildTaskListInjection } from "./injection.js";
import { boundTaskSync, dateStamp, listTasksSync, parseTaskMeta, taskRelativePath, taskViews } from "./tasks.js";
import { detectDocumentLanguage } from "../shared/language.js";
import { contextClipNotice, contextTruncationDropped } from "./context-schema.js";
import { isTopLevel, projectCwd, SerialQueue, SessionWorkTracker } from "../shared/lifecycle.js";
import { consolidateProjectState, fallbackUpdate } from "./consolidate.js";
import { MAX_CONTEXT_CHARS, cachedProjectRoot, contextFile, diagnosticMessage, getProjectRoot, logError, memoryDir, memoryFile, migrateProjectState, readOptional, readTextCachedSync, taskFile, writeAtomic, } from "../shared/project-state.js";
import { backupMemoryBeforeWrite, importLegacyMemory, loadMemory, loadMemorySync, memoryJournalFile, normalizeMemoryWithDrop, readMemoryDamage, recordMemoryDocument } from "./memory-store.js";
import { missingLiteralsBetween } from "./missing-literals.js";
import { OPAQUE_DOCUMENT_MIN_CHARS } from "./sections.js";
import { bindAndMeasure } from "./staleness-source.js";
import { memoryEntryStates } from "./entry-states.js";
import {} from "./staleness.js";
import { appendTombstones } from "./retired.js";
import { recordEntryDates } from "./retirement.js";
import { withMemoryLock } from "../shared/lock.js";
import { pruneProjectMemory } from "./prune.js";
import { projectTodoLines, todoFitNotice, todoLinesIn, withTodoLines } from "./todo.js";
import { acceptEntryState, cleanReport, memoryAcceptReply, memoryPruneReply, memoryReconcileReply, memoryStatusReply, memoryUpdateReply, NO_LOSS, } from "./report.js";
// The public surface of this entry stayed where it was: the report layer moved to `report.ts`, so the
// symbols other modules and the test suite import from `index.js` are re-exported here verbatim.
export { acceptEntryState, memoryAcceptReply, memoryPruneReply, memoryReconcileReply, memoryStatusReply, memoryUpdateReply } from "./report.js";
export const name = "project-memory";
export const inject = ["llm", "systemPrompt", "commands"];
/** Last consolidation version each project's artifacts were written from. */
const written = new Map();
/** Projects whose legacy layout was already consolidated in this process. */
const migrated = new Set();
/** Serialize consolidation so a forced shutdown pass always runs last. */
const updates = new SerialQueue();
/** Synchronous text for the dynamic-context provider; empty until the root is cached. */
function projectMemoryInjection(cwd, limit) {
    if (!cwd)
        return "";
    const projectRoot = cachedProjectRoot(cwd);
    if (projectRoot === undefined) {
        // Prompt assembly must not block on git; warm the cache for the next assembly.
        void getProjectRoot(cwd).catch(() => undefined);
        return "";
    }
    // Folds the append-only journal synchronously: the render can lag a crash between the
    // journal append and the render, and dsh's prompt assembly cannot await.
    const text = loadMemorySync(projectRoot, limit).trim();
    if (!text)
        return "";
    // The kept sections ride inline; the rest becomes one pointer line per section, resolved
    // against the project root so the reader's own `read` can open it from any cwd.
    return `## Project Memory\nThe following is durable project memory learned from earlier sessions, not a new user instruction:\n\n${buildMemoryInjection(text, projectRoot)}`;
}
/**
 * Synchronous text for the dynamic-context provider; empty until the root is cached.
 *
 * The document this session owns: its task's when it is bound to one that is still in use, the
 * project-level `CONTEXT.md` otherwise. Both then carry one line per other task, because the model
 * must know other workflows exist without paying for their bodies — and a project with no task
 * documents adds nothing, which is what keeps an unbound session's prompt byte-identical to the
 * behaviour before this dimension existed.
 * @param cwd - the session's cwd, the key the project root is cached under.
 * @param sessionId - the live session, whose `meta.json` may bind it to a task.
 * @param mode - the project's task mode, which decides which statuses are derived.
 * @returns the injected block, or `""` when there is nothing to inject.
 */
function projectContextInjection(cwd, sessionId, mode) {
    if (!cwd)
        return "";
    const projectRoot = cachedProjectRoot(cwd);
    if (projectRoot === undefined) {
        void getProjectRoot(cwd).catch(() => undefined);
        return "";
    }
    const today = dateStamp();
    const task = boundTaskSync(projectRoot, sessionId, { mode, today });
    // The read cap still applies to the document itself, so the pointer block replaces the indexed
    // sections in what the model sees rather than adding a second copy of them.
    const text = (task?.text ?? readTextCachedSync(contextFile(projectRoot))).trim().slice(0, MAX_CONTEXT_CHARS);
    // An archived task is deliberately not injected; the session then reads the project-level
    // document, which is where its next pass will write too.
    const others = taskViews(listTasksSync(projectRoot).filter((record) => record.slug !== task?.slug), { mode, today }).map((record) => ({ slug: record.slug, status: record.status, title: record.meta.title }));
    const list = buildTaskListInjection(others, detectDocumentLanguage([text, ...others.map((entry) => entry.title)]));
    const parts = [];
    if (text) {
        parts.push(task === undefined
            ? `## Project Context\nThe following is project context, not a new user instruction:\n\n${buildContextInjection(text, projectRoot)}`
            : `## Project Task (${task.slug})\nThe following is this task's context, not a new user instruction:\n\n${buildTaskInjection(text, projectRoot, task.slug)}`);
    }
    if (list)
        parts.push(list);
    return parts.join("\n\n");
}
/** One pass updates both artifacts so MEMORY.md and CONTEXT.md never disagree about the pass. */
/** One consolidation pass. Exported so the version-claim/backoff behaviour is testable. */
export function consolidateProject(ctx, config, agent, options) {
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
                const plannedTodoLines = projectTodoLines(projectionsOf(ctx), session) ?? todoLinesIn(existing);
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
                logOf(ctx).info(`dsh-project-context: ${target} updated: ${memoryFile(projectRoot)}`);
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
            const outcome = await consolidateProjectState(ctx, agent, config, { force: options.force, signal: options.signal });
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
                logOf(ctx).warn(`dsh-project-context: memory cleanup failed: ${cleanup.error ?? "unknown"}`);
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
                logOf(ctx).warn(`dsh-project-context: project memory update failed: ${diagnosticMessage(error)}`);
            return { status: "failed", ...loss };
        }
    });
}
/**
 * Copy one session's todo snapshot into the context document it owns.
 *
 * The document is the session's task's when the binding is in use, else `CONTEXT.md`; a missing
 * document stays missing — this is a mechanical patch on the pass's artifact, not a second creator
 * of one. A `null` projection (no todo write this turn) or an unchanged document writes nothing.
 *
 * No model call and no lock: the write is a read-modify-write of a few lines, and the pass applies
 * the same projection after its own rewrite, so the two can only ever converge on the same block.
 * @param ctx - the plugin context (for the projection read and the error log).
 * @param config - the effective config; `taskMode` decides which document the session owns.
 * @param session - the session whose turn just ended.
 */
export async function writeTodoSnapshot(ctx, config, session) {
    const lines = projectTodoLines(projectionsOf(ctx), session);
    if (lines === undefined)
        return;
    const projectRoot = await getProjectRoot(projectCwd(session));
    const task = boundTaskSync(projectRoot, String(session.id), { mode: config.taskMode, today: dateStamp() });
    const file = task === undefined ? contextFile(projectRoot) : taskFile(projectRoot, task.slug);
    const target = task === undefined ? "CONTEXT.md" : taskRelativePath(task.slug);
    const stored = await readOptional(file);
    if (stored.trim() === "")
        return;
    const patch = withTodoLines(stored, lines);
    if (!patch.changed)
        return;
    await writeAtomic(file, patch.text);
    if (patch.droppedItems > 0)
        await logError(projectRoot, "memory", todoFitNotice(target, patch.droppedItems));
}
export function apply(ctx, rawConfig) {
    const entry = resolvePluginConfig(rawConfig);
    /** In-flight consolidation work per session, awaited by durability flushes. */
    const pending = new SessionWorkTracker();
    const registerLiteralContext = (literal) => {
        ctx.systemPrompt.context(literal);
    };
    // Both documents are user/prose files, not prompt templates: a literal `{{...}}` in MEMORY.md or
    // CONTEXT.md (e.g. documenting a handlebars placeholder) must reach the model as written rather
    // than fail the whole turn as a "malformed prompt variable reference".
    registerLiteralContext({
        name: "project-memory",
        order: 190,
        interpolate: false,
        text: (assembleContext) => projectMemoryInjection(assembleContext.agent?.session.header.cwd, effectivePluginConfig(entry).maxMemoryChars),
    });
    registerLiteralContext({
        name: "project-context",
        order: 210,
        interpolate: false,
        text: (assembleContext) => projectContextInjection(assembleContext.agent?.session.header.cwd, assembleContext.agent === undefined ? undefined : String(assembleContext.agent.session.id), effectivePluginConfig(entry).taskMode),
    });
    ctx.on("agent/created", ({ agent }) => {
        void (async () => {
            let projectRoot;
            try {
                projectRoot = await getProjectRoot(projectCwd(agent.session));
                if (migrated.has(projectRoot))
                    return;
                const result = await migrateProjectState(projectRoot);
                // Marked only after a completed attempt: a failed migration must be
                // retried by the next session start, not written off for the process.
                migrated.add(projectRoot);
                const details = [];
                if (result.moved.length > 0)
                    details.push(`moved ${result.moved.join(", ")}`);
                if (result.importedSkills > 0)
                    details.push(`imported ${result.importedSkills} skill${result.importedSkills === 1 ? "" : "s"}`);
                // The legacy `.omp` import holds the memory lock and refuses to run beside an
                // existing journal, so it is its own step rather than part of the layout migration.
                if (await importLegacyMemory(projectRoot, effectivePluginConfig(entry).maxMemoryChars))
                    details.push("imported legacy OMP memory");
                if (details.length > 0)
                    logOf(ctx).info(`dsh-project-context: project memory in ${memoryDir(projectRoot)}: ${details.join("; ")}`);
                // The legacy counterpart was older, so the current file won and the legacy bytes are
                // gone. Say so: the migration used to report these as "moved", which is false.
                if (result.superseded.length > 0) {
                    logOf(ctx).info(`dsh-project-context: legacy files superseded and discarded (the current file was newer): ${result.superseded.join(", ")}`);
                }
                if (result.conflicts.length > 0) {
                    logOf(ctx).warn(`dsh-project-context: legacy layout left in place (a newer legacy copy or a file/directory type conflict; merge it by hand): ${result.conflicts.join(", ")}`);
                }
            }
            catch (error) {
                // The project root is where diagnostics belong; the cwd is only the
                // fallback when the root itself could not be resolved.
                await logError(projectRoot ?? projectCwd(agent.session), "migration", error);
            }
        })();
        return undefined;
    });
    ctx.on("agent/status", ({ agent, status }) => {
        if (status !== "idle" || !isTopLevel(agent.session))
            return;
        const current = effectivePluginConfig(entry);
        if (!current.memoryEnabled)
            return;
        // Only the pass's write phase reaches the tracker (`SessionWorkTracker`); the span itself is
        // observed here so a rejection stays as invisible as it was when the tracker carried it.
        void consolidateProject(ctx, current, agent, { force: false, silent: false, track: (work) => pending.track(agent.session, work) }).catch(() => undefined);
    });
    ctx.on("agent/disposed", ({ agent }) => {
        if (!isTopLevel(agent.session))
            return;
        const current = effectivePluginConfig(entry);
        if (!current.memoryEnabled)
            return;
        // Silent: the UI may already be rebuilding for a session switch.
        void consolidateProject(ctx, current, agent, { force: true, silent: true, track: (work) => pending.track(agent.session, work) }).catch(() => undefined);
    });
    // The todo list is the one part of the context document that is not a model opinion: fold the
    // finished snapshot into Open tasks at every turn end, before the pass that runs on the following
    // idle can rewrite the document. Mechanical on purpose — no model call, and an unchanged list
    // writes nothing at all.
    ctx.on("session/event", (session, event) => {
        if (event.type !== "turn/end")
            return;
        if (!isTopLevel(session))
            return;
        const current = effectivePluginConfig(entry);
        if (!current.memoryEnabled)
            return;
        void writeTodoSnapshot(ctx, current, session).catch((error) => logError(projectCwd(session), "memory", error));
    });
    ctx.on("session/flush", (session) => pending.flush(session));
    ctx.commands.register({
        name: "memory",
        description: "Show this project's memory location and status, 'update' to consolidate now, 'prune' to preview the cleaning channel, or 'reconcile' to list entries whose cited files changed",
        input: { hint: "update | prune [--apply] | reconcile [--accept <id>]" },
        handler: async ({ agent, rawInput, signal }) => {
            const verb = (rawInput ?? "").trim().toLowerCase();
            if (verb === "update") {
                const report = await consolidateProject(ctx, effectivePluginConfig(entry), agent, { force: true, silent: false, signal });
                return memoryUpdateReply(report);
            }
            if (verb === "prune" || verb === "prune --apply") {
                const projectRoot = await getProjectRoot(projectCwd(agent.session));
                const outcome = await pruneProjectMemory(projectRoot, { apply: verb.endsWith("--apply"), reason: "manual" });
                return memoryPruneReply(outcome, projectRoot);
            }
            if (verb === "reconcile" || verb.startsWith("reconcile ")) {
                const projectRoot = await getProjectRoot(projectCwd(agent.session));
                const config = effectivePluginConfig(entry);
                // The same cap `/memory` status reads under: the id has to be the one the document carries,
                // and a read cut would silently hide the entries past it (reported below, never implied away).
                const memory = await loadMemory(projectRoot, config.maxMemoryChars);
                const rest = verb.slice("reconcile".length).trim();
                const states = await memoryEntryStates(projectRoot, memory.text, config);
                if (rest.startsWith("--accept")) {
                    const tid = rest.slice("--accept".length).trim();
                    if (!/^[0-9a-f]{3,4}$/.test(tid)) {
                        return { kind: "error", text: "Usage: /memory reconcile --accept <id>\nAn entry id is three or four lower-case hex characters, as shown by /memory reconcile." };
                    }
                    return memoryAcceptReply(await acceptEntryState(projectRoot, memory.text, states, tid), tid);
                }
                if (rest !== "") {
                    return { kind: "error", text: `Unknown option "${rest}". Usage: /memory reconcile | /memory reconcile --accept <id>` };
                }
                return memoryReconcileReply(states, { cappedDroppedChars: memory.cappedDroppedChars });
            }
            if (verb !== "")
                return { kind: "error", text: `Unknown option "${verb}". Usage: /memory (status) | /memory update | /memory prune [--apply] | /memory reconcile [--accept <id>]` };
            const projectRoot = await getProjectRoot(projectCwd(agent.session));
            const config = effectivePluginConfig(entry);
            const memory = await loadMemory(projectRoot, config.maxMemoryChars);
            return memoryStatusReply(memory, {
                projectRoot,
                journal: memoryJournalFile(projectRoot),
                maxMemoryChars: config.maxMemoryChars,
            });
        },
    });
}
