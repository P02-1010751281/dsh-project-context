/**
 * The pass itself: one throttled, single-flight distillation per project.
 */

import path from "node:path";
import { type Context } from "@deepseek-ai/cordis";
import { type Agent } from "@deepseek-ai/dsh-agent";
// Type-only: pulls the llm service Context merge (ctx.llm.resolveModelInfo) for this module.
import type {} from "@deepseek-ai/dsh-llm";
import { type PluginConfig } from "../shared/config.js";
import { userTurnCount } from "../shared/conversation.js";
import { type CompletionOutcome, type ToolsFallbackState, callWithToolsFallback, pickToolCall, requestPluginTextWithMeta, resolveModelMetadata, resolveTarget, toolCallIsTruncated } from "../shared/model-call.js";
import { parseToolArguments } from "../shared/reply-json.js";
import { REPLY_OUTPUT_MARGIN_TOKENS, adaptiveOutputTokens, reasoningReserveTokens } from "../shared/output-budget.js";
import { MAX_CONTEXT_CHARS, MAX_SKILL_BODY_CHARS, cachedProjectRoot, contextFile, fileMtimeMs, getProjectRoot, getProjectRootSync, logError, logsDir, memoryFile, readOptional, safeSessionId } from "../shared/project-state.js";
import { loadMemory } from "../project-memory/memory-store.js";
import { readArchivedConversation } from "../project-context/archive.js";
import { readSessionIndex } from "../project-context/session-index.js";
import { readLearnState, updateLearnState } from "./learn-state.js";
import { saveProposedSkill } from "./candidate.js";
import { archivedSessionIds, collectSkillInventory, inventoryText, learnedBodiesText } from "./inventory.js";
import { type AutolearnDecision, parseAutolearnReply, parseAutolearnToolCall } from "./parse.js";
import { backtrackPrompt, basePrompt } from "./prompt.js";
import { RECORD_SKILL_TOOL } from "./schema.js";
import { type LearnedSkill } from "./skill.js";

export interface AutolearnOptions {
	force?: boolean;
	signal?: AbortSignal;
}

export interface AutolearnOutcome {
	skill: LearnedSkill | null;
	/** Archived session ids read during backtracking (empty when memory/context sufficed). */
	backtracked: string[];
	/** True when `skill` was stored as a candidate awaiting `/autolearn approve`. */
	candidate: boolean;
	/**
	 * Why the model's proposal was not written, when there was one and the admission rules refused
	 * it (e.g. `body too short`). `undefined` means the model proposed nothing at all.
	 *
	 * The two used to be indistinguishable — `{skill: null, backtracked: [], candidate: false}` for
	 * both — so `/autolearn` told the user "No new skill was warranted." after a paid model call
	 * that had in fact *returned a skill* the plugin rejected on a size/evidence rule. That sends
	 * the user to re-prompt a model that already answered.
	 */
	rejected?: string | undefined;
	/**
	 * Why no model call was made, when the pass declined to run one (a pass ran moments ago, there is
	 * no memory/context to learn from, or no archived session grounds a skill).
	 *
	 * Without this, those paths returned the same `{skill: null, backtracked: [], candidate: false}`
	 * as "the model answered and proposed nothing", so a reply that talks about what the model did
	 * would be *false* here — the model was never asked. Kept separate from `rejected`, which means
	 * the model *did* answer and an admission rule refused its proposal.
	 */
	skipped?: string | undefined;
}

const MAX_BACKTRACK_CHARS = 16_000;

const MAX_INDEX_ENTRIES = 50;

type AutolearnState = { session: string; sessionTurns: number; turns: number; at: number };

/** Single-flight per cwd: concurrent callers join the same pass. */
const activeAutolearn = new Map<string, Promise<AutolearnOutcome | undefined>>();

const throttle = new Map<string, AutolearnState>();

/**
 * Run one autolearn pass. Automatic runs require new material (MEMORY.md or
 * CONTEXT.md touched since the last pass) plus one open cadence gate (turn
 * count across sessions or wall-clock interval). Commands force the pass.
 */
export function autolearnProjectSkills(
	ctx: Context,
	agent: Agent,
	config: PluginConfig,
	options: AutolearnOptions = {},
): Promise<AutolearnOutcome | undefined> {
	const cwd = path.resolve(agent.session.header.cwd ?? process.cwd());
	// Claim by project root, not cwd: one project shares a single pass.
	const projectKey = cachedProjectRoot(cwd) ?? getProjectRootSync(cwd);
	const claimed = activeAutolearn.get(projectKey);
	if (claimed) return claimed;

	const run = (async (): Promise<AutolearnOutcome | undefined> => {
		const force = options.force ?? false;
		const projectRoot = await getProjectRoot(cwd);
		const session = agent.session;
		const sessionId = String(session.id);
		const turns = userTurnCount(session);
		const previous = throttle.get(projectRoot);
		const baseline = previous?.session === sessionId ? previous.sessionTurns : 0;
		const totalTurns = (previous?.turns ?? 0) + Math.max(0, turns - baseline);
		// Both gates are stored in the project, so they survive a process restart: without them the
		// material and interval gates restart from zero and re-run a pass over memory that was
		// already distilled. The in-process record still covers what a restart cannot know about —
		// skips and failures — so a failed pass backs off instead of retrying on every idle.
		const persisted = await readLearnState(projectRoot);
		const gateAt = persisted.autolearnAt;
		const attemptAt = Math.max(persisted.lastAttemptAt, previous?.at ?? 0);
		// The material stamp the gate compares against, read before any model call, so a memory or
		// context write landing *during* the pass stays newer than the recorded gate and re-opens it.
		const stamp = Math.max(await fileMtimeMs(memoryFile(projectRoot)), await fileMtimeMs(contextFile(projectRoot)));

		if (force && Date.now() - attemptAt < config.forceDedupeMs) return { skill: null, backtracked: [], candidate: false, skipped: "a pass ran moments ago; no model call was made" };

		if (!force) {
			// New material is required; otherwise only remember the turn counter. The material check
			// compares against the persisted gate alone — comparing against the last attempt would
			// hide a write that landed while that attempt was still running. The interval check uses
			// the separate attempt timestamp, so a restart cannot make it look long overdue.
			const changed = stamp > gateAt;
			const due = totalTurns >= config.autolearnTurns || Date.now() - attemptAt >= config.autolearnIntervalMs;
			if (!changed || !due) {
				throttle.set(projectRoot, { session: sessionId, sessionTurns: turns, turns: totalTurns, at: attemptAt });
				return undefined;
			}
		}

		const memory = await loadMemory(projectRoot, config.maxMemoryChars);
		// Report an unreadable source instead of silently distilling from an empty memory.
		if (memory.unreadable) await logError(projectRoot, "memory", `project memory exists but cannot be read: ${memory.source}`);
		else if (memory.damaged) await logError(projectRoot, "memory", `memory journal has ${memory.damaged} unusable line(s); they were skipped`);
		const contextText = (await readOptional(contextFile(projectRoot))).slice(0, MAX_CONTEXT_CHARS);
		if (!memory.text.trim() && !contextText.trim()) return { skill: null, backtracked: [], candidate: false, skipped: "the project has no memory or context to learn from; no model call was made" };

		/** Set once the pass is recorded, so a later failure does not resurrect the turn counter. */
		let recorded = false;
		try {
			const index = await readSessionIndex(projectRoot);
			const indexText = index.slice(-MAX_INDEX_ENTRIES).map((entry) => `- ${entry.id} — ${entry.date} — ${entry.title}`).join("\n");
			const target = resolveTarget(agent, config);
			if (!target) throw new Error("no provider/model available for the autolearn pass: route one request, set AgentOptions, or configure provider+model");
			const inventory = await collectSkillInventory(projectRoot);
			const skillsText = inventoryText(inventory);
			// The learned skills' own bodies travel too: without them a reuse of a learned name would
			// be a blind rewrite instead of a merge.
			const learnedText = learnedBodiesText(inventory);
			// A skill body can be as large as MAX_SKILL_BODY_CHARS; ask for enough output room
			// (1 token per char worst case), plus a reserve for hidden reasoning on a reasoning
			// route, where thinking shares the same output cap as the body and would otherwise cut
			// the JSON off mid-string. Bounded by the model's own limit and the configured ceiling.
			// The ceiling stays a *growth* boundary (`Math.max` inside `adaptiveOutputTokens`), not a
			// hard cap: the configured maxTokens remains the base budget.
			const info = await resolveModelMetadata(ctx, target, options.signal);
			const maxTokens = adaptiveOutputTokens(
				config.maxTokens,
				MAX_SKILL_BODY_CHARS + REPLY_OUTPUT_MARGIN_TOKENS + reasoningReserveTokens(MAX_SKILL_BODY_CHARS, { reasoning: info?.reasoning !== undefined }),
				{ maxTokens: info?.defaultMaxTokens },
				config.maxOutputTokens,
			);
			// Evidence is a file on disk, not a line in the index: an indexed session whose log
			// is gone is not evidence, and a hallucinated id must not become a verified citation.
			const archived = await archivedSessionIds(projectRoot);
			// A live skill needs two verified sessions and a candidate needs one, so an automatic
			// pass in a project with no archive at all can never produce either: skip before
			// spending a model call on it. A forced pass (`/autolearn`) still runs, because the
			// command is the user asking for the call.
			if (archived.size === 0 && !force) return { skill: null, backtracked: [], candidate: false, skipped: "no archived session grounds a new skill; no model call was made" };

			/**
			 * The pass's own tools switch: `ask()` runs twice when the first decision asks for archives
			 * and the pass backtracks, and once a route has refused the `tools` parameter it must not be
			 * offered them again.
			 */
			const toolsState: ToolsFallbackState = {};

			/** One decision call. `withTools` is false for the retry, which asks for the text shape. */
			const call = (prompt: string, withTools: boolean): Promise<CompletionOutcome> =>
				callWithToolsFallback(toolsState, withTools, (useTools) =>
					requestPluginTextWithMeta(ctx, target, maxTokens, prompt, options.signal, useTools ? { tools: [RECORD_SKILL_TOOL] } : {}),
				);

			/** Read one reply: the tool call first, the text JSON shape second. */
			const decideFrom = (completion: CompletionOutcome, allowTools: boolean): AutolearnDecision | undefined => {
				if (allowTools) {
					// Throws when the reply called another tool and carried no text: that is an error, not a
					// decision, and returning one would hide it behind "the model proposed nothing".
					const argsText = pickToolCall(completion.toolCalls, RECORD_SKILL_TOOL.name, completion.text);
					if (argsText !== undefined) {
						const parsed = parseToolArguments(argsText);
						const fromTool = parsed === undefined ? undefined : parseAutolearnToolCall(parsed);
						if (fromTool !== undefined) return fromTool;
						// The expected tool was called with arguments this pass cannot read and left no text:
						// an error, not "the model returned nothing".
						if (completion.text.trim() === "") throw new Error(`the ${RECORD_SKILL_TOOL.name} call carried unusable arguments and no text`);
					}
				}
				return parseAutolearnReply(completion.text);
			};

			/** The fail-soft text path's value for a reply that carried no readable decision. */
			const NOTHING_PROPOSED: AutolearnDecision = { skill: null, needSessions: [] };

			/**
			 * One decision attempt. A reply cut off at the output cap is never accepted when it carries a
			 * tool call: the adapter repairs a truncated arguments string into a shape-valid object, so a
			 * repaired call would store a half-written skill body as if it were complete.
			 *
			 * The **text** half is different, and this pass no longer discards the whole reply to protect
			 * it. `parseAutolearnReply` reports whether the reply's JSON object parsed at all, and a cut
			 * reply that parsed closed its object before the cut, so every member was emitted whole — a
			 * raw `JSON.parse` cannot accept a half-written value (probe over every cut point of three
			 * reply shapes: `.agents/evidence/2026-10-05-autolearn-cut-parse-probe/`, no cut ever parsed
			 * into a partial body). So a cut reply is accepted when it parsed and re-asked when it did
			 * not, which keeps the fail-soft trap closed — reading an *unreadable* cut reply as
			 * `{skill: null}` would report a truncated answer as "no skill was warranted" — without
			 * spending a second call on a decision that already arrived complete.
			 * `test/autolearn.test.mjs` pins both halves: the unreadable cut is retried, the parseable
			 * one is not.
			 */
			const ask = async (prompt: string): Promise<AutolearnDecision> => {
				const completion = await call(prompt, true);
				if (!toolCallIsTruncated(completion)) {
					const decision = decideFrom(completion, true);
					if (completion.stopReason !== "max-tokens" || decision !== undefined) return decision ?? NOTHING_PROPOSED;
				}
				const retryPrompt = `${prompt}\n\nYour previous response was cut off by the output limit. Retry this same decision now without the tool: return exactly one complete JSON object, condensing the skill body so it fits; no prose, Markdown code fence, ellipsis, or unfinished value.`;
				return decideFrom(await call(retryPrompt, false), false) ?? NOTHING_PROPOSED;
			};

			const first = await ask(basePrompt(projectRoot, memory.text, contextText, indexText, skillsText, learnedText));
			// Record the gate at the material stamp this pass actually distilled: a newer write is
			// then still newer than the gate, so a pass that ran while consolidation was writing
			// re-opens on the next idle instead of masking that memory until it is written again.
			// The attempt time is recorded separately, so the interval gate still measures from the
			// pass and not from whenever the material was last touched.
			const recordedAt = Date.now();
			recorded = true;
			await updateLearnState(projectRoot, { autolearnAt: stamp, lastAttemptAt: recordedAt });
			throttle.set(projectRoot, { session: sessionId, sessionTurns: turns, turns: 0, at: recordedAt });

			let skill = first.skill;
			const backtracked: string[] = [];

			if (!skill && first.needSessions.length > 0) {
				const extracts: string[] = [];
				for (const id of first.needSessions) {
					const safe = safeSessionId(id);
					if (!archived.has(safe)) continue;
					// dsh's session.md prints every event with its stream payloads; read the
					// canonical JSONL and render a message-level transcript instead.
					const text = (await readArchivedConversation(path.join(logsDir(projectRoot), safe, "session.jsonl"), MAX_BACKTRACK_CHARS)).trim();
					if (!text) continue;
					backtracked.push(safe);
					extracts.push(`## session ${safe}\n\n${text}`);
				}
				// Every requested id was missing or empty: that is the same as "no evidence" —
				// no second call, and the first look's `null` skill stands.
				if (extracts.length > 0) {
					skill = (await ask(backtrackPrompt(projectRoot, memory.text, skillsText, extracts.join("\n\n"), learnedText))).skill;
				}
			}

			let learned: LearnedSkill | null = null;
			let candidate = false;
			let rejected: string | undefined;
			if (skill) {
				const saved = await saveProposedSkill(projectRoot, skill, archived);
				if (typeof saved === "string") {
					learned = { name: skill.name, description: skill.description, body: skill.body };
					candidate = saved === "candidate";
				} else {
					// The model *did* propose this skill; an admission rule refused it. Carrying the
					// reason out is the difference between "nothing was warranted" and "your proposal
					// was rejected because its body was too short".
					rejected = saved.rejected;
				}
			}
			// `rejected` is only attached when there is one, so an outcome that carries no refusal
			// keeps the historical `{skill, backtracked, candidate}` shape (and its `deepEqual`
			// assertions) byte for byte.
			return rejected === undefined
				? { skill: learned, backtracked, candidate }
				: { skill: learned, backtracked, candidate, rejected };
		} catch (error: unknown) {
			// Record the attempt so a persistent failure backs off instead of retrying on every
			// idle. The persisted gate stays untouched, so a crash before the first model call
			// re-runs the pass; once the pass is recorded, the reset counter stays reset.
			if (!recorded) throttle.set(projectRoot, { session: sessionId, sessionTurns: turns, turns: totalTurns, at: Date.now() });
			throw error;
		}
	})().catch((error: unknown) => {
		ctx.logger.warn("dsh-project-context: autolearn pass failed: %s", error instanceof Error ? error.message : String(error));
		return undefined;
	}).finally(() => {
		activeAutolearn.delete(projectKey);
	});

	activeAutolearn.set(projectKey, run);
	return run;
}
