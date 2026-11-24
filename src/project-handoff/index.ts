/**
 * project-handoff — port of pi's `auto-handoff` extension.
 *
 * Trigger (per top-level session, on `turn/end`):
 *   - adaptive threshold (default): `min(quality(window), capacity(room))` — the quality
 *     layer (the upstream usable-input field when the harness exposes one, else the fitted
 *     knee) as the base, and the usable window as the only ban. `handoffBudgetSummaryTokens` does
 *     not take part (see `resolveThreshold`);
 *   - fixed threshold: a fixed share of the window, or an absolute token count compared as-is
 *     (`handoffThreshold`).
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
 * A second, smaller piece is registered on `user/message`: the title this plugin wrote at handoff time
 * is replaced by one named after the continuation's own first input, once, on `relabel.ts`'s terms.
 * It writes at most one `session/title` per continuation and only while the stored title still carries
 * the switch prefix, so a user's own rename is never overwritten.
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

import type { Context } from "../host/contract.js";
import { hostContextOf } from "../host/dsh/host-context.js";
import { resolveHandoffConfig } from "../shared/config.js";
import { HANDOFF_TITLE_PREFIX } from "./marker.js";
import { isHandoffContinuationText, REPLAY_MARKER } from "./language.js";
import { HandoffSettingsSchema } from "../shared/settings.js";
import { start } from "./start.js";

export const name = "project-handoff";

/**
 * The handoff card: the Host projects a settings form from this schema, keyed by this entry's id.
 * Every field carries the `volatile` mark — schemastery drops a schema whose fields are all
 * ordinary, and the card would then disappear with no error anywhere.
 */
export const Config = HandoffSettingsSchema;

export const inject = ["llm", "systemPrompt", "commands"];

/** Stable title prefix for the fresh handoff session (the browser half switches on it). */
export { HANDOFF_TITLE_PREFIX };

/** Re-exported so the handoff-owned literals stay reachable from one module. */
export { isHandoffContinuationText, REPLAY_MARKER };

/** The settings whose value the status receipt threshold resolution reads; the core owns it. */
export { movesThreshold } from "./start.js";

/**
 * Cordis entry: resolve this card's seven keys and hand the core a façade over this context.
 * It publishes no settings namespace; `/handoff` writes go to this entry's own namespace.
 * @param ctx - the plugin context.
 * @param rawConfig - the raw config the Loader passed.
 */
export function apply(ctx: Context, rawConfig: unknown): void {
	start(hostContextOf(ctx), resolveHandoffConfig(rawConfig));
}
