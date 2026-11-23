/**
 * The consolidation pass (②): one throttled, single-flight model call per project producing
 * durable memory and a session-context update. It lived in `shared/llm.ts` only because the
 * autolearn pass reuses the model plumbing from there; the pass itself belongs to the memory
 * plugin, and the plumbing it shares now sits in `shared/model-call.ts`.
 */

import path from "node:path";
import { type Agent, type HostPorts } from "../host/contract.js";
import { type PluginConfig } from "../shared/config.js";
import { MAX_CONTEXT_CHARS, cachedProjectRoot, contextFile, diagnosticMessage, getProjectRoot, getProjectRootSync, logError, readOptional, taskFile } from "../shared/project-state.js";
import { boundTaskSync, dateStamp } from "./tasks.js";
import { loadMemory } from "./memory-store.js";
import { type MemoryInput, conversationText, fitMemoryInput, userTurnCount } from "../shared/conversation.js";
import { type CompletionOutcome, type PluginTool, type ToolsFallbackState, auxiliaryReasoningEffort, callWithToolsFallback, resolveModelMetadata, resolveTarget, toolCallIsTruncated } from "../shared/model-call.js";
import { RETRY_OUTPUT_HEADROOM_TOKENS } from "../shared/output-budget.js";
import { type ConsolidationResult } from "../shared/reply-json.js";
import { MAX_CONSOLE_REPLY_CHARS, replyHead } from "../shared/text.js";
import { type MemoryRender, type MemorySections, RECORD_MEMORY_TOOL, renderMemoryDocument, sectionsFromMarkdown } from "./sections.js";
import { readTombstones, tombstoneDigestLines } from "./retired.js";
import { type RetirementResult, documentIds, readEntryDates, retireReply, retireWithinBudget } from "./retirement.js";
import { repairLostEntries } from "./lost-entry-repair.js";
import type { ConsolidationOutcome, ResolvedReply } from "./consolidate-types.js";
import {
	CONSOLIDATION_PROMPT_RULES,
	CONVERSATION_CAPTION,
	MEMORY_ENTRY_ID_RULE,
	MEMORY_SURVIVAL_CAPTION,
	TRUNCATED_REPLY_RULE,
	expiryRuleFor,
	memoryBudgetRule,
	memoryLossRetryRule,
	memorySectionRule,
} from "./prompt.js";
import {
	applyPartialGuard,
	entrySamples,
	memoryLoss,
	partialRefusalMessage,
	removedSectionEntries,
	replyIsSemanticallyEmpty,
	requestConsolidationText,
	resolveReply,
} from "./reply.js";

interface ConsolidationOptions {
	force?: boolean;
	signal?: AbortSignal;
}

type ConsolidationState = { session: string; turns: number; at: number };

let nextVersion = 0;

/** Single-flight per cwd: concurrent callers join the same pass. */
const activeConsolidation = new Map<string, Promise<ConsolidationOutcome | undefined>>();

const throttle = new Map<string, ConsolidationState>();

const lastOutcome = new Map<string, { version: number; at: number; cap: number; outcome: ConsolidationOutcome }>();


/**
 * Run the consolidation pass (durable memory + session context).
 * Callers own persisting their artifact; results are cached per project so the memory and
 * session-context plugins can consume the same pass without a second model call.
 * @param host - the ports; the model port is the only facility this pass reads.
 */
export function consolidateProjectState(
	host: HostPorts,
	agent: Agent,
	config: PluginConfig,
	options: ConsolidationOptions = {},
): Promise<ConsolidationOutcome | undefined> {
	const cwd = path.resolve(agent.session.header.cwd ?? process.cwd());
	// Claim by project root, not cwd: the root and a subdirectory of one project
	// are the same state and must share a single pass. The root is cache-warm by
	// the time a pass can trigger (sessions warm it on create and callers resolve
	// it first), so the sync fallback practically never spawns git.
	const projectKey = cachedProjectRoot(cwd) ?? getProjectRootSync(cwd);
	const claimed = activeConsolidation.get(projectKey);
	if (claimed) return claimed;

	const run = (async (): Promise<ConsolidationOutcome | undefined> => {
		const force = options.force ?? false;
		const projectRoot = await getProjectRoot(cwd);
		const session = agent.session;
		const turns = userTurnCount(session);
		const sessionId = String(session.id);
		const today = dateStamp();
		// The task dimension's read half: a session bound by `/context task <slug>` consolidates into
		// that task's document instead of the shared `CONTEXT.md`, so the prompt shows the workflow's
		// own state and the reply replaces the same file. A binding whose task has been archived is
		// bound but not in use, so it takes the same path as an unbound session — the state table's
		// "archived is not injected" applies to the write as well, or a pass would reopen it by
		// refreshing `lastSeen`. Unbound sessions take the old path byte for byte.
		const boundTask = boundTaskSync(projectRoot, sessionId, { mode: config.taskMode, today });
		const taskSlug = boundTask?.slug;
		const previous = throttle.get(projectRoot);
		// The turn counter is session-local: after a session change, count from zero again.
		// Otherwise a fresh session would need `previous session turns + consolidateTurns` before learning.
		const baseline = previous?.session === sessionId ? previous.turns : 0;
		const cached = lastOutcome.get(projectRoot);
		// A cached outcome describes the cap it was decided under. Raising `maxMemoryChars` changes what
		// the very same reply would lose, so a forced pass under a new cap has to re-run instead of
		// re-answering with a refusal the old cap produced — "Raise maxMemoryChars, or retry the pass
		// later" is the refusal's own lever, and the forced pass is where the user turns it. The throttled
		// path below is not keyed on the cap: it must never spend a surprise model call, and re-reporting
		// the last real decision beats claiming "already up to date" for a memory that was never written.
		const cachedForCap = cached !== undefined && cached.cap === config.maxMemoryChars ? cached : undefined;
		const throttled = !force && (turns - baseline < config.consolidateTurns || Date.now() - (previous?.at ?? 0) < config.consolidateIntervalMs);
		if (throttled) return cached?.outcome;
		if (force && cachedForCap && Date.now() - cachedForCap.at < config.forceDedupeMs) return cachedForCap.outcome;

		const existing = await loadMemory(projectRoot, config.maxMemoryChars);
		// The pass continues with whatever is readable, but a broken source must stay diagnosable:
		// the prompt would otherwise look as if the project had no memory at all.
		if (existing.unreadable) await logError(projectRoot, "memory", `project memory exists but cannot be read: ${existing.source}`);
		else if (existing.damaged) await logError(projectRoot, "memory", `memory journal has ${existing.damaged} unusable line(s); they were skipped`);
		const existingContextText = await readOptional(taskSlug === undefined ? contextFile(projectRoot) : taskFile(projectRoot, taskSlug));
		const existingContext = existingContextText.slice(0, MAX_CONTEXT_CHARS);
		// Characters the context read cap alone kept from the model, before the fit clips anything: an
		// over-cap stored context loses this much on every pass, and only the fit's own count was ever
		// reported, so the receipt understated what the model was not shown.
		const contextReadHiddenChars = existingContextText.length - existingContext.length;
		// A pass whose view of a stored artifact was cut by a read cap must not run at all. The reply is
		// built from the shortened view, so writing it replaces the stored file with that view and deletes
		// every character the cap kept back — measured, not inferred: with a 6482-character memory under a
		// 4000-character cap, a reply that merely re-emitted what it was shown landed as a 3983-character
		// document, status `clipped`, and both the Pitfalls and the Index tail were gone. Tier C cannot see
		// it, because it measures the reply against the write cap and the reply fits; `cappedDroppedChars`
		// and the context slice are the only counts that know content was hidden, which is why the gate is
		// here and not at the write. One line per occurrence, and it names the lever that actually applies
		// to the side that was cut.
		const readCapHidden = existing.cappedDroppedChars + contextReadHiddenChars;
		if (readCapHidden > 0) {
			const parts: string[] = [];
			if (existing.cappedDroppedChars > 0) parts.push(`${existing.cappedDroppedChars} character(s) of the stored memory (${config.maxMemoryChars}-character cap)`);
			if (contextReadHiddenChars > 0) parts.push(`${contextReadHiddenChars} character(s) of the stored context (${MAX_CONTEXT_CHARS}-character read cap)`);
			await logError(projectRoot, "memory", `the consolidation pass was not run: ${parts.join(" and ")} would have been hidden from the model, and a reply built from that shortened view would have replaced the stored file with it`);
			const refusal: ConsolidationOutcome = {
				// No reply exists, so the result carries no memory and no context: a refusal publishes
				// neither artifact, which is what keeps the other half from landing behind its back.
				result: { memory: "" },
				...(taskSlug === undefined ? {} : { taskSlug }),
				version: (nextVersion += 1),
				basisKey: existing.text,
				shownMemory: existing.text,
				shownContext: existingContext,
				kind: "none",
				semanticEmpty: false,
				sectionDropped: 0,
				droppedItems: 0,
				itemTruncated: 0,
				memoryWriteCapDroppedChars: 0,
				memoryLossyRefused: false,
				maxMemoryChars: config.maxMemoryChars,
				partialRefused: false,
				mergedFromStore: [],
				readCappedRefused: { cap: config.maxMemoryChars, memoryHiddenChars: existing.cappedDroppedChars, contextHiddenChars: contextReadHiddenChars },
			};
			// The throttle and the cache are set here because this return skips the pass's own tail: an
			// automatic path must not retry the same refusal on every turn, and the cached outcome is keyed
			// on the cap, so raising `maxMemoryChars` really re-runs.
			throttle.set(projectRoot, { session: sessionId, turns, at: Date.now() });
			lastOutcome.set(projectRoot, { version: refusal.version, at: Date.now(), cap: config.maxMemoryChars, outcome: refusal });
			return refusal;
		}
		// Batch Z2's deletion half, decided before the prompt is built: a retired entry leaves the
		// document *and* the view the model is shown, because the pass is a whole-document regeneration
		// from the conversation and a stale fact left in `<existing-memory>` is exactly what gets copied
		// forward. `basisKey` stays the stored bytes — what is written is judged against the store, not
		// against this shortened view.
		const nowMs = Date.now();
		const storedTombstones = await readTombstones(projectRoot);
		const storedSectionsForPlan = sectionsFromMarkdown(existing.text);
		const entryDates = await readEntryDates(projectRoot);
		let plan: (RetirementResult & { stamped: boolean }) | undefined;
		let promptMemory = existing.text;
		if (storedSectionsForPlan !== undefined) {
			plan = await retireWithinBudget(storedSectionsForPlan, { projectRoot, firstSeen: entryDates, today, now: nowMs }, config.maxMemoryChars);
			const rendered = renderMemoryDocument(plan.sections, config.maxMemoryChars);
			if (rendered.sectionDropped === 0 && rendered.itemTruncated === 0) promptMemory = rendered.text;
			else await logError(projectRoot, "memory", `the stored memory could not be re-rendered cleanly, so the pass is shown it verbatim: ${rendered.droppedItems} whole entry(ies) would have been dropped from ${rendered.sectionDropped} section(s)`);
		}
		const target = resolveTarget(agent, config);
		if (!target) throw new Error("no provider/model available for the learn pass: route one request, set AgentOptions, or configure provider+model");
		// One resolve for both facts: the adapter's own output cap bounds the adaptive cap, and its
		// reasoning metadata decides whether hidden thinking must be reserved out of the same budget.
		const info = await resolveModelMetadata(host.llm, target, options.signal);
		const auxModel = { maxTokens: info?.defaultMaxTokens, reasoning: info?.reasoning !== undefined };
		// Same resolve, third fact: the route's cheapest *enabled* effort. Naming none, or naming the
		// disabled level, makes dsh emit disabled thinking, which a gateway may refuse outright
		// (`auxiliaryReasoningEffort` carries the mechanism and the measured case).
		const reasoningEffort = auxiliaryReasoningEffort(info);
		// The reply must re-emit both artifacts, so the output cap is matched to them (raised up to
		// the model's own limit and the configured ceiling) and the input is shortened head-and-tail
		// when even that cannot hold both. An over-long memory is what used to truncate the reply and
		// leave an unparseable document behind.
		const fitted = fitMemoryInput(promptMemory, existingContext, config.maxTokens, auxModel, config.maxOutputTokens);
		// The read-cap gate above can only see a document the loader cut. This one cuts for a different
		// reason — the output budget cannot hold both documents whole — and it is the reason a pass still
		// writes back a shortened view: measured on the built `lib/` (2026-11-07, `.agents/evidence/
		// 2026-11-07-fit-clip-writeback`), a 45247-character memory with a 8164-character context is clean
		// on this first fit but hides 3218 characters on the truncation retry, and a 42199/16048 pair
		// hides 4232 — both inside the read caps, so nothing above stops them. The reply is a whole-document
		// replacement, so letting it land deletes every hidden character while the status says `clipped`
		// and tier C stays silent (it measures the reply against the write cap, and the reply fits).
		// Same decision as the read cap, taken before the model call so a pass that cannot see its own
		// input never spends one; the lever is the output budget, not `maxMemoryChars`.
		if (fitted.clipped) {
			const parts: string[] = [];
			if (fitted.memoryHiddenChars > 0) parts.push(`${fitted.memoryHiddenChars} character(s) of the stored memory`);
			if (fitted.contextHiddenChars > 0) parts.push(`${fitted.contextHiddenChars} character(s) of the stored context`);
			await logError(projectRoot, "memory", `the consolidation pass was not run: the ${config.maxOutputTokens}-token output budget cannot hold both stored documents, so ${parts.join(" and ")} would have been hidden from the model, and a reply built from that shortened view would have replaced the stored file with it`);
			const refusal: ConsolidationOutcome = {
				result: { memory: "" },
				...(taskSlug === undefined ? {} : { taskSlug }),
				version: (nextVersion += 1),
				basisKey: existing.text,
				shownMemory: existing.text,
				shownContext: existingContext,
				kind: "none",
				semanticEmpty: false,
				sectionDropped: 0,
				droppedItems: 0,
				itemTruncated: 0,
				memoryWriteCapDroppedChars: 0,
				memoryLossyRefused: false,
				maxMemoryChars: config.maxMemoryChars,
				partialRefused: false,
				mergedFromStore: [],
				fitCappedRefused: {
					maxOutputTokens: config.maxOutputTokens,
					memoryHiddenChars: fitted.memoryHiddenChars,
					contextHiddenChars: fitted.contextHiddenChars,
				},
			};
			// Throttled so the automatic path does not recompute and re-log on every settled turn, but
			// deliberately NOT written to `lastOutcome`: that cache is keyed on `maxMemoryChars`, and this
			// refusal's lever is `maxOutputTokens`. Caching it under the memory cap would answer a forced
			// pass under the old budget after the operator raised the one knob the receipt named — the dead
			// lever this refusal exists to avoid. A forced pass recomputes instead, which costs one fit.
			throttle.set(projectRoot, { session: sessionId, turns, at: Date.now() });
			return refusal;
		}
		// Batch AA2b's transition: measured once, before any attempt, so a retry states the same entries.
	const expiryRule = await expiryRuleFor(projectRoot, promptMemory, config);
	const promptFor = (input: MemoryInput, extra: readonly string[]): string => [
			...CONSOLIDATION_PROMPT_RULES,
			memorySectionRule(config.maxMemoryChars),
			memoryBudgetRule(config.maxMemoryChars, input.text.length),
			MEMORY_ENTRY_ID_RULE,
			// Dates and titles only: quoting the reason would re-inject the retired content.
			...tombstoneDigestLines(storedTombstones),
			...(expiryRule === "" ? [] : [expiryRule]),
			...extra,
			"",
			`Project root: ${projectRoot}`,
			"",
			MEMORY_SURVIVAL_CAPTION,
			"<existing-memory>",
			input.text || "(none)",
			"</existing-memory>",
			"",
			"<existing-context>",
			input.contextText || "(none)",
			"</existing-context>",
			"",
			"<recent-conversation>",
			CONVERSATION_CAPTION,
			conversationText(session),
			"</recent-conversation>",
		].join("\n");

		/** The input of the call actually sent last: a retry may have sent less than the first fit. */
		let usedInput = fitted;
		/** The pass's own tools switch; only the first call carries `tools`, so it stays inert here. */
		const toolsState: ToolsFallbackState = {};
		/** One call, recording the attempt before a failure so a persistent error backs off. */
		const call = async (input: MemoryInput, extra: readonly string[], tools: readonly PluginTool[] | undefined): Promise<CompletionOutcome> => {
			try {
				// A route that refuses `tools` answers a provider 400, which the harness reports as the
				// request-shape code; `callWithToolsFallback` spends the one tools-free retry for exactly
				// that class and nothing else. The throttle line below runs once for the pair, so a
				// refused parameter cannot burn two failure slots.
				return await callWithToolsFallback(toolsState, tools !== undefined && tools.length > 0, (withTools) =>
					requestConsolidationText(host, agent, config, promptFor(input, extra), options.signal, input.maxTokens, reasoningEffort, withTools ? tools : undefined),
				{
					// A `record_memory` whose argument JSON does not parse is not a request-shape refusal: the
					// route took `tools` and answered unusably, and the same one-shot retry is the cheapest
					// recovery because this prompt already asks for four-section Markdown without the tool.
					// Opted in here and nowhere else — autolearn keeps its own policy. The code is shared with
					// other unusable replies, so this knowingly spends the retry on those too.
					extraCodes: ["MALFORMED_RESPONSE"],
					// One bounded line: the failure's own message carries the model's generated memory
					// arguments, so it is exactly what must not be echoed at this level.
					onRetry: (code) => {
						void logError(projectRoot, "memory", `the model's record_memory reply was unusable (${code}); the pass was retried once without tools`).catch(() => undefined);
					},
				});
			} catch (error: unknown) {
				throttle.set(projectRoot, { session: sessionId, turns, at: Date.now() });
				throw error;
			}
		};
		/** Read a reply, backing off before rethrowing when the reply is unusable by policy. */
		const read = (completion: CompletionOutcome, allowTools: boolean): ResolvedReply | undefined => {
			try {
				const reply = resolveReply(completion, allowTools);
				// Batch Q2 applies to every reply this pass reads, the tier-C retry included: a retry that
				// answers with a partial document must not get a second chance to replace the store.
				return reply === undefined ? undefined : applyPartialGuard(reply, existing.text);
			} catch (error: unknown) {
				throttle.set(projectRoot, { session: sessionId, turns, at: Date.now() });
				throw error;
			}
		};

		/**
		 * Batch Z2 on the reply: drop the echoes of what the pre-prompt plan retired, honour the reply's
		 * own `supersedes:` declarations, and give every entry an id.
		 *
		 * Returned rather than accumulated so a reply that a retry later discards leaves no tombstone
		 * behind: the caller decides which attempt's retirement describes the document that lands.
		 */
		const applyRetirement = async (reply: ResolvedReply): Promise<{ reply: ResolvedReply; applied?: RetirementResult & { stamped: boolean } }> => {
			if (reply.sections === undefined) return { reply };
			const applied = await retireReply(
				reply.sections,
				{ projectRoot, firstSeen: entryDates, today, now: nowMs, retiredIds: plan?.droppedIds },
				config.maxMemoryChars,
			);
			return { reply: { ...reply, sections: applied.sections }, applied };
		};
		let attempt = await call(fitted, [], [RECORD_MEMORY_TOOL]);
		// A cut-off tool call is never accepted: the adapter repairs a truncated arguments string into
		// a shape-valid object, so "there is a tool call" is not evidence that its contents arrived.
		// A *text* reply that stopped at the cap is the old case. Both are retried: the untrusted call
		// because its contents are unverified, the cut text because it may simply have been cut.
		const truncatedToolCall = toolCallIsTruncated(attempt);
		let resolved = truncatedToolCall ? undefined : read(attempt, true);
		// The retirement that belongs to the reply this pass ends up storing, plus the same for the
		// truncation retry: only the attempt that lands may leave a tombstone.
		let applied: (RetirementResult & { stamped: boolean }) | undefined;
		if (resolved !== undefined) {
			const retired = await applyRetirement(resolved);
			resolved = retired.reply;
			applied = retired.applied;
		}
		// Set only when the truncation retry would have hidden stored content, so the failure below can
		// name that cause instead of the cut reply's. `undefined` means the retry either ran or was never
		// eligible.
		let retryFitCapped: MemoryInput | undefined;
		if (!resolved && (attempt.stopReason === "max-tokens" || truncatedToolCall)) {
			// The reply ran into the output cap, which is not a parse failure: ask again with extra
			// headroom reserved out of the same cap, a shorter prompt, and no tool — the reminder asks
			// for the JSON text shape, which a tool call could not satisfy. dsh reports this as
			// `max-tokens` (pi calls it `length`); matching the wrong string would never retry.
			// The headroom is the flat constant **or** the hidden reasoning this attempt actually spent,
			// whichever is larger: the reserve is capped at 8192 while a reasoning route can spend far
			// more, so a retry carrying only +4096 asks again with the very headroom that just starved it
			// (pi `099ebf3`). `attempt.reasoningTokens` is 0 when the adapter reports none, so a route
			// that reports no hidden thinking keeps exactly the flat constant it had before.
			const retryHeadroom = Math.max(RETRY_OUTPUT_HEADROOM_TOKENS, attempt.reasoningTokens);
			const retryFitted = fitMemoryInput(promptMemory, existingContext, config.maxTokens, auxModel, config.maxOutputTokens, retryHeadroom);
			// Headroom is reserved out of the same output cap, so a retry can hide content the first fit
			// showed: measured 2026-11-07 on the built `lib/`, a 42199-character memory with a 16048-character
			// context is clean on the first fit and loses 4232 characters on this one. The retry exists to
			// rescue a cut reply, not to trade the stored document for a longer reply, so it is skipped
			// rather than run against a view the model cannot see whole. The pass then fails naming this
			// cause instead of the cut reply's — see the branch below.
			retryFitCapped = retryFitted.clipped ? retryFitted : undefined;
			if (retryFitCapped === undefined) {
				usedInput = retryFitted;
				attempt = await call(usedInput, [TRUNCATED_REPLY_RULE], undefined);
				resolved = read(attempt, false);
				if (resolved !== undefined) {
					const retired = await applyRetirement(resolved);
					resolved = retired.reply;
					applied = retired.applied;
				}
			} else {
				await logError(projectRoot, "memory", `the consolidation retry was not sent: reserving ${retryHeadroom} more output tokens for it would have hidden ${retryFitCapped.memoryHiddenChars + retryFitCapped.contextHiddenChars} character(s) of the stored documents from the model, and a reply built from that shortened view would have replaced them`);
			}
		}
		if (!resolved) {
			// Back off like any other failed pass, but never store the raw JSON as memory. A reply
			// that hit the cap is reported as what it is — the retry already happened, so a generic
			// "not a usable JSON object" would hide the one cause the operator can act on.
			throttle.set(projectRoot, { session: sessionId, turns, at: Date.now() });
			// A retry that was never sent is not a retry that failed: the reply is still cut, but the one
			// cause the operator can act on is the output budget being too small for both documents, and
			// "raise maxOutputTokens or shorten a document" is a different lever from the cut reply's own.
			// Naming the cut here would point at the same knob the gate already rejected.
			if (retryFitCapped !== undefined) {
				const hidden: string[] = [];
				if (retryFitCapped.memoryHiddenChars > 0) hidden.push(`${retryFitCapped.memoryHiddenChars} character(s) of the stored memory`);
				if (retryFitCapped.contextHiddenChars > 0) hidden.push(`${retryFitCapped.contextHiddenChars} character(s) of the stored context`);
				throw new Error(`consolidation reply was cut off by the model output limit (${fitted.maxTokens} tokens requested), and the retry was not sent because its extra headroom would have hidden ${hidden.join(" and ")} from the model\nRaise maxOutputTokens, or shorten MEMORY.md or CONTEXT.md, and run /memory update again.`);
			}
			if (attempt.stopReason === "max-tokens") {
				const spent = attempt.reasoningTokens > 0 ? `, ${attempt.reasoningTokens} spent on hidden reasoning` : "";
				throw new Error(`consolidation reply was cut off by the model output limit (${usedInput.maxTokens} tokens requested${spent})\n${replyHead(attempt.text, MAX_CONSOLE_REPLY_CHARS)}`);
			}
			throw new Error(`consolidation reply was not a usable JSON object\n${replyHead(attempt.text, MAX_CONSOLE_REPLY_CHARS)}`);
		}
		const renderOf = (reply: ResolvedReply): MemoryRender | undefined =>
			reply.sections === undefined ? undefined : renderMemoryDocument(reply.sections, config.maxMemoryChars);
		let render = renderOf(resolved);
		let loss = memoryLoss(resolved, render, config.maxMemoryChars);
		// Batch Q2's refusal is decided by the reply's shape, not by its size: the guard already knows the
		// reply cannot be merged, so the tier-C retry (which asks for a *smaller* document) would answer a
		// question nobody asked and could replace a refusal that stands on its own.
		let partialRefused = resolved.kind === "unmergeable-partial";
		if (partialRefused) await logError(projectRoot, "memory", partialRefusalMessage(resolved.partialRefusal));
		/**
		 * Tier C: one targeted retry for a reply that was complete but would have been stored lossily,
		 * then a refusal instead of a lossy write if the retry does not fix it.
		 *
		 * The bound is deliberately hard: this is the last model call of the pass, never chained into
		 * another. A retry that is itself cut off, unparseable or still lossy ends the pass — an
		 * unbounded fix-up loop would spend a model call per attempt on a document that cannot fit.
		 * The retry re-sends the input the previous call used, so the only thing that changed between
		 * the two replies is the instruction, and the retry's loss stays attributable to the reply.
		 */
		let memoryLossyRefused = false;
		// A reply with no entries at all is the empty-skeleton gate's case, not tier C's: there is
		// nothing to shrink, and calling it a refusal would name the cap as the blocker when the
		// semantic gate is what stops the write.
		if (loss.retryWorthy && !partialRefused && !replyIsSemanticallyEmpty(resolved, render, existing.text)) {
			// The retry exists to avoid a refusal, not to decide one: the first reply's own loss already
			// says whether it may be stored. A retry that dies for its own reason — a transport error, an
			// unreadable reply — must therefore not erase that decision. Reporting `failed` would hide a
			// refusal this pass had already made, and would throw away a first reply that was storable
			// (a per-item truncation is a loss the pass accepts, so its retry is an improvement only).
			// An abort is the one exception — and only the caller's own signal counts. A stream that
			// merely reports `aborted` reaches this catch with the signal intact (model-call.ts throws
			// that shape without consulting it), so it stays a retry failure like any other; the caller
			// cancelling is different, because carrying on would let it write artifacts after that cancel.
			let retryResolved: ResolvedReply | undefined;
			let retryRender: MemoryRender | undefined;
			let retryApplied: (RetirementResult & { stamped: boolean }) | undefined;
			try {
				const retryAttempt = await call(usedInput, [memoryLossRetryRule(loss.overage, loss.writeCapDroppedChars)], undefined);
				retryResolved = read(retryAttempt, false);
				if (retryResolved !== undefined) {
					const retired = await applyRetirement(retryResolved);
					retryResolved = retired.reply;
					retryApplied = retired.applied;
				}
				retryRender = retryResolved === undefined ? undefined : renderOf(retryResolved);
			} catch (error: unknown) {
				if (options.signal?.aborted) throw error;
				// One line per occurrence, like every other loss: the model call really did fail, and a
				// refusal that follows must not read as if the retry had answered and been too large.
				await logError(projectRoot, "memory", `the targeted loss retry failed for its own reason, so the first reply's loss decides this pass: ${diagnosticMessage(error)}`);
			}
			// Only a retry that actually carries a memory replaces the first reply. One that parses to
			// nothing — an empty stream, or a tool call the JSON-text prompt cannot read — would turn a
			// real but oversized memory into "no new memory", and the semantic-empty gate would then skip
			// the write while the receipt reported a plain update.
			if (retryResolved !== undefined && !replyIsSemanticallyEmpty(retryResolved, retryRender, existing.text)) {
				const retryLoss = memoryLoss(retryResolved, retryRender, config.maxMemoryChars);
				// Ask for a smaller document, but never at the price of the memory: a retry that would be
				// refused does not replace a first reply that would have landed (an entry cut to its
				// per-item cap is a loss this pass accepts).
				// An unmergeable retry is never an improvement: accepting it would replace a storable first
				// reply with one the guard then refuses, turning a landed document into a no-op — and before
				// this condition existed it replaced the store with the partial's own text.
				if (retryResolved.kind !== "unmergeable-partial" && !(retryLoss.refuses && !loss.refuses)) {
					resolved = retryResolved;
					render = retryRender;
					loss = retryLoss;
					// The tombstones must describe the reply that lands, so the first attempt's are dropped
					// here along with its document.
					applied = retryApplied;
				}
			}
			// Either way the refusal is judged on the narrower rule in `memoryLoss`, and on the first
			// reply whenever the retry did not answer at all.
			memoryLossyRefused = loss.refuses;
		}
		// `resolved` cannot become `unmergeable-partial` after the point above: the retry is skipped
		// whenever the first reply was refused, and an unmergeable retry is never accepted in the first
		// place (see the acceptance condition below). That condition is what closes the hole an earlier
		// revision left open — the refusal was decided before tier C, so a retry answering with an
		// unmergeable partial was accepted and written verbatim over the store, status `updated`, with no
		// refusal. The guard is a single owner here rather than a second check after the block.
		const semanticEmpty = replyIsSemanticallyEmpty(resolved, render, existing.text);
		// The gate above owns a reply with no entries; a refusal must not claim the cap stopped it.
		if (semanticEmpty) memoryLossyRefused = false;
		// Batch Q2's report layer, pi's `removedSectionEntries` in shape (batch Z8d strips the entry id
		// before comparing): the sections this pass would write are diffed against the stored ones
		// *before clipping*, so an entry the renderer cuts is not counted as a removal. It reports and
		// never blocks — see that function's own comment.
		let removedEntries: { count: number; samples: string[] } | undefined;
		let restoredEntries: { count: number; samples: string[] } | undefined;
		let unrestoredEntries: { count: number; samples: string[] } | undefined;
		if (!semanticEmpty && !partialRefused) {
			// The baseline is what the model was shown, not the raw store: an entry the retirement pass
			// removed is a deliberate deletion, and reporting it as a regression would misname the cause.
			const oldSections = plan?.sections ?? sectionsFromMarkdown(existing.text);
			if (resolved.sections === undefined) {
				if (existing.text.trim()) await logError(projectRoot, "memory", "memory regression guard skipped: this pass did not produce sections");
			} else if (oldSections === undefined) {
				if (existing.text.trim()) await logError(projectRoot, "memory", "memory regression guard skipped: the stored memory is not a plain four-section bullet document");
			} else {
				// Held in a local so every later read of it describes the document that will land, and so
				// the repair below cannot widen the narrowing this branch already proved.
				let current: MemorySections = resolved.sections;
				// The mechanical half of the loss gate (batch AC). `MEMORY_KEEP_RULE` and
				// `MEMORY_SURVIVAL_CAPTION` already ask for verbatim survival, and three real passes on
				// 2026-11-21 dropped entries anyway, so a dropped entry whose literals vanished with it is
				// put back verbatim. Placement is the design: after tier C (the reply that lands is the one
				// repaired) and after batch Z2's retirement (a tombstone and a repair must never describe
				// the same entry). A repair that does not fit is reported, never traded for another loss.
				if (!memoryLossyRefused) {
					// The retired ids come from batch Z2, not from re-reading the reply: `retireReply`
					// strips the `supersedes:` markers before it returns, so a scan for them here would
					// never see a declaration and would put a replaced entry back (measured on 2026-11-21:
					// the restored line landed next to the tombstone that retired it).
					const retiredIds = new Set([...(plan?.droppedIds ?? []), ...(applied?.droppedIds ?? []), ...(applied?.supersededIds ?? [])]);
					const repair = repairLostEntries(oldSections, current, config.maxMemoryChars, retiredIds);
					if (repair.kind === "restored") {
						current = repair.sections;
						resolved = { ...resolved, sections: repair.sections };
						render = renderOf(resolved);
						loss = memoryLoss(resolved, render, config.maxMemoryChars);
						restoredEntries = { count: repair.entries.length, samples: entrySamples(repair.entries) };
						// A restored line carries the id it always had, so the sidecar prune must keep it:
						// dropping the date would reset a clock only the budget had postponed. The ids are
						// read off the repaired document, not off the entry text, because a partial stamp
						// leaves some entries without a marker and only the document knows which.
						for (const id of documentIds(repair.sections)) applied?.keepIds.add(id);
					} else if (repair.kind === "no-room") {
						unrestoredEntries = { count: repair.entries.length, samples: entrySamples(repair.entries) };
					}
				}
				// Computed here, logged at the write site: a removal claim must describe a document that
				// actually landed, and tier C / the basis-key race are decided later than this point. It
				// reads the repaired sections, so the count names what is still missing, not what was.
				removedEntries = removedSectionEntries(oldSections, current);
			}
		}
		const result: ConsolidationResult = { ...resolved.result, memory: render === undefined ? resolved.result.memory : render.text };
		const version = (nextVersion += 1);
		throttle.set(projectRoot, { session: sessionId, turns, at: Date.now() });
		if (semanticEmpty && existing.text.trim()) {
			// Two shapes land here: a reply with no entries at all (a bare four-heading skeleton, and an
			// opaque reply that is only headings, which is the same thing with the headings lost), and a
			// conversational opaque reply aimed at a store that already holds a document. Writing either
			// would replace a real memory with something that is not one, so the write is skipped
			// outright — and since that is a silent no-op from the outside, it always leaves a diagnostic.
			await logError(projectRoot, "memory", "the consolidation reply was not a writable memory document; the stored memory was kept unchanged");
		}
		if (result.contextUnusable) {
			// Memory still lands, but CONTEXT.md keeps its previous content: say so on every pass, not
			// once per project — a project whose replies keep carrying an unusable context is stale
			// every time, and reporting only the first one leaves the rest silent.
			await logError(projectRoot, "memory", "consolidation reply carried a context whose shape is unusable (summary must be a string and key_points/open_tasks arrays of strings); CONTEXT.md was left unchanged");
		}
		// Batch Z2's record half. A tombstone describes a deletion that only exists once the document
		// lands, so a refused or semantically empty reply carries none: writing one would claim a fact
		// was retired while it is still stored. `ids` is every id the landed document owns — the carried
		// ones and the content-derived ones a partial stamp left without a marker — so the prune removes
		// only entries that are genuinely gone and never resets the clock of one the budget postponed.
		const retirement = !semanticEmpty && !memoryLossyRefused && !partialRefused && (plan !== undefined || applied !== undefined)
			? {
				tombstones: [...(plan?.retired ?? []), ...(applied?.retired ?? [])],
				// Every id the landed document carries that the sidecar does not know yet, dated today —
				// not just the ones this call minted. A document restored from git, or hand-edited with
				// ids of its own, would otherwise carry ids whose age is unknown forever, and an entry
				// with no age can never be unconfirmed.
				added: [...new Set([...(plan?.added ?? []), ...(applied?.added ?? []), ...(applied?.keepIds ?? [])])]
					.filter((tid) => !entryDates.has(tid))
					.map((tid): [string, string] => [tid, today]),
				...(applied === undefined ? {} : { ids: [...applied.keepIds] }),
			}
			: undefined;
		const outcome: ConsolidationOutcome = {
			result,
			...(taskSlug === undefined ? {} : { taskSlug }),
			version,
			basisKey: existing.text,
			shownMemory: promptMemory,
			shownContext: usedInput.contextText,
			kind: resolved.kind,
			semanticEmpty,
			sectionDropped: loss.sectionDropped,
			droppedItems: loss.droppedItems,
			itemTruncated: loss.itemTruncated,
			memoryWriteCapDroppedChars: loss.writeCapDroppedChars,
			memoryLossyRefused,
			maxMemoryChars: config.maxMemoryChars,
			partialRefused,
			...(resolved.partialRefusal === undefined ? {} : { partialRefusal: resolved.partialRefusal }),
			mergedFromStore: resolved.mergedFromStore ?? [],
			...(removedEntries === undefined ? {} : { removedEntries }),
			...(restoredEntries === undefined ? {} : { restoredEntries }),
			...(unrestoredEntries === undefined ? {} : { unrestoredEntries }),
			...(retirement === undefined ? {} : { retirement }),
		};
		lastOutcome.set(projectRoot, { version, at: Date.now(), cap: config.maxMemoryChars, outcome });
		return outcome;
	})().finally(() => {
		// Failures reject; the caller logs them and returns a truthful "failed".
		activeConsolidation.delete(projectKey);
	});

	activeConsolidation.set(projectKey, run);
	return run;
}

export type { ConsolidationOutcome, PartialRefusalReason } from "./consolidate-types.js";
export * from "./prompt.js";
export * from "./reply.js";
