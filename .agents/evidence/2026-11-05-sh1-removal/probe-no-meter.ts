// 只 import session-projection：`contextBreakdown` 的键来自 token-meter 的 augmentation，
// 所以这里必须报错，否则说明「两个包缺一不可」的判断不成立。
import { type Context } from "@deepseek-ai/cordis";
import { type Session } from "@deepseek-ai/dsh-session";
import { type SessionProjectionRegistry } from "@deepseek-ai/dsh-session-projection";

export function readBreakdown(ctx: Context, session: Session): unknown {
	const projections: SessionProjectionRegistry | undefined = ctx.get("sessionProjections");
	return projections?.snapshot(session, ["contextBreakdown"]).values.contextBreakdown;
}
