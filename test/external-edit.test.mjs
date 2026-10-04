/**
 * Tests for batch D: a reply built from a memory that has since changed must not be published.
 *
 * The defect this pins: the pass reads the memory, builds a reply from it, and the write path
 * appended that reply unconditionally. An edit landing during the model call was adopted into the
 * journal and then superseded by the same call's render, so "adopted" only ever meant "entered the
 * history" — the hand edit was reverted on disk.
 *
 * Ported from the pi sibling's `tests/external-edit-test.mjs`; the fixtures here drive the real
 * write path (`consolidateProject`) with a model stub that edits MEMORY.md mid-call, which is the
 * actual race rather than a synthetic one.
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { consolidateProject } from "../lib/project-memory/index.js";
import { loadMemory, memoryJournalFile, readMemoryJournal, recordMemoryDocument } from "../lib/project-memory/memory-store.js";
import { nextRenderSupersedes } from "../lib/project-memory/record.js";
import { resolvePluginConfig } from "../lib/shared/config.js";
import { memoryFile } from "../lib/shared/project-state.js";

const SEED = "# Project Memory\n\n- the memory this pass read before the model call.\n";
const HAND_EDIT = "# Project Memory\n\n- the hand edit that landed while the reply was being built.\n";
const REPLY_MEMORY = "# Project Memory\n\n- the reply's own line, which must never reach the file while the edit is newer.\n";
const REPLY = JSON.stringify({ memory_markdown: REPLY_MEMORY, context: { title: "stale", summary: "s", key_points: [], open_tasks: [] } });

/** One project with a journal-backed memory, plus a model stub that can act mid-call. */
async function fixture({ beforeReply } = {}) {
	const root = await mkdtemp(path.join(tmpdir(), "dsh-external-edit-"));
	await mkdir(path.join(root, ".agents", "memory"), { recursive: true });
	await recordMemoryDocument(root, SEED);
	// Backdate the journal so a hand edit written during the model call is unambiguously newer.
	const past = new Date(Date.now() - 60_000);
	await utimes(memoryJournalFile(root), past, past);
	const infos = [];
	const ctx = {
		logger: { info: (message) => infos.push(message), warn: () => {} },
		llm: {
			resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
			stream() {
				return (async function* generate() {
					if (beforeReply) await beforeReply();
					yield { type: "text-delta", index: 0, text: REPLY };
					yield { type: "finish", reason: { kind: "stop" } };
				})();
			},
		},
	};
	const agent = {
		options: { provider: "test-provider", model: "test-model" },
		session: { id: "session-stale", header: { cwd: root, createdAt: Date.now() }, snapshotEvents: () => [], deriveMessages: () => [], requestHeader: () => undefined },
	};
	const config = resolvePluginConfig({ maxTokens: 8_192, maxOutputTokens: 32_768, consolidateTurns: 1, maxMemoryChars: 32_000, forceDedupeMs: 0 });
	return { root, ctx, agent, config, infos, errors: () => readFile(path.join(root, ".agents", "memory", "errors.log"), "utf8").catch(() => "") };
}

test("nextRenderSupersedes refuses only a different, non-empty render that is not our own output", () => {
	assert.equal(nextRenderSupersedes("a", "b", "c"), true, "a newer different render supersedes the reply");
	assert.equal(nextRenderSupersedes("a", "", "c"), false, "an empty render is not a newer document");
	assert.equal(nextRenderSupersedes("a", "a", "c"), false, "the render this pass read is not newer");
	assert.equal(nextRenderSupersedes("a", "c", "c"), false, "the render this pass is about to write is our own output");
});

test("an edit landing during the model call is kept and the reply is not published", async () => {
	const { root, ctx, agent, config, errors, infos } = await fixture({ beforeReply: () => writeFile(memoryFile(root), HAND_EDIT, "utf8") });
	const report = await consolidateProject(ctx, config, agent, { force: true, silent: false });

	assert.equal(report, "stale-context", "the context still landed, but the memory reply did not");
	const stored = await readFile(memoryFile(root), "utf8");
	assert.equal(stored, HAND_EDIT, "the hand edit stays on disk");
	assert.ok(!stored.includes("must never reach the file"), "the reply's memory is not published");
	// The edit is in the history too: refusing is not the same as discarding.
	const entries = (await readMemoryJournal(memoryJournalFile(root))).entries;
	assert.ok(entries.some((entry) => entry.text.includes("the hand edit that landed")), "the newer bytes entered the journal");
	assert.match(await errors(), /the memory changed while this pass's reply was being built/, "the refusal is recorded");
	// The receipt must not claim the write that was refused.
	assert.ok(infos.some((line) => line.includes("project context updated")), "the receipt names what did land");
	assert.ok(!infos.some((line) => line.includes("project memory and context updated")), "a kept memory is not reported as written");
});

test("the same pass publishes the reply when nothing changed under it", async () => {
	const { root, ctx, agent, config } = await fixture();
	const report = await consolidateProject(ctx, config, agent, { force: true, silent: false });

	assert.equal(report, "updated");
	const stored = await readFile(memoryFile(root), "utf8");
	assert.ok(stored.includes("must never reach the file"), "without a race the reply is published");
});

test("a caller that passes no basisKey keeps the previous behaviour byte for byte", async () => {
	const { root } = await fixture();
	await writeFile(memoryFile(root), HAND_EDIT, "utf8");
	// The legacy import and the existing suites call it this way: no baseline, no refusal.
	const result = await recordMemoryDocument(root, "# Project Memory\n\n- published without a baseline.\n");
	assert.deepEqual(result, { written: true });
	assert.match((await loadMemory(root)).text, /published without a baseline/);
});
