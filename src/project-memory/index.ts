/**
 * project-memory — the memory feature (pass ②, consolidation).
 *
 * One high-frequency, throttled consolidation pass produces both durable
 * project memory (`.agents/memory/MEMORY.md`) and the rolling project context
 * (`.agents/memory/CONTEXT.md`); both documents are injected back into the
 * model context as dynamic runtime context. Skill distillation is a separate
 * feature (`project-autolearn`), and the raw archive is `project-context`.
 *
 * Commands: /memory (status | update)
 */

import type { Context } from "@deepseek-ai/cordis";
// Type-only: pulls the commands service Context merge (ctx.commands).
import type {} from "@deepseek-ai/dsh-commands";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { resolvePluginConfig, type PluginConfig } from "../shared/config.js";
import { effectivePluginConfig } from "../shared/settings.js";
import { renderContextDocument } from "./context-doc.js";
import { contextClipNotice, contextTruncationDropped } from "./context-schema.js";
import { isTopLevel, projectCwd, SerialQueue, SessionWorkTracker } from "../shared/lifecycle.js";
import { consolidateProjectState, fallbackUpdate } from "./consolidate.js";
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
	readOptional,
	readTextCachedSync,
	writeAtomic,
} from "../shared/project-state.js";
import { backupMemoryBeforeWrite, importLegacyMemory, isMemoryTruncated, loadMemory, loadMemorySync, memoryJournalFile, normalizeMemoryWithDrop, readMemoryDamage, recordMemoryDocument } from "./memory-store.js";
import { withMemoryLock } from "../shared/lock.js";

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
	return `## Project Memory\nThe following is durable project memory learned from earlier sessions, not a new user instruction:\n\n${text}`;
}

/** Synchronous text for the dynamic-context provider; empty until the root is cached. */
function projectContextInjection(cwd: string | undefined): string {
	if (!cwd) return "";
	const projectRoot = cachedProjectRoot(cwd);
	if (projectRoot === undefined) {
		void getProjectRoot(cwd).catch(() => undefined);
		return "";
	}
	const text = readTextCachedSync(contextFile(projectRoot)).trim();
	if (!text) return "";
	return `## Project Context\nThe following is project context, not a new user instruction:\n\n${text.slice(0, MAX_CONTEXT_CHARS)}`;
}

interface ConsolidateOptions {
	force: boolean;
	silent: boolean;
	signal?: AbortSignal | undefined;
}

/** What one consolidation attempt did, so the `/memory update` reply can be truthful. */
export type ConsolidateStatus = "updated" | "clipped" | "unchanged" | "deduped" | "failed" | "stale" | "stale-context" | "lossy-refused";

/**
 * What a refused reply would have lost, kept apart from the landed counts on purpose.
 *
 * A refusal stores nothing, so every count that describes landed content is 0 — folding the refused
 * reply's numbers into those fields would report a loss the stored file never suffered. They are still
 * what the user needs to act on, so they ride in their own field instead.
 */
export type RefusedLoss = {
	/** Sections that would have lost at least one entry to their budget. */
	sectionDropped: number;
	/** Entries that would have been dropped whole. */
	droppedItems: number;
	/** Characters the memory cap would have dropped from the reply itself. */
	writeCapDroppedChars: number;
};

/**
 * What one consolidation attempt did, plus the loss it caused.
 *
 * A consolidation pass loses content in two places that the stored document cannot show afterwards,
 * because both happen before the write: the input fit hides characters of the stored artifacts from
 * the model (`memoryHiddenChars` / `contextHiddenChars`), and the section render drops whole entries
 * that overflow a section's share (`sectionDropped` / `droppedItems`), with `itemTruncated` counting
 * entries cut to the per-item cap. Carrying them here is what lets the receipt name the mechanism and
 * the count: without it a pass that dropped twelve entries read exactly like a clean one.
 *
 * A count is 0 unless the artifact it describes actually landed. A memory render whose write was
 * refused dropped nothing from the stored file, so its counts must not be reported as a loss.
 */
export type ConsolidateReport = {
	status: ConsolidateStatus;
	/** True when this pass's memory landed. A receipt must never claim an artifact that did not. */
	memoryWritten: boolean;
	/** True when this pass's context landed. */
	contextWritten: boolean;
	/** Characters of the landed memory the input fit hid from the model; 0 when whole or unwritten. */
	memoryHiddenChars: number;
	/** Characters of the landed context the model was not shown (the read cap plus the input fit). */
	contextHiddenChars: number;
	/** Characters the landed CONTEXT.md render dropped to fit its section budgets. */
	contextDroppedChars: number;
	/**
	 * Characters the landed MEMORY.md write dropped because the reply itself exceeded the memory cap.
	 * A reply that is not a four-section bullet document never reaches the section renderer, so this
	 * cap is the only place its loss is recorded: without it such a write is completely silent.
	 */
	memoryWriteDroppedChars: number;
	/** Sections of the landed memory that lost at least one entry to their budget. */
	sectionDropped: number;
	/** Entries dropped whole from the landed memory because their section's budget was full. */
	droppedItems: number;
	/** Entries of the landed memory cut to their section's per-item cap and kept. */
	itemTruncated: number;
	/**
	 * What a refused reply would have lost. Set only by `lossy-refused`, and never folded into the
	 * landed counts above: tier C refuses the write, so the stored document lost none of it.
	 */
	refusedLoss?: RefusedLoss;
};

/** The no-loss half of a report: nothing landed and nothing was dropped. */
export type ConsolidateLoss = Omit<ConsolidateReport, "status">;

const NO_LOSS: ConsolidateLoss = {
	memoryWritten: false,
	contextWritten: false,
	memoryHiddenChars: 0,
	contextHiddenChars: 0,
	contextDroppedChars: 0,
	memoryWriteDroppedChars: 0,
	sectionDropped: 0,
	droppedItems: 0,
	itemTruncated: 0,
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
		try {
			const outcome = await consolidateProjectState(ctx, agent, config, { force: options.force, signal: options.signal });
			if (!outcome || (written.get(projectRoot) ?? 0) >= outcome.version) return cleanReport("deduped");

			const memoryText = outcome.result.memory.trim();
			// A reply that carried no entries renders as a bare four-heading skeleton: it is over the
			// length floor but is not a memory, so the pass's gate must win over the length heuristic.
			// A refused reply is excluded for the opposite reason: it is a real memory this plugin
			// deliberately did not store, and writing it would be the silent loss the refusal exists to
			// prevent.
			const memoryRefused = outcome.memoryLossyRefused;
			const memoryChanged = !memoryRefused && !outcome.semanticEmpty && memoryText.length >= 40;
			if (!memoryChanged && !memoryRefused && !outcome.semanticEmpty && memoryText.length > 0) {
				// The length floor discards a short reply with no other trace at all: a tiny but real
				// memory must not vanish while the receipt still reports the pass as clean.
				await logError(projectRoot, "memory", `the consolidation reply carried a ${memoryText.length}-character memory, below the ${40}-character floor; the stored memory was kept unchanged`);
			}
			/** What a refused reply would have lost, named per refusal and never counted as landed. */
			let refusedLoss: RefusedLoss | undefined;
			if (memoryRefused) {
				refusedLoss = {
					sectionDropped: outcome.sectionDropped,
					droppedItems: outcome.droppedItems,
					writeCapDroppedChars: outcome.memoryWriteCapDroppedChars,
				};
				// Not gated per project: a project whose replies keep overflowing is refused every pass,
				// and reporting only the first refusal would leave every later one silent.
				const parts: string[] = [];
				if (refusedLoss.sectionDropped > 0) {
					parts.push(`${refusedLoss.sectionDropped} section(s) exceeded their budget and ${refusedLoss.droppedItems} whole entry(ies) would have been dropped`);
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
				if (snapshot.written && snapshot.backup.poisoned) {
					await logError(projectRoot, "memory", `replaced a stored JSON reply with markdown; original kept at ${snapshot.backup.path ?? "(none)"}`);
				}
				// A section render enforces the cap by dropping whole entries; the document itself no
				// longer carries a marker, so the counts are the only trace of what was given up. Report
				// them for every write that actually landed: this used to be gated to once per project,
				// which made every later loss on the same project silent.
				if (snapshot.written && (outcome.sectionDropped > 0 || outcome.itemTruncated > 0)) {
					const parts: string[] = [];
					if (outcome.sectionDropped > 0) parts.push(`${outcome.sectionDropped} section(s) exceeded their budget and ${outcome.droppedItems} whole entry(ies) were dropped`);
					if (outcome.itemTruncated > 0) parts.push(`${outcome.itemTruncated} entry(ies) exceeded their section's per-item cap and were truncated`);
					await logError(projectRoot, "memory", `MEMORY.md was rendered lossily: ${parts.join("; ")}`);
				}
			}

			// What landed is recorded as soon as it lands: a later throw must not erase it.
			loss = {
				...NO_LOSS,
				// A refusal decided above outlives this reset: it describes what did NOT land, and a throw
				// after this point must not turn that decision into a plain failure.
				...(refusedLoss === undefined ? {} : { refusedLoss }),
				memoryWritten: wroteMemory,
				memoryHiddenChars: wroteMemory ? outcome.memoryHiddenChars : 0,
				memoryWriteDroppedChars: wroteMemory ? memoryWriteDroppedChars : 0,
				sectionDropped: wroteMemory ? outcome.sectionDropped : 0,
				droppedItems: wroteMemory ? outcome.droppedItems : 0,
				itemTruncated: wroteMemory ? outcome.itemTruncated : 0,
			};

			const existing = await readOptional(contextFile(projectRoot));
			const update = outcome.result.context ?? (existing.trim() ? undefined : fallbackUpdate(session));
			let contextDroppedChars = 0;
			if (update) {
				const contextDocument = renderContextDocument(update, { updatedAt: new Date().toISOString() });
				await writeAtomic(contextFile(projectRoot), contextDocument);
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
			if (wrote && outcome.clipped) {
				// Always leave a trace: the log line below is hidden by `silent`, and a shortened
				// rewrite is the symptom that used to precede a truncated, unparseable memory.
				await logError(projectRoot, "memory", "consolidation shortened the existing memory or context to fit the model output budget");
			}
			if (!options.silent && wrote) {
				const note = outcome.clipped ? " (the rewrite also shortened the content to fit the output budget)" : "";
				// Name what actually landed: a kept memory must not be reported as written.
				const target = wroteMemory && wroteContext ? "project memory and context" : wroteMemory ? "project memory" : "project context";
				ctx.logger.info(`dsh-project-context: ${target} updated: ${memoryFile(projectRoot)}${note}`);
			}
			// The counts still describe only what landed: a refused memory write dropped nothing from
			// the stored file, and a context that was never written kept all of its characters.
			loss = {
				...loss,
				contextWritten: wroteContext,
				contextHiddenChars: wroteContext ? outcome.contextHiddenChars : 0,
				contextDroppedChars: wroteContext ? contextDroppedChars : 0,
			};
			if (memoryKeptStale) return { status: wroteContext ? "stale-context" : "stale", ...loss };
			if (memoryRefused) {
				// A refusal is a terminal outcome of this pass but not a write, so the claim is released
				// on the catch block's own rule: a later forced pass must really re-run instead of
				// answering "already up to date" for a memory that never landed.
				if (!wroteMemory) written.delete(projectRoot);
				return { status: "lossy-refused", ...loss, refusedLoss };
			}
			return wrote ? { status: outcome.clipped ? "clipped" : "updated", ...loss } : cleanReport("unchanged");
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

export function apply(ctx: Context, rawConfig: unknown): void {
	const entry = resolvePluginConfig(rawConfig);
	/** In-flight consolidation work per session, awaited by durability flushes. */
	const pending = new SessionWorkTracker();

	ctx.systemPrompt.context({
		name: "project-memory",
		order: 190,
		text: (assembleContext) => projectMemoryInjection(assembleContext.agent?.session.header.cwd, effectivePluginConfig(entry).maxMemoryChars),
	});
	ctx.systemPrompt.context({
		name: "project-context",
		order: 210,
		text: (assembleContext) => projectContextInjection(assembleContext.agent?.session.header.cwd),
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
		if (!current.autoConsolidate) return;
		pending.track(agent.session, consolidateProject(ctx, current, agent, { force: false, silent: false }));
	});

	ctx.on("agent/disposed", ({ agent }) => {
		if (!isTopLevel(agent.session)) return;
		const current = effectivePluginConfig(entry);
		if (!current.autoConsolidate) return;
		// Silent: the UI may already be rebuilding for a session switch.
		pending.track(agent.session, consolidateProject(ctx, current, agent, { force: true, silent: true }));
	});

	ctx.on("session/flush", (session) => pending.flush(session));

	ctx.commands.register({
		name: "memory",
		description: "Show this project's memory location and status, or 'update' to consolidate now",
		input: { hint: "update" },
		handler: async ({ agent, rawInput, signal }) => {
			const verb = (rawInput ?? "").trim().toLowerCase();
			if (verb === "update") {
				const report = await consolidateProject(ctx, effectivePluginConfig(entry), agent, { force: true, silent: false, signal });
				return memoryUpdateReply(report);
			}
			if (verb !== "") return { kind: "error" as const, text: `Unknown option "${verb}". Usage: /memory (status) | /memory update` };
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
 * the truncation marker is written into MEMORY.md, but nothing reads it back. Measured on this
 * repo at 41733 characters, the loaded document is capped at 31888 with 9621 dropped while every
 * other flag stays clean — so without the note the receipt calls a memory that lost a third of
 * itself perfectly healthy, and every later append lands past the cap and is dropped on write.
 * @param memory - the loaded memory document and its status flags.
 * @param context - the paths and the cap this project is configured with.
 * @returns the command result.
 */
export function memoryStatusReply(
	memory: Awaited<ReturnType<typeof loadMemory>>,
	context: { projectRoot: string; journal: string; maxMemoryChars: number },
): { kind: "success" | "error"; text: string } {
	const capped = isMemoryTruncated(memory.text)
		? ` Warning: MEMORY.md is at the ${context.maxMemoryChars}-character cap, so it is cut and new memory is dropped on write; raise maxMemoryChars or consolidate to shorten it.`
		: "";
	if (memory.unreadable) {
		const hint = memory.source.endsWith("memory.jsonl")
			? `Delete it to rebuild from MEMORY.md, or restore from memory-log-*.jsonl`
			: `check its permissions`;
		return { kind: "error", text: `Project memory exists but cannot be read: ${memory.source}; ${hint}.` };
	}
	if (memory.damaged) {
		return { kind: "success", text: `Project memory: ${context.journal} (${memory.damaged} unusable line(s) skipped; see .agents/memory/errors.log).${capped}` };
	}
	if (memory.poisoned) {
		return { kind: "success", text: `Project memory: ${memory.source} (stored as raw JSON from the old bug; the next consolidation backs it up and rewrites it as Markdown).${capped}` };
	}
	return {
		kind: "success",
		text: memory.text.trim() ? `Project memory: ${memory.source}${capped}` : `No project memory yet: ${memoryFile(context.projectRoot)}`,
	};
}

/**
 * Name what a pass gave up, mechanism by mechanism, so a lossy receipt cannot read as a clean one.
 *
 * The mechanisms are worded separately because they fail differently: a hidden character count is the
 * input side shielding the model from part of a stored artifact, the write-cap count is the memory the
 * cap dropped from the reply itself, and the drop counts are a renderer refusing to write an entry
 * whole. An empty string means the report carries no loss at all.
 * @param report - the pass result, whose counts are already filtered to what landed.
 * @returns the loss clause, or `""` when the pass was clean.
 */
function memoryLossDetail(report: ConsolidateReport): string {
	const hidden: string[] = [];
	if (report.memoryHiddenChars > 0) hidden.push(`${report.memoryHiddenChars} character(s) of the stored memory`);
	if (report.contextHiddenChars > 0) hidden.push(`${report.contextHiddenChars} character(s) of the stored context`);
	const parts: string[] = [];
	if (hidden.length > 0) parts.push(`the model was not shown ${hidden.join(" and ")}`);
	if (report.memoryWriteDroppedChars > 0) parts.push(`${report.memoryWriteDroppedChars} character(s) of the reply exceeded the memory cap and were dropped on write`);
	if (report.sectionDropped > 0) parts.push(`${report.sectionDropped} section(s) exceeded their budget and ${report.droppedItems} whole entry(ies) were dropped`);
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
		parts.push(`${refused.sectionDropped} section(s) exceeded their budget and ${refused.droppedItems} whole entry(ies) would have been dropped`);
	}
	if (refused.writeCapDroppedChars > 0) {
		parts.push(`${refused.writeCapDroppedChars} character(s) of the reply exceeded the memory cap`);
	}
	return parts.length === 0 ? "the reply would have been stored lossily" : `the reply would have been stored lossily (${parts.join("; ")})`;
}

/** Name the artifact(s) a pass wrote, so no receipt claims one that did not land. */
function writtenTarget(report: ConsolidateReport): string {
	if (report.memoryWritten && report.contextWritten) return "Project memory and context";
	return report.memoryWritten ? "Project memory" : "Project context";
}

/**
 * The `/memory update` reply for one pass result. The pass swallows its own
 * error (it is also logged to `errors.log`), so the reply must not claim success
 * for a failure or for a deduped no-op. Exported for tests.
 *
 * A clean pass that wrote both artifacts reads exactly as it did before the report carried counts —
 * the wording only changes when the pass lost something or wrote only one of the two, so an unchanged
 * sentence keeps meaning "both landed, nothing was lost".
 * @param report - what the consolidation attempt did, including the loss it caused.
 * @returns the command result.
 */
export function memoryUpdateReply(report: ConsolidateReport): { kind: "success" | "error"; text: string } {
	const detail = memoryLossDetail(report);
	const refused = refusedLossCause(report);
	if (report.status === "failed") {
		const base = "Project memory update failed; see .agents/memory/errors.log.";
		// A write that landed before the failure is not part of the failure; say which one survived.
		if (!report.memoryWritten && !report.contextWritten) {
			// A refusal decided before the failure is not the failure either: the memory was kept on
			// purpose, and dropping that from the receipt would report the pass as a plain error.
			return { kind: "error", text: refused === "" ? base : `${base} The memory was not written: ${refused}, and the one targeted retry did not fix it.` };
		}
		const what = report.memoryWritten && report.contextWritten ? "The memory and the context" : report.memoryWritten ? "The memory" : "The context";
		return { kind: "error", text: `${base} ${what} had already landed${detail === "" ? "" : `, with this loss: ${detail}`}.` };
	}
	if (report.status === "deduped") return { kind: "success", text: "Project memory and context are already up to date (deduped recently); nothing was rewritten." };
	if (report.status === "unchanged") return { kind: "success", text: "Consolidation ran but produced no new memory or context." };
	const target = writtenTarget(report);
	if (report.status === "clipped") {
		const base = `${target} updated, but the existing content was shortened to fit the model output budget`;
		return { kind: "success", text: detail === "" ? `${base}.` : `${base}: ${detail}.` };
	}
	// A refused reply is not a write: the memory changed while the reply was being built, so the
	// newer bytes stay effective. Neither wording may claim that memory was rewritten.
	if (report.status === "stale") return { kind: "success", text: "Project memory was not rewritten: it changed while this pass's reply was being built, so the newer memory stays effective. Run /memory update again to consolidate from it." };
	if (report.status === "stale-context") {
		// The context did land, so a context this pass was shown only part of is a real loss and is
		// named; the memory's own counts stay 0 because that document was refused.
		const base = "Project context updated; project memory was not rewritten because it changed while this pass's reply was being built — the newer memory stays effective.";
		return { kind: "success", text: detail === "" ? base : `${base} ${detail}.` };
	}
	if (report.status === "lossy-refused") {
		// A refusal is neither a failure nor a write: the stored memory is byte-identical, and the reply
		// is named through its own counts so the operator can act (usually by raising `maxMemoryChars`).
		// The memory-side landed counts are all 0 by contract; `detail` can still carry a context loss
		// that landed in the same pass, and leaving it out would report that context as clean.
		const base = `Project memory was kept unchanged: ${refused} and the one targeted retry did not fix it.`;
		const context = report.contextWritten ? ` The context was updated${detail === "" ? "" : `, with this loss: ${detail}`}.` : "";
		// The pass itself is cached for `forceDedupeMs`, so an immediate re-run can only re-report this
		// refusal; the lever that actually gives the reply room is the cap.
		return { kind: "success", text: `${base}${context} Raise maxMemoryChars, or retry the pass later, to give the reply more room.` };
	}
	return { kind: "success", text: detail === "" ? `${target} updated.` : `${target} updated, but the rewrite was lossy: ${detail}.` };
}
