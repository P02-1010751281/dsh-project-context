/**
 * project-memory — one consolidation pass.
 *
 * The pass owns the serialization (one pass per process at a time) and the version claim that makes a
 * deduplicated run cheap. It was 390 lines of `index.ts`; split out so the plugin entry is wiring and
 * the report layer (`report.ts`) stays pure text. No host registration happens here.
 */
import type { Agent } from "../host/contract.js";
import type { Context } from "../host/contract.js";
import { type PluginConfig } from "../shared/config.js";
import { type ConsolidateOptions, type ConsolidateReport } from "./report.js";
/** One pass updates both artifacts so MEMORY.md and CONTEXT.md never disagree about the pass. */
/** One consolidation pass. Exported so the version-claim/backoff behaviour is testable. */
export declare function consolidateProject(ctx: Context, config: PluginConfig, agent: Agent, options: ConsolidateOptions): Promise<ConsolidateReport>;
