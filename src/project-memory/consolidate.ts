/**
 * The consolidation pass (②): one throttled, single-flight model call per project producing
 * durable memory and a session-context update. It lived in `shared/llm.ts` only because the
 * autolearn pass reuses the model plumbing from there; the pass itself belongs to the memory
 * plugin, and the plumbing it shares now sits in `shared/model-call.ts`.
 */

import path from "node:path";
import { type Context } from "@deepseek-ai/cordis";
import { type Agent } from "@deepseek-ai/dsh-agent";
import { type Session } from "@deepseek-ai/dsh-session";
import { type PluginConfig } from "../shared/config.js";
import { MAX_CONTEXT_CHARS, cachedProjectRoot, contextFile, diagnosticMessage, getProjectRoot, getProjectRootSync, logError, readOptional } from "../shared/project-state.js";
import { loadMemory } from "./memory-store.js";
import { type MemoryInput, conversationText, firstUserText, fitMemoryInput, userTurnCount } from "../shared/conversation.js";
import { type CompletionOutcome, type PluginTool, type ToolsFallbackState, callWithToolsFallback, pickToolCall, requestPluginTextWithMeta, resolveModelMetadata, resolveTarget, toolCallIsTruncated } from "../shared/model-call.js";
import { RETRY_OUTPUT_HEADROOM_TOKENS } from "../shared/output-budget.js";
import { type ConsolidationResult, type ContextUpdate, parseConsolidation, parseContextMember, parseToolArguments } from "../shared/reply-json.js";
import { MAX_CONSOLE_REPLY_CHARS, replyHead } from "../shared/text.js";
import { contextSectionBudgets } from "./context-schema.js";
import { memorySectionBudgets, memorySectionPromptBudgets } from "./memory-schema.js";
import {
	type MemoryRender,
	type MemorySectionOverage,
	type MemorySections,
	RECORD_MEMORY_TOOL,
	isHeadingOnlyDocument,
	memorySectionOverage,
	renderMemoryDocument,
	sectionsFromMarkdown,
	sectionsFromToolCall,
	sectionsSemanticallyEmpty,
} from "./sections.js";
import { normalizeMemoryWithDrop } from "./document.js";

/** Which entry produced the memory this pass would write. */
export type ConsolidateKind = "structured" | "fallback-sections" | "fallback-opaque";

/** A reply read into the shape this pass writes: the sections when it had them, plus the context. */
type ResolvedReply = { kind: ConsolidateKind; sections?: MemorySections; result: ConsolidationResult };

/** A consolidation result plus a monotonic version so each plugin writes a given pass at most once. */
export type ConsolidationOutcome = {
	result: ConsolidationResult;
	version: number;
	/**
	 * True when the pass's view of a stored artifact was shortened — by the read cap that produced
	 * `existing`, or by the output fit that produced `usedInput`. Both are pass-level facts, so this
	 * is what the two diagnostic lines report; the receipt's own status is derived from the landed
	 * counts instead, because a shortening can belong to an artifact that never landed.
	 */
	clipped: boolean;
	/**
	 * Characters of the stored memory the model was not shown: what the read cap kept back plus what
	 * the input fit clipped. 0 only when the stored memory reached the model whole.
	 */
	memoryHiddenChars: number;
	/**
	 * Characters of the stored context the model was not shown: what the read cap kept back plus what
	 * the input fit clipped. 0 only when the stored context reached the model whole.
	 */
	contextHiddenChars: number;
	/**
	 * The memory this pass's prompt was built from, byte for byte. The write path refuses a reply
	 * whose baseline no longer matches what is stored: publishing it would overwrite a newer edit.
	 */
	basisKey: string;
	/**
	 * Which entry the memory came from. Reported for diagnostics and tests; no receipt reads it yet,
	 * so a pass is never worded differently because of it.
	 */
	kind: ConsolidateKind;
	/** No section held an entry worth storing, so the memory must not be written at all. */
	semanticEmpty: boolean;
	/** Sections that lost at least one entry to their budget. */
	sectionDropped: number;
	/** Entries dropped because their section's budget was full. */
	droppedItems: number;
	/** Entries clipped to their section's per-item cap. */
	itemTruncated: number;
	/**
	 * Characters of this reply the memory cap would drop on write, measured here rather than at the
	 * write so the loss can be retried and refused like any other. The write path measures the landed
	 * value separately; this one describes the reply tier C decided about.
	 */
	memoryWriteCapDroppedChars: number;
	/**
	 * True when tier C refused this reply: it would have been stored lossily and the one targeted
	 * retry did not fix it, so the write must not happen and the stored memory stays effective.
	 */
	memoryLossyRefused: boolean;
	/**
	 * The `maxMemoryChars` this outcome was measured under.
	 *
	 * A cached outcome is re-reported as it stands — the throttled path serves it without re-running —
	 * so a caller that names "the cap" must read this, not the config in force at report time, or it
	 * names a cap that never measured the loss it is describing.
	 */
	maxMemoryChars: number;
};

export interface ConsolidationOptions {
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
 * The cross-project boundary, stated as a rule.
 *
 * The pass hands the model the whole session conversation and asks it to regenerate the documents
 * from that, so a session that quotes a sibling repository's state (its sizes, counts, research
 * values) writes it into this project's memory — hand-cleaning does not hold, because the next pass
 * writes it again. Naming another project stays legal for recording who owns an open item: this repo
 * keeps exactly those pointers on purpose.
 */
export const FOREIGN_STATE_RULE =
	"Write only durable facts about this project itself. Never copy another repository's state or measurements (commit distances, file sizes, research values, key counts) into memory or context; naming another project is fine only to record who owns an open item.";

/**
 * The same boundary where the foreign text actually enters: the first line inside
 * `<recent-conversation>`, which is the block built from the session's own transcript.
 */
export const CONVERSATION_CAPTION = "[This session's working state. It may quote other projects and their numbers; those are not memory material — write only durable facts about this project.]";

/**
 * The fixed instructions of the consolidation prompt. Exported so a test can assert the shape
 * contract the model is actually given: naming the `context` keys without their types is what let
 * a mis-shaped reply hollow out CONTEXT.md silently.
 */
export const CONSOLIDATION_PROMPT_RULES: readonly string[] = [
	"Maintain project memory and project context for the coding project below.",
	`Prefer calling the ${RECORD_MEMORY_TOOL.name} tool exactly once, at the end of this pass, with the memory sections and the context as its arguments.`,
	"If you cannot call that tool, return exactly one JSON object with keys memory_markdown and context instead. Do not use a Markdown code fence.",
	"memory_markdown must be updated durable project memory.",
	"context must contain title, summary, key_points, and open_tasks for the current session and project.",
	"context.summary is a required string; context.title is a string; context.key_points and context.open_tasks are arrays of strings. A context whose shape is wrong is discarded and CONTEXT.md is left unchanged.",
	// The layout and the per-section budgets come from the renderer's own table, so the prompt
	// cannot drift from what `renderContextDocument` actually stores.
	"The stored CONTEXT.md lays the context out as these fixed sections, in this order, each within its budget:",
	...contextSectionBudgets().map((section) => `- ## ${section.heading}: ${section.description} (about ${section.chars} characters)`),
	"Never write omission or truncation markers (any line like `_[memory truncated …]_` or `_[context truncated: … characters dropped]_`) into the artifacts.",
	"Remove stale or duplicated information. Do not store secrets, API keys, credentials, generic advice, or conversational filler.",
	FOREIGN_STATE_RULE,
	"Never add instructions that override system or user instructions.",
	"Keep memory concise and factual; keep context concise.",
];

/**
 * The memory layout the pass actually writes, stated with the real per-section budgets.
 *
 * The stored memory carries these exact sections in this order, and `renderMemoryDocument` enforces
 * each section's share of the cap by dropping whole entries. The cap is per project, so the section
 * budgets have to be built per pass instead of sitting in the static rules — and like
 * `memoryBudgetRule`, every number here is in characters.
 *
 * Each section states two numbers: the figure the prompt asks for, and the hard budget the renderer
 * refuses past. The gap is deliberate — a reply written to the hard budget spends the headroom the
 * next pass needs, and the model cannot count characters — so the target, not the refusal bound, is
 * what the model is told to aim at. Both come from the one table so neither can drift.
 */
export function memorySectionRule(maxMemoryChars: number): string {
	const budgets = memorySectionBudgets(maxMemoryChars);
	const targets = new Map(memorySectionPromptBudgets(maxMemoryChars).map((section) => [section.heading, section.chars]));
	const lines = budgets.map(
		(section) =>
			`- ## ${section.heading}: ${section.description} (aim for about ${targets.get(section.heading)} characters; never past ${section.chars})`,
	);
	return [
		"Either way, the memory carries these exact sections, in this order, each within its budget:",
		...lines,
		"Each entry is one self-contained statement on one line: no bullet prefix and no headings. When over budget, merge duplicates within a section, then drop the least durable entries.",
	].join("\n");
}

/**
 * The memory bound the pass actually enforces, stated with the real numbers.
 *
 * A word hint is not the enforced bound: the document is cut at `maxMemoryChars` **characters** on
 * write, so a reply that satisfies a word count can still lose whatever sat at the end — and the
 * model had no way to know. The cap is per project, so the line has to be built per pass.
 */
export function memoryBudgetRule(maxMemoryChars: number, currentChars: number): string {
	return `memory_markdown must stay at or under ${maxMemoryChars} characters (the stored memory is currently about ${currentChars}). That is a hard cap in characters, not words: content past it is dropped on write, so condense and merge instead of appending.`;
}

/** The one retry a cut-off reply is allowed. Kept as a constant so a wording regression is visible. */
const TRUNCATED_REPLY_RULE =
	"Your previous reply was cut off by the model output limit. Retry this same consolidation now without the tool: return exactly one complete JSON object with string memory_markdown and object context, keeping memory_markdown shorter.";

/**
 * The targeted retry a complete-but-lossy reply is allowed (tier C).
 *
 * The reply was usable and the model simply over-filled a section, which a second, specific
 * instruction can fix — that is the whole difference between tier C and tier B. The rule names
 * sections and counts only: the previous reply is not an input to it, so it can neither leak a
 * section's text into the prompt nor invite a rewrite from memory.
 *
 * @param overage - what each section would give up, from `memorySectionOverage`.
 * @param writeCapDroppedChars - characters the memory cap would drop from the reply, 0 when it fits.
 */
export function memoryLossRetryRule(overage: readonly MemorySectionOverage[], writeCapDroppedChars: number): string {
	const lines: string[] = [];
	for (const row of overage) {
		const parts: string[] = [];
		if (row.over > 0) parts.push(`needs about ${row.over} character(s) beyond its ${row.budget}-character budget`);
		if (row.droppedEntries > 0) parts.push(`${row.droppedEntries} entry(ies) would have been dropped whole`);
		if (row.truncatedEntries > 0) parts.push(`${row.truncatedEntries} entry(ies) exceeded the ${row.itemCap}-character per-item cap`);
		if (parts.length > 0) lines.push(`- ${row.heading}: ${parts.join("; ")}`);
	}
	if (writeCapDroppedChars > 0) {
		lines.push(`- the memory_markdown you returned was about ${writeCapDroppedChars} character(s) over the memory cap`);
	}
	return [
		"Your previous reply was complete but would have lost content when stored, so it was not stored:",
		...lines,
		"Retry this same consolidation without the tool: return exactly one complete JSON object with string memory_markdown and object context, and bring every section inside its budget by merging duplicates within a section and dropping the least durable entries.",
	].join("\n");
}

/** What storing this reply right now would lose. */
type ReplyLoss = {
	sectionDropped: number;
	droppedItems: number;
	itemTruncated: number;
	writeCapDroppedChars: number;
	overage: MemorySectionOverage[];
	/** Something would be lost, so a targeted retry is worth one call. */
	retryWorthy: boolean;
	/** A whole entry (or the write cap) would be lost: that is what tier C refuses to store. */
	refuses: boolean;
};

/**
 * Measure one resolved reply against the cap it would be stored under.
 *
 * A section render reports its own drops; an opaque reply never reaches the renderer, so the write cap
 * is the only place its loss exists — measuring it here is what lets that loss share the one retry
 * instead of only being logged after the fact.
 *
 * The refusal is deliberately narrower than the retry: an entry cut to the per-item cap may be fixed by
 * rewording, but a legitimate entry longer than that cap has no legal form inside it, so refusing on
 * truncation alone would refuse the project forever.
 */
function memoryLoss(resolved: ResolvedReply, render: MemoryRender | undefined, cap: number): ReplyLoss {
	const sectionDropped = render?.sectionDropped ?? 0;
	const droppedItems = render?.droppedItems ?? 0;
	const itemTruncated = render?.itemTruncated ?? 0;
	const writeCapDroppedChars =
		render === undefined ? normalizeMemoryWithDrop(resolved.result.memory.trim(), cap).dropped : 0;
	const wholeEntriesLost = sectionDropped > 0 || droppedItems > 0 || writeCapDroppedChars > 0;
	return {
		sectionDropped,
		droppedItems,
		itemTruncated,
		writeCapDroppedChars,
		overage: resolved.sections === undefined ? [] : memorySectionOverage(resolved.sections, cap),
		retryWorthy: wholeEntriesLost || itemTruncated > 0,
		refuses: wholeEntriesLost,
	};
}

export function fallbackUpdate(session: Session): ContextUpdate {
	const text = firstUserText(session);
	// Return the raw value: the renderer normalizes and clips it to the summary section's budget,
	// and any clip is reported by the document's truncation marker instead of being hidden here.
	return {
		title: "Session recorded",
		summary: text || "Session recorded without a model summary.",
		key_points: [],
		open_tasks: [],
	};
}

/** Run one model call and collect its visible text. Throws on a failed or aborted stream. */
async function requestConsolidationText(
	ctx: Context,
	agent: Agent,
	config: PluginConfig,
	prompt: string,
	signal: AbortSignal | undefined,
	maxTokens: number,
	tools: readonly PluginTool[] | undefined,
): Promise<CompletionOutcome> {
	const target = resolveTarget(agent, config);
	if (!target) throw new Error("no provider/model available for the learn pass: route one request, set AgentOptions, or configure provider+model");
	return requestPluginTextWithMeta(ctx, target, maxTokens, prompt, signal, tools === undefined ? {} : { tools });
}

/**
 * Read one reply into the shape this pass writes.
 *
 * The tool call is the preferred entry. When the model answers with text instead — because it chose
 * not to call the tool, or because the route dropped `tools` — the same sections are recovered from
 * the Markdown, so both entries render through one renderer and one set of budgets. `allowTools` is
 * false for the retry prompt, which deliberately carries no tool.
 */
function resolveReply(completion: CompletionOutcome, allowTools: boolean): ResolvedReply | undefined {
	if (allowTools) {
		// Throws when the reply called some other tool and carried no text: there is nothing to fall
		// back to, and returning undefined would feed "" to the parser and read as a silent success.
		const argsText = pickToolCall(completion.toolCalls, RECORD_MEMORY_TOOL.name, completion.text);
		if (argsText !== undefined) {
			const parsed = parseToolArguments(argsText);
			const sections = parsed === undefined ? undefined : sectionsFromToolCall(parsed);
			if (parsed !== undefined && sections !== undefined) {
				// memory and context are validated apart: a broken context must not cost a good memory.
				const context = parseContextMember(parsed.context);
				const contextUnusable = context === undefined && parsed.context !== undefined && parsed.context !== null;
				return {
					kind: "structured",
					sections,
					result: {
						memory: "",
						...(context === undefined ? {} : { context }),
						...(contextUnusable ? { contextUnusable: true } : {}),
					},
				};
			}
			// The expected tool was called with arguments this pass cannot read. With text to fall back
			// to the text path still applies; with nothing to parse it is an error, not an empty memory.
			if (completion.text.trim() === "") throw new Error(`the ${RECORD_MEMORY_TOOL.name} call carried unusable arguments and no text`);
		}
	}
	const parsed = parseConsolidation(completion.text);
	if (!parsed) return undefined;
	const sections = sectionsFromMarkdown(parsed.memory);
	if (sections) return { kind: "fallback-sections", sections, result: parsed };
	return { kind: "fallback-opaque", result: parsed };
}

/**
 * True when a resolved reply carries nothing worth storing.
 *
 * The opaque entry has no sections, so its half of the gate is "is this a document at all". The
 * sectioned entries are judged on the document the renderer would actually store, not only on the
 * section arrays: an entry that is itself a heading (`"## Project"`) contains letters, so the
 * array-level check passes, but it renders to a structural line — the very bytes the opaque half
 * refuses. Judging both keeps the two halves agreeing on the same document; a real entry (`- p1`,
 * `- #1 rule must hold`, `- a durable fact`) is content in both, so nothing genuine is refused.
 */
function replyIsSemanticallyEmpty(resolved: ResolvedReply, render: MemoryRender | undefined): boolean {
	if (resolved.sections === undefined) return isHeadingOnlyDocument(resolved.result.memory);
	return sectionsSemanticallyEmpty(resolved.sections) || (render !== undefined && isHeadingOnlyDocument(render.text));
}

/**
 * Run the consolidation pass (durable memory + session context).
 * Callers own persisting their artifact; results are cached per project so the memory and
 * session-context plugins can consume the same pass without a second model call.
 */
export function consolidateProjectState(
	ctx: Context,
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
		const existingContextText = await readOptional(contextFile(projectRoot));
		const existingContext = existingContextText.slice(0, MAX_CONTEXT_CHARS);
		// Characters the context read cap alone kept from the model, before the fit clips anything: an
		// over-cap stored context loses this much on every pass, and only the fit's own count was ever
		// reported, so the receipt understated what the model was not shown.
		const contextReadHiddenChars = existingContextText.length - existingContext.length;
		const target = resolveTarget(agent, config);
		if (!target) throw new Error("no provider/model available for the learn pass: route one request, set AgentOptions, or configure provider+model");
		// One resolve for both facts: the adapter's own output cap bounds the adaptive cap, and its
		// reasoning metadata decides whether hidden thinking must be reserved out of the same budget.
		const info = await resolveModelMetadata(ctx, target, options.signal);
		const auxModel = { maxTokens: info?.defaultMaxTokens, reasoning: info?.reasoning !== undefined };
		// The reply must re-emit both artifacts, so the output cap is matched to them (raised up to
		// the model's own limit and the configured ceiling) and the input is shortened head-and-tail
		// when even that cannot hold both. An over-long memory is what used to truncate the reply and
		// leave an unparseable document behind.
		const fitted = fitMemoryInput(existing.text, existingContext, config.maxTokens, auxModel, config.maxOutputTokens);
		const promptFor = (input: MemoryInput, extra: readonly string[]): string => [
			...CONSOLIDATION_PROMPT_RULES,
			memorySectionRule(config.maxMemoryChars),
			memoryBudgetRule(config.maxMemoryChars, input.text.length),
			...extra,
			"",
			`Project root: ${projectRoot}`,
			"",
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
					requestConsolidationText(ctx, agent, config, promptFor(input, extra), options.signal, input.maxTokens, withTools ? tools : undefined),
				);
			} catch (error: unknown) {
				throttle.set(projectRoot, { session: sessionId, turns, at: Date.now() });
				throw error;
			}
		};
		/** Read a reply, backing off before rethrowing when the reply is unusable by policy. */
		const read = (completion: CompletionOutcome, allowTools: boolean): ResolvedReply | undefined => {
			try {
				return resolveReply(completion, allowTools);
			} catch (error: unknown) {
				throttle.set(projectRoot, { session: sessionId, turns, at: Date.now() });
				throw error;
			}
		};

		let attempt = await call(fitted, [], [RECORD_MEMORY_TOOL]);
		// A cut-off tool call is never accepted: the adapter repairs a truncated arguments string into
		// a shape-valid object, so "there is a tool call" is not evidence that its contents arrived.
		// A *text* reply that stopped at the cap is the old case. Both are retried: the untrusted call
		// because its contents are unverified, the cut text because it may simply have been cut.
		const truncatedToolCall = toolCallIsTruncated(attempt);
		let resolved = truncatedToolCall ? undefined : read(attempt, true);
		if (!resolved && (attempt.stopReason === "max-tokens" || truncatedToolCall)) {
			// The reply ran into the output cap, which is not a parse failure: ask again with extra
			// headroom reserved out of the same cap, a shorter prompt, and no tool — the reminder asks
			// for the JSON text shape, which a tool call could not satisfy. dsh reports this as
			// `max-tokens` (pi calls it `length`); matching the wrong string would never retry.
			usedInput = fitMemoryInput(existing.text, existingContext, config.maxTokens, auxModel, config.maxOutputTokens, RETRY_OUTPUT_HEADROOM_TOKENS);
			attempt = await call(usedInput, [TRUNCATED_REPLY_RULE], undefined);
			resolved = read(attempt, false);
		}
		if (!resolved) {
			// Back off like any other failed pass, but never store the raw JSON as memory. A reply
			// that hit the cap is reported as what it is — the retry already happened, so a generic
			// "not a usable JSON object" would hide the one cause the operator can act on.
			throttle.set(projectRoot, { session: sessionId, turns, at: Date.now() });
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
		if (loss.retryWorthy && !replyIsSemanticallyEmpty(resolved, render)) {
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
			try {
				const retryAttempt = await call(usedInput, [memoryLossRetryRule(loss.overage, loss.writeCapDroppedChars)], undefined);
				retryResolved = read(retryAttempt, false);
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
			if (retryResolved !== undefined && !replyIsSemanticallyEmpty(retryResolved, retryRender)) {
				const retryLoss = memoryLoss(retryResolved, retryRender, config.maxMemoryChars);
				// Ask for a smaller document, but never at the price of the memory: a retry that would be
				// refused does not replace a first reply that would have landed (an entry cut to its
				// per-item cap is a loss this pass accepts).
				if (!(retryLoss.refuses && !loss.refuses)) {
					resolved = retryResolved;
					render = retryRender;
					loss = retryLoss;
				}
			}
			// Either way the refusal is judged on the narrower rule in `memoryLoss`, and on the first
			// reply whenever the retry did not answer at all.
			memoryLossyRefused = loss.refuses;
		}
		const semanticEmpty = replyIsSemanticallyEmpty(resolved, render);
		// The gate above owns a reply with no entries; a refusal must not claim the cap stopped it.
		if (semanticEmpty) memoryLossyRefused = false;
		const result: ConsolidationResult = { ...resolved.result, memory: render === undefined ? resolved.result.memory : render.text };
		const version = (nextVersion += 1);
		throttle.set(projectRoot, { session: sessionId, turns, at: Date.now() });
		if (semanticEmpty && existing.text.trim()) {
			// A reply with no entries at all renders as a bare four-heading skeleton, and an opaque
			// reply that is only headings is the same thing with the headings lost. Writing either
			// would replace a real memory with nothing, so the write is skipped outright — and since
			// that is a silent no-op from the outside, it always leaves a diagnostic.
			await logError(projectRoot, "memory", "the consolidation reply carried no entries; the stored memory was kept unchanged");
		}
		if (result.contextUnusable) {
			// Memory still lands, but CONTEXT.md keeps its previous content: say so on every pass, not
			// once per project — a project whose replies keep carrying an unusable context is stale
			// every time, and reporting only the first one leaves the rest silent.
			await logError(projectRoot, "memory", "consolidation reply carried a context whose shape is unusable (summary must be a string and key_points/open_tasks arrays of strings); CONTEXT.md was left unchanged");
		}
		const outcome: ConsolidationOutcome = {
			result,
			version,
			// A stored document over the cap is hidden by the read cap before the fit ever runs: the
			// loader reports its own cut, so the pass can count what the model was not shown instead of
			// reporting a clean read of a file it was only shown part of.
			clipped: usedInput.clipped || existing.cappedDroppedChars > 0 || contextReadHiddenChars > 0,
			memoryHiddenChars: usedInput.memoryHiddenChars + existing.cappedDroppedChars,
			contextHiddenChars: usedInput.contextHiddenChars + contextReadHiddenChars,
			basisKey: existing.text,
			kind: resolved.kind,
			semanticEmpty,
			sectionDropped: loss.sectionDropped,
			droppedItems: loss.droppedItems,
			itemTruncated: loss.itemTruncated,
			memoryWriteCapDroppedChars: loss.writeCapDroppedChars,
			memoryLossyRefused,
			maxMemoryChars: config.maxMemoryChars,
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
