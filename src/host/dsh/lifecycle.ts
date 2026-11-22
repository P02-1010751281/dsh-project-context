/**
 * The plugin-lifecycle port.
 *
 * Only disposal is named here; event subscriptions and command/prompt registration stay in each
 * plugin's `index.ts`, which is the wiring file by design (`scripts/check-boundary.mjs` allows
 * `ctx.on` / `ctx.commands` / `ctx.systemPrompt` there and nowhere else). A core module that needs
 * to react to being torn down asks for this seam instead of touching `ctx.effect`.
 */
import type { Context } from "../contract.js";

export function onDispose(ctx: Pick<Context, "effect">, cleanup: () => void, label?: string): void {
	(ctx.effect as (fn: () => () => void, label?: string) => void)(() => cleanup, label);
}
