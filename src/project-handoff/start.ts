/**
 * The handoff core: the trigger, the injected pressure line and the `/handoff` command, behind the
 * host façade.
 *
 * This module registers nothing with a framework. It receives the {@link HostContext} the entry
 * built from its cordis context and only calls `host.on` / `host.registerCommand` /
 * `host.addPromptContext`; the trigger, the gate and the command helpers receive the narrower
 * `HostPorts` / `ServiceHost` they actually read. See `index.ts` for the plugin's own description.
 *
 * Commands: /handoff [status|now|on|off|threshold auto|<ratio>|budget summary <tokens>|budget recent <tokens>|pending defer|wait|lang auto|zh|en]
 */

import type { HostContext, Session } from "../host/contract.js";
import { type PluginConfig, resolveHandoffConfig } from "../shared/config.js";
import { effectiveSharedSettings, livePluginConfig, withShared } from "../shared/settings.js";
import { isTopLevel } from "../shared/lifecycle.js";
import { getProjectRoot, getProjectRootSync, logError } from "../shared/project-state.js";
import { pick } from "../shared/language.js";
import { resolveHandoffLanguage, sessionLanguageMessages } from "./conversation.js";
import { clearHandoffPressure, handoffPressureIsOver, handoffPressureText, recordHandoffGate } from "./display.js";
import { resolveHandoffGate } from "./gate.js";
import { relabelHandoffChild } from "./relabel.js";
import { maybeAutoHandoff } from "./auto.js";
import { retireIfPending } from "./child.js";
import { HandoffDeferred } from "./classify.js";
import { isHandoffRouteError, recordRouteFailure } from "./route-failure.js";
import { USAGE, runManual, settingPatch, statusText, writeSetting } from "./command.js";
import { FAILURE_BACKOFF_MS, SKIP_LOG_INTERVAL_MS, deferredLoggedAt, failedUntil, handedOff, inFlight, pendingRetire, pendingTriggerSeq, skippedLoggedAt, skippedSince } from "./state.js";

/**
 * Start the plugin behind the façade.
 * @param host - the registration façade and ports the entry built.
 * @param entry - the resolved plugin config, shared with the other three plugins.
 */
export function start(host: HostContext, entry: PluginConfig): void {
	/**
	 * This entry's own keys, re-resolved on every call, overlaid with the shared ten.
	 *
	 * The `entry` handed to `apply` is a snapshot: a volatile-only save lands in the running
	 * fiber's live references and never restarts the entry, so reading the snapshot would show
	 * a saved value in the card and keep using the old one. The shared ten come from the
	 * `project-context` publication (or this entry's own values when it is not loaded).
	 */
	const currentConfig = (): PluginConfig => withShared(livePluginConfig(host, entry, resolveHandoffConfig), effectiveSharedSettings(entry));
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
		const config = currentConfig();
		if (!config.handoffEnabled) return;

		inFlight.add(key);
		void maybeAutoHandoff(host, session, config, triggerSeq)
			.catch(async (error: unknown) => {
				if (error instanceof HandoffDeferred) {
					// Not a failure: the session is still working. The next `turn/end` re-checks.
					if (Date.now() - (deferredLoggedAt.get(key) ?? 0) >= SKIP_LOG_INTERVAL_MS) {
						deferredLoggedAt.set(key, Date.now());
						host.log.info("dsh-project-context: automatic handoff deferred — %s", error.message);
					}
					return;
				}
				failedUntil.set(key, Date.now() + FAILURE_BACKOFF_MS);
				if (isHandoffRouteError(error)) {
					// The one failure that repeats forever without saying anything: the pair the session is
					// routed on cannot be resolved, so every later attempt fails the same way. It goes on the
					// same injected line the crossing uses — a `warn` and an `errors.log` row are not a
					// surface, and `/handoff status` used to throw the very same exception.
					recordRouteFailure(key, error.failure, resolveHandoffLanguage(sessionLanguageMessages(session), config));
				}
				host.log.warn("dsh-project-context: automatic handoff failed: %s", error instanceof Error ? error.message : String(error));
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
		const config = currentConfig();
		if (!config.handoffEnabled) return;
		ticking.add(key);
		void resolveHandoffGate(host, session, config)
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
	host.addPromptContext({
		name: "handoff-pressure",
		order: 200,
		text: (assembleContext) => {
			const session = assembleContext.agent?.session;
			if (session === undefined || !isTopLevel(session)) return "";
			if (!currentConfig().handoffEnabled) return "";
			return handoffPressureText(session);
		},
	});

	host.on("session/event", (session, event) => {
		if (event.type === "user/message") {
			// The deferred half of the title policy: a continuation the handoff could only name after
			// its parent's id is renamed once its own first real input arrives (see `relabel.ts`). Three
			// cheap refusals, and the semantics rest on none of them: `humanUserText` re-filters by kind
			// and drops a generated banner (`firstHandoffInput` owns that predicate), a session that is
			// not a continuation is refused by the prefix test, and the seq is what tells the write this
			// very event is the one that carried the first naming input.
			if (event.data.source.kind === "user" && isTopLevel(session) && currentConfig().handoffEnabled) relabelHandoffChild(host, session, event.seq);
			return;
		}
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
		retireIfPending(host, session);
		if (!isTopLevel(session)) return;
		attempt(session, event.seq);
	});

	host.on("session/disposed", (session) => {
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
		// A retirement still waiting for a `turn/end` never runs once the session is disposed: the
		// archive is a write into the workspace store, and a disposing session is the wrong moment to
		// attempt it. Dropping it silently is what made the 2026-11-07 loss invisible — the session
		// stayed above its own continuation with nothing recorded anywhere — so the drop is logged.
		// The line states only what this handler knows: that the retirement is gone. Whether the
		// session is still listed is the client's state, so the advice is conditional.
		if (pendingRetire.delete(key)) {
			try {
				void logError(getProjectRootSync(session.header.cwd ?? process.cwd()), "handoff", `the handed-off session ${key} was disposed before its open turn ended, so its retirement was dropped; archive it from the client if it is still listed`);
			} catch {
				// Diagnostics must never throw.
			}
		}
	});

	host.registerCommand({
		name: "handoff",
		description: "Hand off this session to a fresh one (status|now|on|off|threshold|budget|pending|lang)",
		input: { hint: "status | now | on|off | threshold auto|0.4 | budget summary 64k | budget recent 20k | pending defer|wait | lang auto|zh|en" },
		handler: async ({ agent, rawInput, signal }) => {
			const args = rawInput.trim();
			// One language for every `/handoff` verb receipt, resolved the same way the status receipt is.
			const language = resolveHandoffLanguage(sessionLanguageMessages(agent.session), currentConfig());
			if (args === "" || args === "now") return runManual(host, agent.session, currentConfig(), signal);
			// `force` was the third spelling of `now` and is retired rather than kept as an alias (one
			// fact, one spelling), so it is told which name to use instead of quietly doing nothing.
			if (args === "force") return { kind: "error" as const, text: pick(language, "`/handoff force` 已退役；请用 `/handoff now`。", "`/handoff force` was retired; use `/handoff now`.") };
			if (args === "status") return { kind: "success" as const, text: await statusText(host, agent.session, currentConfig(), signal) };

			const parsed = settingPatch(args, language);
			if (parsed === undefined) return { kind: "error" as const, text: USAGE };
			if (parsed.error !== undefined) return { kind: "error" as const, text: parsed.error };
			const failure = await writeSetting(host, parsed.patch ?? {}, language);
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
					return { kind: "success" as const, text: await statusText(host, agent.session, currentConfig(), signal, parsed.patch as Partial<PluginConfig>) };
				} catch (error: unknown) {
					const reason = error instanceof Error ? error.message : String(error);
					return { kind: "success" as const, text: pick(language, `交接设置已更新：${args}（状态回执无法构建：${reason}）`, `Handoff setting updated: ${args} (the status receipt could not be built: ${reason})`) };
				}
			}
			return { kind: "success" as const, text: pick(language, `交接设置已更新：${args}`, `Handoff setting updated: ${args}`) };
		},
	});
}

/**
 * The settings whose value the status receipt's threshold resolution reads. A write to one of these can
 * change the trigger, the refusal or the override warning, so its reply is the receipt.
 */
const THRESHOLD_SETTING_KEYS = ["handoffThreshold", "handoffBudgetSummaryTokens", "handoffBudgetRecentTokens"] as const;

export function movesThreshold(patch: Record<string, unknown> | undefined): boolean {
	return patch !== undefined && THRESHOLD_SETTING_KEYS.some((key) => key in patch);
}
