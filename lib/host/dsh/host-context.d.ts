import type { Context, HostContext } from "../contract.js";
/**
 * Adapt one plugin's cordis context to the façade.
 * @param ctx - the plugin context `apply` received.
 * @returns the façade the core starts with.
 */
export declare function hostContextOf(ctx: Context): HostContext;
