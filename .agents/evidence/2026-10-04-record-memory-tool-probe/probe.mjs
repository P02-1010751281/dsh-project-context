// Throwaway runtime probe (batch B, step 1): does a plugin-sourced, sessionless
// ctx.llm.stream() call with `tools` actually deliver tool-call-delta chunks, a block-end
// carrying the assembled call, and a tool-calls finish reason?
//
// Loaded through a `--patch` overlay pointing at this file; no profile on disk is touched.
//
// Two races were observed while building this and are the reason for the retry loop:
//   1. `llm` being injectable only proves the service exists. A call fired inside apply() got
//      NO_ADAPTER in 28 ms because the route's adapter had not registered yet.
//   2. Even after the route registers, its *auth* services (credentials / deepseekAccount) may
//      still be absent, which surfaces as MISSING_CREDENTIAL / ACCOUNT_SIGN_IN_REQUIRED — a
//      false negative that looks like a missing credential. Both are cheap local failures.
// So: wait for the route, then retry until a call produces something other than those two codes.
import { writeFileSync } from "node:fs";

export const name = "record-memory-tool-probe";
export const inject = ["llm"];

const OUT = "/tmp/record-memory-tool-probe/out.json";
const ROUTES = process.env.PROBE_PROVIDER ? [process.env.PROBE_PROVIDER] : ["deepseek-account", "deepseek-official"];
const AUTH_CODES = new Set(["ACCOUNT_SIGN_IN_REQUIRED", "MISSING_CREDENTIAL"]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const TOOLS = [
	{
		name: "probe_echo",
		description: "Record one short string value.",
		parameters: {
			type: "object",
			properties: { value: { type: "string", description: "the value to record" } },
			required: ["value"],
			additionalProperties: false,
		},
	},
];

export function apply(ctx) {
	const record = {
		startedAt: new Date().toISOString(),
		routes: ROUTES,
		providersSeen: null,
		attempts: [],
		result: null,
		completedAt: null,
		fatal: null,
	};
	const write = () => {
		try {
			writeFileSync(OUT, JSON.stringify(record, null, 2));
		} catch {}
	};
	write();

	const callOnce = async (route) => {
		const chunks = [];
		let failure = null;
		for await (const chunk of ctx.llm.stream({
			provider: route,
			model: "deepseek-flash",
			messages: [{ role: "user", content: [{ type: "text", text: 'Call the probe_echo tool with value "ok". Do not reply with text.' }] }],
			tools: TOOLS,
			maxTokens: 512,
		})) {
			const entry = { type: chunk.type };
			if (chunk.type === "block-start") Object.assign(entry, { index: chunk.index, blockType: chunk.blockType });
			if (chunk.type === "tool-call-delta")
				Object.assign(entry, { index: chunk.index, id: chunk.id, name: chunk.name ?? null, argumentsDelta: chunk.argumentsDelta });
			if (chunk.type === "block-end") Object.assign(entry, { index: chunk.index, block: chunk.block });
			if (chunk.type === "finish") Object.assign(entry, { reason: chunk.reason });
			if (chunk.type === "usage") Object.assign(entry, { usage: chunk.usage });
			if (chunk.type === "text-delta") Object.assign(entry, { text: chunk.text });
			if (chunk.type === "finish" && chunk.reason.kind === "error") failure = chunk.reason.failure;
			chunks.push(entry);
		}
		return { route, chunks, failure };
	};

	void (async () => {
		try {
			for (const route of ROUTES) {
				// (1) wait for the route itself, bounded.
				const deadline = Date.now() + 30_000;
				while (!ctx.llm.listProviders().some((info) => info.id === route)) {
					if (Date.now() > deadline) {
						record.providersSeen = ctx.llm.listProviders().map((info) => info.id);
						record.attempts.push({ route, attempt: 0, skipped: "route never registered within 30s" });
						write();
						break;
					}
					await sleep(100);
				}
				record.providersSeen = ctx.llm.listProviders().map((info) => info.id);
				write();
				if (record.attempts.some((a) => a.route === route && a.skipped)) continue;

				// (2) retry past the auth-service race.
				for (let attempt = 1; attempt <= 25; attempt++) {
					const outcome = await callOnce(route);
					record.attempts.push({
						route,
						attempt,
						at: new Date().toISOString(),
						failure: outcome.failure,
						chunkTypes: outcome.chunks.map((chunk) => chunk.type),
					});
					write();
					if (outcome.failure === null || !AUTH_CODES.has(outcome.failure.code)) {
						record.result = outcome;
						break;
					}
					await sleep(1000);
				}
				if (record.result) break;
			}
			record.completedAt = new Date().toISOString();
		} catch (error) {
			record.fatal = String((error && error.stack) || error);
		}
		write();
	})();
}
