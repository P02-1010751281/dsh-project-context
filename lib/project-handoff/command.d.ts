/**
 * The `/handoff` surface: argument parsing, the `/handoff status` receipt and the manual
 * handoff the bare command and `now` share.
 */
import { type Context } from "@deepseek-ai/cordis";
import { type Session } from "@deepseek-ai/dsh-session";
import { type PluginConfig } from "../shared/config.js";
import { parseTokenCount } from "../shared/threshold-spec.js";
/**
 * Parse "0.4", "40%", or "40" into a ratio. Exported for tests.
 *
 * The folding rule itself lives in `shared/ratio.ts` because the settings card reads the same text:
 * two copies of it is how the command accepts `40` while the card's number field passes `40` through
 * to a schema that refuses it. The bounds are likewise the one pair in `limits.ts`.
 */
export declare function parseRatio(input: string): number | undefined;
/** Re-exported for tests: the one token-count reader lives in `shared/threshold-spec.ts`. */
export { parseTokenCount };
/** Map one command argument to a settings patch. */
/** Exported for tests: the settings patch `/handoff <args>` produces, if any. */
export declare function settingPatch(args: string): {
    patch?: Record<string, unknown>;
    error?: string;
} | undefined;
export declare const USAGE = "Usage: /handoff [status|now|on|off|threshold auto|<ratio>|<tokens>|budget summary <tokens>|budget recent <tokens>|pending defer|wait|lang auto|zh|en]";
/** Persist one settings patch through the mounted settings service. */
export declare function writeSetting(ctx: Context, patch: Record<string, unknown>): Promise<string | undefined>;
/** Human-readable handoff state for the current session. */
/**
 * The `/handoff status` receipt. Exported so a test can read the skip report without going through
 * the command registration.
 *
 * `pending` is the patch a just-completed settings write is about to put in force. The receipt explains
 * the *effect* of a write, and the host's entry restart may not have republished the config by the time
 * this runs, so reading the live config alone would explain the previous ratio instead of the one just
 * set — a fresh misattribution in the place a misattribution is least tolerable. `/handoff status`
 * passes nothing and reports exactly what is in force.
 */
export declare function statusText(ctx: Context, session: Session, entry: PluginConfig, signal: AbortSignal, 
/** The raw patch a just-completed write will put in force — stored spellings, not resolved values. */
pending?: Partial<Record<keyof PluginConfig, unknown>>): Promise<string>;
/**
 * Manual handoff shared by the bare command and `now`. Exported so a test can drive the whole reply
 * path (an empty span must come back as an error reply, not as a fabricated child).
 */
export declare function runManual(ctx: Context, session: Session, entry: PluginConfig, signal: AbortSignal): Promise<{
    kind: "error";
    text: string;
} | {
    kind: "success";
    text: string;
}>;
