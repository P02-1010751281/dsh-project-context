/**
 * One handoff transaction, in order: summarize, persist `HANDOFF.md`, seed the child,
 * publish the switch marker. The seed happens before the marker, and the document is
 * written last, so an abandoned attempt leaves nothing behind in the project.
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import { type Context } from "@deepseek-ai/cordis";
import { type LlmResolvedModelInfo } from "@deepseek-ai/dsh-llm";
import { type Session } from "@deepseek-ai/dsh-session";
import { type PluginConfig } from "../shared/config.js";
import { getProjectRoot, logsDir, memoryDir, safeSessionId, sessionIndexFile, writeAtomic } from "../shared/project-state.js";
import { loadMemory } from "../project-memory/memory-store.js";
import { type HandoffLanguage, localizeSummaryHeadings } from "./language.js";
import { HANDOFF_TITLE_PREFIX } from "./marker.js";
import { abandonChild, carryModelSelection, carryPermissionPreset, createChildSession } from "./child.js";
import { transientIfRetryable } from "./classify.js";
import { CHARS_PER_TOKEN, type HandoffSplit, fileOperations, handoffSplit, pendingQuestionFor, resolveHandoffLanguage } from "./conversation.js";
import { assertSessionSettled } from "./guard.js";
import { type SessionControllerLike } from "./runtime.js";
import { handedOff } from "./state.js";
import { continuation, handoffPrompt, renderHandoff, resolveSummaryEffort, summarize, withTimeout } from "./summary.js";

/**
 * The two language-dependent artifacts of one handoff: the `HANDOFF.md` document and the child's
 * first message. The summary headings are normalized to the resolved language here, so the stored
 * document and the seed prompt can never disagree about it. Exported so a test can pin the wiring
 * (the resolved language and the pending-question carry) rather than only the pure helpers.
 * @param args - session, resolved language, the raw model summary, archive pointers and the tail.
 * @returns the document to persist and the prompt to admit to the child.
 */
export function handoffArtifacts(args: {
	session: Session;
	config: PluginConfig;
	language: HandoffLanguage;
	rawSummary: string;
	archive: { log: string; index: string };
	pointers: { log: string; index: string };
	tail: string;
}): { document: string; prompt: string } {
	const summary = localizeSummaryHeadings(args.rawSummary, args.language);
	return {
		document: renderHandoff(args.session, summary, args.archive, args.language),
		prompt: continuation(String(args.session.id), summary, args.tail, args.pointers, args.language, pendingQuestionFor(args.config, args.session)),
	};
}

/**
 * The span a handoff summarizes, or an error when there is none. Two cases reach this: a session
 * with no messages at all, and — with the default `handoffKeepTokens` — a short conversation that
 * fits entirely inside the carried-over window. Both would otherwise pay for a model call and seed
 * the child with a fabricated summary; the error names the `keep 0` escape for the second case.
 * The automatic path cannot reach it (it refuses a span below `MIN_SUMMARIZE_TOKENS` first).
 * Exported so a test can pin the guard instead of only the happy path.
 * @param older - the rendered conversation before the kept tail.
 */
export function assertHandoffSummarizable(older: string): void {
	if (older.trim().length === 0) {
		throw new Error("nothing to hand off: every message is inside the carried-over window; run `/handoff keep 0` to summarize the whole conversation");
	}
}

/**
 * Summarize the session, persist the document, and start the seeded child session.
 * @param reason - the path that decided this handoff.
 * @param signal - the caller's cancellation signal, when the profile supplies one.
 * @param split - the span decided by the caller, when it already computed one.
 * @param triggerSeq - the automatic path's triggering `turn/end` offset; the handoff is deferred
 *   (never performed) once this session has started a turn after it. Absent on the manual path:
 *   `/handoff now` runs *inside* a turn, so "a turn is open" cannot mean the user moved on.
 */
export async function performHandoff(
	ctx: Context,
	session: Session,
	target: { provider: string; model: string },
	config: PluginConfig,
	resolved: LlmResolvedModelInfo,
	reason: "auto" | "manual",
	signal: AbortSignal | undefined,
	split?: HandoffSplit,
	triggerSeq?: number,
): Promise<{ childId: string; file: string }> {
	const controller = ctx.get("sessionController") as SessionControllerLike | undefined;
	if (!controller) throw new Error("the session controller is unavailable in this profile; handoff needs the web/API session runtime");
	assertSessionSettled(session, triggerSeq);

	const projectRoot = await getProjectRoot(session.header.cwd ?? process.cwd());
	const memory = await loadMemory(projectRoot, config.maxMemoryChars);
	const { older, tail, languageMessages } = split ?? handoffSplit(session, Math.round(config.handoffKeepTokens * CHARS_PER_TOKEN));
	assertHandoffSummarizable(older);
	const language = resolveHandoffLanguage(languageMessages, config);
	const raw = (
		await summarize(ctx, target, config, handoffPrompt(projectRoot, memory.text, older, fileOperations(session), language), withTimeout(signal), resolveSummaryEffort(config, session, resolved))
	).trim();
	// The summary call is the wide window: it takes seconds, and a message the user sends while it
	// runs opens the next turn immediately. Check before the empty-summary verdict so a session that
	// moved on is deferred rather than recorded as a failed attempt.
	assertSessionSettled(session, triggerSeq);
	if (raw.length === 0) throw new Error("the handoff summary came back empty");

	const logFile = path.join(logsDir(projectRoot), safeSessionId(String(session.id)), "session.md");
	const indexFile = sessionIndexFile(projectRoot);
	// The document lives in the repository, so it points at it relatively; the child
	// session's cwd can be a subdirectory of the project root, so the first message
	// carries absolute paths that resolve from anywhere.
	const archive = { log: path.relative(projectRoot, logFile), index: path.relative(projectRoot, indexFile) };
	const pointers = { log: logFile, index: indexFile };
	const file = path.join(memoryDir(projectRoot), "HANDOFF.md");
	const { document, prompt } = handoffArtifacts({ session, config, language, rawSummary: raw, archive, pointers, tail });

	const childId = await createChildSession(ctx, controller, session.header.cwd, session.header.agentPreset);
	const parentLabel = String(session.id).replace(/^session-/, "").slice(0, 8);

	// The child starts on the deployment defaults: `create` takes neither a model nor a permission
	// preset. Carry what the user had switched to before any work can be admitted, so the
	// continuation does not silently drop the model/thinking level or re-ask for every approval.
	carryPermissionPreset(ctx, childId, session);
	await carryModelSelection(ctx, controller, childId, session);

	// Admit the seed prompt before publishing the switch marker. The title prefix
	// IS the browser half's switch signal, so a handoff that fails here would
	// otherwise leave the user switched into an empty child while the parent stays
	// unmarked — and the retry after the failure backoff would create a second one.
	const promptSignal = signal ?? new AbortController().signal;
	let promptAttempted = false;
	try {
		// Last check: creating the child is an RPC, and configuring it is two more round trips, so a
		// turn can still open inside that window. The child already exists here, so the catch below
		// strips its switch marker instead of leaving the browser pointed at a duplicate continuation.
		assertSessionSettled(session, triggerSeq);
		// The flag is raised *before* the call: the prompt can be admitted and the turn opened before
		// the request rejects, so a rejection is not proof that the child stayed idle.
		promptAttempted = true;
		await controller.prompt(
			{
				requestId: randomUUID(),
				sessionId: childId,
				mode: "queue",
				content: [{ type: "text", text: prompt }],
			},
			promptSignal,
		);
		// The prompt RPC is the last window: its turn can open while the request is in flight, and
		// then the child runs the duplicate continuation the guard exists to prevent. The seed is
		// already durable, so this check undoes it (cancel below) rather than skipping it.
		assertSessionSettled(session, triggerSeq);
		// The document is written last, once this attempt is certain to be seeded, so an abandoned
		// handoff leaves nothing behind in the project. Nothing above reads it: the seed prompt
		// carries the summary inline and points at the archive log and index.
		await writeAtomic(file, document);
	} catch (error: unknown) {
		await abandonChild(ctx, controller, childId, parentLabel, error, promptAttempted);
		// Stamp the retryable verdict here, where the failing step is known: the child already
		// existed and its seed was refused, so a transient controller error (a turn still open, a
		// queue hiccup) has usually left nothing behind that a second `/handoff now` cannot redo.
		throw transientIfRetryable(error);
	}

	// The title is the browser half's switch signal: it is stable, projected to
	// the client list, and survives history replay (unlike a live-only event).
	if (controller.rename) {
		try {
			await controller.rename({
				sessionId: childId,
				title: `${HANDOFF_TITLE_PREFIX}${parentLabel}`,
			});
		} catch (error: unknown) {
			ctx.logger.warn("dsh-project-context: handoff session title not set: %s", error instanceof Error ? error.message : String(error));
		}
	}

	// Nothing is appended to the parent's log. `project-context/handoff` is a
	// downstream type, so dsh's persistence read path would refuse to load the
	// session ("contains event type ... unknown to this harness and not marked
	// ignorable"), and `Session.append` offers no way to set that marker. The
	// handoff is durable in HANDOFF.md, the session archive and the index.
	ctx.logger.info("dsh-project-context: handoff (%s) %s -> %s", reason, String(session.id), childId);
	handedOff.add(String(session.id));
	return { childId, file };
}
