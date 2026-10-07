/**
 * One handoff transaction, in order: persist `HANDOFF.md`, seed the child, publish the switch
 * marker. Nothing is generated: the child gets the carried tail, the file index and a pointer to
 * the session log the dropped prefix stays in. The seed happens before the marker, and the document
 * is written last, so an abandoned attempt leaves nothing behind in the project.
 */
import path from "node:path";
import {} from "@deepseek-ai/cordis";
import {} from "@deepseek-ai/dsh-session";
import {} from "../shared/config.js";
import { getProjectRoot, logsDir, memoryDir, safeSessionId, sessionIndexFile, writeAtomic } from "../shared/project-state.js";
import {} from "./language.js";
import { HANDOFF_TITLE_PREFIX } from "./marker.js";
import { abandonChild, carryModelSelection, carryPermissionPreset, createChildSession, scheduleRetirement, seedChildSession } from "./child.js";
import { transientIfRetryable } from "./classify.js";
import { CHARS_PER_TOKEN, fileOperations, handoffCarry, handoffLabel, handoffSplit, resolveHandoffLanguage } from "./conversation.js";
import { assertSessionSettled } from "./guard.js";
import {} from "./runtime.js";
import { handedOff } from "./state.js";
import { continuation, renderHandoff } from "./summary.js";
/**
 * The two language-dependent artifacts of one handoff: the `HANDOFF.md` document and the child's
 * first message. Both carry mechanical parts only — the archive pointers, the file index and the
 * carried state; the dropped prefix is reachable through the log the payload names. Exported so a
 * test can pin the wiring (the resolved language, the pending-question carry and the carried user
 * decision) rather than only the pure helpers.
 * @param args - session, resolved language, file index, archive pointers and the tail.
 * @returns the document to persist and the prompt to admit to the child.
 */
export function handoffArtifacts(args) {
    const carry = handoffCarry(args.session, args.config.handoffPendingQuestion === "wait");
    return {
        document: renderHandoff(args.session, args.fileOperations, args.archive, args.language),
        prompt: continuation(String(args.session.id), args.fileOperations, args.tail, args.pointers, args.language, carry.pending, carry.decision),
    };
}
/**
 * The span a handoff drops, or an error when there is none. Two cases reach this: a session with no
 * messages at all, and — with the default `handoffBudgetRecentTokens` — a short conversation that
 * fits entirely inside the carried-over window. Both would otherwise seed the child with a
 * continuation that drops nothing; the error names the `budget recent 0` escape for the second case.
 * The automatic path cannot reach it (it refuses a span below `MIN_DROP_TOKENS` first).
 * Exported so a test can pin the guard instead of only the happy path.
 * @param older - the rendered conversation before the kept tail.
 */
export function assertHandoffDroppable(older) {
    if (older.trim().length === 0) {
        throw new Error("nothing to hand off: every message is inside the carried-over window, so there is nothing older than the recent window to drop; run `/handoff budget recent 0` to drop the whole conversation");
    }
}
/**
 * Drop the older context, persist the document, and start the seeded child session.
 * @param reason - the path that decided this handoff.
 * @param signal - the caller's cancellation signal, when the profile supplies one.
 * @param split - the span decided by the caller, when it already computed one.
 * @param triggerSeq - the automatic path's triggering `turn/end` offset; the handoff is deferred
 *   (never performed) once this session has started a turn after it. Absent on the manual path:
 *   `/handoff now` runs *inside* a turn, so "a turn is open" cannot mean the user moved on.
 */
export async function performHandoff(ctx, session, config, reason, signal, split, triggerSeq) {
    const controller = ctx.get("sessionController");
    if (!controller)
        throw new Error("the session controller is unavailable in this profile; handoff needs the web/API session runtime");
    assertSessionSettled(session, triggerSeq);
    const projectRoot = await getProjectRoot(session.header.cwd ?? process.cwd());
    const { older, tail, languageMessages } = split ?? handoffSplit(session, Math.round(config.handoffBudgetRecentTokens * CHARS_PER_TOKEN));
    assertHandoffDroppable(older);
    const language = resolveHandoffLanguage(languageMessages, config);
    // The file index is read here, before the child exists, and travels in both artifacts.
    const files = fileOperations(session);
    // Resolving the project root reads the filesystem and the index walk reads the session, so a
    // message the user sends meanwhile can open the next turn. Check again before creating a child.
    assertSessionSettled(session, triggerSeq);
    const logFile = path.join(logsDir(projectRoot), safeSessionId(String(session.id)), "session.md");
    const indexFile = sessionIndexFile(projectRoot);
    // The document lives in the repository, so it points at it relatively; the child
    // session's cwd can be a subdirectory of the project root, so the first message
    // carries absolute paths that resolve from anywhere.
    const archive = { log: path.relative(projectRoot, logFile), index: path.relative(projectRoot, indexFile) };
    const pointers = { log: logFile, index: indexFile };
    const file = path.join(memoryDir(projectRoot), "HANDOFF.md");
    const { document, prompt } = handoffArtifacts({ session, config, language, fileOperations: files, archive, pointers, tail });
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
    let promptAttempted = false;
    try {
        // Last check: creating the child is an RPC, and configuring it is two more round trips, so a
        // turn can still open inside that window. The child already exists here, so the catch below
        // strips its switch marker instead of leaving the browser pointed at a duplicate continuation.
        assertSessionSettled(session, triggerSeq);
        // The flag is raised *before* the call: the seed can be admitted and the child's turn opened
        // before the call reports a failure, so a failure is not proof that the child stayed idle.
        promptAttempted = true;
        // Deliberately not `controller.prompt`: the RPC hardcodes `source.kind = "user"`, which would
        // hand the seed the person's authority (and their turn count). See `seedChildSession`.
        seedChildSession(ctx, childId, prompt);
        // Reading the parent again closes the same window from the other side: a turn that opened
        // there while the child was being configured means the user moved on.
        assertSessionSettled(session, triggerSeq);
        // The document is written last, once this attempt is certain to be seeded, so an abandoned
        // handoff leaves nothing behind in the project. Nothing above reads it: the seed prompt
        // carries the file index and the pointers to the archive log and index itself.
        await writeAtomic(file, document);
    }
    catch (error) {
        await abandonChild(ctx, controller, childId, parentLabel, error, promptAttempted);
        // Stamp the retryable verdict here, where the failing step is known: the child already
        // existed and its seed was refused, so a transient controller error (a turn still open, a
        // queue hiccup) has usually left nothing behind that a second `/handoff now` cannot redo.
        throw transientIfRetryable(error);
    }
    // The title is the browser half's switch signal: it is stable, projected to
    // the client list, and survives history replay (unlike a live-only event).
    // Only the part after the prefix is ours, and the parent's own last typed
    // input is what names the continuation — see `handoffLabel`.
    if (controller.rename) {
        try {
            await controller.rename({
                sessionId: childId,
                title: `${HANDOFF_TITLE_PREFIX}${handoffLabel(session, parentLabel)}`,
            });
        }
        catch (error) {
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
    // The continuation is seeded and marked, so retire the session it replaced: a handoff forks, so
    // without this the old session stays live and, being active, sits above its own continuation in the
    // workspace list. The manual path is inside the command's own turn, where archiving with
    // `stopActivity` would stop the turn rendering the reply, so that one waits for its `turn/end`.
    scheduleRetirement(ctx, session, reason === "manual");
    return { childId, file };
}
