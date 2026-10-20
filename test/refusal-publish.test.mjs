/**
 * Tests for batch T2: a refused reply must not publish its context section either.
 *
 * The defect this pins: the context write ran for every outcome, so a reply the plugin refused to store
 * still replaced CONTEXT.md — and a context write is a whole-file replacement, which is how a curated
 * open-task list came back in pi's field case. The ruling (2026-10-20) also covers the local
 * `fallbackUpdate` placeholder: a refused pass is a pass that decided nothing, so it publishes nothing,
 * and the session-derived placeholder is not the reply's context and is not published in its place.
 *
 * The positive control is the third case below: the same fresh-project shape with no refusal really does
 * publish the placeholder, so the gate is "refused", not "never write a context".
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { consolidateProject } from "../lib/project-memory/index.js";
import { memoryJournalFile, recordMemoryDocument } from "../lib/project-memory/memory-store.js";
import { resolvePluginConfig } from "../lib/shared/config.js";
import { contextFile, memoryFile } from "../lib/shared/project-state.js";

const SEED = "# Project Memory\n\n- the memory this pass read before the model call.\n";
const HAND_EDIT = "# Project Memory\n\n- the hand edit that landed while the reply was being built.\n";
// The reply carries the complete four-section document batch Q2 requires of any reply aimed at a store
// that already holds one: a partial document cannot be merged into this free-form store.
const REPLY_MEMORY = "# Project Memory\n\n## Project\n- the reply's own line, which must never reach the file while the edit is newer.\n\n## Invariants\n- i\n\n## Pitfalls\n- p\n\n## Index\n- x\n";
const CURATED_CONTEXT = "# Project Context\n\n## Summary\n- a curated open task that must survive a refused pass\n";
/** The same reply with no context member at all, which is what makes the local fallback the only candidate. */
const REPLY_WITHOUT_CONTEXT = JSON.stringify({ memory_markdown: REPLY_MEMORY });
const REPLY_WITH_CONTEXT = JSON.stringify({ memory_markdown: REPLY_MEMORY, context: { title: "stale", summary: "s", key_points: [], open_tasks: [] } });

/**
 * One project with a journal-backed memory and a model stub. `race` writes the hand edit while the model
 * call is in flight, which is the real ordering: the reply is built from the memory the pass read, and the
 * write path then finds a newer one on disk and refuses.
 */
async function fixture({ reply, race: handEditDuringCall = false } = {}) {
	const root = await mkdtemp(path.join(tmpdir(), "dsh-refusal-publish-"));
	await mkdir(path.join(root, ".agents", "memory"), { recursive: true });
	await recordMemoryDocument(root, SEED);
	// Backdate the journal so a hand edit written during the model call is unambiguously newer.
	const past = new Date(Date.now() - 60_000);
	await utimes(memoryJournalFile(root), past, past);
	const ctx = {
		logger: { info: () => {}, warn: () => {} },
		llm: {
			resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
			stream() {
				return (async function* generate() {
					if (handEditDuringCall) await writeFile(memoryFile(root), HAND_EDIT, "utf8");
					yield { type: "text-delta", index: 0, text: reply };
					yield { type: "finish", reason: { kind: "stop" } };
				})();
			},
		},
	};
	const agent = {
		options: { provider: "test-provider", model: "test-model" },
		session: { id: "session-refusal-publish", header: { cwd: root, createdAt: Date.now() }, snapshotEvents: () => [], deriveMessages: () => [], requestHeader: () => undefined },
	};
	const config = resolvePluginConfig({ maxTokens: 8_192, maxOutputTokens: 32_768, consolidateTurns: 1, maxMemoryChars: 32_000, forceDedupeMs: 0 });
	const errors = () => readFile(path.join(root, ".agents", "memory", "errors.log"), "utf8").catch(() => "");
	return { root, ctx, agent, config, errors };
}

test("a refused reply leaves a curated CONTEXT.md byte-identical", async () => {
	// The field case: the reply was built from an older memory, so its context section is just as stale,
	// and publishing it reverts the curated file the pass raced.
	const { root, ctx, agent, config, errors } = await fixture({ reply: REPLY_WITH_CONTEXT, race: true });
	await writeFile(contextFile(root), CURATED_CONTEXT, "utf8");

	const report = await consolidateProject(ctx, config, agent, { force: true, silent: true });

	assert.equal(report.status, "stale", `a refusal publishes nothing (got ${JSON.stringify(report)})`);
	assert.equal(report.memoryWritten, false);
	assert.equal(report.contextWritten, false);
	assert.equal(await readFile(contextFile(root), "utf8"), CURATED_CONTEXT, "the curated context is not reverted");
	assert.match(await errors(), /the refused reply's context section was not published; the previous CONTEXT\.md stays effective/);
});

test("a fresh project gets no placeholder context from a refused pass", async () => {
	// No CONTEXT.md exists, so `fallbackUpdate` would normally supply one; the ruling is that a refused
	// pass decides nothing, and the line must not call the session-derived placeholder the reply's section.
	const { root, ctx, agent, config, errors } = await fixture({ reply: REPLY_WITHOUT_CONTEXT, race: true });

	const report = await consolidateProject(ctx, config, agent, { force: true, silent: true });

	assert.equal(report.status, "stale", `the memory raced, so nothing is published (got ${JSON.stringify(report)})`);
	assert.equal(report.contextWritten, false);
	await assert.rejects(readFile(contextFile(root), "utf8"), "the fallback placeholder is not published either");
	const log = await errors();
	assert.match(log, /the refused pass wrote no CONTEXT\.md \(the reply carried no context section\)/);
	assert.doesNotMatch(log, /the refused reply's context section/, "the placeholder is not called the reply's section");
});

test("the same fresh-project shape publishes the fallback when nothing was refused", async () => {
	// The control: without a race the memory lands and the placeholder really is written, so the gate
	// above is the refusal and not "a context is never written from the fallback".
	const { root, ctx, agent, config } = await fixture({ reply: REPLY_WITHOUT_CONTEXT });

	const report = await consolidateProject(ctx, config, agent, { force: true, silent: true });

	assert.equal(report.status, "updated", `the reply lands (got ${JSON.stringify(report)})`);
	assert.equal(report.memoryWritten, true);
	assert.equal(report.contextWritten, true, "the fallback is the only context candidate and it lands");
	const document = await readFile(contextFile(root), "utf8");
	assert.match(document, /Session recorded/, "the placeholder names itself, not the reply");
	assert.doesNotMatch(document, /stale/, "the reply carried no context to publish");
});
