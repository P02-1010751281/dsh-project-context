/**
 * project-handoff — port of pi's `auto-handoff` extension.
 *
 * Trigger (per top-level session, on `turn/end`):
 *   - adaptive threshold (default): `min(quality(window), capacity(room))` — the quality
 *     layer (the upstream usable-input field when the harness exposes one, else the fitted
 *     knee) as the base, and the usable window as the only ban. `handoffBudgetSummaryTokens` does
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
 * child exists. `agent.status` cannot express it (the driver is still
 * `running` when `turn/end` commits), so the check reads the log for a later
 * `turn/start` — before the artifacts are built, once before the seed prompt and
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
 * The handoff generates nothing — no model call: the older conversation is
 * dropped and stays reachable through the session log, while the recent tail
 * (`handoffBudgetRecentTokens`), the file index and the carried user input ride
 * into the continuation. The
 * document is archived to `.agents/memory/HANDOFF.md`, a fresh session is
 * created in the same workspace, renamed with `HANDOFF_TITLE_PREFIX`, and
 * seeded with the continuation as its first prompt (the browser half switches
 * to it). The old session's own log is left untouched: dsh refuses to load a
 * log that contains an event type outside its vocabulary unless the record
 * carries `ignorable: true`, and `Session.append` cannot set that marker, so a
 * downstream plugin must not append custom event types at all.
 *
 * Beyond the trigger this plugin owns one *display* contribution: a `step/start` tick resolves the
 * same gate `gate.ts` hands the trigger, freezes it when crossed, and a `systemPrompt.context`
 * renders that frozen line (`display.ts`). It exists because a crossed threshold was otherwise
 * silent until the user typed `/handoff status` — the session that motivated it sat at 2.01x its
 * threshold with one open turn, so the `turn/end`-only trigger had never evaluated it. The line must
 * not re-render per turn: the harness appends a ~37 KB runtime-context snapshot on every text
 * change, which is why the display layer changes the text only at a crossing or a reason change.
 *
 * dsh adaptations of pi's behavior:
 *   - no editor draft mode: `handoffPendingQuestion: "defer"` (default) waits for the
 *     user's answer instead of auto-answering it on their behalf; `"wait"` hands off
 *     and carries the question into the continuation (pi's `handoffGuard: wait`);
 *   - dsh model metadata exposes no cost tiers: the adaptive threshold is
 *     bounded by the window reserve and the keep budget only;
 *   - `handoffLang: "auto"` follows the conversation (see `project-handoff/language.ts`)
 *     and a previous continuation prompt in the carried tail is replaced by a one-line
 *     marker so it cannot read as a fresh instruction.
 *
 * Commands: /handoff [status|now|on|off|threshold auto|<ratio>|budget summary <tokens>|budget recent <tokens>|pending defer|wait|lang auto|zh|en]
 */

// Type-only: pulls the commands service Context merge (ctx.commands).
import type {} from "@deepseek-ai/dsh-commands";
import { type Context } from "@deepseek-ai/cordis";
import { type Session } from "@deepseek-ai/dsh-session";
import { type PluginConfig, resolvePluginConfig } from "../shared/config.js";
import { effectivePluginConfig } from "../shared/settings.js";
import { isTopLevel } from "../shared/lifecycle.js";
import { getProjectRoot, logError } from "../shared/project-state.js";
import { REPLAY_MARKER, isHandoffContinuationText } from "./language.js";
import { resolveHandoffLanguage, sessionLanguageMessages } from "./conversation.js";
import { clearHandoffPressure, handoffPressureIsOver, handoffPressureText, recordHandoffGate } from "./display.js";
import { resolveHandoffGate } from "./gate.js";
import { HANDOFF_TITLE_PREFIX } from "./marker.js";
import { maybeAutoHandoff } from "./auto.js";
import { retireIfPending } from "./child.js";
import { HandoffDeferred } from "./classify.js";
import { USAGE, runManual, settingPatch, statusText, writeSetting } from "./command.js";
import { FAILURE_BACKOFF_MS, SKIP_LOG_INTERVAL_MS, deferredLoggedAt, failedUntil, handedOff, inFlight, pendingRetire, pendingTriggerSeq, skippedLoggedAt, skippedSince } from "./state.js";

export const name = "project-handoff";

export const inject = ["llm", "systemPrompt", "commands"];

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

	/** Sessions whose pressure tick is still resolving, so one session never measures twice at once. */
	const ticking = new Set<string>();

	/**
	 * Sessions disposed while their tick was still resolving. The tick's `.then` runs *after*
	 * `session/disposed` has cleared the line, so without this mark it re-inserts a crossing for a
	 * session that can never assemble again — one entry that then lives for the lifetime of the process
	 * (the very leak `clearHandoffPressure` exists to prevent). The tick's own `.finally` removes the
	 * mark, so the set stays bounded by the ticks actually in flight.
	 */
	const disposedDuringTick = new Set<string>();

	/**
	 * Resolve the gate for one step and hand it to the display layer, which freezes the line at the
	 * crossing. Best-effort by construction: a tick that cannot measure is just a step without a line,
	 * and it must never disturb the turn. Skipped once the line is frozen — an over-threshold session
	 * has nothing left for the tick to say, and re-resolving the route and the surface every step
	 * would be pure cost.
	 */
	const tickPressure = (session: Session): void => {
		if (!isTopLevel(session)) return;
		const key = String(session.id);
		if (handoffPressureIsOver(key) || ticking.has(key)) return;
		const config = effectivePluginConfig(entry);
		if (!config.handoffEnabled) return;
		ticking.add(key);
		void resolveHandoffGate(ctx, session, config)
			.then((gate) => {
				// A disposal that landed while this tick was parked must win: re-recording here would
				// resurrect the line for a session that will never assemble a prompt again.
				if (gate !== undefined && !disposedDuringTick.has(key)) recordHandoffGate(session, gate, resolveHandoffLanguage(sessionLanguageMessages(session), config));
			})
			.catch(() => undefined)
			.finally(() => {
				ticking.delete(key);
				disposedDuringTick.delete(key);
			});
	};

	// The visible half: without this a crossed threshold is silent until the user types
	// `/handoff status`. Registered as dynamic runtime context, and it renders `''` until something is
	// crossed — the documented way to contribute nothing. Reading the frozen map is all it does: the
	// numbers and the language were resolved once, where the trigger resolved them.
	ctx.systemPrompt.context({
		name: "handoff-pressure",
		order: 200,
		text: (assembleContext) => {
			const session = assembleContext.agent?.session;
			if (session === undefined || !isTopLevel(session)) return "";
			if (!effectivePluginConfig(entry).handoffEnabled) return "";
			return handoffPressureText(session);
		},
	});

	ctx.on("session/event", (session, event) => {
		if (event.type !== "turn/end") {
			// The pressure tick, not a trigger: `turn/end` is the only place a handoff is attempted, but
			// a session whose turn never ends still assembles prompts every step, so that is where a
			// crossing becomes visible (the motivating session sat at 2.01x its threshold with one open
			// turn and was never evaluated). It never hands off.
			if (event.type === "step/start") tickPressure(session);
			return;
		}
		// A handoff that ran inside its own turn retires that session once the turn ends — never
		// mid-turn, where archiving would stop the turn rendering the command's reply.
		retireIfPending(ctx, session);
		if (!isTopLevel(session)) return;
		attempt(session, event.seq);
	});

	ctx.on("session/disposed", (session) => {
		const key = String(session.id);
		clearHandoffPressure(key);
		// A tick already in flight resolves later and would re-insert the line right after this clear;
		// mark it so the tick's own `.then` declines to (see `disposedDuringTick`).
		if (ticking.has(key)) disposedDuringTick.add(key);
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
		description: "Hand off this session to a fresh one (status|now|on|off|threshold|budget|pending|lang)",
		input: { hint: "status | now | on|off | threshold auto|0.4 | budget summary 64k | budget recent 20k | pending defer|wait | lang auto|zh|en" },
		handler: async ({ agent, rawInput, signal }) => {
			const args = rawInput.trim();
			if (args === "" || args === "now") return runManual(ctx, agent.session, entry, signal);
			// `force` was the third spelling of `now` and is retired rather than kept as an alias (one
			// fact, one spelling), so it is told which name to use instead of quietly doing nothing.
			if (args === "force") return { kind: "error" as const, text: "`/handoff force` was retired; use `/handoff now`." };
			if (args === "status") return { kind: "success" as const, text: await statusText(ctx, agent.session, entry, signal) };

			const parsed = settingPatch(args);
			if (parsed === undefined) return { kind: "error" as const, text: USAGE };
			if (parsed.error !== undefined) return { kind: "error" as const, text: parsed.error };
			const failure = await writeSetting(ctx, parsed.patch ?? {});
			if (failure !== undefined) return { kind: "error" as const, text: failure };
			// The four writes the receipt's *resolution* reads can each turn a working configuration into a
			// refusal (or back): the two threshold keys, and the carried tail, which builds the physical floor
			// — `/handoff budget recent 160000` on a 400K window takes a 0.4 ratio that resolved exactly on the
			// floor to `fixed-below-floor`, so confirming that write with a bare "updated" is the same false
			// success. `handoffEnabled`/`handoffPendingQuestion`/`handoffLang` cannot move the trigger and keep
			// the short confirmation.
			if (movesThreshold(parsed.patch)) {
				// The write has already landed, so a receipt that cannot be built must not be reported as a
				// failed write — that is the same misattribution in reverse. Say the write landed and why the
				// receipt is missing.
				try {
					return { kind: "success" as const, text: await statusText(ctx, agent.session, entry, signal, parsed.patch as Partial<PluginConfig>) };
				} catch (error: unknown) {
					const reason = error instanceof Error ? error.message : String(error);
					return { kind: "success" as const, text: `Handoff setting updated: ${args} (the status receipt could not be built: ${reason})` };
				}
			}
			return { kind: "success" as const, text: `Handoff setting updated: ${args}` };
		},
	});
}

/**
 * The settings whose value the status receipt's threshold resolution reads. A write to one of these can
 * change the trigger, the refusal or the override warning, so its reply is the receipt.
 */
const THRESHOLD_SETTING_KEYS = ["handoffThresholdAuto", "handoffThresholdRatio", "handoffBudgetSummaryTokens", "handoffBudgetRecentTokens"] as const;

export function movesThreshold(patch: Record<string, unknown> | undefined): boolean {
	return patch !== undefined && THRESHOLD_SETTING_KEYS.some((key) => key in patch);
}
