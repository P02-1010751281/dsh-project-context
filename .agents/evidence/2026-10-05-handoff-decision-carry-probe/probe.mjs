/**
 * Read-only probe: can a handoff carry the user's last `ask_user_question` decision verbatim?
 *
 * It answers the precondition the A proposal states -- that `session.deriveMessages()` exposes the
 * `ask_user_question` tool call (question text plus structured options) AND its matching tool
 * result (the structured `selected` answer) -- by replaying the two functions `deriveMessages()`
 * itself calls, over an archived session log:
 *
 *   Session.deriveMessages()  ->  foldSurface(events)  ->  deriveEventMessage(node)  per surface node
 *
 * No host, no session store write, no network. Usage, from the repo root:
 *
 *   node .agents/evidence/2026-10-05-handoff-decision-carry-probe/probe.mjs \
 *     .agents/memory/session-logs/<session-id>/session.jsonl
 *
 * The first log line is the `session` header (no `seq`); the rest are events whose `seq` starts at
 * 0 and is contiguous, which `foldSurface` asserts.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const { foldSurface, deriveEventMessage } = await import(
	resolve(root, "node_modules/@deepseek-ai/dsh-session/lib/index.js")
);
const { textAsksQuestion } = await import(resolve(root, "lib/project-handoff/conversation.js"));

const file = process.argv[2];
if (file === undefined) {
	console.error("usage: node probe.mjs <path/to/session.jsonl>");
	process.exit(2);
}

const events = readFileSync(file, "utf8")
	.split("\n")
	.filter((line) => line.trim().length > 0)
	.map((line) => JSON.parse(line))
	.filter((event) => event.type !== "session");
const bySeq = new Map(events.map((event) => [event.seq, event]));

/** Exactly what `Session.deriveMessages()` returns: one message per surface node, nulls dropped. */
function deriveMessages() {
	const fold = foldSurface(events);
	const messages = [];
	for (const node of fold.nodes) {
		const seq = typeof node === "object" ? (node.seq ?? node.node) : node;
		const event = bySeq.get(seq);
		if (event === undefined) continue;
		const message = deriveEventMessage(event, fold.projectedMessages);
		if (message) messages.push({ seq: event.seq, event: event.type, message });
	}
	return messages;
}

const messages = deriveMessages();
console.log(`derived messages: ${messages.length} (from ${events.length} events)`);

const textOf = (message) =>
	(message.content ?? [])
		.filter((block) => block.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n")
		.trim();

// (1) The ask_user_question half: an assistant tool-call block carrying name + arguments.
const calls = new Map();
for (const { message } of messages) {
	if (message.role !== "assistant") continue;
	for (const block of message.content ?? []) {
		if (block.type === "tool-call" && block.name === "ask_user_question") calls.set(block.id, block);
	}
}
console.log(`ask_user_question tool-call blocks: ${calls.size}`);

for (const [id, block] of calls) {
	const args = JSON.parse(block.arguments);
	console.log(`\n=== call ${id} ===`);
	for (const question of args.questions) {
		console.log(`header:   ${question.header}`);
		console.log(`question: ${question.question}`);
		for (const option of question.options) console.log(`  option: ${JSON.stringify(option.label)}`);
	}
	// (2) The result half: role 'tool' with source {kind:'tool', callId} and a JSON text block.
	const result = messages.find(
		({ message }) => message.role === "tool" && message.source?.callId === id,
	);
	console.log(`matching tool result: ${result === undefined ? "MISSING" : `seq ${result.seq}`}`);
	if (result === undefined) continue;
	console.log(`source: ${JSON.stringify(result.message.source)}`);
	const raw = textOf(result.message);
	console.log(`content: ${JSON.stringify(raw)}`);
	try {
		const parsed = JSON.parse(raw);
		console.log(`selected: ${JSON.stringify(parsed.answers?.map((a) => a.selected))}`);
	} catch {
		console.log("content is not bare JSON");
	}
}

// (3) What the shipped code sees: `pendingQuestion()` reads text blocks of user/assistant only.
let last;
for (const { message } of messages) {
	if (message.role !== "user" && message.role !== "assistant") continue;
	const text = textOf(message);
	if (text.length > 0) last = { role: message.role, text };
}
console.log(
	`\ncurrent-code view: last conversational role=${last?.role} textLen=${last?.text.length} textAsksQuestion=${textAsksQuestion(last?.text ?? "")}`,
);
