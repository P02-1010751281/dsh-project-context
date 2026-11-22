/** The logging port: one narrow surface, so a host's logger shape stops at this file. */
import type { Context, HostLog } from "../contract.js";
export type { HostLog };
export declare function logOf(ctx: Context): HostLog;
