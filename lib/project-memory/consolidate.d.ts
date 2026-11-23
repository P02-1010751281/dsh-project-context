/**
 * The consolidation pass (②): one throttled, single-flight model call per project producing
 * durable memory and a session-context update. It lived in `shared/llm.ts` only because the
 * autolearn pass reuses the model plumbing from there; the pass itself belongs to the memory
 * plugin, and the plumbing it shares now sits in `shared/model-call.ts`.
 */
import { type Agent, type HostPorts } from "../host/contract.js";
import { type PluginConfig } from "../shared/config.js";
import type { ConsolidationOutcome } from "./consolidate-types.js";
interface ConsolidationOptions {
    force?: boolean;
    signal?: AbortSignal;
}
/**
 * Run the consolidation pass (durable memory + session context).
 * Callers own persisting their artifact; results are cached per project so the memory and
 * session-context plugins can consume the same pass without a second model call.
 * @param host - the ports; the model port is the only facility this pass reads.
 */
export declare function consolidateProjectState(host: HostPorts, agent: Agent, config: PluginConfig, options?: ConsolidationOptions): Promise<ConsolidationOutcome | undefined>;
export type { ConsolidationOutcome, PartialRefusalReason } from "./consolidate-types.js";
export * from "./prompt.js";
export * from "./reply.js";
