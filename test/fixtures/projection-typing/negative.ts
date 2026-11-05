/**
 * Negative control for `test/projection-typing.test.mjs`: one character away from the real key must
 * be a compile error.
 *
 * This is what makes the positive control mean something. A read that silently widened to `any` —
 * `ctx.get` resolving to its `get(name: string): any` overload, or `snapshot` losing its typed `keys`
 * parameter — would accept this typo, and `projectionEnvelope` would then report the result as "no
 * harness envelope" rather than "the composition did not parse". The typo has to be rejected here.
 */
import { type Context } from "@deepseek-ai/cordis";
import { type Session } from "@deepseek-ai/dsh-session";
import { type SessionProjectionRegistry } from "@deepseek-ai/dsh-session-projection";
import { type ContextBreakdownProjection } from "@deepseek-ai/dsh-token-meter";

export function readBreakdown(ctx: Context, session: Session): ContextBreakdownProjection | undefined {
	const projections = ctx.get("sessionProjections");
	const registry: SessionProjectionRegistry | undefined = projections;
	if (registry === undefined) return undefined;
	return projections?.snapshot(session, ["contextBreakdwon"]).values.contextBreakdown;
}
