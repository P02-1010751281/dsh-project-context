/**
 * R1 safety probe — the autolearn TEXT path.
 *
 * Question: if a reply is cut by the output cap and the braced-object scan still parses it, is the
 * parsed decision ever a PARTIAL one (a truncated skill body, or a body different from the one the
 * full reply carried)?
 *
 * Why it matters: R1 proposes accepting a `max-tokens` reply whose text parses, instead of
 * discarding it and re-asking. That is only safe if "parsed" implies "every parsed member was fully
 * emitted". `parseJsonObject` runs a raw `JSON.parse` over the emitted bytes (after an optional
 * fence strip, or over the first `{` … last `}` slice), so the claim should hold — this records the
 * evidence instead of asserting it.
 *
 * Run: node .agents/evidence/2026-10-05-autolearn-cut-parse-probe/probe.mjs
 * Measured 2026-10-05 against lib/ built from the then-current src/ (dbf8124).
 */
import { parseAutolearn } from "../../../lib/project-autolearn/parse.js";
import { parseJsonObject } from "../../../lib/shared/reply-json.js";

const object = JSON.stringify({
	skill: {
		name: "probe-skill",
		description: "when the probe fires",
		body: "Step 1: read `${VAR}` and match the literal `{\"a\":1}` shape.\nStep 2: run the command.\nStep 3: verify the tail.",
		evidence: ["session-aaa", "session-bbb"],
		candidate: false,
		reason: "probe",
	},
	need_sessions: ["session-ccc"],
});

/** The three reply shapes a model actually emits, all carrying the same complete object. */
const SHAPES = {
	"bare json": object,
	"fenced json": `\`\`\`json\n${object}\n\`\`\``,
	"json + trailing prose": `${object}\n\nThat is the decision this pass should record, and here is one more sentence of commentary that a model may append before finishing.`,
};

let failures = 0;
for (const [label, full] of Object.entries(SHAPES)) {
	const expected = parseAutolearn(full);
	if (expected.skill === null) throw new Error(`${label}: fixture must parse to a skill`);
	const fullBody = expected.skill.body;

	let parsed = 0;
	let fullBodyCount = 0;
	const bad = [];
	for (let i = 1; i < full.length; i++) {
		const cut = full.slice(0, i);
		if (parseJsonObject(cut) === undefined) continue;
		parsed++;
		const decision = parseAutolearn(cut);
		if (decision.skill === null) {
			// A parse that reports "nothing to propose": the object closed but carried no skill. This is
			// the class R1 would newly accept, so it must be an honest null, never a truncated proposal.
			bad.push(`cut@${i}: parsed to skill:null`);
			continue;
		}
		if (decision.skill.body !== fullBody) bad.push(`cut@${i}: body differs (${decision.skill.body.length} vs ${fullBody.length} chars)`);
		else fullBodyCount++;
	}

	console.log(`${label}:`);
	console.log(`  reply chars                 : ${full.length}`);
	console.log(`  cuts that parse             : ${parsed}`);
	console.log(`  -> full, unmodified body    : ${fullBodyCount}`);
	console.log(`  -> PARTIAL/DIFFERENT body   : ${bad.length}`);
	for (const line of bad.slice(0, 5)) console.log(`     ${line}`);
	if (bad.length > 0) failures++;
}

console.log(failures === 0
	? "\nRESULT: no cut of any shape parsed into a partial or altered decision."
	: `\nRESULT: ${failures} shape(s) produced a partial/altered decision.`);
process.exit(failures === 0 ? 0 : 1);
