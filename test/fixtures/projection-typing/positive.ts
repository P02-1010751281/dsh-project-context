/**
 * Control for `test/projection-typing.test.mjs`: the projection read this plugin actually performs
 * must typecheck with the key it really asks for.
 *
 * These are the same two imports `src/project-handoff/runtime.ts` makes, and both are load-bearing:
 *  - `@deepseek-ai/dsh-session-projection` is what declares `Context.sessionProjections`; without it
 *    `ctx.get` falls back to its `get(name: string): any` overload, silently;
 *  - `@deepseek-ai/dsh-token-meter` contributes the `contextBreakdown` key by augmenting
 *    `SessionProjectionMap`, so without it this file's key stops being a key.
 */
import { type Context } from "@deepseek-ai/cordis";
import { type Session } from "@deepseek-ai/dsh-session";
import { type SessionProjectionRegistry } from "@deepseek-ai/dsh-session-projection";
import { type ContextBreakdownProjection } from "@deepseek-ai/dsh-token-meter";

export function readBreakdown(ctx: Context, session: Session): ContextBreakdownProjection | undefined {
	const projections = ctx.get("sessionProjections");
	// Deliberately unannotated above: annotating would hide which overload `get` resolved to.
	const registry: SessionProjectionRegistry | undefined = projections;
	if (registry === undefined) return undefined;
	return projections?.snapshot(session, ["contextBreakdown"]).values.contextBreakdown;
}
