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
import { type Context } from "@deepseek-ai/cordis";
import { REPLAY_MARKER, isHandoffContinuationText } from "./language.js";
import { HANDOFF_TITLE_PREFIX } from "./marker.js";
export declare const name = "project-handoff";
export declare const inject: string[];
/** Stable title prefix for the fresh handoff session (the browser half switches on it). */
export { HANDOFF_TITLE_PREFIX };
/** Re-exported so the handoff-owned literals stay reachable from one module. */
export { isHandoffContinuationText, REPLAY_MARKER };
export declare function apply(ctx: Context, rawConfig: unknown): void;
export declare function movesThreshold(patch: Record<string, unknown> | undefined): boolean;
