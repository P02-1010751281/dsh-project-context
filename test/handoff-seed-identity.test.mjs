/**
 * Pins the seed's own identity stamp (AOCI borrow ②).
 *
 * The gap: `HANDOFF.md` is one file per project and is overwritten by the next handoff, while a
 * child session keeps the message it was seeded with forever. Nothing recorded which handoff a given
 * child actually read, so the forensics question — "is this seed the one that handoff produced?" —
 * could only be answered by re-rendering the seed with the scaffolding that happens to be current.
 * The stamp is a digest of the seed's own body, so the message proves its own provenance.
 *
 * The conservative half matters as much: `isHandoffContinuationText` is structural, and a seed that
 * stopped matching it would be counted as the child's own first human turn. Every shape is therefore
 * checked for the six closings and the two `<handoff>` markers, not only for the new line.
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { SCAFFOLDING, isHandoffContinuationText } from "../lib/project-handoff/language.js";
import { handoffArtifacts } from "../lib/project-handoff/perform.js";
import { SEED_ID_LABEL, continuation, seedIdentityOf } from "../lib/project-handoff/summary.js";
import { DEFAULT_CONFIG } from "../lib/shared/config.js";
import { sessionViews } from "./session-views.mjs";

const ARCHIVE = { log: "/abs/logs/session-parent/session.md", index: "/abs/logs/INDEX.md" };
const FILES = "<read-files>\nsrc/project-handoff/summary.ts\n</read-files>";
const TAIL = "<recent-conversation>\nUser: 看 journal\nAssistant: 看过了\n</recent-conversation>";
const DECISION = { kind: "message", text: "重启吧", entries: [] };
const PENDING = "要先跑一次 pnpm test 吗？";

function userMessage(text) {
	return { role: "user", source: { kind: "user" }, content: [{ type: "text", text }] };
}

function assistantMessage(text) {
	return { role: "assistant", source: { kind: "model" }, content: [{ type: "text", text }] };
}

function fakeSession(messages) {
	return { id: "session-parent", header: { cwd: "/tmp/dsh-seed-identity" }, ...sessionViews(messages) };
}

/** Every shape `continuation` can produce: two languages times the three closings. */
function everyShape() {
	const shapes = [];
	for (const language of ["en", "zh"]) {
		const text = SCAFFOLDING[language];
		shapes.push({ name: `${language} closing`, language, args: [language], closing: text.continuationClosing });
		shapes.push({ name: `${language} pending`, language, args: [language, PENDING], closing: text.pendingWait });
		shapes.push({ name: `${language} decision`, language, args: [language, undefined, DECISION], closing: text.decisionClosing });
	}
	return shapes.map((shape) => {
		const [language, pending, decision] = shape.args;
		// A decision block is rendered only when the tail cannot carry it, so that shape carries none.
		const tail = shape.closing === SCAFFOLDING[language].decisionClosing ? "" : TAIL;
		return {
			name: shape.name,
			closing: shape.closing,
			prompt: continuation("session-parent", FILES, tail, ARCHIVE, language, pending, decision),
		};
	});
}

test("every seed shape carries one identity line and verifies against its own body", () => {
	for (const { name, prompt } of everyShape()) {
		const lines = prompt.split("\n").filter((line) => line.startsWith(SEED_ID_LABEL));
		assert.equal(lines.length, 1, `${name}: exactly one identity line`);
		const identity = seedIdentityOf(prompt);
		assert.ok(identity !== undefined, `${name}: the identity line is readable`);
		assert.match(identity.id, /^[0-9a-f]{12}$/, `${name}: the id is 12 hex characters`);
		assert.equal(identity.verified, true, `${name}: the body still hashes to the stamped id`);
	}
});

test("the stamp covers the carried payload, so an edited seed no longer verifies", () => {
	const prompt = continuation("session-parent", FILES, TAIL, ARCHIVE);
	assert.equal(seedIdentityOf(prompt)?.verified, true);
	// One character inside the carried tail is a different seed, and the stamp is not recomputed.
	const tampered = prompt.replace("看过了", "看过了。");
	assert.notEqual(tampered, prompt);
	const identity = seedIdentityOf(tampered);
	assert.ok(identity !== undefined, "the tampered seed still carries a line");
	assert.equal(identity.verified, false, "the body no longer matches its own stamp");
});

test("the id is deterministic for one handoff and differs across parents", () => {
	const first = continuation("session-parent", FILES, TAIL, ARCHIVE);
	const again = continuation("session-parent", FILES, TAIL, ARCHIVE);
	assert.deepEqual(seedIdentityOf(first), seedIdentityOf(again), "the same handoff stamps the same id");
	const other = continuation("session-other", FILES, TAIL, ARCHIVE);
	assert.notEqual(seedIdentityOf(other)?.id, seedIdentityOf(first)?.id, "a different parent is a different seed");
});

test("the identity stamp does not disturb the structural judgement", () => {
	for (const { name, prompt, closing } of everyShape()) {
		assert.ok(prompt.includes("<handoff>") && prompt.includes("</handoff>"), `${name}: both markers survive`);
		assert.ok(prompt.trimEnd().endsWith(closing), `${name}: the closing is still last`);
		assert.equal(isHandoffContinuationText(prompt), true, `${name}: still recognized as a generated seed`);
		// The negative control: the same text with the identity line removed is still a seed — the
		// predicate never depended on the stamp — so a red here would have to come from the closings.
		const withoutLine = prompt.split("\n").filter((line) => !line.startsWith(SEED_ID_LABEL)).join("\n");
		assert.equal(isHandoffContinuationText(withoutLine), true, `${name}: the stamp is not what makes it a seed`);
	}
});

test("a seed written before this existed has no identity line", () => {
	const prompt = continuation("session-parent", FILES, TAIL, ARCHIVE);
	const legacy = prompt.split("\n").filter((line) => !line.startsWith(SEED_ID_LABEL)).join("\n");
	assert.equal(seedIdentityOf(legacy), undefined, "no line means no claim, not a failed one");
	assert.equal(seedIdentityOf("not a seed at all"), undefined);
});

test("a chained handoff keeps its own id even when the tail carries the parent's seed", () => {
	// A handoff child that hands off again carries its own seed inside the tail, so the successor's
	// message holds two identity lines. The details block comes first, and only that one is removed for
	// the digest — otherwise the child's id could never be verified from a chained seed.
	const parentSeed = continuation("session-grandparent", FILES, TAIL, ARCHIVE);
	const chained = continuation("session-parent", FILES, parentSeed, ARCHIVE);
	const ids = chained.split("\n").filter((line) => line.startsWith(SEED_ID_LABEL));
	assert.equal(ids.length, 2, "the carried seed's line rides along in the tail");
	const identity = seedIdentityOf(chained);
	assert.ok(identity !== undefined);
	assert.equal(identity.verified, true, "the new seed still verifies against its own body");
	assert.notEqual(identity.id, seedIdentityOf(parentSeed)?.id, "and it is the child's id, not the grandparent's");
	assert.equal(ids[0], `${SEED_ID_LABEL}${identity.id}`, "the details block holds the identifying line");
});

test("the archived document records the id of the seed it describes", () => {
	const session = fakeSession([userMessage("先看 journal"), assistantMessage("看过了，重启即可。")]);
	const { document, prompt } = handoffArtifacts({
		session,
		config: DEFAULT_CONFIG,
		language: "en",
		fileOperations: FILES,
		archive: ARCHIVE,
		pointers: ARCHIVE,
		tail: TAIL,
	});
	const id = seedIdentityOf(prompt)?.id;
	assert.ok(id !== undefined);
	assert.ok(document.includes(`${SEED_ID_LABEL}${id}`), "the document names the seed it was built with");
	assert.equal(seedIdentityOf(document)?.verified, false, "the document is not a seed: its body hashes differently");
});
