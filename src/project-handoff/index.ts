/**
 * project-handoff — port of pi's `auto-handoff` extension.
 *
 * Trigger (per top-level session, on `turn/end`):
 *   - adaptive threshold (default): `min(quality(window), capacity(room))` — the quality
 *     layer (the upstream usable-input field when the harness exposes one, else the fitted
 *     knee) as the base, and the usable window as the only ban. `handoffTargetTokens` does
 *     not take part (see `resolveThreshold`);
 *   - fixed threshold: `handoffThresholdRatio` × window.
 * A handoff is deferred while the last assistant message is an open question
 * (`handoffPendingQuestion: defer`), while a *continuable* subagent child this
 * session started is still running (that child's settlement notice wakes this
 * session again, so handing off first would leave two sessions on the same
 * project), and while the session has started another turn since the
 * `turn/end` that triggered the attempt. The last one is the same failure from
 * the other side: the harness pumps a queued user message into the next turn as
 * soon as the current one closes, so the parent can be back at work before the
 * summary call returns. `agent.status` cannot express it (the driver is still
 * `running` when `turn/end` commits), so the check reads the log for a later
 * `turn/start` — before the summary, after it, once before the seed prompt and
 * once after it, because creating and configuring the child is itself a wide
 * window and the prompt RPC is another. An abandoned child is undone rather
 * than deleted (dsh has no delete RPC): a possible seed is cancelled, the
 * switch marker is stripped, and a child that was never seeded — or whose seed
 * was provably cancelled — is archived so it does not appear in the workspace
 * list, while a child that may still be running stays visible. The document is
 * written last, so an abandoned attempt leaves nothing in the project. The
 * guard is best-effort down to the final rename RPC, the one window no check
 * can close. A `turn/end` that arrives while an attempt is running is
 * remembered and re-evaluated when that attempt finishes (an attempt that
 * *failed* keeps its backoff, so the retry waits it out), so a settled turn is
 * not passed over.
 * One auxiliary model call distills the older conversation; the recent tail
 * (`handoffKeepTokens`) is carried into the continuation verbatim. The
 * document is archived to `.agents/memory/HANDOFF.md`, a fresh session is
 * created in the same workspace, renamed with `HANDOFF_TITLE_PREFIX`, and
 * seeded with the continuation as its first prompt (the browser half switches
 * to it). The old session's own log is left untouched: dsh refuses to load a
 * log that contains an event type outside its vocabulary unless the record
 * carries `ignorable: true`, and `Session.append` cannot set that marker, so a
 * downstream plugin must not append custom event types at all.
 *
 * dsh adaptations of pi's behavior:
 *   - no editor draft mode: `handoffPendingQuestion: "defer"` (default) waits for the
 *     user's answer instead of auto-answering it on their behalf; `"wait"` hands off
 *     and carries the question into the continuation (pi's `handoffGuard: wait`);
 *   - dsh model metadata exposes no cost tiers: the adaptive threshold is
 *     bounded by the window reserve and the keep budget only;
 *   - summary thinking defaults to `off` when the adapter exposes that effort;
 *   - `handoffLanguage: "auto"` follows the conversation (see `project-handoff/language.ts`)
 *     and a previous continuation prompt in the carried tail is replaced by a one-line
 *     marker so it cannot read as a fresh instruction.
 *
 * Commands: /handoff [status|now|on|off|auto|<ratio>|target <tokens>|keep <tokens>|thinking off|session|pending defer|wait|lang auto|zh|en]
 */

// Type-only: pulls the commands service Context merge (ctx.commands).
import type {} from "@deepseek-ai/dsh-commands";
import { type Context } from "@deepseek-ai/cordis";
import { type Session } from "@deepseek-ai/dsh-session";
import { resolvePluginConfig } from "../shared/config.js";
import { effectivePluginConfig } from "../shared/settings.js";
import { isTopLevel } from "../shared/lifecycle.js";
import { getProjectRoot, logError } from "../shared/project-state.js";
import { REPLAY_MARKER, isHandoffContinuationText } from "./language.js";
import { HANDOFF_TITLE_PREFIX } from "./marker.js";
import { maybeAutoHandoff } from "./auto.js";
import { retireIfPending } from "./child.js";
import { HandoffDeferred } from "./classify.js";
import { USAGE, runManual, settingPatch, statusText, writeSetting } from "./command.js";
import { FAILURE_BACKOFF_MS, SKIP_LOG_INTERVAL_MS, deferredLoggedAt, failedUntil, handedOff, inFlight, pendingRetire, pendingTriggerSeq, skippedLoggedAt, skippedSince } from "./state.js";

export const name = "project-handoff";

export const inject = ["llm", "commands"];

/** Stable title prefix for the fresh handoff session (the browser half switches on it). */
export { HANDOFF_TITLE_PREFIX };

/** Re-exported so the handoff-owned literals stay reachable from one module. */
export { isHandoffContinuationText, REPLAY_MARKER };

export function apply(ctx: Context, rawConfig: unknown): void {
	const entry = resolvePluginConfig(rawConfig);

	// One attempt at a time per session. A `turn/end` that lands while an attempt is running is
	// remembered rather than dropped: it may be the settled turn this handoff was waiting for.
	const attempt = (session: Session, triggerSeq: number): void => {
		const key = String(session.id);
		if (handedOff.has(key)) return;
		if (inFlight.has(key)) {
			pendingTriggerSeq.set(key, triggerSeq);
			return;
		}
		const backoff = failedUntil.get(key);
		if (backoff !== undefined && Date.now() < backoff) return;
		const config = effectivePluginConfig(entry);
		if (!config.handoffEnabled) return;

		inFlight.add(key);
		void maybeAutoHandoff(ctx, session, config, triggerSeq)
			.catch(async (error: unknown) => {
				if (error instanceof HandoffDeferred) {
					// Not a failure: the session is still working. The next `turn/end` re-checks.
					if (Date.now() - (deferredLoggedAt.get(key) ?? 0) >= SKIP_LOG_INTERVAL_MS) {
						deferredLoggedAt.set(key, Date.now());
						ctx.logger.info("dsh-project-context: automatic handoff deferred — %s", error.message);
					}
					return;
				}
				failedUntil.set(key, Date.now() + FAILURE_BACKOFF_MS);
				ctx.logger.warn("dsh-project-context: automatic handoff failed: %s", error instanceof Error ? error.message : String(error));
				try {
					const projectRoot = await getProjectRoot(session.header.cwd ?? process.cwd());
					await logError(projectRoot, "handoff", error);
				} catch {
					// Diagnostics must never throw.
				}
			})
			.finally(() => {
				inFlight.delete(key);
				const pending = pendingTriggerSeq.get(key);
				pendingTriggerSeq.delete(key);
				if (pending !== undefined) attempt(session, pending);
			});
	};

	ctx.on("session/event", (session, event) => {
		if (event.type !== "turn/end") return;
		// A handoff that ran inside its own turn retires that session once the turn ends — never
		// mid-turn, where archiving would stop the turn rendering the command's reply.
		retireIfPending(ctx, session);
		if (!isTopLevel(session)) return;
		attempt(session, event.seq);
	});

	ctx.on("session/disposed", (session) => {
		const key = String(session.id);
		// A disposed session can never be handed off again, so its markers must not
		// accumulate for the lifetime of the process.
		handedOff.delete(key);
		failedUntil.delete(key);
		skippedLoggedAt.delete(key);
		skippedSince.delete(key);
		deferredLoggedAt.delete(key);
		pendingTriggerSeq.delete(key);
		pendingRetire.delete(key);
	});

	ctx.commands.register({
		name: "handoff",
		description: "Hand off this session to a fresh one (status|now|on|off|auto|ratio|target|keep|thinking|pending|lang)",
		input: { hint: "status | now | on|off | auto | 0.4 | target 64k | keep 20k | thinking off|session | pending defer|wait | lang auto|zh|en" },
		handler: async ({ agent, rawInput, signal }) => {
			const args = rawInput.trim();
			if (args === "" || args === "now" || args === "force") return runManual(ctx, agent.session, entry, signal);
			if (args === "status") return { kind: "success" as const, text: await statusText(ctx, agent.session, entry, signal) };

			const parsed = settingPatch(args);
			if (parsed === undefined) return { kind: "error" as const, text: USAGE };
			if (parsed.error !== undefined) return { kind: "error" as const, text: parsed.error };
			const failure = await writeSetting(ctx, parsed.patch ?? {});
			return failure === undefined
				? { kind: "success" as const, text: `Handoff setting updated: ${args}` }
				: { kind: "error" as const, text: failure };
		},
	});
}
