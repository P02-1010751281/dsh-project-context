/**
 * The draft-object tail: a reply that completes one JSON object, adds prose, then starts a second
 * object and is cut before closing it.
 *
 * `parseJsonObject` (`src/shared/reply-json.ts`) strips an optional fence, tries `JSON.parse` on the
 * whole text, and otherwise parses the slice from the first `{` to the last `}`. When the model
 * starts a second object and never closes it, the last `}` is the *first* object's, so the scan
 * hands back the earlier — draft — object as if it were the reply's answer.
 *
 * This probe records the boundary of the R1 change rather than a defect in it: the memory pass has
 * read its reply first and accepted whatever parsed since it was written, so this shape is a
 * property of the shared decoder that both passes inherit. R1 aligned autolearn with the memory
 * pass; it did not create the shape. Fixing it means a span-aware "the parsed object must be the
 * last one started" rule applied to both passes, which is a new design decision, not a repair.
 *
 * Expected behaviour is ASSERTED so the record fails loudly if someone changes it: a fix has to
 * update this file and the residual note in `docs/batch-b-residual-decisions.md` together.
 *
 * Run: node .agents/evidence/2026-10-05-draft-object-tail-probe/probe.mjs
 * Measured 2026-10-05 against lib/ built from the then-current src/.
 */
import { parseConsolidation } from "../../../lib/shared/reply-json.js";
import { parseAutolearnReply } from "../../../lib/project-autolearn/parse.js";

/** The shape under test: a complete object, prose, then a second object cut before its close. */
const DRAFT_TAIL = "Let me reconsider that answer.";
let violations = 0;
function record(label, actual, expected) {
	const ok = actual === expected;
	if (!ok) violations++;
	console.log(`  ${ok ? "as recorded " : "CHANGED     "} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (recorded: ${JSON.stringify(expected)})`}`);
}

console.log("memory pass — the reply it would store from a draft-shaped answer:");
const memoryReply = `${JSON.stringify({ memory_markdown: "# Project Memory\n\n## Project\n- draft entry\n", context: { title: "t", summary: "draft", key_points: [], open_tasks: [] } })}\n\n${DRAFT_TAIL}\n${'{"memory_markdown":"# Project Memory\\n\\n## Project\\n- final en'}`;
const memory = parseConsolidation(memoryReply);
record("parsed", memory !== undefined, true);
record("entry stored", memory?.memory?.split("\n").filter(Boolean).pop(), "- draft entry");

console.log("autolearn pass — the skill it would use from the same shape:");
const autolearnReply = `${JSON.stringify({ skill: { name: "draft-skill", description: "d", body: "draft body", evidence: ["a"], candidate: true, reason: "r" }, need_sessions: [] })}\n\n${DRAFT_TAIL}\n${'{"skill":{"name":"final-skill","description":"d","body":"fi'}`;
const learned = parseAutolearnReply(autolearnReply);
record("parsed", learned !== undefined, true);
record("skill used", learned?.skill?.name, "draft-skill");

console.log("control — a fence and trailing prose start no new object, so the object IS the answer:");
const fenced = `\`\`\`json\n${JSON.stringify({ skill: { name: "kept-skill", description: "d", body: "b", evidence: [], candidate: false, reason: "r" }, need_sessions: [] })}\n\`\`\`\n\n${DRAFT_TAIL}`;
record("skill used", parseAutolearnReply(fenced)?.skill?.name, "kept-skill");

console.log(violations === 0
	? "\nRESULT: both passes take the earlier object (recorded residual, shared decoder)."
	: `\nRESULT: ${violations} recorded behaviour(s) changed — update this file and the residual note together.`);
process.exit(violations === 0 ? 0 : 1);
