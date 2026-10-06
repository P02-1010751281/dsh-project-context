/**
 * The automatic trigger: measure context pressure and hand off once the threshold is
 * crossed, unless a guard defers. Driven by the `turn/end` listener in `index.ts`.
 *
 * The measurement itself lives in `gate.ts` because the injected pressure line reports the same
 * numbers; this function adds only the guards, the split and the handoff.
 */
import { type Context } from "@deepseek-ai/cordis";
import { type Session } from "@deepseek-ai/dsh-session";
import { type PluginConfig } from "../shared/config.js";
/**
 * Measure pressure and hand off when the configured threshold is crossed. Exported so a test can
 * drive the guards (pending question, running subagents, minimum span, a session that moved on)
 * without the session/event plumbing of the plugin's own turn-end listener.
 *
 * Every `turn/end` re-measures. The trigger is already a once-per-turn event, so the 15 s
 * wall-clock throttle this used to carry saved at most one measurement per ~90 turns (measured on
 * this repo's 72 archived sessions: 1 of 89 inter-turn gaps was under 15 s) while letting a
 * deferral swallow the first idle after the user answered. Model-info resolution and the surface
 * pricing behind `tokenMeter.measure` are cheap enough to re-run per turn.
 */
export declare function maybeAutoHandoff(ctx: Context, session: Session, config: PluginConfig, triggerSeq?: number): Promise<void>;
