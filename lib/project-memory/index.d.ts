/**
 * project-memory — the memory feature (pass ②, consolidation).
 *
 * One high-frequency, throttled consolidation pass produces both durable
 * project memory (`.agents/memory/MEMORY.md`) and the rolling project context
 * (`.agents/memory/CONTEXT.md`); both documents are injected back into the
 * model context as dynamic runtime context. Skill distillation is a separate
 * feature (`project-autolearn`), and the raw archive is `project-context`.
 *
 * Commands: /memory (status | update | prune [--apply])
 */
import type { Context } from "../host/contract.js";
import type { Agent } from "../host/contract.js";
import type { Session } from "../host/contract.js";
import { type PluginConfig } from "../shared/config.js";
import { type ConsolidateOptions, type ConsolidateReport } from "./report.js";
export { acceptEntryState, memoryAcceptReply, memoryPruneReply, memoryReconcileReply, memoryStatusReply, memoryUpdateReply } from "./report.js";
export type { ConsolidateReport, ConsolidateStatus, RefusedLoss } from "./report.js";
export declare const name = "project-memory";
export declare const inject: string[];
/** One pass updates both artifacts so MEMORY.md and CONTEXT.md never disagree about the pass. */
/** One consolidation pass. Exported so the version-claim/backoff behaviour is testable. */
export declare function consolidateProject(ctx: Context, config: PluginConfig, agent: Agent, options: ConsolidateOptions): Promise<ConsolidateReport>;
/**
 * Copy one session's todo snapshot into the context document it owns.
 *
 * The document is the session's task's when the binding is in use, else `CONTEXT.md`; a missing
 * document stays missing — this is a mechanical patch on the pass's artifact, not a second creator
 * of one. A `null` projection (no todo write this turn) or an unchanged document writes nothing.
 *
 * No model call and no lock: the write is a read-modify-write of a few lines, and the pass applies
 * the same projection after its own rewrite, so the two can only ever converge on the same block.
 * @param ctx - the plugin context (for the projection read and the error log).
 * @param config - the effective config; `taskMode` decides which document the session owns.
 * @param session - the session whose turn just ended.
 */
export declare function writeTodoSnapshot(ctx: Context, config: PluginConfig, session: Session): Promise<void>;
export declare function apply(ctx: Context, rawConfig: unknown): void;
