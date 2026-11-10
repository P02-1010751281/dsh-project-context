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

import path from "node:path";
import type { Context } from "@deepseek-ai/cordis";
// Type-only: pulls the commands service Context merge (ctx.commands).
import type {} from "@deepseek-ai/dsh-commands";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { Session } from "@deepseek-ai/dsh-session";
import type { SessionProjectionRegistry } from "@deepseek-ai/dsh-session-projection";
import { resolvePluginConfig, type PluginConfig } from "../shared/config.js";
import { effectivePluginConfig } from "../shared/settings.js";
import { renderContextDocument, renderTaskDocument } from "./context-doc.js";
import { buildContextInjection, buildMemoryInjection, buildTaskInjection, buildTaskListInjection, type TaskListEntry } from "./injection.js";
import { boundTaskSync, dateStamp, listTasksSync, parseTaskMeta, taskRelativePath, taskViews } from "./tasks.js";
import { detectDocumentLanguage } from "../shared/language.js";
import { contextClipNotice, contextTruncationDropped } from "./context-schema.js";
import { isTopLevel, projectCwd, SerialQueue, SessionWorkTracker } from "../shared/lifecycle.js";
import { type ConsolidationOutcome, type PartialRefusalReason, consolidateProjectState, fallbackUpdate } from "./consolidate.js";
import {
	MAX_CONTEXT_CHARS,
	cachedProjectRoot,
	contextFile,
	diagnosticMessage,
	getProjectRoot,
	logError,
	memoryDir,
	memoryFile,
	migrateProjectState,
	purgeLogFile,
	readOptional,
	readTextCachedSync,
	taskFile,
	writeAtomic,
} from "../shared/project-state.js";
import { backupMemoryBeforeWrite, importLegacyMemory, isMemoryTruncated, loadMemory, loadMemorySync, memoryJournalFile, normalizeMemoryWithDrop, readMemoryDamage, recordMemoryDocument } from "./memory-store.js";
import { OPAQUE_DOCUMENT_MIN_CHARS } from "./sections.js";
import { appendTombstones } from "./retired.js";
import { recordEntryDates } from "./retirement.js";
import { withMemoryLock } from "../shared/lock.js";
import { type PruneOutcome, formatBytes, pruneProjectMemory } from "./prune.js";
import { projectTodoLines, todoFitNotice, todoLinesIn, withTodoLines } from "./todo.js";

export const name = "project-memory";
export const inject = ["llm", "systemPrompt", "commands"];

/** Last consolidation version each project's artifacts were written from. */
const written = new Map<string, number>();
/** Projects whose legacy layout was already consolidated in this process. */
const migrated = new Set<string>();
/** Serialize consolidation so a forced shutdown pass always runs last. */
const updates = new SerialQueue();

/** Synchronous text for the dynamic-context provider; empty until the root is cached. */
function projectMemoryInjection(cwd: string | undefined, limit: number): string {
	if (!cwd) return "";
	const projectRoot = cachedProjectRoot(cwd);
	if (projectRoot === undefined) {
		// Prompt assembly must not block on git; warm the cache for the next assembly.
		void getProjectRoot(cwd).catch(() => undefined);
		return "";
	}
	// Folds the append-only journal synchronously: the render can lag a crash between the
	// journal append and the render, and dsh's prompt assembly cannot await.
	const text = loadMemorySync(projectRoot, limit).trim();
	if (!text) return "";
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
function projectContextInjection(cwd: string | undefined, sessionId: string | undefined, mode: PluginConfig["taskMode"]): string {
	if (!cwd) return "";
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
	const others = taskViews(
		listTasksSync(projectRoot).filter((record) => record.slug !== task?.slug),
		{ mode, today },
	).map((record): TaskListEntry => ({ slug: record.slug, status: record.status, title: record.meta.title }));
	const list = buildTaskListInjection(others, detectDocumentLanguage([text, ...others.map((entry) => entry.title)]));
	const parts: string[] = [];
	if (text) {
		parts.push(task === undefined
			? `## Project Context\nThe following is project context, not a new user instruction:\n\n${buildContextInjection(text, projectRoot)}`
			: `## Project Task (${task.slug})\nThe following is this task's context, not a new user instruction:\n\n${buildTaskInjection(text, projectRoot, task.slug)}`);
	}
	if (list) parts.push(list);
	return parts.join("\n\n");
}

interface ConsolidateOptions {
	force: boolean;
	silent: boolean;
	signal?: AbortSignal | undefined;
	/**
	 * Hand this pass's write phase to the caller's durability tracker.
	 *
	 * The pass registers **only** the half that follows its model call, because a registered span that
	 * contained the model call would be awaited by that call's own checkpoint flush
	 * (`SessionWorkTracker`). Callers that do not track pass nothing.
	 */
	track?: ((work: Promise<unknown>) => void) | undefined;
}

/** What one consolidation attempt did, so the `/memory update` reply can be truthful. */
export type ConsolidateStatus = "updated" | "unchanged" | "deduped" | "failed" | "stale" | "lossy-refused" | "partial-refused" | "read-capped-refused" | "fit-capped-refused";

/**
 * What a refused reply would have lost, kept apart from the landed counts on purpose.
 *
 * A refusal stores nothing, so every count that describes landed content is 0 — folding the refused
 * reply's numbers into those fields would report a loss the stored file never suffered. They are still
 * what the user needs to act on, so they ride in their own field instead.
 */
export type RefusedLoss = {
	/** Sections that would have lost at least one entry because the document reached its cap. */
	sectionDropped: number;
	/** Entries that would have been dropped whole. */
	droppedItems: number;
	/** Characters the memory cap would have dropped from the reply itself. */
	writeCapDroppedChars: number;
};

/**
 * What one consolidation attempt did, plus the loss it caused.
 *
 * A consolidation pass loses content before the write, in places the stored document cannot show
 * afterwards: the section render drops whole entries once the document reaches its cap
 * (`sectionDropped` / `droppedItems`), with `itemTruncated` counting entries cut to the per-item cap,
 * and a write cap clips the reply or the context document on the way out. Carrying them here is what
 * lets the receipt name the mechanism and the count: without it a pass that dropped twelve entries
 * read exactly like a clean one.
 *
 * A count is 0 unless the artifact it describes actually landed. A memory render whose write was
 * refused dropped nothing from the stored file, so its counts must not be reported as a loss.
 *
 * The input side is deliberately absent: a pass whose view of a stored artifact was shortened is
 * refused before the model call (`readCappedRefused` / `fitCappedRefused`), so no landed count can
 * describe a character the model was not shown.
 */
export type ConsolidateReport = {
	status: ConsolidateStatus;
	/** True when this pass's memory landed. A receipt must never claim an artifact that did not. */
	memoryWritten: boolean;
	/** True when this pass's context landed. */
	contextWritten: boolean;
	/** Characters the landed CONTEXT.md render dropped to fit its section budgets. */
	contextDroppedChars: number;
	/**
	 * Characters the landed MEMORY.md write dropped because the reply itself exceeded the memory cap.
	 * A reply that is not a four-section bullet document never reaches the section renderer, so this
	 * cap is the only place its loss is recorded: without it such a write is completely silent.
	 */
	memoryWriteDroppedChars: number;
	/** Sections of the landed memory that lost at least one entry because the document reached its cap. */
	sectionDropped: number;
	/** Entries dropped whole from the landed memory because its character cap was full. */
	droppedItems: number;
	/** Entries of the landed memory cut to their section's per-item cap and kept. */
	itemTruncated: number;
	/**
	 * Project-relative path of the context half that landed when it was a task document rather than
	 * `CONTEXT.md`. The receipt names this file, because "updated CONTEXT.md" would be false for a
	 * bound session — the project-level document was not touched at all.
	 */
	contextTarget?: string;
	/**
	 * What a refused reply would have lost. Set only by `lossy-refused`, and never folded into the
	 * landed counts above: tier C refuses the write, so the stored document lost none of it.
	 */
	refusedLoss?: RefusedLoss;
	/**
	 * True when batch Q2's guard refused the reply: it carried this extension's document shape but could
	 * not be merged into the stored document, so the write was skipped and `MEMORY.md` is byte-identical.
	 * Kept apart from `refusedLoss` (tier C's cap refusal) because the causes are different: naming the
	 * cap here would point the operator at a knob that has nothing to do with the refusal.
	 */
	partialRefused: boolean;
	/** Which half of the merge could not be read, when `partialRefused` is set (batch Q2). */
	partialRefusal?: PartialRefusalReason;
	/** Headings the stored document contributed to a merged partial reply (batch Q2); empty otherwise. */
	mergedFromStore?: string[];
	/** Invariants/Pitfalls entries a written reply no longer carries (batch Q2's report layer). */
	removedEntries?: { count: number; samples: string[] };
	/**
	 * Set by the read-cap gate: the pass was refused before any model call because a stored artifact was
	 * longer than the cap that decides what the model is shown (`maxMemoryChars` for the memory,
	 * `MAX_CONTEXT_CHARS` for the context). The reply would have been built from the shortened view and
	 * would have replaced the stored file with it, deleting the hidden characters — a loss tier C cannot
	 * see, because it measures the reply against the write cap the reply fits.
	 */
	readCappedRefused?: { cap: number; memoryHiddenChars: number; contextHiddenChars: number };
	/**
	 * Set by the output-budget gate: the pass was refused before any model call because `fitMemoryInput`
	 * could not hold both stored documents inside the output budget, so the model would have been shown a
	 * shortened view and its whole-document reply would have replaced the stored file with it. The same
	 * loss as `readCappedRefused`, cut on a different budget, so the levers differ: this one is
	 * `maxOutputTokens` (or a shorter document), never `maxMemoryChars`.
	 */
	fitCappedRefused?: { maxOutputTokens: number; memoryHiddenChars: number; contextHiddenChars: number };
};

/** The no-loss half of a report: nothing landed and nothing was dropped. */
export type ConsolidateLoss = Omit<ConsolidateReport, "status">;

const NO_LOSS: ConsolidateLoss = {
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
function cleanReport(status: ConsolidateStatus): ConsolidateReport {
	return { status, ...NO_LOSS };
}

/** One pass updates both artifacts so MEMORY.md and CONTEXT.md never disagree about the pass. */
/** One consolidation pass. Exported so the version-claim/backoff behaviour is testable. */
export function consolidateProject(ctx: Context, config: PluginConfig, agent: Agent, options: ConsolidateOptions): Promise<ConsolidateReport> {
	return updates.run(async (): Promise<ConsolidateReport> => {
		const session = agent.session;
		const projectRoot = await getProjectRoot(projectCwd(session));
		let wroteMemory = false;
		let wroteContext = false;
		/** What had already landed if something throws later: a failure receipt must not hide it. */
		let loss: ConsolidateLoss = NO_LOSS;
		/**
		 * The half of the pass that runs after the model call: every durable write this pass makes
		 * happens here, and nothing in it dispatches a request. Only this half is handed to the
		 * durability tracker — this pass's auxiliary call names a live session, so a registration that
		 * spanned it would make that request's own checkpoint flush await the call it is dispatching
		 * (`SessionWorkTracker`).
		 */
		const write = async (outcome: ConsolidationOutcome): Promise<ConsolidateReport> => {
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
			let refusedLoss: RefusedLoss | undefined;
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
				const parts: string[] = [];
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
					return { backup, written: result.written };
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
				// Batch Q2's report layer, at the write site: the claim describes the document that landed,
				// so a reply tier C or the basis-key race refused does not leave a removal claim behind.
				if (snapshot.written && outcome.removedEntries !== undefined && outcome.removedEntries.count > 0) {
					await logError(projectRoot, "memory", `memory regression: ${outcome.removedEntries.count} Invariants/Pitfalls entry(ies) are no longer present, e.g. ${outcome.removedEntries.samples.join(" | ")}`);
				}
				if (snapshot.written && snapshot.backup.poisoned) {
					await logError(projectRoot, "memory", `replaced a stored JSON reply with markdown; original kept at ${snapshot.backup.path ?? "(none)"}`);
				}
				// A section render keeps the document inside the cap by dropping whole entries; the document
				// itself no longer carries a marker, so the counts are the only trace of what was given up.
				// Report them for every write that actually landed: this used to be gated to once per
				// project, which made every later loss on the same project silent.
				if (snapshot.written && (outcome.sectionDropped > 0 || outcome.itemTruncated > 0)) {
					const parts: string[] = [];
					// A whole-entry drop means the document itself is full: the per-section shares are targets,
					// so naming a section's budget as the limit would point at a number that is not one.
					if (outcome.sectionDropped > 0) parts.push(`${outcome.droppedItems} whole entry(ies) were dropped from ${outcome.sectionDropped} section(s) because the memory document reached its character cap`);
					if (outcome.itemTruncated > 0) parts.push(`${outcome.itemTruncated} entry(ies) exceeded their section's per-item cap and were truncated`);
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
						await recordEntryDates(
							projectRoot,
							new Map(outcome.retirement.added),
							outcome.retirement.ids === undefined ? undefined : new Set(outcome.retirement.ids),
						);
					} catch (error: unknown) {
						await logError(projectRoot, "memory", `the retired-fact record could not be written after MEMORY.md landed: ${diagnosticMessage(error)}`);
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
			if (update && contextRefused) {
				// Silent no-ops are this repo's standing failure class: say what did not land, and do not
				// call the session-derived placeholder "the reply's context section".
				const carried = outcome.result.context !== undefined || outcome.result.contextUnusable === true;
				const kept = existing.trim() ? `the previous ${contextName} stays effective` : `no ${contextName} was written`;
				await logError(projectRoot, "memory", carried
					? `the refused reply's context section was not published; ${kept}`
					: `the refused pass wrote no ${contextName} (the reply carried no context section)`);
			} else if (update) {
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
				ctx.logger.info(`dsh-project-context: ${target} updated: ${memoryFile(projectRoot)}`);
			}
			// The counts still describe only what landed: a refused memory write dropped nothing from
			// the stored file, and a context that was never written kept all of its characters.
			loss = {
				...loss,
				contextWritten: wroteContext,
				contextDroppedChars: wroteContext ? contextDroppedChars : 0,
				...(wroteContext && taskSlug !== undefined ? { contextTarget: taskRelativePath(taskSlug) } : {}),
			};
			if (memoryKeptStale) return { status: "stale", ...loss };
			if (memoryRefused) {
				// A refusal is a terminal outcome of this pass but not a write, so the claim is released
				// on the catch block's own rule: a later forced pass must really re-run instead of
				// answering "already up to date" for a memory that never landed.
				if (!wroteMemory) written.delete(projectRoot);
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
			if (!outcome || (written.get(projectRoot) ?? 0) >= outcome.version) return cleanReport("deduped");
			const work = write(outcome);
			options.track?.(work);
			const report = await work;
			// Batch Z4's cleaning channel runs after a pass that really ran, never after a deduped one
			// (nothing happened, so nothing aged). It is deliberately outside the reported outcome: a
			// cleanup failure must not turn a landed write into a failed command, and the receipt has no
			// business mentioning a deletion — `purge.log` is where a removal is recorded.
			const cleanup = await pruneProjectMemory(projectRoot, { apply: true, reason: "auto" });
			if (cleanup.status === "failed" && !options.silent) {
				ctx.logger.warn(`dsh-project-context: memory cleanup failed: ${cleanup.error ?? "unknown"}`);
			}
			return report;
		} catch (error) {
			// Release the claimed version when nothing was written: otherwise the next forced pass
			// inside `forceDedupeMs` would answer "already up to date" for a write that never landed.
			if (!wroteMemory) written.delete(projectRoot);
			await logError(projectRoot, "memory", error);
			if (!options.silent) ctx.logger.warn(`dsh-project-context: project memory update failed: ${diagnosticMessage(error)}`);
			return { status: "failed", ...loss };
		}
	});
}

/**
 * The projection registry, when the host (or a test harness) offers one.
 *
 * `sessionProjections` is optional per profile and undeclared in `inject`, so it is read through
 * `ctx.get` like every other optional service. A context that predates the service, or a fixture
 * that models only the parts a case needs, simply has no todo opinion.
 */
function projectionsOf(ctx: Context): SessionProjectionRegistry | undefined {
	return ctx.get("sessionProjections") as SessionProjectionRegistry | undefined;
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
export async function writeTodoSnapshot(ctx: Context, config: PluginConfig, session: Session): Promise<void> {
	const lines = projectTodoLines(projectionsOf(ctx), session);
	if (lines === undefined) return;
	const projectRoot = await getProjectRoot(projectCwd(session));
	const task = boundTaskSync(projectRoot, String(session.id), { mode: config.taskMode, today: dateStamp() });
	const file = task === undefined ? contextFile(projectRoot) : taskFile(projectRoot, task.slug);
	const target = task === undefined ? "CONTEXT.md" : taskRelativePath(task.slug);
	const stored = await readOptional(file);
	if (stored.trim() === "") return;
	const patch = withTodoLines(stored, lines);
	if (!patch.changed) return;
	await writeAtomic(file, patch.text);
	if (patch.droppedItems > 0) await logError(projectRoot, "memory", todoFitNotice(target, patch.droppedItems));
}

export function apply(ctx: Context, rawConfig: unknown): void {
	const entry = resolvePluginConfig(rawConfig);
	/** In-flight consolidation work per session, awaited by durability flushes. */
	const pending = new SessionWorkTracker();
	/**
	 * `interpolate` is part of the host's `PromptContext` since 0.2.x; the pinned
	 * `@deepseek-ai/dsh-system-prompt` types this plugin builds against (0.1.7-rc.2)
	 * predate it. A host that does not know the flag simply ignores it, so widen the
	 * registration type locally instead of dropping the guard.
	 */
	type LiteralContext = Parameters<Context["systemPrompt"]["context"]>[0] & { readonly interpolate?: boolean };
	const registerLiteralContext = (literal: LiteralContext): void => {
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
		text: (assembleContext) => projectContextInjection(
			assembleContext.agent?.session.header.cwd,
			assembleContext.agent === undefined ? undefined : String(assembleContext.agent.session.id),
			effectivePluginConfig(entry).taskMode,
		),
	});

	ctx.on("agent/created", ({ agent }) => {
		void (async () => {
			let projectRoot: string | undefined;
			try {
				projectRoot = await getProjectRoot(projectCwd(agent.session));
				if (migrated.has(projectRoot)) return;
				const result = await migrateProjectState(projectRoot);
				// Marked only after a completed attempt: a failed migration must be
				// retried by the next session start, not written off for the process.
				migrated.add(projectRoot);
				const details: string[] = [];
				if (result.moved.length > 0) details.push(`moved ${result.moved.join(", ")}`);
				if (result.importedSkills > 0) details.push(`imported ${result.importedSkills} skill${result.importedSkills === 1 ? "" : "s"}`);
				// The legacy `.omp` import holds the memory lock and refuses to run beside an
				// existing journal, so it is its own step rather than part of the layout migration.
				if (await importLegacyMemory(projectRoot, effectivePluginConfig(entry).maxMemoryChars)) details.push("imported legacy OMP memory");
				if (details.length > 0) ctx.logger.info(`dsh-project-context: project memory in ${memoryDir(projectRoot)}: ${details.join("; ")}`);
				// The legacy counterpart was older, so the current file won and the legacy bytes are
				// gone. Say so: the migration used to report these as "moved", which is false.
				if (result.superseded.length > 0) {
					ctx.logger.info(`dsh-project-context: legacy files superseded and discarded (the current file was newer): ${result.superseded.join(", ")}`);
				}
				if (result.conflicts.length > 0) {
					ctx.logger.warn(`dsh-project-context: legacy layout left in place (a newer legacy copy or a file/directory type conflict; merge it by hand): ${result.conflicts.join(", ")}`);
				}
			} catch (error: unknown) {
				// The project root is where diagnostics belong; the cwd is only the
				// fallback when the root itself could not be resolved.
				await logError(projectRoot ?? projectCwd(agent.session), "migration", error);
			}
		})();
		return undefined;
	});

	ctx.on("agent/status", ({ agent, status }) => {
		if (status !== "idle" || !isTopLevel(agent.session)) return;
		const current = effectivePluginConfig(entry);
		if (!current.memoryEnabled) return;
		// Only the pass's write phase reaches the tracker (`SessionWorkTracker`); the span itself is
		// observed here so a rejection stays as invisible as it was when the tracker carried it.
		void consolidateProject(ctx, current, agent, { force: false, silent: false, track: (work) => pending.track(agent.session, work) }).catch(() => undefined);
	});

	ctx.on("agent/disposed", ({ agent }) => {
		if (!isTopLevel(agent.session)) return;
		const current = effectivePluginConfig(entry);
		if (!current.memoryEnabled) return;
		// Silent: the UI may already be rebuilding for a session switch.
		void consolidateProject(ctx, current, agent, { force: true, silent: true, track: (work) => pending.track(agent.session, work) }).catch(() => undefined);
	});

	// The todo list is the one part of the context document that is not a model opinion: fold the
	// finished snapshot into Open tasks at every turn end, before the pass that runs on the following
	// idle can rewrite the document. Mechanical on purpose — no model call, and an unchanged list
	// writes nothing at all.
	ctx.on("session/event", (session, event) => {
		if (event.type !== "turn/end") return;
		if (!isTopLevel(session)) return;
		const current = effectivePluginConfig(entry);
		if (!current.memoryEnabled) return;
		void writeTodoSnapshot(ctx, current, session).catch((error: unknown) => logError(projectCwd(session), "memory", error));
	});

	ctx.on("session/flush", (session) => pending.flush(session));

	ctx.commands.register({
		name: "memory",
		description: "Show this project's memory location and status, 'update' to consolidate now, or 'prune' to preview the cleaning channel",
		input: { hint: "update | prune [--apply]" },
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
			if (verb !== "") return { kind: "error" as const, text: `Unknown option "${verb}". Usage: /memory (status) | /memory update | /memory prune [--apply]` };
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

/**
 * The `/memory` status reply for one loaded memory. Exported for tests.
 *
 * The reply distinguishes the states a silent fold would otherwise hide: a torn journal line, a
 * source that exists but cannot be read, and a stored reply from the old bug. It also reports the
 * character cap, which is the one degraded state the document itself cannot surface to the user:
 * a marker records that the document was capped *at some point* (it is carried forward), while
 * `cappedDroppedChars` describes what **this** read's cap kept back — including on the no-journal
 * read, which clips without writing a marker at all. Either one is enough to warn.
 * Measure the current state rather than quoting one: `loadMemory(root, maxMemoryChars)` reports
 * `cappedDroppedChars` and the marker through `isMemoryTruncated(loaded.text)`. Without the note the
 * receipt calls a memory that lost a third of itself perfectly healthy, and every later append lands
 * past the cap and is dropped on write.
 * @param memory - the loaded memory document and its status flags.
 * @param context - the paths and the cap this project is configured with.
 * @returns the command result.
 */
export function memoryStatusReply(
	memory: Awaited<ReturnType<typeof loadMemory>>,
	context: { projectRoot: string; journal: string; maxMemoryChars: number },
): { kind: "success" | "error"; text: string } {
	const capped = isMemoryTruncated(memory.text) || memory.cappedDroppedChars > 0
		? ` Warning: MEMORY.md is at the ${context.maxMemoryChars}-character cap — this read is cut, so a consolidation pass refuses to rewrite it (status read-capped-refused), and anything appended past the cap is dropped on write; raise maxMemoryChars or shorten the document.`
		: "";
	if (memory.unreadable) {
		const hint = memory.source.endsWith("memory.jsonl")
			? `Delete it to rebuild from MEMORY.md, or restore from memory-log-*.jsonl`
			: `check its permissions`;
		return { kind: "error", text: `Memory: exists but cannot be read — ${memory.source}; ${hint}.` };
	}
	if (memory.damaged) {
		return { kind: "success", text: `Memory: ${context.journal} (${memory.damaged} unusable line(s) skipped; see .agents/memory/errors.log).${capped}` };
	}
	if (memory.poisoned) {
		return { kind: "success", text: `Memory: ${memory.source} (stored as raw JSON from the old bug; the next consolidation backs it up and rewrites it as Markdown).${capped}` };
	}
	return {
		kind: "success",
		text: memory.text.trim() ? `Memory: ${memory.source}${capped}` : `Memory: none yet — ${memoryFile(context.projectRoot)}`,
	};
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
function memoryLossDetail(report: ConsolidateReport): string {
	const parts: string[] = [];
	if (report.memoryWriteDroppedChars > 0) parts.push(`${report.memoryWriteDroppedChars} character(s) of the reply exceeded the memory cap and were dropped on write`);
	if (report.sectionDropped > 0) parts.push(`${report.droppedItems} whole entry(ies) were dropped from ${report.sectionDropped} section(s) because the memory document reached its character cap`);
	if (report.itemTruncated > 0) parts.push(`${report.itemTruncated} entry(ies) exceeded their section's per-item cap and were truncated`);
	if (report.contextDroppedChars > 0) parts.push(`${report.contextDroppedChars} character(s) of the context were dropped to fit its section budgets`);
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
function refusedLossCause(report: ConsolidateReport): string {
	const refused = report.refusedLoss;
	if (refused === undefined) return "";
	const parts: string[] = [];
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
function writtenTarget(report: ConsolidateReport): string {
	// A bound session writes its task's document instead of the project-level one, and the receipt has
	// to name the file that actually changed: "CONTEXT.md" would be a landed write reported against a
	// document this pass never opened.
	const context = report.contextTarget ?? "CONTEXT.md";
	if (report.memoryWritten && report.contextWritten) return `MEMORY.md and ${context}`;
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
export function memoryUpdateReply(report: ConsolidateReport): { kind: "success" | "error"; text: string } {
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
	if (report.status === "deduped") return { kind: "success", text: "Memory: already up to date (deduped recently); nothing was rewritten." };
	if (report.status === "unchanged") return { kind: "success", text: "Consolidation ran but produced no new memory or context." };
	const target = writtenTarget(report);
	// A refused reply is not a write: the memory changed while the reply was being built, so the newer
	// bytes stay effective, and neither artifact was published. The wording may not claim either one.
	if (report.status === "stale") return { kind: "success", text: "Memory: was not rewritten — it changed while this pass's reply was being built, so the newer memory stays effective. Run /memory update again to consolidate from it." };
	if (report.status === "partial-refused") {
		// Batch Q2's refusal: the reply was in this extension's shape but could not be merged, so writing
		// it would have replaced content this pass cannot account for. Saying "lossy" or naming the cap
		// would point at the wrong cause; the lever is the reply's shape, and a complete document (or a
		// subset of the four sections) is what unblocks it.
		// Two causes, two levers: a store that is not a four-section document can only be replaced by a
		// complete one, while a reply whose sections are not plain `- ` entries is fixed in the reply.
		// Offering the wrong one is a dead lever, so the reason decides the sentence.
		const base = "Memory: was kept unchanged — the reply could not be merged into the stored memory (see .agents/memory/errors.log).";
		const lever = report.partialRefusal === "store-not-sections"
			? " Send the complete four-section document (## Project / ## Invariants / ## Pitfalls / ## Index) to replace the stored one."
			: " Rewrite the reply so every line under a section is a `- ` entry at column 0, or send a subset of the four sections to merge the rest from the stored memory.";
		return { kind: "success", text: `${base}${lever}` };
	}
	if (report.status === "read-capped-refused") {
		// A refusal decided before the model call: the pass was shown only part of a stored artifact, and
		// writing a reply built from that view would have deleted the rest. The advice must follow the
		// side that was cut — `maxMemoryChars` cannot raise the context read cap (it is a constant), and
		// shortening the memory cannot un-cut the context, so a single generic lever would be a dead one.
		const refused = report.readCappedRefused;
		const hidden: string[] = [];
		const levers: string[] = [];
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
		return { kind: "success", text: `Memory: was kept unchanged — the pass did not run, because ${what} would have been hidden from the model, and a reply built from that shortened view would have replaced the stored file with it. To unblock: ${lever}, then run /memory update again.` };
	}
	if (report.status === "fit-capped-refused") {
		// The read caps were satisfied, so `maxMemoryChars` cannot be the lever here: the documents are
		// within both read caps and the output budget still cannot hold them whole. Naming the memory cap
		// would send the operator to a knob that cannot buy the pass a token, which is the dead-lever
		// failure the read-cap receipt was written to avoid — on the other side of the same budget.
		const refused = report.fitCappedRefused;
		const hidden: string[] = [];
		const levers: string[] = [];
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
		return { kind: "success", text: `Memory: was kept unchanged — the pass did not run, because ${budget} cannot hold both stored documents and ${what} would have been hidden from the model, and a reply built from that shortened view would have replaced the stored file with it. To unblock: ${lever}, then run /memory update again.` };
	}
	if (report.status === "lossy-refused") {
		// A refusal is neither a failure nor a write: the stored memory is byte-identical, and the reply
		// is named through its own counts so the operator can act (usually by raising `maxMemoryChars`).
		// Both artifacts are withheld with the refusal, so no landed count can describe this pass.
		const base = `Memory: was kept unchanged — ${refused} and the one targeted retry did not fix it.`;
		// The pass itself is cached for `forceDedupeMs`, so an immediate re-run can only re-report this
		// refusal; the lever that actually gives the reply room is the cap.
		return { kind: "success", text: `${base} Raise maxMemoryChars, or retry the pass later, to give the reply more room.` };
	}
	return { kind: "success", text: detail === "" ? `Memory: updated ${target}.` : `Memory: updated ${target}, but the rewrite was lossy: ${detail}.` };
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
export function memoryPruneReply(outcome: PruneOutcome, projectRoot: string): { kind: "success" | "error"; text: string } {
	const memory = path.relative(projectRoot, memoryDir(projectRoot)) || memoryDir(projectRoot);
	const size = formatBytes(outcome.plan.bytes);
	const listed = outcome.plan.candidates
		.slice(0, 8)
		.map((candidate) => `${candidate.name} (${candidate.reason}, ${formatBytes(candidate.bytes)})`)
		.join(", ");
	const more = outcome.plan.candidates.length > 8 ? `, and ${outcome.plan.candidates.length - 8} more` : "";
	const trash = outcome.trash === undefined ? undefined : path.relative(projectRoot, outcome.trash) || outcome.trash;
	const log = path.relative(projectRoot, purgeLogFile(projectRoot)) || purgeLogFile(projectRoot);
	if (outcome.status === "failed") {
		// Fail closed: the archive is written before the first removal, so a failure here means the
		// directory is untouched. Say that, and do not imply a partial cleanup.
		return { kind: "error", text: `Memory prune: nothing was deleted — ${outcome.error ?? "the bytes could not be archived"}. The ${outcome.plan.candidates.length} planned file(s) (${size}) are still in ${memory}; nothing was logged as removed.` };
	}
	if (outcome.status === "nothing") {
		return { kind: "success", text: "Memory prune: nothing to clean — backups keep the newest 3, archived journals and stray journal temporaries are kept 90 days, errors.log is truncated above 1 MB, and skill candidates for 60 days." };
	}
	if (outcome.status === "preview") {
		return { kind: "success", text: `Memory prune: ${outcome.plan.candidates.length} file(s), ${size}, could be cleaned from ${memory} — ${listed}${more}. Nothing was deleted; /memory prune --apply removes them after archiving the bytes to ${memory}/trash/<date>.tar and appending one line to ${log}.` };
	}
	const actions: string[] = [];
	if (outcome.removed > 0) actions.push(`removed ${outcome.removed} file(s)`);
	if (outcome.truncated > 0) actions.push(`truncated ${outcome.truncated} file(s) in place`);
	const did = actions.join(" and ");
	if (outcome.status === "partial") {
		return { kind: "success", text: `Memory prune: ${did} of ${outcome.plan.candidates.length} planned (${size}), ${outcome.failed} file(s) could not be cleaned${outcome.error === undefined ? "" : ` (${outcome.error})`}; the bytes that left are archived in ${trash}. One line was appended to ${log}.` };
	}
	return { kind: "success", text: `Memory prune: ${did} (${size}); bytes archived in ${trash}, one line appended to ${log}.` };
}
