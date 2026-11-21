/**
 * The rewrite loss gate's pure half: `backtickedLiterals` / `missingLiteralsBetween`.
 *
 * Tier C counts structure, so a pass that regenerates the whole document in condensed wording reports
 * `0 0 0` and status `updated` while facts vanish. This suite pins the measure that names that loss
 * (`docs/memory-rewrite-loss-gate-spec.md` §3 A), including the two rules a review forced:
 *  - **pairing before filtering** (§9.1): filtering short spans at the match stage lets one span's
 *    closing backtick pair with the next span's opening one, which reports literals the document never
 *    carried. The first test is that exact case.
 *  - **bare text is not a loss**: a literal that kept its meaning and lost its backticks is present.
 *
 * The measure is document-level, so these tests also pin what it deliberately does *not* say: a
 * literal another entry still mentions, or a rename, is outside its reach — that is why the count is
 * reported with samples and never used as an admission gate.
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { MISSING_LITERAL_SAMPLES, backtickedLiterals, missingLiteralsBetween } from "../lib/project-memory/memory-store.js";

test("a short span does not steal the next span's opening backtick", () => {
	// §9.1's case. Filtering `[^`]{3,}` at the match stage reads the closing backtick of `` `ab` `` as
	// the opening of `` ` then ` `` and reports " then " as a literal the document never carried. Pairing
	// each line once, then dropping the short span, leaves only the real one.
	const line = "`ab` then `failureCodeOf`";
	assert.deepEqual(backtickedLiterals(line), ["failureCodeOf"]);
	// The same shape with a different short span: filtering at the match stage reports " x " here.
	assert.deepEqual(backtickedLiterals("`a` x `bcd`"), ["bcd"]);
});

test("a literal that survived as bare text was not lost", () => {
	const previous = "# Project Memory\n\n## Project\n- calls `failureCodeOf` before reporting\n";
	const next = "# Project Memory\n\n## Project\n- calls failureCodeOf before reporting\n";
	assert.deepEqual(missingLiteralsBetween(previous, next), { count: 0, samples: [] }, "only the backticks left, not the fact");
});

test("a literal that only survives inside a longer word is a real loss", () => {
	// The first version asked `next.includes(literal)`, which reads `memoryComparisonKey` inside
	// `memoryComparisonKeyWithDrop` and `main` inside "the remaining domain" as present. That is a
	// systematic under-report in the one direction that hides what this measure exists to see, so a
	// bare mention has to sit on a word boundary.
	const previous = "- `memoryComparisonKey` normalizes the document\n- `main` is the entry point\n- `dsh` loads it\n";
	const next = "- `memoryComparisonKeyWithDrop` normalizes the document\n- it belongs to the remaining domain\n- the dsh project loads it\n";
	assert.deepEqual(missingLiteralsBetween(previous, next), { count: 2, samples: ["memoryComparisonKey", "main"] });
	// A literal resting against punctuation is still a mention: the token is there.
	assert.equal(missingLiteralsBetween("- calls `failureCodeOf` first\n", "- calls failureCodeOf(...) first\n").count, 0);
});

test("a CJK literal is a whole token, not a substring of the neighbouring word", () => {
	// Three characters, because `MIN_LITERAL_CHARS` drops shorter spans in every script: the spec's
	// floor is 3, and a two-character CJK literal is below it even though it names a word.
	assert.equal(missingLiteralsBetween("- `记忆库` 是本项目的一条事实\n", "- 记忆库扩容是本项目的一条事实\n").count, 1, "记忆库 inside 记忆库扩容 is a different token");
	assert.equal(missingLiteralsBetween("- `记忆库` 是本项目的一条事实\n", "- 记忆库 是本项目的一条事实\n").count, 0, "a free-standing 记忆库 is the same fact");
});

test("a literal that left the document is reported with its own sample", () => {
	const previous = "# Project Memory\n\n## Project\n- root `/etc/nixos` holds the flake\n- `isHeadingOnlyDocument` gates the skeleton\n";
	const next = "# Project Memory\n\n## Project\n- root `/etc/nixos` holds the flake\n- the skeleton gate is unchanged\n";
	const measured = missingLiteralsBetween(previous, next);
	assert.equal(measured.count, 1, "one fact left, one stayed");
	assert.deepEqual(measured.samples, ["isHeadingOnlyDocument"], "the sample is the literal itself, not the whole line");
	assert.equal(missingLiteralsBetween(next, previous).count, 0, "the measure is directional: nothing came back");
});

test("a backtick pair split across two lines matches, so it is never spliced into a literal", () => {
	// One unpaired backtick on each line: pairing across lines would manufacture the literal "alpha beta".
	assert.deepEqual(backtickedLiterals("a `alpha\nbeta` b"), []);
	assert.equal(missingLiteralsBetween("a `alpha\nbeta` b", "nothing").count, 0);
});

test("the same literal twice is one fact", () => {
	assert.deepEqual(backtickedLiterals("- `kept` and `kept` again"), ["kept"]);
	assert.equal(missingLiteralsBetween("- `kept`\n- `kept` again", "- nothing").count, 1);
});

test("spans shorter than three characters name no fact, and are trimmed before the length test", () => {
	assert.deepEqual(backtickedLiterals("`a` `ab` `abc` ` a `"), ["abc"]);
	// A span that trims to nothing is not a literal either.
	assert.deepEqual(backtickedLiterals("`` `` `x`"), []);
});

test("the count is the whole loss even when the samples are capped", () => {
	const previous = Array.from({ length: 15 }, (_, index) => `- \`fact-${index}\``).join("\n");
	const measured = missingLiteralsBetween(previous, "- nothing left");
	assert.equal(measured.count, 15, "every missing literal is counted");
	assert.equal(measured.samples.length, MISSING_LITERAL_SAMPLES, "one log line may not carry the whole document");
	assert.deepEqual(measured.samples, Array.from({ length: MISSING_LITERAL_SAMPLES }, (_, index) => `fact-${index}`), "samples keep document order");
});

test("an unchanged document measures zero, and an empty previous document has nothing to lose", () => {
	const document = "# Project Memory\n\n## Project\n- `alpha` and `/etc/nixos`\n";
	assert.deepEqual(missingLiteralsBetween(document, document), { count: 0, samples: [] });
	assert.deepEqual(missingLiteralsBetween("", document), { count: 0, samples: [] });
	assert.equal(missingLiteralsBetween(document, "").count, 2, "an emptied document loses every literal it had");
});
