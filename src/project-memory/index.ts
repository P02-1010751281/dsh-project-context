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
 *
 * The body is `start.ts`: this file is the cordis entry and nothing else.
 */

import type { Context } from "../host/contract.js";
import { hostContextOf } from "../host/dsh/host-context.js";
import { resolveMemoryConfig } from "../shared/config.js";
import { MemorySettingsSchema } from "../shared/settings.js";
import { start } from "./start.js";

// The public surface of this entry stayed where it was: the report layer lives in `report.ts` and
// the pass in `update.ts`, so the symbols other modules and the test suite import from `index.js`
// are re-exported here verbatim.
export { acceptEntryState, memoryAcceptReply, memoryPruneReply, memoryReconcileReply, memoryStatusReply, memoryUpdateReply } from "./report.js";
export type { ConsolidateReport, ConsolidateStatus, RefusedLoss } from "./report.js";
export { consolidateProject } from "./update.js";
export { writeTodoSnapshot } from "./start.js";

export const name = "project-memory";
/**
 * The memory card: the Host projects a settings form from this schema, keyed by this entry's id.
 * Every field carries the `volatile` mark — schemastery drops a schema whose fields are all
 * ordinary, and the card would then disappear with no error anywhere.
 */
export const Config = MemorySettingsSchema;

export const inject = ["llm", "systemPrompt", "commands"];

/**
 * Cordis entry: resolve this card's three keys and hand the core a façade over this context.
 * This plugin publishes no settings namespace: the archive entry (`project-context`) publishes the
 * shared ten, and `start.ts` overlays them onto these keys on every read.
 * @param ctx - the plugin context.
 * @param rawConfig - the raw config the Loader passed.
 */
export function apply(ctx: Context, rawConfig: unknown): void {
	start(hostContextOf(ctx), resolveMemoryConfig(rawConfig));
}
