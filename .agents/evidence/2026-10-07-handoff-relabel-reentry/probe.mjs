/**
 * The deferred half of the handoff title policy, driven against the REAL session store.
 *
 * Why the real store: `relabelHandoffChild` is dispatched from a `session/event` observer, i.e. from
 * inside `Session.append` while that store entry is publishing, and `SessionTitleService.rename`
 * appends the `session/title` event itself. The store refuses a nested append, so an in-envelope
 * write can never land. A hand-rolled fake session cannot show that — it has no guard to trip — which
 * is exactly how the shipped synchronous write stayed green in every unit test it had.
 *
 * The first session below is the control that proves the harness owns the refusal; the second is the
 * shipped wiring. Run:
 *   node .agents/evidence/2026-10-07-handoff-relabel-reentry/probe.mjs
 * Exit 0 = every printed claim held.
 */
import { Context, Service } from "@deepseek-ai/cordis";
import { SessionId, SessionStore } from "@deepseek-ai/dsh-session";
import { relabelHandoffChild } from "../../../lib/project-handoff/relabel.js";
import { HANDOFF_TITLE_PREFIX as P } from "../../../lib/project-handoff/marker.js";

const BANNER = [
	"从会话 session-aaaaaaaa-1111-2222-3333-444444444444 交接。请在本会话中接着下面的内容继续。",
	"",
	"<handoff>",
	"## 上一会话信息",
	"",
	"- 上一会话 id：session-aaaaaaaa-1111-2222-3333-444444444444",
	"</handoff>",
	"",
].join("\n");

const failures = [];
const claim = (name, ok, detail) => {
	console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail === undefined ? "" : ` — ${detail}`}`);
	if (!ok) failures.push(name);
};

/** The title service on the real store: `get` folds the log, `rename` appends — as the host's does. */
class StoreBackedTitles extends Service {
	constructor(ctx) {
		super(ctx, "sessionTitle");
	}
	get(session) {
		return [...session.snapshotEvents()].reverse().find((event) => event.type === "session/title")?.data;
	}
	rename(session, title) {
		session.append("session/title", { title, messageSeqs: [], source: { kind: "user" } });
		return this.get(session);
	}
}

const titlesOf = (session) => session.snapshotEvents().filter((event) => event.type === "session/title").map((event) => event.data.title);
const human = (id, text) => ({ id, role: "user", content: [{ type: "text", text }], source: { kind: "user" } });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function harness(id) {
	const ctx = new Context();
	await ctx.plugin(SessionStore);
	await ctx.plugin(StoreBackedTitles);
	const warnings = [];
	ctx.logger.warn = (...args) => warnings.push(args.map(String).join(" "));
	const session = ctx.sessions.create(SessionId(id));
	session.append("user/message", { id: `${id}-seed`, role: "user", content: [{ type: "text", text: BANNER }], source: { kind: "dsh-project-context" } }, { surfaceOp: "append" });
	session.append("session/title", { title: `${P}9f80b44`, messageSeqs: [], source: { kind: "user" } });
	return { ctx, session, warnings };
}

// ---- control: the store refuses an append made from inside an observer ------------------------
{
	const { ctx, session, warnings } = await harness("probe-inline");
	ctx.on("session/event", (observed, event) => {
		if (observed !== session || event.type !== "user/message" || event.data.source.kind !== "user") return;
		ctx.get("sessionTitle").rename(observed, `${P}inline`);
	});
	session.append("user/message", human("inline", "在信封里写"), { surfaceOp: "append" });
	await flush();
	claim("control: an in-envelope `rename` is refused, so the title stays as the handoff left it", titlesOf(session).length === 1, JSON.stringify(titlesOf(session)));
	claim(
		"control: the store names the reason (`cannot reenter`)",
		warnings.some((w) => w.includes("cannot reenter while another append is being published")),
		warnings.join(" | ").slice(0, 130),
	);
}

// ---- the shipped wiring: `project-handoff/index.ts`'s listener + `relabelHandoffChild` ---------
{
	const { ctx, session, warnings } = await harness("probe-deferred");
	ctx.on("session/event", (observed, event) => {
		if (observed !== session || event.type !== "user/message" || event.data.source.kind !== "user") return;
		relabelHandoffChild(ctx, observed, event.seq);
	});
	session.append("user/message", human("human", "检查？"), { surfaceOp: "append" });
	claim("nothing is written while the dispatch envelope is open", titlesOf(session).length === 1, JSON.stringify(titlesOf(session)));
	await flush();
	claim(
		"the deferred write lands after the envelope unwinds, exactly once",
		JSON.stringify(titlesOf(session)) === JSON.stringify([`${P}9f80b44`, `${P}检查？`]),
		JSON.stringify(titlesOf(session)),
	);
	claim(
		"no `title not updated` warning is logged",
		!warnings.some((w) => w.includes("handoff continuation title not updated")),
		warnings.join(" | ").slice(0, 130),
	);
}

console.log(failures.length === 0 ? "\nRESULT: PASS" : `\nRESULT: FAIL (${failures.length})`);
process.exit(failures.length === 0 ? 0 : 1);
