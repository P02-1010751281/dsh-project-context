/**
 * project-autolearn — the skill-distillation feature (pass ③).
 *
 * Low-frequency pass over `.agents/memory/CONTEXT.md` + `MEMORY.md` plus the
 * mechanical session index; when those documents lack the concrete steps it
 * backtracks into the archived sessions named by the index, reading each one's
 * canonical `session.jsonl` rather than its rendered `session.md`. Output is
 * `.agents/skills/<name>/SKILL.md`; dsh discovers skills natively, so only the
 * description enters the prompt while the body loads on demand.
 *
 * Commands: /autolearn
 *
 * The body is `start.ts`: this file is the cordis entry and nothing else.
 */
import { hostContextOf } from "../host/dsh/host-context.js";
import { resolvePluginConfig } from "../shared/config.js";
import { start } from "./start.js";
export const name = "project-autolearn";
export const inject = ["llm", "commands"];
/**
 * Cordis entry: resolve the plugin config, publish nothing (the memory card owns the namespace), and
 * hand the core a façade over this context.
 * @param ctx - the plugin context.
 * @param rawConfig - the raw config the Loader passed.
 */
export function apply(ctx, rawConfig) {
    start(hostContextOf(ctx), resolvePluginConfig(rawConfig));
}
