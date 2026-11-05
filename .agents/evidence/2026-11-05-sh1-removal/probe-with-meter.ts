// 两个包都 import：与 `src/project-handoff/runtime.ts` 的 import 集一致，必须 0 错。
import { type Context } from "@deepseek-ai/cordis";
import { type Session } from "@deepseek-ai/dsh-session";
import { type SessionProjectionRegistry } from "@deepseek-ai/dsh-session-projection";
import { type ContextBreakdownProjection } from "@deepseek-ai/dsh-token-meter";

export function readBreakdown(ctx: Context, session: Session): ContextBreakdownProjection | undefined {
	const projections: SessionProjectionRegistry | undefined = ctx.get("sessionProjections");
	return projections?.snapshot(session, ["contextBreakdown"]).values.contextBreakdown;
}
