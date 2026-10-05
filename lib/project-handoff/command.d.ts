/**
 * The `/handoff` surface: argument parsing, the `/handoff status` receipt and the manual
 * handoff the bare command and `now` share.
 */
import { type Context } from "@deepseek-ai/cordis";
import { type Session } from "@deepseek-ai/dsh-session";
import { type PluginConfig } from "../shared/config.js";
/** Parse "0.4", "40%", or "40" into a ratio. Exported for tests. */
export declare function parseRatio(input: string): number | undefined;
/** Parse "12k", "12000", or "0" into a token count. Exported for tests. */
export declare function parseTokenCount(input: string): number | undefined;
/** Map one command argument to a settings patch. */
/** Exported for tests: the settings patch `/handoff <args>` produces, if any. */
export declare function settingPatch(args: string): {
    patch?: Record<string, unknown>;
    error?: string;
} | undefined;
export declare const USAGE = "Usage: /handoff [status|now|on|off|threshold auto|<ratio>|budget summary <tokens>|budget recent <tokens>|thinking off|session|pending defer|wait|lang auto|zh|en]";
/** Persist one settings patch through the mounted settings service. */
export declare function writeSetting(ctx: Context, patch: Record<string, unknown>): Promise<string | undefined>;
/** Human-readable handoff state for the current session. */
/**
 * The `/handoff status` receipt. Exported so a test can read the skip report without going through
 * the command registration.
 */
export declare function statusText(ctx: Context, session: Session, entry: PluginConfig, signal: AbortSignal): Promise<string>;
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
