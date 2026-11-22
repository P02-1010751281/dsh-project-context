/** The logging port: one narrow surface, so a host's logger shape stops at this file. */
import type { Context } from "../contract.js";
export interface HostLog {
    info(format: string, ...args: readonly unknown[]): void;
    warn(format: string, ...args: readonly unknown[]): void;
}
export declare function logOf(ctx: Context): HostLog;
