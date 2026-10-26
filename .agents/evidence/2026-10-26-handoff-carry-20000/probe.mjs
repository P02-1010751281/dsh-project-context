/**
 * Offline witness for the handoff carry statement (batch U), driven through the built `lib/`.
 *
 * What it proves before any host restart: a handoff with the shipped recent budget carries the recent
 * tail and announces it as verbatim (or as trimmed when a section was cut at its render cap), and the
 * `## The user's last input` block is no longer rendered beside a tail that already carries it. With a
 * zero budget the seed says nothing was carried and the last-input block comes back, which is the case
 * that block was built for.
 *
 * Exit codes name the cause: 0 pass, 10 no tail at the shipped budget, 11 the last-input block is
 * duplicated beside a carried tail, 12 a clean tail is announced as trimmed, 13 a zero budget keeps
 * silent instead of saying nothing was carried.
 *
 * Run: node .agents/evidence/2026-10-26-handoff-carry-20000/probe.mjs
 */

import assert from "node:assert/strict";
import { handoffSplit } from "../../../lib/project-handoff/conversation.js";
import { SCAFFOLDING } from "../../../lib/project-handoff/language.js";
import { handoffArtifacts } from "../../../lib/project-handoff/perform.js";
import { DEFAULT_CONFIG } from "../../../lib/shared/config.js";

const ARCHIVE = { log: "/abs/.agents/memory/session-logs/session-parent/session.md", index: "/abs/.agents/memory/session-logs/INDEX.md" };
const FILES = "<read-files>\nsrc/project-handoff/summary.ts\n</read-files>";
const config = { ...DEFAULT_CONFIG, handoffBudgetRecentTokens: 20_000 };

function user(text) {
	return { role: "user", source: { kind: "user" }, content: [{ type: "text", text }] };
}
function assistant(text) {
	return { role: "assistant", source: { kind: "model" }, content: [{ type: "text", text }] };
}
/** A session shaped like a real turn: question, a long answer, then the user's decision. */
function session() {
	const longAnswer = `回答很长。${"x".repeat(3900)}`;
	return { id: "session-parent", header: { cwd: "/tmp/dsh-carry-probe" }, deriveMessages: () => [user("审计一下 dsh 的更新。"), assistant(longAnswer), user("2 + 3 要。1 的话和pi已一样就行")] };
}

const split = handoffSplit(session(), Math.round(config.handoffBudgetRecentTokens * 3.5));
if (split.tail.length === 0) {
	console.error("FAIL: the shipped budget carried no tail");
	process.exit(10);
}
const shipped = handoffArtifacts({ session: session(), config, language: "zh", fileOperations: FILES, archive: ARCHIVE, pointers: ARCHIVE, tail: split.tail, trimmedTail: split.trimmedTail }).prompt;

const zeroSplit = handoffSplit(session(), 0);
const zero = handoffArtifacts({ session: session(), config: { ...config, handoffBudgetRecentTokens: 0 }, language: "zh", fileOperations: FILES, archive: ARCHIVE, pointers: ARCHIVE, tail: zeroSplit.tail, trimmedTail: zeroSplit.trimmedTail }).prompt;

console.log("== shipped seed (budget 20000) ==");
console.log(shipped);
console.log("\n== zero-budget seed ==");
console.log(zero);

try {
	assert.ok(shipped.includes("<recent-conversation>"), "the tail rides in its block");
	assert.ok(shipped.includes(SCAFFOLDING.zh.continuationCarried), "a clean tail is announced as carried");
	assert.ok(!shipped.includes(SCAFFOLDING.zh.continuationTrimmed), "a clean tail is not announced as trimmed");
	assert.ok(!shipped.includes(SCAFFOLDING.zh.decisionHeading), "the last-input block is not duplicated beside a carrying tail");
	assert.ok(shipped.endsWith(SCAFFOLDING.zh.continuationClosing), "a carried tail keeps the usual closing");
	assert.ok(shipped.includes("2 + 3 要。1 的话和pi已一样就行"), "the user's own decision travels inside the tail");

	assert.ok(zero.includes(SCAFFOLDING.zh.continuationNothing), "a zero budget says nothing was carried");
	assert.ok(!zero.includes("<recent-conversation>") && !zero.includes(SCAFFOLDING.zh.continuationCarried));
	assert.ok(zero.includes(SCAFFOLDING.zh.decisionHeading), "and the last-input block comes back as the only carrier");
	assert.ok(zero.includes("2 + 3 要。1 的话和pi已一样就行"));
} catch (error) {
	const message = String(error && error.message);
	const code = message.includes("last-input block") ? 11 : message.includes("trimmed") ? 12 : 13;
	console.error(`FAIL (exit ${code}): ${message}`);
	process.exit(code);
}

console.log("\nRESULT: PASS — carried tail announced, no duplicated last-input block; zero budget says nothing was carried");
