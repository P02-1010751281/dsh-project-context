/**
 * Tests that the prompts state the bounds the code actually enforces.
 *
 * The defect this pins: both prompts stated a *word* hint ("below 6000 words", "below 3000 words")
 * where the write path enforces *characters* — a reply can satisfy the hint and still be cut, and
 * whatever sat at the end is lost with nothing said. Ported from pi's batch C
 * (`d02e869`'s first half and `024b3db`).
 *
 * (The handoff's summarizer prompt, which once carried a "under 900 words" line, was deleted with the
 * generated summary — the handoff builds its payload from mechanical parts only, so there is no such
 * prompt left to bound. The autolearn and consolidation prompts above are the remaining ones.)
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { basePrompt, backtrackPrompt } from "../lib/project-autolearn/prompt.js";
import { MAX_SKILL_DESCRIPTION_CHARS } from "../lib/project-autolearn/skill.js";
import { CONSOLIDATION_PROMPT_RULES, memoryBudgetRule } from "../lib/project-memory/consolidate.js";
import { MAX_SKILL_BODY_CHARS } from "../lib/shared/project-state.js";

/** A word-count hint is what the code does not enforce; no prompt may carry one. */
const WORD_HINT = /\b(?:below|under|at most)\s+\d[\d,]*\s+words?\b/i;

test("the consolidation prompt states the enforced character cap and the current size", () => {
	const rule = memoryBudgetRule(40_000, 12_345);
	assert.match(rule, /at or under 40000 characters/);
	assert.match(rule, /currently about 12345/);
	assert.match(rule, /hard cap in characters, not words/);
	assert.doesNotMatch(rule, WORD_HINT);
	// The cap is per project, so the line has to change with it — a fixed number in the static
	// rules would be a second source of truth again.
	assert.match(memoryBudgetRule(120_000, 0), /at or under 120000 characters/);
});

test("no consolidation rule states a word count", () => {
	for (const rule of CONSOLIDATION_PROMPT_RULES) assert.doesNotMatch(rule, WORD_HINT, rule);
	assert.doesNotMatch(CONSOLIDATION_PROMPT_RULES.join("\n"), /6000 words/);
});

test("both autolearn prompts state the enforced body and description caps", () => {
	const prompts = [
		basePrompt("/tmp/p", "# Project Memory", "# Project Context", "", "(none)"),
		backtrackPrompt("/tmp/p", "# Project Memory", "(none)", "(no extracts)"),
	];
	for (const prompt of prompts) {
		const body = /body under (\d+) characters/.exec(prompt);
		const description = /description under (\d+) characters/.exec(prompt);
		assert.ok(body, "the prompt states the body cap");
		assert.ok(description, "the prompt states the description cap");
		// The numbers must be the same constants the validator truncates with, not a pasted copy.
		assert.equal(Number(body[1]), MAX_SKILL_BODY_CHARS);
		assert.equal(Number(description[1]), MAX_SKILL_DESCRIPTION_CHARS);
		assert.doesNotMatch(prompt, WORD_HINT);
	}
});
