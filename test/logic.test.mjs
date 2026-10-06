/**
 * Unit tests for the pure plugin logic: threshold math, ratio/token parsing,
 * conversation splitting, CONTEXT.md rendering, the mechanical session index,
 * the consolidation/autolearn parsers, the handoff watcher, config validation,
 * the atomic writers and the session-log append path. Run `pnpm test`, which
 * builds `lib/` first and then runs `node --test test/*.test.mjs`.
 */

import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { apply } from "../lib/project-handoff/index.js";
import { apply as applyContext } from "../lib/project-context/index.js";
import { pendingRetire } from "../lib/project-handoff/state.js";
import { maybeAutoHandoff } from "../lib/project-handoff/auto.js";
import { createChildSession, seedChildSession } from "../lib/project-handoff/child.js";
import { HandoffDeferred, handoffFailureIsTransient } from "../lib/project-handoff/classify.js";
import { USAGE, parseRatio, parseTokenCount, runManual, settingPatch, statusText } from "../lib/project-handoff/command.js";
import { pendingQuestion, textAsksQuestion } from "../lib/project-handoff/conversation.js";
import { turnStartedAfter } from "../lib/project-handoff/guard.js";
import { continuation } from "../lib/project-handoff/summary.js";
import { MIN_DROP_TOKENS, qualityLimit, resolveThreshold, thresholdRefusal, thresholdRefusalText } from "../lib/project-handoff/threshold.js";
import { measuredContext, projectionEnvelope } from "../lib/project-handoff/runtime.js";
import { DEFAULT_CONFIG, resolvePluginConfig } from "../lib/shared/config.js";
import { renderContextDocument } from "../lib/project-memory/context-doc.js";
import { consolidateProjectState, CONSOLIDATION_PROMPT_RULES, CONVERSATION_CAPTION, FOREIGN_STATE_RULE, fallbackUpdate, memorySectionRule } from "../lib/project-memory/consolidate.js";
import { memorySectionBudgets, memorySectionPromptBudgets } from "../lib/project-memory/memory-schema.js";
import { adaptiveOutputTokens, MAX_ADAPTIVE_OUTPUT_TOKENS, MAX_REASONING_RESERVE_TOKENS, MIN_REASONING_RESERVE_TOKENS, REASONING_RESERVE_RATIO, REPLY_OUTPUT_MARGIN_TOKENS, RETRY_OUTPUT_HEADROOM_TOKENS, reasoningReserveTokens } from "../lib/shared/output-budget.js";
import { parseConsolidation, parseContextMember, parseToolArguments } from "../lib/shared/reply-json.js";
import { fitMemoryInput, conversationText, userTurnCount } from "../lib/shared/conversation.js";
import { pickToolCall, requestPluginText, requestPluginTextWithMeta } from "../lib/shared/model-call.js";
import { clip, clipText, replyHead, replyTokenRate, textOf, truncateMiddle } from "../lib/shared/text.js";
import { approveCandidate, listCandidates, rejectCandidate } from "../lib/project-autolearn/candidate.js";
import { parseAutolearnReply, parseAutolearnToolCall } from "../lib/project-autolearn/parse.js";
import { HANDOFF_TITLE_PREFIX, handoffSwitchDeferred, planHandoffWatch } from "../lib/project-handoff/marker.js";
import { watchHandoffSwitch } from "../lib/project-handoff/watch.js";
import { archivedConversationText, readArchivedConversation } from "../lib/project-context/archive.js";
import { parseSessionIndex, queueIndexLine, queueSessionIndexEntry, sessionIndexLine, untouchedSince } from "../lib/project-context/session-index.js";
import {
	diagnosticMessage,
	invalidateTextCache,
	logError,
	migrateProjectState,
	readOptional,
	readTextCachedSync,
	redactSecrets,
	safeSessionId,
	sessionIndexFile,
	validSkillName,
	writeAtomic,
} from "../lib/shared/project-state.js";
import { MAX_CONTEXT_CHARS } from "../lib/shared/limits.js";
import { releaseSessionQueue, writeSessionArtifacts } from "../lib/project-context/session-log.js";
import { effectivePluginConfig, publishProjectContextSettings } from "../lib/shared/settings.js";
import { apply as applyMemory, consolidateProject, memoryUpdateReply, memoryStatusReply } from "../lib/project-memory/index.js";
import { isMemoryTruncated, loadMemory, normalizeMemoryDocument } from "../lib/project-memory/memory-store.js";

function message(role, text) {
	return { role, source: { kind: role }, content: [{ type: "text", text }] };
}

function fakeSession(messages) {
	return { deriveMessages: () => messages };
}

/**
 * A model-call counter that also fails loudly. A handoff generates nothing any more — the auxiliary
 * summary call was deleted — so any `llm.stream` reached from a handoff fixture is a regression. The
 * counter is asserted after every integration scenario, not only the first: one fixture's zero says
 * nothing about the paths the others take.
 */
function noModelCalls() {
	let calls = 0;
	const stream = () => {
		calls += 1;
		throw new Error("the handoff must not call a model");
	};
	return {
		stream,
		count: () => calls,
		assertNone: (where) => assert.equal(calls, 0, `${where}: the handoff must not call a model`),
	};
}

test("fixed threshold is a window share, and refuses under the physical floor", () => {
	const config = { ...DEFAULT_CONFIG, handoffThresholdAuto: false };
	assert.equal(resolveThreshold(config, { totalTokens: 0, surfaceTokens: 0 }, 100_000)?.tokens, 40_000);
	// 8_000 × 0.4 = 3_200 is a positive trigger, but it sits under the 28_000 floor the default kept tail
	// (20_000) plus `MIN_DROP_TOKENS` builds, so this configuration cannot fire at all: fixed mode obeys
	// the same physical gate adaptive mode does. The margin's own clamp — and the label that admits it —
	// is pinned by the ratio-override test below.
	assert.equal(resolveThreshold(config, { totalTokens: 0, surfaceTokens: 0 }, 8_000), undefined);
	assert.equal(thresholdRefusal(config, { totalTokens: 0, surfaceTokens: 0 }, 8_000), "fixed-below-floor", "the cause is the floor, not the window");
});

test("MIN_DROP_TOKENS is the floor a handoff may not sit below", () => {
	// The drop minimum is a term of the physical floor (`overhead + keep + MIN_DROP_TOKENS`), not
	// decoration: a handoff whose threshold lands below it refuses rather than clamping up to it. The
	// boundary is computed from the constant, so a changed value moves the assertion with it while a
	// changed comparison does not. At a 1M window the quality knee (157_000) is what the threshold
	// resolves to, and the kept tail is the term a test can drive, so the boundary is exactly
	// `keep = knee − MIN_DROP_TOKENS`.
	const knee = qualityLimit(1_000_000);
	const measurement = { totalTokens: 0, surfaceTokens: 0 };
	const configFor = (handoffBudgetRecentTokens) => resolvePluginConfig({ provider: "test-provider", model: "test-model", handoffBudgetRecentTokens });
	assert.equal(MIN_DROP_TOKENS, 8_000, "the drop minimum is the documented 8000");
	assert.notEqual(
		resolveThreshold(configFor(knee - MIN_DROP_TOKENS), measurement, 1_000_000),
		undefined,
		"a kept tail that leaves the floor exactly at the knee still resolves",
	);
	const over = configFor(knee - MIN_DROP_TOKENS + 1);
	assert.equal(resolveThreshold(over, measurement, 1_000_000), undefined, "one token of tail past the floor refuses");
	assert.equal(thresholdRefusal(over, measurement, 1_000_000), "quality-knee");
	// The floor is quoted in the receipt, computed from the same constant: with no envelope the
	// window-headroom text names `keep + MIN_DROP_TOKENS` as the floor it could not clear.
	const tinyWindow = 20_000;
	const tiny = resolvePluginConfig({ provider: "test-provider", model: "test-model", handoffBudgetRecentTokens: 1_000 });
	assert.equal(thresholdRefusal(tiny, measurement, tinyWindow), "window-headroom");
	assert.match(
		thresholdRefusalText("window-headroom", tiny, measurement, tinyWindow, "en"),
		new RegExp(`below the ${1_000 + MIN_DROP_TOKENS}-token floor`),
	);
});

test("adaptive threshold reserves room for the summary and the carried tail", () => {
	const config = { ...DEFAULT_CONFIG, handoffBudgetRecentTokens: 1_000, handoffBudgetSummaryTokens: 8_000 };
	const threshold = resolveThreshold(config, { totalTokens: 20_000, surfaceTokens: 18_000 }, 32_000);
	assert.ok(threshold);
	// The quality layer is the base and `capacityLimit` has the last word, so a small window triggers
	// at `usable − SAFETY_MARGIN` (32_000 − 16_384 − 4_000 = 11_616): the curve allows the whole window
	// here, so capacity decides. The old value was 11_000 = baseline + keep + target, with no quality
	// layer at all. The configured 8_000 target takes no part in the trigger, high or low.
	assert.equal(threshold.tokens, 11_616);
	assert.match(threshold.label, /^auto /);

	// Window headroom below the reserve cannot fit a pass.
	assert.equal(resolveThreshold(config, { totalTokens: 5_000, surfaceTokens: 1_000 }, 16_000), undefined);
});

test("parseRatio accepts only the range the settings schema persists", () => {
	assert.equal(parseRatio("0.4"), 0.4);
	assert.equal(parseRatio("40%"), 0.4);
	assert.equal(parseRatio("40"), 0.4);
	assert.equal(parseRatio("0.1"), 0.1);
	assert.equal(parseRatio("0.95"), 0.95);
	assert.equal(parseRatio("0.08"), undefined);
	assert.equal(parseRatio("0.96"), undefined);
	assert.equal(parseRatio("nope"), undefined);
});

test("parseTokenCount parses plain and k-suffixed counts", () => {
	assert.equal(parseTokenCount("12000"), 12_000);
	assert.equal(parseTokenCount("12k"), 12_000);
	assert.equal(parseTokenCount("1.5k"), 1_500);
	assert.equal(parseTokenCount("0"), 0);
	assert.equal(parseTokenCount("-5"), undefined);
	assert.equal(parseTokenCount("abc"), undefined);
});

const INDEX_SESSION = { id: "session-abcdef", header: { createdAt: Date.UTC(2026, 8, 12) } };

test("renderContextDocument keeps the summary and sheds list items past the budget", () => {
	const update = {
		title: "audit",
		summary: "s".repeat(6_000),
		key_points: Array.from({ length: 200 }, () => "p".repeat(800)),
		open_tasks: Array.from({ length: 200 }, () => "t".repeat(800)),
	};
	const document = renderContextDocument(update, { updatedAt: new Date(Date.UTC(2026, 8, 12)).toISOString() });
	assert.ok(document.length <= 32_000, `document is ${document.length} chars`);
	// 400 items of 800 chars would be far past the budget, so both lists must have
	// been shed; the summary is capped separately and must survive.
	const items = (document.match(/^- /gm) ?? []).length;
	assert.ok(items > 0 && items < 400, `list items were shed to fit the budget (${items})`);
	assert.ok(document.includes("s".repeat(1_000)), "the capped summary survives the shedding");
	assert.ok(document.includes("<!-- latest-session-title: audit -->"));
});

test("renderContextDocument preserves short lists verbatim", () => {
	const update = { title: "small", summary: "summary", key_points: ["k1", "k2"], open_tasks: ["o1"] };
	const document = renderContextDocument(update, { updatedAt: new Date().toISOString() });
	assert.match(document, /- k1/);
	assert.match(document, /- k2/);
	assert.match(document, /- o1/);
	assert.ok(document.length < 32_000);
});

test("a legacy session-index.md is adopted once and its links are normalized", async () => {
	const project = await mkdtemp(path.join(tmpdir(), "dsh-index-legacy-"));
	const memory = path.join(project, ".agents", "memory");
	await mkdir(memory, { recursive: true });
	await writeFile(
		path.join(memory, "session-index.md"),
		"# Session Index\n\n- [11111111-2222-3333-4444-555555555555](session-logs/11111111-2222-3333-4444-555555555555/session.md) — 2026-09-12 — old session\n",
		"utf8",
	);

	await queueIndexLine(project, "session-new", "- [session-new](session-new/session.md) — 2026-09-14 — new session");

	const index = await readFile(path.join(memory, "session-logs", "INDEX.md"), "utf8");
	assert.match(index, /\]\(11111111-2222-3333-4444-555555555555\/session\.md\)/, "the pre-move link is converted");
	assert.doesNotMatch(index, /session-logs\/11111111/);
	assert.match(index, /- \[session-new\]\(session-new\/session\.md\) — 2026-09-14 — new session/);
	assert.equal(existsSync(path.join(memory, "session-index.md")), false, "the adopted legacy file is removed");
});

test("adoption never removes the legacy index before the new one exists", async () => {
	const project = await mkdtemp(path.join(tmpdir(), "dsh-index-adopt-"));
	const memory = path.join(project, ".agents", "memory");
	await mkdir(memory, { recursive: true });
	// Already in the current form: re-queueing the same line produces a byte-identical document,
	// so a "write only when it changed" rule would leave nothing behind after the legacy file goes.
	const canonical = "# Session Index\n\n- [abc](abc/session.md) — 2026-09-12 — t\n";
	await writeFile(path.join(memory, "session-index.md"), canonical, "utf8");

	await queueIndexLine(project, "abc", "- [abc](abc/session.md) — 2026-09-12 — t");

	const index = path.join(memory, "session-logs", "INDEX.md");
	assert.ok(existsSync(index), "the new index exists even when the legacy bytes already match");
	assert.equal(await readFile(index, "utf8"), canonical);
	assert.equal(existsSync(path.join(memory, "session-index.md")), false, "the source is removed only after the write");
});

test("a legacy index that appears after the new one exists is still adopted", async () => {
	// Two hosts can straddle the `<memory>/` → `<memory>/session-logs/` move: an updated build
	// writes the new index while an older one keeps appending to the legacy file. Adoption ran only
	// while the new index was still empty, so those entries were stranded — archived on disk,
	// missing from the one list autolearn navigates by.
	const project = await mkdtemp(path.join(tmpdir(), "dsh-index-late-legacy-"));
	const memory = path.join(project, ".agents", "memory");
	const logs = path.join(memory, "session-logs");
	await mkdir(logs, { recursive: true });
	await writeFile(
		path.join(logs, "INDEX.md"),
		[
			"# Session Index",
			"",
			"- [11111111-2222-3333-4444-555555555555](11111111-2222-3333-4444-555555555555/session.md) — 2026-09-12 — current title",
			"- [session-keep](session-keep/session.md) — 2026-09-14 — kept",
			"",
		].join("\n"),
		"utf8",
	);
	await writeFile(
		path.join(memory, "session-index.md"),
		[
			"# Session Index",
			"",
			"- [11111111-2222-3333-4444-555555555555](session-logs/11111111-2222-3333-4444-555555555555/session.md) — 2026-09-12 — stale title",
			"- [99999999-8888-7777-6666-555555555555](session-logs/99999999-8888-7777-6666-555555555555/session.md) — 2026-09-13 — late arrival",
			"",
		].join("\n"),
		"utf8",
	);

	await queueIndexLine(project, "session-keep", "- [session-keep](session-keep/session.md) — 2026-09-14 — kept");

	const index = await readFile(path.join(logs, "INDEX.md"), "utf8");
	assert.match(
		index,
		/- \[99999999-8888-7777-6666-555555555555\]\(99999999-8888-7777-6666-555555555555\/session\.md\) — 2026-09-13 — late arrival/,
		"the late legacy entry is adopted and its link normalized",
	);
	assert.equal(
		index.split("\n").filter((current) => current.includes("11111111-2222-3333-4444-555555555555")).length,
		1,
		"a session the new index already lists is not duplicated",
	);
	assert.match(index, /— current title/, "the current index's line wins over the stale legacy one");
	assert.doesNotMatch(index, /stale title/);
	assert.doesNotMatch(index, /session-logs\/99999999/);
	assert.equal(existsSync(path.join(memory, "session-index.md")), false, "the adopted legacy file is removed");
});

test("an adopted legacy entry newer than the current lines lands at the newest end", async () => {
	// A straddling legacy file holds what an older host archived after the move, so its lines can be
	// the NEWEST ones. Ordering the merge by source instead of by date would put them at the head,
	// where a reader taking the newest lines — autolearn, via `slice(-MAX_INDEX_ENTRIES)` — never looks.
	const project = await mkdtemp(path.join(tmpdir(), "dsh-index-late-newest-"));
	const memory = path.join(project, ".agents", "memory");
	const logs = path.join(memory, "session-logs");
	await mkdir(logs, { recursive: true });
	await writeFile(
		path.join(logs, "INDEX.md"),
		[
			"# Session Index",
			"",
			"- [session-a](session-a/session.md) — 2026-09-01 — a",
			"- [session-b](session-b/session.md) — 2026-09-02 — b",
			"",
		].join("\n"),
		"utf8",
	);
	await writeFile(path.join(memory, "session-index.md"), "# Session Index\n\n- [session-z](session-logs/session-z/session.md) — 2026-09-18 — z\n", "utf8");

	await queueIndexLine(project, "session-a", "- [session-a](session-a/session.md) — 2026-09-01 — a");

	const ids = (await readFile(path.join(logs, "INDEX.md"), "utf8"))
		.split("\n")
		.filter((line) => line.startsWith("- ["))
		.map((line) => /^- \[([^\]]+)\]/.exec(line)[1]);
	assert.deepEqual(ids, ["session-a", "session-b", "session-z"], "the adopted line takes its date position, not the head");
	assert.equal(existsSync(path.join(memory, "session-index.md")), false, "the adopted legacy file is removed");
});

test("the cap never deletes a legacy entry it could not keep", async () => {
	// MAX_INDEX_LINES drops the oldest lines. A legacy entry too old to survive that cap has no other
	// copy, so the file must stay on disk; once an entry does survive, its source is released. Deleting
	// the file in the first case would destroy the line outright.
	const project = await mkdtemp(path.join(tmpdir(), "dsh-index-cap-"));
	const memory = path.join(project, ".agents", "memory");
	const logs = path.join(memory, "session-logs");
	const legacy = path.join(memory, "session-index.md");
	await mkdir(logs, { recursive: true });
	const current = Array.from({ length: 200 }, (_, index) => `- [session-${index}](session-${index}/session.md) — 2026-09-20 — t${index}`);
	await writeFile(path.join(logs, "INDEX.md"), ["# Session Index", "", ...current, ""].join("\n"), "utf8");

	// Older than every current line: 201 entries against a 200-line cap, so this one drops off.
	await writeFile(legacy, "# Session Index\n\n- [session-old](session-logs/session-old/session.md) — 2026-09-01 — ancient\n", "utf8");
	await queueIndexLine(project, "session-199", current[199]);
	let index = await readFile(path.join(logs, "INDEX.md"), "utf8");
	assert.ok(!index.includes("[session-old]"), "the oldest line is the one the cap drops");
	assert.equal(index.split("\n").filter((line) => line.startsWith("- [")).length, 200);
	assert.ok(existsSync(legacy), "the only copy of a dropped legacy entry is not deleted");

	// Newer than every current line: it survives the cap, so the adopted source can go.
	await writeFile(legacy, "# Session Index\n\n- [session-new](session-logs/session-new/session.md) — 2026-09-21 — brand new\n", "utf8");
	await queueIndexLine(project, "session-199", current[199]);
	index = await readFile(path.join(logs, "INDEX.md"), "utf8");
	assert.ok(index.includes("[session-new]"), "the newest line is kept");
	assert.equal(index.split("\n").filter((line) => line.startsWith("- [")).length, 200);
	assert.equal(existsSync(legacy), false, "an entry that survived the cap releases its source");
});

test("a legacy index that changed while it was being adopted is not deleted", async () => {
	// Removing the adopted source is a check-then-act: the path can change between the read and the
	// rm, and the file that was adopted must then be left alone rather than deleted. That window is a
	// couple of milliseconds wide, so a test cannot enter it by timing; the legacy path is instead
	// made to resolve to the file the write itself replaces, which reaches the same decision —
	// "the path no longer holds what was adopted" — deterministically. What an append does to that
	// decision (same inode, new size/mtime) is pinned separately below, because this aliased case
	// changes the inode as well and so passes an identity-based check too.
	const project = await mkdtemp(path.join(tmpdir(), "dsh-index-changed-"));
	const memory = path.join(project, ".agents", "memory");
	const logs = path.join(memory, "session-logs");
	const legacy = path.join(memory, "session-index.md");
	const index = path.join(logs, "INDEX.md");
	await mkdir(logs, { recursive: true });
	await writeFile(index, "# Session Index\n\n- [session-a](session-a/session.md) — 2026-09-01 — a\n", "utf8");
	await symlink(index, legacy);

	await queueIndexLine(project, "session-b", "- [session-b](session-b/session.md) — 2026-09-02 — b");

	const written = await readFile(index, "utf8");
	assert.match(written, /session-b/, "the index write happened");
	assert.match(written, /session-a/);
	assert.equal(await readFile(legacy, "utf8"), written, "the legacy path still resolves to the rewritten index");
	assert.equal(existsSync(legacy), true, "a legacy path that changed under the write is not deleted");
});

test("the re-stat guard notices an append, not only a replacement", async () => {
	// The guard exists because an older host can append to the legacy path during the read→remove
	// window, and that line must not be deleted with the file. An append keeps the inode and changes
	// size+mtime; the write that replaces the path changes the inode too. An identity-based check
	// therefore looks correct in the aliased test above and still destroys an appended line.
	const project = await mkdtemp(path.join(tmpdir(), "dsh-index-guard-"));
	try {
		const file = path.join(project, "session-index.md");
		await writeFile(file, "# Session Index\n\n- [session-a](session-a/session.md) — 2026-09-01 — a\n", "utf8");
		const first = await stat(file);
		const adopted = { size: first.size, mtimeMs: first.mtimeMs };
		assert.equal(await untouchedSince(file, adopted), true, "a path nobody touched is still removable");

		await appendFile(file, "- [session-late](session-late/session.md) — 2026-09-30 — late\n");
		assert.equal((await stat(file)).ino, first.ino, "an append keeps the inode, unlike the aliased write");
		assert.equal(await untouchedSince(file, adopted), false, "an appended line blocks the removal");

		await rm(file);
		assert.equal(await untouchedSince(file, adopted), false, "a path that vanished is not untouched either");
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});

test("two host processes writing one project's index lose no lines", { timeout: 60_000 }, async () => {
	// `queues` serializes writes inside one process, so two writers in this test process would share
	// it and prove nothing. Real children are the only way to exercise the cross-process case, where
	// the write is a read-modify-write: before the lock, four writers lost most of their lines.
	const project = await mkdtemp(path.join(tmpdir(), "dsh-index-cross-"));
	try {
		const memory = path.join(project, ".agents", "memory");
		const logs = path.join(memory, "session-logs");
		await mkdir(logs, { recursive: true });
		const lib = new URL("../lib/project-context/session-index.js", import.meta.url).href;
		const writer = path.join(project, "writer.mjs");
		await writeFile(
			writer,
			[
				'import { existsSync, writeFileSync } from "node:fs";',
				`import { queueIndexLine } from ${JSON.stringify(lib)};`,
				"const [projectRoot, tag, count, barrier, ready] = process.argv.slice(2);",
				"writeFileSync(ready, \"\");",
				"while (!existsSync(barrier)) await new Promise((resolve) => setTimeout(resolve, 5));",
				"for (let index = 0; index < Number(count); index += 1) {",
				"	const id = `session-${tag}-${index}`;",
				"	await queueIndexLine(projectRoot, id, `- [${id}](${id}/session.md) — 2026-09-02 — ${id}`);",
				"}",
			].join("\n"),
			"utf8",
		);
		const perWriter = 25;
		const tags = ["w0", "w1", "w2", "w3"];
		const barrier = path.join(project, "go");
		const ready = tags.map((tag) => path.join(project, `ready-${tag}`));
		const children = tags.map((tag, index) => {
			const child = promisify(execFile)(process.execPath, [writer, project, tag, String(perWriter), barrier, ready[index]]);
			// The rejection still reaches `Promise.all` below; this handler only marks it as observed,
			// so a child killed on the failure path cannot surface as an unhandled rejection.
			void child.catch(() => undefined);
			return child;
		});
		try {
			// Wait for every child to be up and past its imports, then release them together: a fixed
			// sleep is not enough under CPU oversubscription (a child needed 1084 ms with 48 burners
			// running), and the test must not pass merely because one process finished before the next.
			const readyBy = Date.now() + 30_000;
			while (ready.some((file) => !existsSync(file))) {
				if (Date.now() > readyBy) throw new Error("the writer processes did not reach the barrier in time");
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
			await writeFile(barrier, "", "utf8");
			await Promise.all(children);
		} finally {
			// A child whose barrier never appears polls until it is killed; without this a readiness
			// timeout would leave four spinning writers and their handles holding the event loop open.
			for (const child of children) child.child?.kill();
		}

		const entries = (await readFile(path.join(logs, "INDEX.md"), "utf8")).split("\n").filter((line) => line.startsWith("- ["));
		assert.equal(entries.length, 4 * perWriter, "no writer's lines are lost to another's read-modify-write");
		assert.match(entries[0], /^\- \[session-w\d-\d+\]/, "the surviving lines are the writers' own");
		assert.equal(existsSync(path.join(memory, "session-index.lock")), false, "the cross-process lock is released");
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});

test("a legacy file holding no index line is left alone", async () => {
	// The pre-move path could hold a hand-written note. Adopting it would delete the note and index
	// nothing in its place.
	const project = await mkdtemp(path.join(tmpdir(), "dsh-index-note-"));
	const memory = path.join(project, ".agents", "memory");
	const logs = path.join(memory, "session-logs");
	await mkdir(logs, { recursive: true });
	await writeFile(path.join(logs, "INDEX.md"), "# Session Index\n\n- [session-a](session-a/session.md) — 2026-09-01 — a\n", "utf8");
	const note = "# Session Index\n\nkeep this note: hand-written, no entries\n";
	await writeFile(path.join(memory, "session-index.md"), note, "utf8");

	await queueIndexLine(project, "session-b", "- [session-b](session-b/session.md) — 2026-09-02 — b");

	assert.equal(await readFile(path.join(memory, "session-index.md"), "utf8"), note, "a file without entries is not consumed");
	const index = await readFile(path.join(logs, "INDEX.md"), "utf8");
	assert.match(index, /session-b/);
	assert.doesNotMatch(index, /keep this note/);
});

test("a FIFO at the legacy index path cannot stall the index write", { timeout: 15_000 }, async (t) => {
	// Reading a FIFO with no writer blocks forever, and because index writes are chained per project
	// every later write would queue behind this one, stalling the archive step for good.
	const project = await mkdtemp(path.join(tmpdir(), "dsh-index-fifo-"));
	const memory = path.join(project, ".agents", "memory");
	await mkdir(memory, { recursive: true });
	try {
		execFileSync("mkfifo", [path.join(memory, "session-index.md")]);
	} catch {
		t.skip("mkfifo is unavailable on this platform");
		return;
	}

	await queueIndexLine(project, "session-a", "- [session-a](session-a/session.md) — 2026-09-01 — a");

	assert.match(await readFile(path.join(memory, "session-logs", "INDEX.md"), "utf8"), /session-a/);
});

test("a directory at the legacy index path does not break the write", async () => {
	const project = await mkdtemp(path.join(tmpdir(), "dsh-index-dir-"));
	const memory = path.join(project, ".agents", "memory");
	await mkdir(path.join(memory, "session-index.md"), { recursive: true });

	await queueIndexLine(project, "session-a", "- [session-a](session-a/session.md) — 2026-09-01 — a");

	assert.match(await readFile(path.join(memory, "session-logs", "INDEX.md"), "utf8"), /session-a/);
	assert.ok(existsSync(path.join(memory, "session-index.md")), "the directory is not removed");
});

test("session index lines are mechanical and relative to the logs directory", () => {
	const line = sessionIndexLine(INDEX_SESSION, "audit");
	// The link targets the canonical JSONL: it is what every reader opens and it is
	// never pruned, whereas the rendering is reproducible from it and may be deleted.
	assert.equal(line, "- [session-abcdef](session-abcdef/session.jsonl) — 2026-09-12 — audit");
});

test("parseSessionIndex reads the current, the pre-JSONL and the legacy link forms", () => {
	const text = [
		"# Session Index",
		"",
		"- [session-abcdef](session-abcdef/session.jsonl) — 2026-09-12 — audit",
		"- [session-aaa](session-aaa/session.md) — 2026-09-12 — rendered target still parses",
		"- [session-123](session-logs/session-123/session.md) — 2026-09-11 — old layout",
		"garbage",
	].join("\n");
	const entries = parseSessionIndex(text);
	assert.equal(entries.length, 3);
	assert.deepEqual(entries[0], { id: "session-abcdef", date: "2026-09-12", title: "audit" });
	assert.equal(entries[1].id, "session-aaa");
	assert.equal(entries[2].id, "session-123");
});

test("queueSessionIndexEntry upserts one line per session and refreshes the title", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "dsh-index-"));
	const session = { id: "session-abcdef", header: { createdAt: Date.UTC(2026, 8, 12) }, snapshotEvents: () => [] };
	await queueSessionIndexEntry(root, session);
	await queueSessionIndexEntry(root, { ...session, id: "session-other" });
	await queueSessionIndexEntry(root, {
		...session,
		snapshotEvents: () => [{ type: "session/title", seq: 1, time: 0, data: { title: "renamed" } }],
	});
	const text = await readFile(path.join(root, ".agents", "memory", "session-logs", "INDEX.md"), "utf8");
	const entries = parseSessionIndex(text);
	assert.equal(entries.length, 2);
	assert.equal(entries.find((entry) => entry.id === "session-abcdef").title, "renamed");
	assert.ok(text.startsWith("# Session Index"));
});

test("parseConsolidation reads memory and context and never a skill", () => {
	const result = parseConsolidation(JSON.stringify({
		memory_markdown: "# Project Memory\n\nfact",
		context: { title: "t", summary: "s", key_points: ["k"], open_tasks: ["o"] },
		skill: { name: "x", description: "y", body: "z" },
	}));
	assert.match(result.memory, /fact/);
	assert.equal(result.context.summary, "s");
	assert.deepEqual(result.context.open_tasks, ["o"]);
	assert.equal("skill" in result, false);
	assert.deepEqual(parseConsolidation("plain markdown"), { memory: "plain markdown" });
});

test("parseConsolidation recovers memory from a malformed reply and fails closed otherwise", () => {
	// The reply that used to poison MEMORY.md: a stray member made JSON.parse fail and the
	// raw object was stored as memory.
	const corrupted = '{"memory_markdown":"# Project Memory\\n\\n## Project\\n- kept.","context":"# Project Context","stray\\n\\n- tail"}';
	assert.deepEqual(parseConsolidation(corrupted), { memory: "# Project Memory\n\n## Project\n- kept." });
	assert.equal(parseConsolidation('{"memory_markdown":"# Project Memory\\n\\n- cut'), undefined);
	assert.equal(parseConsolidation('{"memory_markdown": 17, "context": {'), undefined);
});

test("a context with the wrong shape is refused instead of hollowed out", () => {
	// The defect: `key_points: "a, b, c"` (a string, not an array) was silently coerced to []
	// while `summary` stayed a string, so the context was ACCEPTED and CONTEXT.md was rewritten
	// with empty sections — destroying the previous content with nothing logged. A present but
	// malformed list must now refuse the whole context.
	const base = { memory_markdown: "# Project Memory\n\nfact" };
	const unusable = [
		{ ...base, context: { title: "t", summary: "s", key_points: "a, b, c", open_tasks: ["o"] } },
		{ ...base, context: { title: "t", summary: "s", key_points: [1, 2], open_tasks: ["o"] } },
		{ ...base, context: { title: "t", summary: "s", key_points: null, open_tasks: ["o"] } },
		{ ...base, context: { title: "t", summary: "s", open_tasks: "o" } },
		{ ...base, context: { title: "t", key_points: ["k"], open_tasks: ["o"] } },
		{ ...base, context: "not an object" },
	];
	for (const reply of unusable) {
		const result = parseConsolidation(JSON.stringify(reply));
		assert.equal(result.context, undefined, `refused: ${JSON.stringify(reply.context)}`);
		assert.equal(result.contextUnusable, true, `reported unusable: ${JSON.stringify(reply.context)}`);
		// The memory half must still land: refusing the context must not cost the memory.
		assert.match(result.memory, /fact/);
	}

	// Absent and null are the model saying nothing, which is not an error and must not be logged
	// as one — otherwise a healthy pass reads as a failure.
	for (const reply of [
		{ ...base },
		{ ...base, context: null },
	]) {
		const result = parseConsolidation(JSON.stringify(reply));
		assert.equal(result.context, undefined);
		assert.equal(result.contextUnusable, undefined, "absent/null context is not unusable");
	}

	// A well-shaped context still works, including genuinely empty lists.
	const good = parseConsolidation(JSON.stringify({ ...base, context: { title: "t", summary: "s", key_points: ["k"], open_tasks: ["o"] } }));
	assert.deepEqual(good.context.key_points, ["k"]);
	assert.equal(good.contextUnusable, undefined);
	const empty = parseConsolidation(JSON.stringify({ ...base, context: { title: "t", summary: "s", key_points: [], open_tasks: [] } }));
	assert.deepEqual(empty.context.key_points, []);
	assert.equal(empty.contextUnusable, undefined);
});

test("the context shape rule lives in one place, shared by the reply and the tool call", () => {
	const usable = { title: "t", summary: "s", key_points: ["k"], open_tasks: ["o"] };
	assert.deepEqual(parseContextMember(usable), usable);
	assert.equal(parseContextMember(undefined), undefined);
	assert.equal(parseContextMember(null), undefined);
	assert.equal(parseContextMember("not an object"), undefined);
	for (const value of [
		{ title: "t", summary: "s", key_points: "a, b, c", open_tasks: ["o"] },
		{ title: "t", summary: "s", key_points: [1, 2], open_tasks: ["o"] },
		{ title: "t", summary: "s", key_points: null, open_tasks: ["o"] },
		{ title: "t", summary: "s", open_tasks: "o" },
		{ title: "t", key_points: ["k"], open_tasks: ["o"] },
	]) {
		assert.equal(parseContextMember(value), undefined, JSON.stringify(value));
	}
	// Every verdict the reply parser reports must be the one the shared rule makes, or the tool path
	// would accept a context the text path refuses (and the two entries would drift).
	for (const raw of [null, "not an object", { summary: 1 }, { summary: "s", key_points: "x", open_tasks: [] }, usable]) {
		const viaReply = parseConsolidation(JSON.stringify({ memory_markdown: "m", context: raw }));
		assert.deepEqual(viaReply.context, parseContextMember(raw), JSON.stringify(raw));
		// The flag is only present when the context was present but unusable; absent and null are
		// the model saying nothing and must not read as an error.
		const expectedUnusable = parseContextMember(raw) === undefined && raw !== null ? true : undefined;
		assert.equal(viaReply.contextUnusable, expectedUnusable, JSON.stringify(raw));
	}
	// A `context` key the reply omits entirely is the model saying nothing: not an error.
	const absent = parseConsolidation(JSON.stringify({ memory_markdown: "m" }));
	assert.equal(absent.context, undefined);
	assert.equal(absent.contextUnusable, undefined);
	assert.deepEqual(parseContextMember({ title: "t", summary: "s", key_points: [], open_tasks: [] }), { title: "t", summary: "s", key_points: [], open_tasks: [] });
});

test("parseToolArguments decodes the streamed argument text and refuses a non-object", () => {
	assert.deepEqual(parseToolArguments('{"memory":{"project":["p"],"invariants":[],"pitfalls":[],"index":[]}}'), {
		memory: { project: ["p"], invariants: [], pitfalls: [], index: [] },
	});
	// The same tolerant reader the text path uses: a fence or surrounding prose still decodes.
	assert.deepEqual(parseToolArguments('```json\n{"a":1}\n```'), { a: 1 });
	assert.deepEqual(parseToolArguments('prose {"a":1} tail'), { a: 1 });
	// Not an object at all: the caller must treat this as an unusable call, never as an empty one.
	assert.equal(parseToolArguments("[1,2]"), undefined);
	assert.equal(parseToolArguments(""), undefined);
	assert.equal(parseToolArguments("not json"), undefined);
});

test("the consolidation prompt states the context field types, not just their names", () => {
	// Naming the keys without their types is the root cause of the drift the shape check catches:
	// the model is never told that a string where an array belongs costs the whole context.
	const prompt = CONSOLIDATION_PROMPT_RULES.join("\n");
	assert.match(prompt, /key_points and context\.open_tasks are arrays of strings/);
	assert.match(prompt, /context\.summary is a required string/);
	assert.match(prompt, /discarded and CONTEXT\.md is left unchanged/);
	// The consequence must be stated too, or the model cannot know a wrong shape is costly.
	assert.match(prompt, /discarded/);
});

test("the prompt states the cross-project boundary, at the rule and at the conversation block", async () => {
	// The pass hands the model the whole session conversation and asks it to regenerate the documents
	// from it, so a session that quotes a sibling repository's state writes that state into THIS
	// project's memory — and hand-cleaning cannot hold, because the next pass writes it again. The
	// boundary is therefore stated twice: as a rule, next to the secrets rule, and as the first line
	// inside `<recent-conversation>`, which is the block where the foreign text actually enters.
	assert.ok(CONSOLIDATION_PROMPT_RULES.includes(FOREIGN_STATE_RULE), "the rule is part of the fixed prompt rules");
	assert.match(FOREIGN_STATE_RULE, /naming another project is fine only to record who owns an open item/, "naming another project stays legal for an ownership pointer, which this repo keeps on purpose");

	const root = await memoryProject("dsh-memory-foreign-state-", "# Project Memory\n\n## Project\n- original\n");
	const { calls, ctx, agent } = await consolidationFixture({ root, replies: [{ text: FITTING_TEXT_REPLY }] });
	const config = resolvePluginConfig({ consolidateTurns: 1, forceDedupeMs: 0 });
	await consolidateProject(ctx, config, agent, { force: true, silent: true });

	const prompt = calls[0].messages[0].content.map((block) => block.text ?? "").join("\n");
	const captionAt = prompt.indexOf(CONVERSATION_CAPTION);
	assert.ok(captionAt > 0, "the caption is in the prompt the model is sent");
	assert.equal(prompt.slice(captionAt - "<recent-conversation>\n".length, captionAt), "<recent-conversation>\n", "the caption is the first line inside the conversation block");
	assert.ok(captionAt > prompt.indexOf("</existing-context>"), "and that block sits below the memory and context blocks");
});

test("parseAutolearnReply separates a skill, a backtrack request and an unreadable reply", () => {
	const direct = parseAutolearnReply(JSON.stringify({ skill: { name: "n", description: "d", body: "b" }, need_sessions: [] }));
	assert.equal(direct.skill.name, "n");
	assert.deepEqual(direct.needSessions, []);
	assert.deepEqual(direct.inspectSkill, []);

	const backlog = parseAutolearnReply('```json\n{"skill": null, "need_sessions": ["session-a", "", "session-b", "session-c", "session-d"]}\n```');
	assert.equal(backlog.skill, null);
	assert.deepEqual(backlog.needSessions, ["session-a", "session-b", "session-c"]);

	// The ask for a learned body travels beside the ask for archives: the same parser reads both the
	// tool call and the text fallback, so a reply that leaves the new list out parses as "asked for no
	// body" rather than as an unreadable reply.
	const wantsBody = parseAutolearnReply(JSON.stringify({ skill: null, need_sessions: [], inspect_skill: ["alpha-workflow", "  ", "beta-workflow"] }));
	assert.equal(wantsBody.skill, null);
	assert.deepEqual(wantsBody.inspectSkill, ["alpha-workflow", "beta-workflow"]);

	// The distinction the pass routes on: an unreadable reply is not a decision, so a caller that
	// accepted it as "nothing to propose" could not tell a cut reply from a considered one.
	assert.equal(parseAutolearnReply("not json"), undefined, "an unreadable reply reports no decision at all");
	assert.deepEqual(parseAutolearnReply('{"skill": null}'), { skill: null, needSessions: [], inspectSkill: [] }, "a parsed reply that proposed nothing is a decision");
});

test("parseAutolearnReply reads evidence, candidate and reason", () => {
	const parsed = parseAutolearnReply(JSON.stringify({
		skill: { name: "n", description: " d ", body: " b ", evidence: ["a", "b"], candidate: true, reason: "why" },
	}));
	assert.equal(parsed.skill.name, "n");
	assert.equal(parsed.skill.description, "d");
	assert.deepEqual(parsed.skill.evidence, ["a", "b"]);
	assert.equal(parsed.skill.candidate, true);
	assert.equal(parsed.skill.reason, "why");
});

test("parseAutolearnToolCall reads the record_skill shape and treats an empty name as no proposal", () => {
	// The tool schema requires every property, so "nothing to propose" is an empty name (a `null`
	// skill cannot be expressed without an `anyOf`, which strict schemas reject).
	assert.deepEqual(
		parseAutolearnToolCall({ skill: { name: "", description: "", body: "", evidence: [], candidate: false, reason: "" }, need_sessions: [] }),
		{ skill: null, needSessions: [], inspectSkill: [] },
	);
	// A model returning the text shape out of habit still reads.
	assert.deepEqual(parseAutolearnToolCall({ skill: null, need_sessions: ["a", " ", "b"] }), { skill: null, needSessions: ["a", "b"], inspectSkill: [] });
	// The body ask reads through the same entry, and a tool call that predates the field parses as
	// "asked for no body" instead of becoming unusable arguments.
	assert.deepEqual(
		parseAutolearnToolCall({ skill: null, need_sessions: [], inspect_skill: ["alpha-workflow"] }),
		{ skill: null, needSessions: [], inspectSkill: ["alpha-workflow"] },
	);

	const parsed = parseAutolearnToolCall({ skill: { name: "n", description: " d ", body: " b ", evidence: ["e"], candidate: true, reason: "r" }, need_sessions: ["s"] });
	assert.equal(parsed.skill.name, "n");
	assert.equal(parsed.skill.description, "d");
	assert.equal(parsed.skill.candidate, true);
	assert.deepEqual(parsed.skill.evidence, ["e"]);
	assert.deepEqual(parsed.needSessions, ["s"]);
	assert.deepEqual(parsed.inspectSkill, []);

	// The name is not filtered here, or the kebab-case admission rule would be unreachable from a
	// model answer (the pass path takes whatever the model returned).
	assert.equal(parseAutolearnToolCall({ skill: { name: "Not Kebab", description: "d", body: "b" } }).skill.name, "Not Kebab");

	// Unusable arguments are `undefined` — an error — never "the model proposed nothing".
	assert.equal(parseAutolearnToolCall(undefined), undefined);
	assert.equal(parseAutolearnToolCall("nope"), undefined);
	assert.equal(parseAutolearnToolCall({ skill: [1] }), undefined);
	assert.equal(parseAutolearnToolCall({ skill: { name: 5 } }), undefined);
	assert.equal(parseAutolearnToolCall({ skill: { name: "n" } }), undefined);
});

test("candidates list, approve and reject", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "dsh-candidates-"));
	try {
		await mkdir(path.join(root, ".agents/memory/skill-candidates"), { recursive: true });
		const body = `## When to use\n\n${"step ".repeat(60)}\n`;
		await writeFile(
			path.join(root, ".agents/memory/skill-candidates/beta-workflow.md"),
			`---\nname: beta-workflow\ndescription: "beta candidate"\ncandidate: true\n---\n\n<!-- evidence: sess-a -->\n\n${body}`,
		);
		assert.deepEqual(await listCandidates(root), ["beta-workflow"]);

		const approved = await approveCandidate(root, "beta-workflow");
		assert.equal(approved.ok, true);
		const live = await readFile(path.join(root, ".agents/skills/beta-workflow/SKILL.md"), "utf8");
		assert.match(live, /description: "beta candidate"/);
		assert.doesNotMatch(live, /candidate: true/);
		assert.doesNotMatch(live, /<!-- evidence/);
		assert.deepEqual(await listCandidates(root), []);

		await writeFile(
			path.join(root, ".agents/memory/skill-candidates/gamma.md"),
			`---\nname: gamma\ndescription: "gamma"\ncandidate: true\n---\n\n${body}`,
		);
		assert.equal((await rejectCandidate(root, "gamma")).ok, true);
		assert.deepEqual(await listCandidates(root), []);

		// Missing/unsafe names fail cleanly instead of throwing.
		assert.equal((await approveCandidate(root, "nope")).ok, false);
		assert.equal((await rejectCandidate(root, "bad name")).ok, false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("the session index dedupes by id and keeps the newest 200", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "dsh-index-"));
	try {
		for (let index = 0; index < 205; index += 1) {
			await queueIndexLine(root, `session-${index}`, `- [session-${index}](session-${index}/session.md) — 2026-09-01 — t${index}`);
		}
		const file = path.join(root, ".agents/memory/session-logs/INDEX.md");
		const text = await readFile(file, "utf8");
		assert.equal(text.split("\n").filter((line) => line.startsWith("- [")).length, 200);
		assert.ok(!text.includes("[session-0]"), "oldest line drops off");
		assert.ok(text.includes("[session-204]"), "newest line stays");

		// Refreshing an id replaces its line instead of appending a duplicate.
		await queueIndexLine(root, "session-100", "- [session-100](session-100/session.md) — 2026-09-02 — updated");
		const refreshed = (await readFile(file, "utf8")).split("\n").filter((line) => line.startsWith("- [session-100]"));
		assert.equal(refreshed.length, 1);
		assert.match(refreshed[0], /updated/);

		// A duplicate id left behind by a backfill collapses on the next write too.
		await writeFile(file, `${await readFile(file, "utf8")}- [session-100](session-100/session.md) — 2026-09-03 — duplicate\n`);
		await queueIndexLine(root, "session-50", "- [session-50](session-50/session.md) — 2026-09-04 — fifty");
		assert.equal((await readFile(file, "utf8")).split("\n").filter((line) => line.startsWith("- [session-100]")).length, 1);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("archivedConversationText renders dsh JSONL without stream payloads", () => {
	const lines = [
		JSON.stringify({ type: "session", harness: "dsh", id: "s1" }),
		JSON.stringify({ type: "user/message", seq: 1, time: 0, data: { source: { kind: "user" }, content: [{ type: "text", text: "build release" }] } }),
		JSON.stringify({
			type: "assistant/message",
			seq: 2,
			time: 0,
			data: {
				message: { role: "assistant", content: [{ type: "text", text: "run pnpm build" }, { type: "tool-call", name: "bash" }] },
				stream: [{ type: "chunk", chunk: { type: "text", text: "x".repeat(5_000) } }],
			},
		}),
		JSON.stringify({
			type: "tool/result",
			seq: 3,
			time: 0,
			data: {
				turn: 1,
				step: 1,
				message: {
					role: "tool",
					id: "m1",
					source: { kind: "tool", callId: "c1" },
					toolCallId: "c1",
					content: [{ type: "text", text: "ok" }],
				},
			},
		}),
	];
	const text = archivedConversationText(lines.join("\n"), 50_000);
	assert.match(text, /## user\nbuild release/);
	assert.match(text, /## assistant\nrun pnpm build\n\[tool: bash\]/);
	assert.match(text, /## tool result\nok/);
	assert.doesNotMatch(text, /x{100}/);
	assert.ok(text.length < 4_000);
});

test("the handoff continuation points at the archive and index", () => {
	const files = "<read-files>\nsrc/a.ts\n</read-files>";
	const text = continuation("session-abcdef", files, "tail", {
		log: ".agents/memory/session-logs/session-abcdef/session.md",
		index: ".agents/memory/session-logs/INDEX.md",
	});
	assert.match(text, /session-abcdef\/session\.md/);
	assert.match(text, /session-logs\/INDEX\.md/);
	assert.match(text, /<handoff>\n## Previous session details/);
	assert.ok(text.includes(files), "the file index rides inside the details block");
	// The block carries mechanical parts only: no generated summary section was ever there.
	assert.ok(!text.includes("## Handoff Summary"));
	assert.match(text, /<recent-conversation>/);
});

test("session ids and skill names stay filesystem-safe", () => {
	const traversing = safeSessionId("session-../../etc");
	// Still filesystem-safe: no separator survives the sanitization.
	assert.ok(!traversing.includes("/") && !traversing.includes("\\"), traversing);
	assert.ok(traversing.startsWith("session-..-..-etc"), traversing);
	// …and now injective: `a/b` and `a-b` used to sanitize to the same directory, so the second
	// session's archive overwrote the first one's. A sanitized (or truncated) id carries a digest of
	// the original instead.
	assert.notEqual(traversing, "session-..-..-etc");
	assert.notEqual(safeSessionId("a/b"), safeSessionId("a-b"));
	assert.notEqual(safeSessionId(`x${"y".repeat(200)}`), safeSessionId(`x${"y".repeat(199)}z`));
	assert.equal(
		safeSessionId("session-9f2c1b7e-0000-4000-8000-000000000000"),
		"session-9f2c1b7e-0000-4000-8000-000000000000",
		"a normal id is passed through unchanged, so existing archives keep their directory",
	);
	assert.equal(safeSessionId(""), "ephemeral");
	assert.equal(validSkillName("my-skill"), true);
	assert.equal(validSkillName("../evil"), false);
});

/** A handoff context whose workspace registry is whatever the test passes. */
function handoffContext(registry) {
	const warnings = [];
	return {
		ctx: {
			get: (name) => (name === "workspaceRegistry" ? registry : undefined),
			logger: { warn: (...args) => warnings.push(args) },
		},
		warnings,
	};
}

/** A session controller that records every create request. */
function recordingController(requests) {
	return {
		create: async (request) => {
			requests.push(request);
			return { sessionId: "session-child" };
		},
	};
}

test("the handoff child is created inside the parent's workspace", async () => {
	const requests = [];
	const { ctx } = handoffContext({ resolveByPath: async (cwd) => (cwd === "/project" ? { id: "ws-1" } : undefined) });

	const childId = await createChildSession(ctx, recordingController(requests), "/project");

	assert.equal(childId, "session-child");
	assert.deepEqual(requests, [{ workspaceId: "ws-1" }], "workspaceId replaces cwd on the wire");
});

test("the handoff child falls back to the parent cwd outside any workspace", async () => {
	const requests = [];
	const { ctx } = handoffContext({ resolveByPath: async () => undefined });

	await createChildSession(ctx, recordingController(requests), "/elsewhere");

	assert.deepEqual(requests, [{ cwd: "/elsewhere" }]);
});

test("the handoff child survives a missing or failing workspace registry", async () => {
	const requests = [];
	const controller = recordingController(requests);

	await createChildSession({ get: () => undefined, logger: { warn() {} } }, controller, "/project");
	const { ctx, warnings } = handoffContext({ resolveByPath: async () => { throw new Error("lookup exploded"); } });
	await createChildSession(ctx, controller, "/project");
	await createChildSession(ctx, controller, undefined);

	assert.deepEqual(requests, [{ cwd: "/project" }, { cwd: "/project" }, {}]);
	assert.equal(warnings.length, 1, "a failing lookup warns without failing the handoff");
});

test("the handoff child keeps the parent's agent preset", async () => {
	// Without the preset the child is composed from the deployment default, so a
	// handoff from a custom-preset session would resume with different tools.
	const requests = [];
	const { ctx } = handoffContext({ resolveByPath: async () => ({ id: "ws-1" }) });

	await createChildSession(ctx, recordingController(requests), "/project", "anchored-standard");
	await createChildSession({ get: () => undefined, logger: { warn() {} } }, recordingController(requests), "/project", "anchored-standard");
	await createChildSession({ get: () => undefined, logger: { warn() {} } }, recordingController(requests), undefined);

	assert.deepEqual(requests, [
		{ workspaceId: "ws-1", agentPreset: "anchored-standard" },
		{ cwd: "/project", agentPreset: "anchored-standard" },
		{}, // a session without a preset keeps the previous create shape
	]);
});

test("the handoff seed carries the plugin's own source kind, never the human one", () => {
	// The seed reaches the child through its Agent inbox (`followup`), not through the prompt RPC:
	// that RPC hardcodes `source = {kind:"user", rpcId}` and `SessionPromptRequest` has no source
	// field, so a machine-written banner was indistinguishable from something the person typed.
	// Three consumers read that field — the turn counter, the index title fallback, and dsh's goal
	// tools, which grant `create_goal` / `update_goal edit|pause|resume` to a "direct human turn".
	const delivered = [];
	const child = { followup: (message) => delivered.push(message) };
	const ctx = { get: (name) => (name === "agents" ? { get: (id) => (id === "session-child" ? child : undefined) } : undefined) };

	seedChildSession(ctx, "session-child", "从会话 session-parent 交接。");

	assert.equal(delivered.length, 1);
	assert.equal(delivered[0].source.kind, "dsh-project-context", "the seed must not borrow the human kind");
	assert.equal(delivered[0].role, "user", "it is still a user-role message; only the source differs");
	assert.equal(delivered[0].content[0].text, "从会话 session-parent 交接。");
});

test("the delivered seed is invisible to the human-turn reader, unlike a real user message", () => {
	// The same text read two ways. Without the second half this pin would pass on a fixture that
	// simply never counts anything.
	const delivered = [];
	const ctx = { get: (name) => (name === "agents" ? { get: () => ({ followup: (message) => delivered.push(message) }) } : undefined) };
	seedChildSession(ctx, "session-child", "seed text");
	const asSeeded = { snapshotEvents: () => [{ type: "user/message", data: { source: delivered[0].source, content: delivered[0].content } }] };
	assert.equal(userTurnCount(asSeeded), 0, "a plugin seed is not a human turn");
	const asHuman = { snapshotEvents: () => [{ type: "user/message", data: { source: { kind: "user" }, content: delivered[0].content } }] };
	assert.equal(userTurnCount(asHuman), 1, "the same text under the RPC's kind would have counted");
});

test("a non-resident handoff child fails the seed loudly instead of falling back to the RPC", () => {
	// A fallback would silently restore the human-kind source this change removes, so an absent child
	// must raise. Each case is a different way the registry can fail to answer.
	const noService = { get: () => undefined };
	assert.throws(() => seedChildSession(noService, "session-child", "seed"), /not resident/);
	const emptyRegistry = { get: (name) => (name === "agents" ? { get: () => undefined } : undefined) };
	assert.throws(() => seedChildSession(emptyRegistry, "session-child", "seed"), /not resident/);
	// An entry that cannot queue a turn (another dsh version's shape) is not a seed target either.
	const inert = { get: (name) => (name === "agents" ? { get: () => ({}) } : undefined) };
	assert.throws(() => seedChildSession(inert, "session-child", "seed"), /not resident/);
});

test("readArchivedConversation streams a file and tolerates a missing one", async () => {
	const project = await mkdtemp(path.join(tmpdir(), "dsh-archive-read-"));
	const file = path.join(project, "session.jsonl");
	await writeFile(file, [
		"null",
		JSON.stringify({ type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "streamed question" }] } }),
		JSON.stringify({ type: "assistant/message", data: { message: { content: [{ type: "text", text: "streamed answer" }] } } }),
		"",
	].join("\n"));

	const text = await readArchivedConversation(file, 10_000);
	assert.match(text, /## user\nstreamed question/);
	assert.match(text, /## assistant\nstreamed answer/);
	assert.equal(await readArchivedConversation(path.join(project, "missing.jsonl"), 10_000), "", "a missing log renders empty instead of throwing");
});

test("archivedConversationText skips JSONL lines that are not event objects", () => {
	// `null`, arrays and scalars all parse as valid JSON; one such line used to
	// throw and fail the whole autolearn backtrack pass.
	const lines = [
		"null",
		"[1,2]",
		'"text"',
		"42",
		JSON.stringify({ type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "kept" }] } }),
	];
	const text = archivedConversationText(`${lines.join("\n")}\n`, 10_000);
	assert.match(text, /## user\nkept/);
});

test("a legacy path whose type conflicts with the new layout is left in place", async () => {
	const project = await mkdtemp(path.join(tmpdir(), "dsh-migrate-conflict-"));
	const memory = path.join(project, ".agents", "memory");
	await mkdir(path.join(memory, "session-logs"), { recursive: true });
	await writeFile(path.join(memory, "MEMORY.md"), "# New memory\n");
	// Legacy mirror image: MEMORY.md is a directory, session-logs is a file.
	await mkdir(path.join(project, ".pi", "MEMORY.md", "nested"), { recursive: true });
	await writeFile(path.join(project, ".pi", "MEMORY.md", "nested", "old.md"), "old\n");
	await writeFile(path.join(project, ".pi", "session-logs"), "legacy file\n");

	// Neither side may be deleted to "resolve" the conflict, and `cp` must not throw.
	const result = await migrateProjectState(project);

	assert.deepEqual(result.conflicts.sort(), [".agents/memory/MEMORY.md", ".agents/memory/session-logs"]);
	assert.equal(result.moved.length, 0);
	assert.equal(await readFile(path.join(memory, "MEMORY.md"), "utf8"), "# New memory\n");
	assert.equal(await readFile(path.join(project, ".pi", "MEMORY.md", "nested", "old.md"), "utf8"), "old\n");
	assert.equal(await readFile(path.join(project, ".pi", "session-logs"), "utf8"), "legacy file\n");
});

test("the shared settings value is republished on reload and survives a stale fiber's cleanup", () => {
	const cleanups = [];
	const fakeContext = () => ({
		effect: (callback) => { cleanups.push(callback()); },
	});
	const first = { ...DEFAULT_CONFIG, archiveEnabled: true };
	const second = { ...DEFAULT_CONFIG, archiveEnabled: false };
	const own = { ...DEFAULT_CONFIG, maxTokens: 1 };

	publishProjectContextSettings(fakeContext(), first);
	assert.equal(effectivePluginConfig(own), first, "the published entry config is the live shared value");
	publishProjectContextSettings(fakeContext(), second);
	assert.equal(effectivePluginConfig(own), second, "a reload republishes the namespace owner's config");

	// An update can dispose the old fiber after the new one published: that stale
	// cleanup must not release the live publication.
	cleanups[0]();
	assert.equal(effectivePluginConfig(own), second, "a stale fiber must not release a newer publication");

	cleanups[1]();
	assert.equal(effectivePluginConfig(own), own, "the owner's cleanup restores each plugin's own entry config");
});

test("a dirty or in-flight composer defers the auto handoff switch", () => {
	assert.equal(handoffSwitchDeferred(undefined), false, "an absent facade never blocks the switch");
	assert.equal(handoffSwitchDeferred({ draft: "", phase: "plain" }), false);
	assert.equal(handoffSwitchDeferred({ draft: "   ", phase: "plain" }), false);
	assert.equal(handoffSwitchDeferred({ draft: "/caveman-help", phase: "plain" }), true);
	assert.equal(handoffSwitchDeferred({ draft: "", phase: "submitting" }), true);
	assert.equal(handoffSwitchDeferred({ draft: "text", phase: "claimed" }), true);
});

test("no plugin source appends a custom session event (dsh refuses to load such logs)", async () => {
	// A downstream event type is outside dsh's KNOWN_SESSION_EVENT_TYPES, and
	// `Session.append` cannot set the `ignorable: true` marker the persistence read
	// path requires, so one such record makes the whole session unloadable. The
	// scan covers both halves of the package, not just the host sources.
	for (const root of ["../src", "../client"]) {
		for (const entry of await readdir(new URL(root, import.meta.url), { recursive: true })) {
			if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue;
			const source = await readFile(new URL(`${root}/${entry}`, import.meta.url), "utf8");
			assert.doesNotMatch(source, /\.append\(/, `${root}/${entry} appends a session event`);
			assert.doesNotMatch(source, /interface SessionEventMap/, `${root}/${entry} declares a custom session event`);
		}
	}
});

/**
 * A fake client context exposing the two services the handoff watcher reads.
 *
 * `conversation` selects the facade the watcher must survive: `"absent"` (no
 * service), `"throwing"` (a session with no shell), `"no-subscribe"` (a snapshot
 * without a subscriber), or the default complete facade. Composer snapshots are
 * keyed by session id, like the real input hub.
 */
function handoffWatchContext(options = {}) {
	const listListeners = new Set();
	const composerListeners = new Map();
	const opened = [];
	const titles = { ...(options.titles ?? {}) };
	const composers = new Map(Object.entries(options.composers ?? {}));
	const state = {
		ids: [...(options.ids ?? [])],
		byId: { ...(options.byId ?? {}) },
		current: options.current,
		phase: options.phase ?? "ready",
	};
	const composerOf = (id) => composers.get(id) ?? { draft: "", phase: "plain" };
	const mode = options.conversation ?? "normal";
	const sessions = {
		list: {
			getSnapshot: () => state,
			subscribe: (listener) => {
				listListeners.add(listener);
				return () => listListeners.delete(listener);
			},
		},
		// The real service returns undefined for a session that is neither listed nor scoped.
		binding: (id) => (options.bindingMissing === true ? undefined : { session: { projections: { faceOf: () => ({ getSnapshot: () => titles[String(id)] }) } } }),
		open: (id) => {
			opened.push(String(id));
		},
	};
	const conversation = mode === "absent" ? undefined : {
		input: {
			shell: (id) => {
				if (mode === "throwing") throw new Error(`conversation.input: session "${String(id)}" resolved no binding`);
				const key = String(id);
				return {
					state: {
						getSnapshot: () => ({ ...composerOf(key) }),
						...(mode === "no-subscribe" ? {} : {
							subscribe: (listener) => {
								const set = composerListeners.get(key) ?? new Set();
								set.add(listener);
								composerListeners.set(key, set);
								return () => set.delete(listener);
							},
						}),
					},
				};
			},
		},
	};
	return {
		ctx: {
			get: (name) => {
				if (options.sessionsMissing === true && name === "sessions") return undefined;
				return name === "sessions" ? sessions : name === "conversation" ? conversation : undefined;
			},
		},
		opened,
		state,
		titles,
		addSession(id, summary, title) {
			state.ids.push(id);
			state.byId[id] = summary;
			// An absent title models a projection that has not landed yet.
			if (title !== undefined) titles[id] = title;
		},
		notifyList: () => {
			for (const listener of listListeners) listener();
		},
		settleComposer: (id, next) => {
			composers.set(id, { ...composerOf(id), ...next });
			for (const listener of composerListeners.get(id) ?? []) listener();
		},
		composerWatchers: (id) => composerListeners.get(id)?.size ?? 0,
	};
}

test("planHandoffWatch waits for a landed list and a landed title", () => {
	const handoffRow = { id: "s2", cwd: "/p", title: `${HANDOFF_TITLE_PREFIX}abc123` };

	// A `pending` list is empty because nothing arrived, not because nothing exists.
	assert.equal(planHandoffWatch({ phase: "pending", seeded: false, rows: [handoffRow] }).seed, false);
	assert.equal(planHandoffWatch({ phase: "pending", seeded: false, rows: [handoffRow] }).open, undefined);
	assert.equal(planHandoffWatch({ phase: "ready", seeded: false, rows: [handoffRow] }).seed, true, "the first landed list is adopted");
	assert.equal(planHandoffWatch({ phase: "ready", seeded: true, rows: [{ id: "s2", cwd: "/p" }], current: "s1" }).open, undefined, "a title that has not landed is retried, never settled");
	assert.equal(planHandoffWatch({ phase: "ready", seeded: true, rows: [handoffRow], current: "s1" }).open, "s2");
	assert.equal(planHandoffWatch({ phase: "ready", seeded: true, rows: [handoffRow], current: "s1" }).deferred, false);
});

test("the handoff watcher adopts an already-listed session instead of opening it", () => {
	const harness = handoffWatchContext({ phase: "pending" });
	const dispose = watchHandoffSwitch(harness.ctx);
	assert.deepEqual(harness.opened, [], "a pending list never triggers a switch");

	// The first pull lands carrying an old handoff session plus an ordinary one.
	harness.state.ids = ["old-handoff", "ordinary"];
	harness.state.byId = { "old-handoff": { cwd: "/p" }, ordinary: { cwd: "/p" } };
	harness.state.current = "ordinary";
	harness.titles["old-handoff"] = `${HANDOFF_TITLE_PREFIX}old12345`;
	harness.titles.ordinary = "work";
	harness.state.phase = "ready";
	harness.notifyList();

	assert.deepEqual(harness.opened, [], "sessions present before the list landed are never opened");
	dispose();
});

test("the handoff watcher opens exactly one newly listed handoff session", () => {
	const harness = handoffWatchContext({ ids: ["s1"], byId: { s1: { cwd: "/p" } }, current: "s1", titles: { s1: "work" } });
	const dispose = watchHandoffSwitch(harness.ctx);

	harness.addSession("s2", { cwd: "/p" }, `${HANDOFF_TITLE_PREFIX}abc12345`);
	harness.notifyList();
	assert.deepEqual(harness.opened, ["s2"]);

	harness.notifyList();
	assert.deepEqual(harness.opened, ["s2"], "an opened session is not opened again");

	// Neither a delegated child, another cwd, nor an ordinary title is a target.
	harness.addSession("s3", { cwd: "/p", origin: "subagent" }, `${HANDOFF_TITLE_PREFIX}child`);
	harness.addSession("s4", { cwd: "/other" }, `${HANDOFF_TITLE_PREFIX}elsewhere`);
	harness.addSession("s5", { cwd: "/p" }, "an ordinary session");
	harness.notifyList();
	assert.deepEqual(harness.opened, ["s2"]);
	dispose();
});

test("the handoff watcher waits for the composer to settle before switching", () => {
	// The 2026-09-13 incident: the switch stole a `/caveman-help` draft and it was
	// submitted into the fresh handoff session instead.
	const harness = handoffWatchContext({
		ids: ["s1"],
		byId: { s1: { cwd: "/p" } },
		current: "s1",
		titles: { s1: "work" },
		composers: { s1: { draft: "/caveman-help", phase: "plain" } },
	});
	const dispose = watchHandoffSwitch(harness.ctx);
	assert.equal(harness.composerWatchers("s1"), 0, "a clean composer needs no watch");

	harness.addSession("s2", { cwd: "/p" }, `${HANDOFF_TITLE_PREFIX}abc12345`);
	harness.notifyList();
	assert.deepEqual(harness.opened, [], "a draft the user has not surrendered blocks the switch");
	assert.equal(harness.composerWatchers("s1"), 1, "the watcher subscribes to the composer so it can retry");

	harness.settleComposer("s1", { draft: "", phase: "plain" });
	assert.deepEqual(harness.opened, ["s2"], "clearing the draft retries the switch without waiting for list traffic");
	assert.equal(harness.composerWatchers("s1"), 0, "the composer subscription is released after the switch");
	dispose();
});

test("the composer retry follows the active session", () => {
	// Deferral can outlive a move to another session: the retry must re-bind to the
	// composer that is now active, or clearing that draft would not retry at all.
	const harness = handoffWatchContext({
		ids: ["s1", "s9"],
		byId: { s1: { cwd: "/p" }, s9: { cwd: "/p" } },
		current: "s1",
		titles: { s1: "work", s9: "other work" },
		composers: { s1: { draft: "typing", phase: "plain" }, s9: { draft: "also typing", phase: "plain" } },
	});
	const dispose = watchHandoffSwitch(harness.ctx);

	harness.addSession("s2", { cwd: "/p" }, `${HANDOFF_TITLE_PREFIX}abc12345`);
	harness.notifyList();
	assert.equal(harness.composerWatchers("s1"), 1, "the deferral watches the then-active session");

	harness.state.current = "s9";
	harness.notifyList();
	assert.equal(harness.composerWatchers("s1"), 0, "the stale subscription is released");
	assert.equal(harness.composerWatchers("s9"), 1, "the retry re-binds to the new active session");

	harness.settleComposer("s9", { draft: "", phase: "plain" });
	assert.deepEqual(harness.opened, ["s2"], "settling the active composer retries the switch");
	dispose();
});

test("the handoff watcher survives an unavailable composer facade", () => {
	// These are exactly the paths that must not throw inside the list listener.
	for (const [mode, composers, expected] of [
		["absent", {}, ["s2"]],
		["throwing", {}, ["s2"]],
		["no-subscribe", { s1: { draft: "typing", phase: "plain" } }, []],
	]) {
		const harness = handoffWatchContext({
			ids: ["s1"],
			byId: { s1: { cwd: "/p" } },
			current: "s1",
			titles: { s1: "work" },
			composers,
			conversation: mode,
		});
		const dispose = watchHandoffSwitch(harness.ctx);
		harness.addSession("s2", { cwd: "/p" }, `${HANDOFF_TITLE_PREFIX}abc12345`);
		harness.notifyList();
		harness.notifyList();
		assert.deepEqual(harness.opened, expected, `conversation mode ${mode}`);
		dispose();
	}
});

test("defensive handoff-watcher branches never break the switcher", () => {
	// A runtime without the `phase` field keeps the previous (ungated) behavior.
	const handoffRow = { id: "s2", cwd: "/p", title: `${HANDOFF_TITLE_PREFIX}abc123` };
	assert.equal(planHandoffWatch({ seeded: true, rows: [handoffRow], current: "s1" }).open, "s2", "an absent phase is not treated as pending");

	// A snapshot whose draft/phase are not the strings the composer contract promises
	// must not throw inside the list listener: an unknown composer never blocks.
	const hostile = handoffWatchContext({
		ids: ["s1"],
		byId: { s1: { cwd: "/p" } },
		current: "s1",
		titles: { s1: "work" },
		composers: { s1: { draft: 42, phase: "plain" } },
	});
	const disposeHostile = watchHandoffSwitch(hostile.ctx);
	hostile.addSession("s2", { cwd: "/p" }, `${HANDOFF_TITLE_PREFIX}abc12345`);
	hostile.notifyList();
	assert.deepEqual(hostile.opened, ["s2"]);
	disposeHostile();

	// Disposing while a switch is deferred releases the composer retry for good.
	const deferred = handoffWatchContext({
		ids: ["s1"],
		byId: { s1: { cwd: "/p" } },
		current: "s1",
		titles: { s1: "work" },
		composers: { s1: { draft: "typing", phase: "plain" } },
	});
	const disposeDeferred = watchHandoffSwitch(deferred.ctx);
	deferred.addSession("s2", { cwd: "/p" }, `${HANDOFF_TITLE_PREFIX}abc12345`);
	deferred.notifyList();
	assert.equal(deferred.composerWatchers("s1"), 1);
	disposeDeferred();
	assert.equal(deferred.composerWatchers("s1"), 0, "dispose releases the composer subscription");
	deferred.settleComposer("s1", { draft: "", phase: "plain" });
	assert.deepEqual(deferred.opened, [], "nothing fires after dispose");

	// Without the sessions service the watcher is a no-op, not a crash.
	const missing = handoffWatchContext({ sessionsMissing: true });
	const disposeMissingSessions = watchHandoffSwitch(missing.ctx);
	assert.equal(typeof disposeMissingSessions, "function");
	disposeMissingSessions();
});

test("the handoff watcher retries a session whose title has not landed", () => {
	const harness = handoffWatchContext({ ids: ["s1"], byId: { s1: { cwd: "/p" } }, current: "s1", titles: { s1: "work" } });
	const dispose = watchHandoffSwitch(harness.ctx);

	harness.addSession("s2", { cwd: "/p" }); // listed, title projection still pending
	harness.notifyList();
	assert.deepEqual(harness.opened, [], "an unlanded title is neither opened nor settled");

	harness.titles.s2 = `${HANDOFF_TITLE_PREFIX}abc12345`;
	harness.notifyList();
	assert.deepEqual(harness.opened, ["s2"], "the switch happens once the title lands");

	// A binding that resolves to nothing is the same "not landed yet" case.
	const missing = handoffWatchContext({ ids: ["s1"], byId: { s1: { cwd: "/p" } }, current: "s1", titles: { s1: "work" }, bindingMissing: true });
	const disposeMissing = watchHandoffSwitch(missing.ctx);
	missing.addSession("s2", { cwd: "/p" }, `${HANDOFF_TITLE_PREFIX}abc12345`);
	missing.notifyList();
	assert.deepEqual(missing.opened, [], "a missing binding never opens a session");
	assert.deepEqual(missing.state.ids, ["s1", "s2"]);
	dispose();
	disposeMissing();
});

test("the handoff watcher releases its subscriptions when the plugin unloads", () => {
	const harness = handoffWatchContext({ ids: [], byId: {} });
	const dispose = watchHandoffSwitch(harness.ctx);
	dispose();

	harness.addSession("s2", { cwd: "/p" }, `${HANDOFF_TITLE_PREFIX}abc12345`);
	harness.notifyList();
	assert.deepEqual(harness.opened, [], "a disposed watcher stops scanning");
});

test("the memory command carries status and update, and the removed /context-update is gone", async () => {
	// The command surface is part of the port: `/context-update` was renamed to `/memory update` and
	// deleted with no alias, so this pins both the routing and the absence of the old name.
	const root = await mkdtemp(path.join(tmpdir(), "dsh-memory-command-"));
	await mkdir(path.join(root, ".agents", "memory"), { recursive: true });
	await writeFile(path.join(root, ".agents", "memory", "MEMORY.md"), "# Project Memory\n\n## Project\n- p1\n\n## Invariants\n- i1\n\n## Pitfalls\n\n## Index\n");
	const commands = new Map();
	const ctx = {
		on: () => () => undefined,
		effect: () => () => undefined,
		inject: () => () => undefined,
		systemPrompt: { context: () => undefined },
		commands: { register: (command) => { commands.set(command.name, command); return () => undefined; } },
		logger: { info: () => undefined, warn: () => undefined },
		llm: {
			resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
			stream: () => (async function* generate() {
				yield { type: "text-delta", text: JSON.stringify({ memory_markdown: "# Project Memory\n\n## Project\n- p1\n- a second durable fact\n\n## Invariants\n- i1\n\n## Pitfalls\n\n## Index\n", context: { title: "t", summary: "s", key_points: [], open_tasks: [] } }) };
			})(),
		},
	};
	applyMemory(ctx, { provider: "test-provider", model: "test-model" });
	assert.deepEqual([...commands.keys()], ["memory"], "the plugin registers exactly one command, with no /context-update alias");
	const agent = { session: { id: "session-cmd", header: { cwd: root, createdAt: Date.now() }, snapshotEvents: () => [], deriveMessages: () => [], requestHeader: () => undefined } };
	const command = commands.get("memory");

	const status = await command.handler({ agent, rawInput: "" });
	assert.equal(status.kind, "success");
	assert.match(status.text, /Memory:/);

	const unknown = await command.handler({ agent, rawInput: "frobnicate" });
	assert.equal(unknown.kind, "error");
	assert.match(unknown.text, /\/memory update/, "the usage names the verb that exists");

	const updated = await command.handler({ agent, rawInput: "update" });
	assert.equal(updated.kind, "success", JSON.stringify(updated));
	assert.match(updated.text, /updated/i);
	assert.match(await readFile(path.join(root, ".agents", "memory", "MEMORY.md"), "utf8"), /a second durable fact/, "the forced pass really wrote");
});

test("the bare /session-log reads, `write` writes, and `now` is retired", async () => {
	// The bare command was the one read path with a write side effect: it wrote the session's
	// artifacts. `write` owns that now, and the retired spelling is told which name to use instead of
	// quietly doing nothing — the same hard cut `/context-update` got, no alias.
	const root = await mkdtemp(path.join(tmpdir(), "dsh-session-log-command-"));
	const commands = new Map();
	// `applyContext` publishes the shared settings namespace, which is module-level state: the effect's
	// disposer must run at the end of the test or every later `effectivePluginConfig` caller in this
	// process sees this project's defaults instead of its own config.
	const disposers = [];
	const ctx = {
		on: () => () => undefined,
		effect: (fn) => {
			const dispose = fn();
			if (typeof dispose === "function") disposers.push(dispose);
			return () => undefined;
		},
		commands: { register: (command) => { commands.set(command.name, command); return () => undefined; } },
		logger: { info: () => undefined, warn: () => undefined },
	};
	applyContext(ctx, {});
	try {
		const command = commands.get("session-log");
		assert.ok(command, "the plugin registers /session-log");
		assert.match(command.input.hint, /write \| import /, "the hint names the write verb");

		const session = fakeEventSession(
			[{ type: "user/message", seq: 0, data: { source: { kind: "user" }, content: [{ type: "text", text: "one" }] } }],
			"session-log-read",
			root,
		);
		const dir = path.join(root, ".agents", "memory", "session-logs", "session-log-read");

		// Bare: reads. It prints the log directory and the index and teaches the write verb, and writes nothing.
		const read = await command.handler({ agent: { session }, rawInput: "" });
		assert.equal(read.kind, "success");
		assert.match(read.text, /Session logs: /);
		assert.match(read.text, /Session index: /);
		assert.match(read.text, /\/session-log write/);
		assert.equal(existsSync(dir), false, "the bare command writes no archive");

		// `now` is retired rather than aliased: it must not act, and it names the new spelling.
		const retired = await command.handler({ agent: { session }, rawInput: "now" });
		assert.equal(retired.kind, "error");
		assert.match(retired.text, /retired/);
		assert.match(retired.text, /\/session-log write/);
		assert.equal(existsSync(dir), false, "a retired spelling writes no archive");

		// `write` performs exactly what `now` did, Markdown rendering included.
		const written = await command.handler({ agent: { session }, rawInput: "write" });
		assert.equal(written.kind, "success", JSON.stringify(written));
		assert.match(written.text, /Session log written: /);
		assert.ok(written.text.endsWith("session-log-read"), written.text);
		assert.match(await readFile(path.join(dir, "session.jsonl"), "utf8"), /one/);
		assert.ok(existsSync(path.join(dir, "session.md")), "write renders the Markdown too");
		releaseSessionQueue(session);
	} finally {
		for (const dispose of disposers) dispose();
	}
});

/**
 * A consolidation report for a status, with every loss count zero unless a case overrides it.
 * The written flags default to what that status means: a clean `updated`/`clipped` pass wrote both
 * artifacts, a `stale` pass wrote only the context, and the no-op statuses wrote nothing.
 */
const plainReport = (status, loss = {}) => ({
	status,
	memoryWritten: status === "updated" || status === "clipped",
	contextWritten: status === "updated" || status === "clipped" || status === "stale-context",
	memoryHiddenChars: 0,
	contextHiddenChars: 0,
	contextDroppedChars: 0,
	memoryWriteDroppedChars: 0,
	sectionDropped: 0,
	droppedItems: 0,
	itemTruncated: 0,
	...loss,
});

test("the /memory update reply reflects what the consolidation pass did", () => {
	// The pass swallows its own failure, so the reply is the only signal the user gets.
	assert.equal(memoryUpdateReply(plainReport("failed")).kind, "error");
	assert.match(memoryUpdateReply(plainReport("failed")).text, /errors\.log/);
	assert.equal(memoryUpdateReply(plainReport("updated")).kind, "success");
	assert.match(memoryUpdateReply(plainReport("updated")).text, /updated/);
	assert.match(memoryUpdateReply(plainReport("deduped")).text, /already up to date/);
	assert.match(memoryUpdateReply(plainReport("unchanged")).text, /no new memory/);
	assert.match(memoryUpdateReply(plainReport("clipped", { memoryHiddenChars: 12 })).text, /shortened version of the existing content/);
	assert.notEqual(memoryUpdateReply(plainReport("deduped")).text, memoryUpdateReply(plainReport("updated")).text, "a deduped no-op must not read as a successful rewrite");
});

test("a lossy pass is receipted by mechanism and count, and a clean pass reads word for word as before", () => {
	// Both losses happen before the write, so the stored document cannot show them afterwards. The
	// receipt is the only place the user can see them, and it has to name which mechanism and how
	// much: before this, a pass that dropped twelve entries and a pass that dropped none produced a
	// text that was identical character for character.
	const clean = memoryUpdateReply(plainReport("updated")).text;
	assert.equal(clean, "Memory: updated MEMORY.md and CONTEXT.md.", "a clean pass keeps its exact wording");

	// A `clipped` report always carries a landed hidden count, because the pass derives the status
	// from the counts — a shortening that belonged to an artifact which did not land leaves every
	// count at 0, and the pass reports `updated` instead (pinned end to end by "a shortening that did
	// not land is never receipted as clipped"). What is pinned here is the sentence a zero-count
	// report would get, so a reworded base is caught rather than silently accepted.
	assert.equal(
		memoryUpdateReply(plainReport("clipped")).text,
		"Memory: updated MEMORY.md and CONTEXT.md, but the pass was given a shortened version of the existing content.",
		"the clipped sentence names a shortened input, not the output budget it may not have been",
	);

	const clipped = memoryUpdateReply(plainReport("clipped", { memoryHiddenChars: 1234, contextHiddenChars: 567 })).text;
	assert.match(clipped, /1234 character\(s\) of the stored memory/);
	assert.match(clipped, /567 character\(s\) of the stored context/);
	assert.match(clipped, /the model was not shown 1234 character\(s\) of the stored memory and 567 character\(s\) of the stored context/);
	assert.match(clipped, /shortened version of the existing content/, "the detail extends the existing sentence rather than replacing it");
	assert.notEqual(clipped, memoryUpdateReply(plainReport("clipped")).text, "a lossy clipped pass must not read as a lossless one");

	const dropped = memoryUpdateReply(plainReport("updated", { sectionDropped: 1, droppedItems: 12 })).text;
	assert.match(dropped, /1 section\(s\) exceeded their budget and 12 whole entry\(ies\) were dropped/);
	assert.notEqual(dropped, clean, "an entry-dropping pass must not read as a clean one");
	assert.doesNotMatch(dropped, /shortened version of the existing content/, "drops are the render's loss, not a shortened input");

	const cut = memoryUpdateReply(plainReport("updated", { itemTruncated: 2 })).text;
	assert.match(cut, /2 entry\(ies\) exceeded their section's per-item cap and were truncated/);
	assert.notEqual(cut, clean);

	// Both mechanisms in one pass are named separately, not collapsed into one number.
	const both = memoryUpdateReply(plainReport("clipped", { memoryHiddenChars: 9, sectionDropped: 1, droppedItems: 3, itemTruncated: 1 })).text;
	assert.match(both, /9 character\(s\) of the stored memory/);
	assert.match(both, /1 section\(s\) exceeded their budget and 3 whole entry\(ies\) were dropped/);
	assert.match(both, /1 entry\(ies\) exceeded their section's per-item cap/);
	assert.match(both, /; /, "the two mechanisms are separate clauses");

	// A refused memory write lost nothing from the stored file, so its report must carry no counts —
	// otherwise the receipt would blame the context for a memory that was never written.
	assert.equal(memoryUpdateReply(plainReport("stale")).text, "Memory: was not rewritten — it changed while this pass's reply was being built, so the newer memory stays effective. Run /memory update again to consolidate from it.");
	assert.equal(
		memoryUpdateReply(plainReport("stale-context")).text,
		"Memory: context updated; memory was not rewritten because it changed while this pass's reply was being built — the newer memory stays effective.",
		"a stale-context receipt with no landed loss keeps its exact wording",
	);
	assert.match(memoryUpdateReply(plainReport("stale-context", { contextHiddenChars: 40 })).text, /40 character\(s\) of the stored context/, "the context landed, so a context hidden from the model is reported");

	// The other two loss sites the same receipt has to name: the reply's own write cap (an opaque or
	// oversized reply never reaches the section renderer) and the context render's own budgets.
	const written = memoryUpdateReply(plainReport("updated", { memoryWriteDroppedChars: 700 })).text;
	assert.match(written, /700 character\(s\) of the reply exceeded the memory cap and were dropped on write/);
	assert.notEqual(written, clean, "a write-cap truncation must not read as a clean pass");
	const contextClipped = memoryUpdateReply(plainReport("updated", { contextDroppedChars: 3599 })).text;
	assert.match(contextClipped, /3599 character\(s\) of the context were dropped to fit its section budgets/);
	assert.notEqual(contextClipped, clean);

	// A pass that wrote only one artifact must say so: the old wording claimed both were updated even
	// when the context was left unchanged. A `clipped` report always has a landed hidden count, so the
	// reachable single-artifact clipped shape is the one below (the memory landed, and the account of
	// what was shortened is in the detail); the zero-count variant is pinned above as a pure-function
	// boundary and is never produced by a pass.
	assert.equal(memoryUpdateReply(plainReport("updated", { contextWritten: false })).text, "Memory: updated MEMORY.md.");
	assert.equal(memoryUpdateReply(plainReport("updated", { memoryWritten: false })).text, "Memory: updated CONTEXT.md.");
	assert.equal(memoryUpdateReply(plainReport("clipped", { contextWritten: false, memoryHiddenChars: 5 })).text, "Memory: updated MEMORY.md, but the pass was given a shortened version of the existing content: the model was not shown 5 character(s) of the stored memory.");
	// Tier C added a status but reworded no other one: a clean pass that wrote both artifacts is still
	// one clause with no loss account.
	assert.equal(memoryUpdateReply(plainReport("updated")).text, "Memory: updated MEMORY.md and CONTEXT.md.");
	assert.doesNotMatch(memoryUpdateReply(plainReport("updated")).text, /refus|kept unchanged/i, "a clean pass never reads like a refusal");

	// A failure that happened after a write landed must not hide what landed.
	const partial = memoryUpdateReply(plainReport("failed", { memoryWritten: true, contextWritten: false, sectionDropped: 1, droppedItems: 4 })).text;
	assert.match(partial, /^Memory: update failed; see \.agents\/memory\/errors\.log\. The memory had already landed, with this loss: 1 section\(s\) exceeded their budget and 4 whole entry\(ies\) were dropped\.$/);
});

test("fitMemoryInput reports the hidden characters per artifact, and clipped stays their summary", () => {
	const memory = "m".repeat(400_000);
	const context = "c".repeat(400_000);
	const fits = [
		fitMemoryInput("small memory", "small context", 8192, {}, 32_768),
		fitMemoryInput(memory, context, 8192, {}, 32_768),
		fitMemoryInput(memory, context, 8192, {}, 32_768, RETRY_OUTPUT_HEADROOM_TOKENS),
		fitMemoryInput("记".repeat(60_000), "录".repeat(60_000), 8192, {}, 32_768),
	];
	for (const fit of fits) {
		assert.equal(typeof fit.memoryHiddenChars, "number", "the per-artifact count is always present");
		assert.equal(typeof fit.contextHiddenChars, "number");
		assert.ok(fit.memoryHiddenChars >= 0 && fit.contextHiddenChars >= 0, "counts are never negative");
		assert.equal(fit.clipped, fit.memoryHiddenChars > 0 || fit.contextHiddenChars > 0, "clipped is exactly the counts' summary");
	}
	// The count is the characters the model was not shown, not a token estimate: it reconstructs the
	// original from what was sent.
	const clipped = fits[1];
	assert.ok(clipped.clipped, "fixture: this fit is budget-bound");
	assert.equal(clipped.text.length + clipped.memoryHiddenChars, memory.length, "memory hidden = stored minus sent");
	assert.equal(clipped.contextText.length + clipped.contextHiddenChars, context.length, "context hidden = stored minus sent");
	// A clean fit sends everything and reports nothing hidden.
	const clean = fits[0];
	assert.equal(clean.clipped, false);
	assert.equal(clean.memoryHiddenChars, 0);
	assert.equal(clean.contextHiddenChars, 0);
});

/** A `record_memory` call whose Project section floods its share at a small cap. */
const FLOODED_MEMORY_ARGS = JSON.stringify({
	memory: { project: Array.from({ length: 400 }, (_, index) => `short entry ${index}`), invariants: [], pitfalls: [], index: [] },
	context: { title: "t", summary: "s", key_points: [], open_tasks: [] },
});

/** The same flood as a plain text reply, the shape the retry prompt asks for. */
const FLOODED_TEXT_REPLY = JSON.stringify({
	memory_markdown: `# Project Memory\n\n## Project\n${Array.from({ length: 400 }, (_, index) => `- short entry ${index}`).join("\n")}\n`,
	context: { title: "t", summary: "s", key_points: [], open_tasks: [] },
});

/** A four-section document that fits any cap this file uses. */
const FITTING_TEXT_REPLY = JSON.stringify({
	memory_markdown: "# Project Memory\n\n## Project\n- one kept entry\n",
	context: { title: "t", summary: "s", key_points: [], open_tasks: [] },
});

/** One over-long entry that fits its own section: retry-worthy, but never refusal-worthy. */
const ITEM_CAP_ARGS = JSON.stringify({
	memory: { project: [], invariants: [], pitfalls: [], index: ["x".repeat(1000)] },
	context: { title: "t", summary: "s", key_points: [], open_tasks: [] },
});

test("tier C: a reply that would be stored lossily is refused after one retry, and the stored memory stays byte-identical", async () => {
	// End-to-end over the real write path. The reply's Project section floods its share at this cap, so
	// the renderer would drop entries before anything landed; tier C asks once for a smaller document
	// and then refuses to write rather than storing the loss. A stored document cannot show any of that
	// afterwards, so the receipt and the log are the only traces — and the log must fire on every
	// occurrence, because it used to be gated to once per project, silencing every later loss.
	const root = await memoryProject("dsh-memory-loss-refusal-", "# Project Memory\n\n## Project\n- original\n");
	const before = await readFile(path.join(root, ".agents", "memory", "MEMORY.md"), "utf8");
	const { calls, ctx, agent } = await consolidationFixture({
		root,
		replies: [{ toolCall: { name: "record_memory", arguments: FLOODED_MEMORY_ARGS }, reason: { kind: "tool-calls" } }],
	});
	const config = resolvePluginConfig({ consolidateTurns: 1, maxMemoryChars: 4000, forceDedupeMs: 0 });

	const first = await consolidateProject(ctx, config, agent, { force: true, silent: true });
	assert.equal(calls.length, 2, "one targeted retry, and no more");
	assert.equal(first.status, "lossy-refused", `a lossy reply must not land (got ${JSON.stringify(first)})`);
	assert.equal(first.memoryWritten, false, "nothing was written");
	assert.equal(first.sectionDropped, 0, "a refused reply dropped nothing from the stored file");
	assert.equal(first.droppedItems, 0, "and its entries are not counted as dropped either");
	assert.ok(first.refusedLoss.sectionDropped > 0, "the refused loss is reported apart from the landed counts");
	assert.ok(first.refusedLoss.droppedItems > 0);
	assert.equal(await readFile(path.join(root, ".agents", "memory", "MEMORY.md"), "utf8"), before, "the stored memory is byte-identical");
	assert.equal(first.contextWritten, true, "the context is a separate artifact and still lands");

	const receipt = memoryUpdateReply(first).text;
	assert.match(receipt, /was kept unchanged/, "the receipt says the memory was kept");
	assert.match(receipt, /one targeted retry did not fix it/);
	assert.match(receipt, /whole entry\(ies\) would have been dropped/, "the refusal names what it avoided");
	assert.notEqual(receipt, memoryUpdateReply(plainReport("updated")).text, "a refusal cannot read as a clean pass");

	// The version claim is released on a refusal, so a second forced pass really re-runs.
	const second = await consolidateProject(ctx, config, agent, { force: true, silent: true });
	assert.equal(second.status, "lossy-refused", `the second pass is not deduped away (got ${JSON.stringify(second)})`);
	const refusals = (await readFile(path.join(root, ".agents", "memory", "errors.log"), "utf8"))
		.split("\n")
		.filter((line) => line.includes("would have been stored lossily"));
	assert.equal(refusals.length, 2, `each refusal leaves its own line, got ${JSON.stringify(refusals)}`);
	for (const line of refusals) {
		assert.match(line, /the stored memory was kept unchanged/, `the line must say what happened, got ${line}`);
	}
});

test("a consolidation route that refuses the tools parameter is retried once without it", async () => {
	// The shared fallback is wired in both passes, so this pins the memory side's own call site: the
	// first (tools-carrying) call is the one that may be refused, and the retry must really drop the
	// tool rather than repeat the request the route already rejected.
	const root = await memoryProject("dsh-memory-tools-fallback-", "# Project Memory\n\n## Project\n- original\n");
	const { calls, ctx, agent } = await consolidationFixture({
		root,
		replies: [
			{ reason: { kind: "error", failure: { message: "this route does not accept the tools parameter", code: "INVALID_REQUEST" } } },
			{ text: FITTING_TEXT_REPLY },
		],
	});
	const config = resolvePluginConfig({ consolidateTurns: 1, forceDedupeMs: 0 });

	const report = await consolidateProject(ctx, config, agent, { force: true, silent: true });

	assert.equal(calls.length, 2, "the refused tools call is retried once");
	assert.deepEqual(calls[0].tools?.map((tool) => tool.name), ["record_memory"], "the first call offered the tool");
	assert.equal(calls[1].tools, undefined, "the retry drops the tool");
	assert.equal(report.status, "updated", `the tools-free answer is the one that lands (got ${JSON.stringify(report)})`);
});

test("only a request-shape refusal buys the tools-free retry on the memory side too", async () => {
	// The autolearn pass has the paired negative; without this one a memory-side over-reach — falling
	// back on any code-carrying failure — would have been caught only by the autolearn case.
	const root = await memoryProject("dsh-memory-tools-negative-", "# Project Memory\n\n## Project\n- original\n");
	const { calls, ctx, agent } = await consolidationFixture({
		root,
		replies: [
			{ reason: { kind: "error", failure: { message: "invalid api key", code: "AUTH" } } },
			{ text: FITTING_TEXT_REPLY },
		],
	});
	const config = resolvePluginConfig({ consolidateTurns: 1, forceDedupeMs: 0 });

	const report = await consolidateProject(ctx, config, agent, { force: true, silent: true });

	assert.equal(calls.length, 1, "an auth failure is not re-asked without tools");
	assert.equal(report.status, "failed", `the pass reports the failure rather than papering over it (got ${JSON.stringify(report)})`);
});

test("a per-item truncation with no section overflow still logs a complete loss line", async () => {
	// The same branch's other shape: one entry over the per-item cap that still fits its own section.
	// The section-drop test filters on `exceeded their budget`, so this line — which carries only the
	// truncation clause — is invisible to it, and it is also the shape that would expose a prefix left
	// dangling with an empty description after the colon.
	const root = await memoryProject("dsh-memory-item-cap-log-");
	const reply = JSON.stringify({
		memory: { project: [], invariants: [], pitfalls: [], index: ["x".repeat(1000)] },
		context: { title: "t", summary: "s", key_points: [], open_tasks: [] },
	});
	const { calls, ctx, agent } = await consolidationFixture({
		root,
		replies: [{ toolCall: { name: "record_memory", arguments: reply }, reason: { kind: "tool-calls" } }],
	});
	const config = resolvePluginConfig({ consolidateTurns: 1, maxMemoryChars: 4000, forceDedupeMs: 0 });

	const report = await consolidateProject(ctx, config, agent, { force: true, silent: true });
	assert.equal(calls.length, 2, "a per-item truncation is retry-worthy even though it is not refusal-worthy");
	assert.equal(report.status, "updated", `fixture: a clipped item is not an input clip (got ${JSON.stringify(report)})`);
	assert.equal(report.itemTruncated, 1, "fixture: the single over-long entry is clipped and kept");
	assert.equal(report.sectionDropped, 0, "fixture: its section does not overflow");

	const lines = (await readFile(path.join(root, ".agents", "memory", "errors.log"), "utf8"))
		.split("\n")
		.filter((line) => line.includes("per-item cap"));
	assert.equal(lines.length, 1, `the truncation-only line is logged once, got ${JSON.stringify(lines)}`);
	assert.match(
		lines[0],
		/MEMORY\.md was rendered lossily: 1 entry\(ies\) exceeded their section's per-item cap and were truncated$/,
		`the line names what landed, got ${lines[0]}`,
	);
	assert.doesNotMatch(lines[0], /exceeded their budget/, "no section overflowed, so the line must not claim one");
});

test("tier C: one targeted retry fixes a lossy reply, and the retry names the overage without carrying content", async () => {
	const root = await memoryProject("dsh-tierc-retry-fixes-", "# Project Memory\n\n## Project\n- original\n");
	const { calls, ctx, agent } = await consolidationFixture({
		root,
		replies: [
			{ toolCall: { name: "record_memory", arguments: FLOODED_MEMORY_ARGS }, reason: { kind: "tool-calls" } },
			{ text: FITTING_TEXT_REPLY, reason: { kind: "stop" } },
		],
	});
	const config = resolvePluginConfig({ consolidateTurns: 1, maxMemoryChars: 4000, forceDedupeMs: 0 });

	const report = await consolidateProject(ctx, config, agent, { force: true, silent: true });

	assert.equal(calls.length, 2, "the first reply was lossy, so exactly one retry happened");
	assert.equal(calls[1].tools, undefined, "the retry asks for the JSON text shape, not another tool call");
	const retryPrompt = JSON.stringify(calls[1].messages);
	assert.match(retryPrompt, /would have lost content when stored/, "the retry says why it is being asked again");
	assert.match(retryPrompt, /beyond its \d+-character budget/, "and how far the section is over");
	assert.doesNotMatch(retryPrompt, /short entry 7\b/, "the retry names counts, never the previous reply's content");
	assert.equal(report.status, "updated", JSON.stringify(report));
	assert.equal(report.memoryWritten, true, "the retry's document fits, so it lands");
	assert.equal(report.sectionDropped, 0, "nothing was dropped");
	assert.equal(report.refusedLoss, undefined, "a stored reply has no refused loss to report");
	assert.match(await readFile(path.join(root, ".agents", "memory", "MEMORY.md"), "utf8"), /- one kept entry/);
});

test("tier C: the loss retry is the pass's last call — three at most, never chained", async () => {
	// First reply cut off by the output cap -> the existing max-tokens retry -> a lossy reply -> the one
	// loss retry -> still lossy. Three calls, then the refusal: an unbounded fix-up loop would spend a
	// model call per attempt on a document that cannot fit.
	const root = await memoryProject("dsh-tierc-bound-", "# Project Memory\n\n## Project\n- original\n");
	const { calls, ctx, agent } = await consolidationFixture({
		root,
		replies: [
			{ toolCall: { name: "record_memory", arguments: '{"memory":{"project":["p' }, reason: { kind: "max-tokens" } },
			{ text: FLOODED_TEXT_REPLY, reason: { kind: "stop" } },
		],
	});
	const config = resolvePluginConfig({ consolidateTurns: 1, maxMemoryChars: 4000, forceDedupeMs: 0 });

	const report = await consolidateProject(ctx, config, agent, { force: true, silent: true });

	assert.equal(calls.length, 3, "the truncation retry, the loss retry, and then no more");
	assert.equal(report.status, "lossy-refused", JSON.stringify(report));
	assert.equal(report.memoryWritten, false, "the still-lossy retry is not stored");
});

test("tier C: the refusal is cap-driven, which is what keeps a refusing tier from self-locking", async () => {
	// One reply, two caps: refused under a small one and stored under the live 40000-char one. That is
	// the whole self-lock argument — the refusal follows the budgets, so raising the cap is the lever
	// that decides whether this repo's own memory can still be updated at all.
	const reply = JSON.stringify({
		memory: { project: Array.from({ length: 120 }, (_, index) => `entry number ${index}`), invariants: [], pitfalls: [], index: [] },
		context: { title: "t", summary: "s", key_points: [], open_tasks: [] },
	});
	const run = async (cap) => {
		const root = await memoryProject(`dsh-tierc-cap-${cap}-`, "# Project Memory\n\n## Project\n- original\n");
		const { calls, ctx, agent } = await consolidationFixture({
			root,
			replies: [{ toolCall: { name: "record_memory", arguments: reply }, reason: { kind: "tool-calls" } }],
		});
		const config = resolvePluginConfig({ consolidateTurns: 1, maxMemoryChars: cap, forceDedupeMs: 0 });
		return { calls, root, report: await consolidateProject(ctx, config, agent, { force: true, silent: true }) };
	};

	const small = await run(4000);
	assert.equal(small.report.status, "lossy-refused", JSON.stringify(small.report));
	assert.equal(small.calls.length, 2, "the small cap retried once and then refused");
	assert.equal(await readFile(path.join(small.root, ".agents", "memory", "MEMORY.md"), "utf8"), "# Project Memory\n\n## Project\n- original\n");

	const large = await run(40_000);
	assert.equal(large.report.status, "updated", JSON.stringify(large.report));
	assert.equal(large.calls.length, 1, "the same reply fits the raised cap, so nothing was retried");
	assert.match(await readFile(path.join(large.root, ".agents", "memory", "MEMORY.md"), "utf8"), /- entry number 119/);
});

test("tier C: a cap marker the reply already carried is not this pass's loss", async () => {
	// A project that was ever capped stores MEMORY.md WITH the plugin's own marker, and the model
	// re-emits it inside <existing-memory>. Deciding the refusal from that LINE rather than from a real
	// cut refused a fitting reply with a count the cap never dropped — and because the number came from
	// the old marker it could exceed the cap, so raising maxMemoryChars could not escape the refusal.
	const root = await memoryProject("dsh-tierc-stale-marker-", "# Project Memory\n\n## Project\n- original\n");
	const reply = JSON.stringify({
		memory_markdown: "# Project Memory\n\nA durable prose fact about the project.\n\n_[memory truncated at 4000 characters: 2788 dropped]_",
		context: { title: "t", summary: "s", key_points: [], open_tasks: [] },
	});
	const { calls, ctx, agent } = await consolidationFixture({ root, replies: [{ text: reply, reason: { kind: "stop" } }] });
	const config = resolvePluginConfig({ consolidateTurns: 1, maxMemoryChars: 4000, forceDedupeMs: 0 });

	const report = await consolidateProject(ctx, config, agent, { force: true, silent: true });

	assert.equal(calls.length, 1, "nothing was cut, so nothing was retried");
	assert.equal(report.status, "updated", JSON.stringify(report));
	assert.equal(report.memoryWritten, true, "a fitting reply is stored");
	assert.equal(report.memoryWriteDroppedChars, 0, "no character of THIS reply was dropped by the cap");
	assert.equal(report.refusedLoss, undefined);
	assert.match(await readFile(path.join(root, ".agents", "memory", "MEMORY.md"), "utf8"), /A durable prose fact about the project\./);
});

test("tier C: a retry that would be worse never costs a reply that could have landed", async () => {
	// The first reply only cuts one entry to its per-item cap, which this pass accepts and stores; the
	// retry comes back with a flooded section that must be refused. Adopting it would turn a storable
	// reply into a refused one, so the worse retry is discarded and the first reply lands.
	const root = await memoryProject("dsh-tierc-worse-retry-", "# Project Memory\n\n## Project\n- original\n");
	const firstReply = JSON.stringify({
		memory: { project: [], invariants: [], pitfalls: [], index: ["x".repeat(1000)] },
		context: { title: "t", summary: "s", key_points: [], open_tasks: [] },
	});
	const { calls, ctx, agent } = await consolidationFixture({
		root,
		replies: [
			{ toolCall: { name: "record_memory", arguments: firstReply }, reason: { kind: "tool-calls" } },
			{ text: FLOODED_TEXT_REPLY, reason: { kind: "stop" } },
		],
	});
	const config = resolvePluginConfig({ consolidateTurns: 1, maxMemoryChars: 4000, forceDedupeMs: 0 });

	const report = await consolidateProject(ctx, config, agent, { force: true, silent: true });

	assert.equal(calls.length, 2, "the first reply was lossy, so the retry happened");
	assert.equal(report.status, "updated", JSON.stringify(report));
	assert.equal(report.memoryWritten, true, "the truncation-only first reply lands instead of being refused");
	assert.equal(report.itemTruncated, 1);
	assert.equal(report.refusedLoss, undefined);
	const stored = await readFile(path.join(root, ".agents", "memory", "MEMORY.md"), "utf8");
	assert.ok(stored.includes("x".repeat(100)), "the first reply's entry is what got stored");
});

test("tier C: a reply carrying no entries is the empty-skeleton gate's case, not a refusal", async () => {
	// A body-less document is over the cap like any other, but there is nothing to shrink and the
	// semantic gate is what stops the write. Reporting a refusal would name the cap as the blocker.
	const root = await memoryProject("dsh-tierc-empty-", "# Project Memory\n\n## Project\n- original\n");
	const reply = JSON.stringify({
		memory_markdown: `# Project Memory\n${"#".repeat(4200)}`,
		context: { title: "t", summary: "s", key_points: [], open_tasks: [] },
	});
	const { calls, ctx, agent } = await consolidationFixture({ root, replies: [{ text: reply, reason: { kind: "stop" } }] });
	const config = resolvePluginConfig({ consolidateTurns: 1, maxMemoryChars: 4000, forceDedupeMs: 0 });

	const report = await consolidateProject(ctx, config, agent, { force: true, silent: true });

	assert.equal(calls.length, 1, "a body-less reply is not worth a retry");
	assert.equal(report.refusedLoss, undefined, "the cap is not named as what stopped the write");
	assert.equal(report.memoryWritten, false);
	assert.equal(report.status, "updated", "the context still landed");
	assert.match(await readFile(path.join(root, ".agents", "memory", "errors.log"), "utf8"), /carried no entries/);
});

test("a failure after a refusal does not hide the refusal", async () => {
	const root = await memoryProject("dsh-tierc-refusal-failure-", "# Project Memory\n\n## Project\n- original\n");
	// The context write fails after the refusal was decided: CONTEXT.md is a directory here.
	await mkdir(path.join(root, ".agents", "memory", "CONTEXT.md"), { recursive: true });
	const { ctx, agent } = await consolidationFixture({
		root,
		replies: [{ toolCall: { name: "record_memory", arguments: FLOODED_MEMORY_ARGS }, reason: { kind: "tool-calls" } }],
	});
	const config = resolvePluginConfig({ consolidateTurns: 1, maxMemoryChars: 4000, forceDedupeMs: 0 });

	const report = await consolidateProject(ctx, config, agent, { force: true, silent: true });

	assert.equal(report.status, "failed", JSON.stringify(report));
	assert.equal(report.memoryWritten, false);
	assert.equal(report.contextWritten, false);
	assert.ok(report.refusedLoss !== undefined, "the refusal survives into the failure");
	assert.match(memoryUpdateReply(report).text, /The memory was not written: the reply would have been stored lossily/);
});

test("tier C: a refusal releases the pass claim, so a forced re-run re-reports instead of saying deduped", async () => {
	const root = await memoryProject("dsh-tierc-claim-", "# Project Memory\n\n## Project\n- original\n");
	const { calls, ctx, agent } = await consolidationFixture({
		root,
		replies: [{ toolCall: { name: "record_memory", arguments: FLOODED_MEMORY_ARGS }, reason: { kind: "tool-calls" } }],
	});
	// A real dedupe window: the pass itself is cached, so a second forced pass returns the cached
	// outcome. Without the claim release the report would answer `deduped` for a memory that never
	// landed, which is the claim that matters; the model call count stays 2 either way.
	const config = resolvePluginConfig({ consolidateTurns: 1, maxMemoryChars: 4000, forceDedupeMs: 60_000 });

	const first = await consolidateProject(ctx, config, agent, { force: true, silent: true });
	const second = await consolidateProject(ctx, config, agent, { force: true, silent: true });

	assert.equal(first.status, "lossy-refused", JSON.stringify(first));
	assert.equal(second.status, "lossy-refused", `a refusal must not be reported as deduped (got ${JSON.stringify(second)})`);
	assert.equal(calls.length, 2, "the cached pass makes no new model call inside forceDedupeMs");
});

test("tier C: a loss retry that fails for its own reason does not hide the refusal it was avoiding", async () => {
	// The retry exists to avoid a refusal, not to decide one: the first reply's own loss already says
	// whether it may be stored. A transport error there used to reject the pass, so the report read
	// `failed` — a decision the pass had already made vanished into an infrastructure error, and the
	// refusal's own counts went with it.
	const root = await memoryProject("dsh-tierc-retry-failure-", "# Project Memory\n\n## Project\n- original\n");
	const before = await readFile(path.join(root, ".agents", "memory", "MEMORY.md"), "utf8");
	const { calls, ctx, agent } = await consolidationFixture({
		root,
		replies: [{ toolCall: { name: "record_memory", arguments: FLOODED_MEMORY_ARGS }, reason: { kind: "tool-calls" } }],
		throwOnCall: 2, // the loss retry itself
	});
	const config = resolvePluginConfig({ consolidateTurns: 1, maxMemoryChars: 4000, forceDedupeMs: 0 });

	const report = await consolidateProject(ctx, config, agent, { force: true, silent: true });

	assert.equal(calls.length, 2, "the retry was attempted exactly once");
	assert.equal(report.status, "lossy-refused", `the first reply's refusal must outlive the retry failure (got ${JSON.stringify(report)})`);
	assert.equal(report.memoryWritten, false, "nothing was written");
	assert.ok(report.refusedLoss?.sectionDropped > 0, "the refused loss is still named apart from the landed counts");
	assert.equal(await readFile(path.join(root, ".agents", "memory", "MEMORY.md"), "utf8"), before, "the stored memory is byte-identical");
	const lines = (await readFile(path.join(root, ".agents", "memory", "errors.log"), "utf8"))
		.split("\n")
		.filter((line) => line.includes("targeted loss retry failed"));
	assert.equal(lines.length, 1, `the retry's own failure leaves its own line, got ${JSON.stringify(lines)}`);
	assert.match(lines[0], /retry transport error on call 2/, "the line names the call failure");
	assert.match(memoryUpdateReply(report).text, /was kept unchanged/, "the refusal receipt is what the user sees");
});

test("tier C: a loss retry that fails for its own reason does not discard a storable first reply", async () => {
	// The other shape of the same rule: the first reply only truncates one entry to its per-item cap,
	// which this pass accepts, so the retry is an improvement attempt. Its failure must not turn a
	// storable memory into no memory at all.
	const root = await memoryProject("dsh-tierc-retry-failure-item-");
	const reply = JSON.stringify({
		memory: { project: [], invariants: [], pitfalls: [], index: ["x".repeat(1000)] },
		context: { title: "t", summary: "s", key_points: [], open_tasks: [] },
	});
	const { calls, ctx, agent } = await consolidationFixture({
		root,
		replies: [{ toolCall: { name: "record_memory", arguments: reply }, reason: { kind: "tool-calls" } }],
		throwOnCall: 2,
	});
	const config = resolvePluginConfig({ consolidateTurns: 1, maxMemoryChars: 4000, forceDedupeMs: 0 });

	const report = await consolidateProject(ctx, config, agent, { force: true, silent: true });

	assert.equal(calls.length, 2);
	assert.equal(report.status, "updated", `the truncation-only first reply still lands (got ${JSON.stringify(report)})`);
	assert.equal(report.memoryWritten, true, "a failed improvement retry does not throw the memory away");
	assert.equal(report.itemTruncated, 1, "the accepted per-item truncation is reported");
	assert.equal(report.refusedLoss, undefined, "no refusal happened");
});

test("tier C: an aborted loss retry still fails the pass instead of landing the first reply", async () => {
	// The one retry failure that is not the retry's own: the caller cancelled the pass. Continuing would
	// let the caller write artifacts after that cancel, so the abort keeps failing the pass — the same
	// thing an abort during the first call does.
	const root = await memoryProject("dsh-tierc-retry-abort-");
	const { calls, ctx, agent } = await consolidationFixture({
		root,
		replies: [{ toolCall: { name: "record_memory", arguments: ITEM_CAP_ARGS }, reason: { kind: "tool-calls" } }],
		throwOnCall: 2,
	});
	const config = resolvePluginConfig({ consolidateTurns: 1, maxMemoryChars: 4000, forceDedupeMs: 0 });

	const report = await consolidateProject(ctx, config, agent, { force: true, silent: true, signal: AbortSignal.abort() });

	assert.equal(calls.length, 2);
	assert.equal(report.status, "failed", `an abort is not the retry's own failure (got ${JSON.stringify(report)})`);
	assert.equal(report.memoryWritten, false, "nothing is written after a cancel");
	assert.equal(report.contextWritten, false);
});

test("tier C: raising maxMemoryChars inside forceDedupeMs re-runs the pass instead of re-reporting the refusal", async () => {
	// The refusal's own lever is "Raise maxMemoryChars, or retry the pass later". A cached decision was
	// taken under the old cap, so serving it after the cap changed answered the new cap with the old
	// verdict — the user's fix could not take effect inside the window.
	const root = await memoryProject("dsh-tierc-cap-raise-", "# Project Memory\n\n## Project\n- original\n");
	const { calls, ctx, agent } = await consolidationFixture({
		root,
		replies: [
			{ toolCall: { name: "record_memory", arguments: FLOODED_MEMORY_ARGS }, reason: { kind: "tool-calls" } },
			{ toolCall: { name: "record_memory", arguments: FLOODED_MEMORY_ARGS }, reason: { kind: "tool-calls" } },
			{ text: FITTING_TEXT_REPLY, reason: { kind: "stop" } },
		],
	});
	const small = resolvePluginConfig({ consolidateTurns: 1, maxMemoryChars: 4000, forceDedupeMs: 60_000 });
	const big = resolvePluginConfig({ consolidateTurns: 1, maxMemoryChars: 40_000, forceDedupeMs: 60_000 });

	const first = await consolidateProject(ctx, small, agent, { force: true, silent: true });
	const raised = await consolidateProject(ctx, big, agent, { force: true, silent: true });

	assert.equal(first.status, "lossy-refused", JSON.stringify(first));
	assert.equal(calls.length, 3, "the raised cap makes a real model call inside the window");
	assert.equal(raised.status, "updated", `the old cap's refusal must not answer the new cap (got ${JSON.stringify(raised)})`);
	assert.equal(raised.memoryWritten, true, "the reply that fits the new cap lands");
});

test("tier C: a cached refusal names the cap it was measured under, not the current setting", async () => {
	// The throttled path re-reports a cached decision as it stands, so its log line has to read the cap
	// that actually measured the loss. Naming the setting in force at report time attributes the loss to
	// a cap that never saw it — the wrong-cause defect this repo treats as a real one, not a slip.
	const root = await memoryProject("dsh-tierc-cached-cap-");
	const prose = `# Project Memory\n\n${"a prose memory paragraph. ".repeat(400)}`;
	const { calls, ctx, agent } = await consolidationFixture({
		root,
		replies: [{ text: JSON.stringify({ memory_markdown: prose, context: { title: "t", summary: "s", key_points: [], open_tasks: [] } }), reason: { kind: "stop" } }],
	});
	const small = resolvePluginConfig({ maxTokens: 8192, maxOutputTokens: 32_768, consolidateTurns: 1, maxMemoryChars: 4000, forceDedupeMs: 60_000 });
	const big = resolvePluginConfig({ maxTokens: 8192, maxOutputTokens: 32_768, consolidateTurns: 1, maxMemoryChars: 40_000, forceDedupeMs: 60_000 });

	const first = await consolidateProject(ctx, small, agent, { force: true, silent: true });
	// No `force`: the pass is throttled, so the cached refusal is re-reported under the new cap.
	const cached = await consolidateProject(ctx, big, agent, { silent: true });

	assert.equal(first.status, "lossy-refused", JSON.stringify(first));
	assert.equal(cached.status, "lossy-refused", JSON.stringify(cached));
	assert.equal(calls.length, 2, "the throttled path makes no new model call");
	const capLines = (await readFile(path.join(root, ".agents", "memory", "errors.log"), "utf8"))
		.split("\n")
		.filter((line) => line.includes("character(s) of the reply exceeded"));
	assert.equal(capLines.length, 2, "each report leaves its own line");
	assert.match(capLines[1], /the 4000-character memory cap/, `the re-report names the cap it was measured under, got ${capLines[1]}`);
	assert.doesNotMatch(capLines[1], /the 40000-character memory cap/, "not the setting in force at report time");
});

test("counts describe only what landed, and a receipt never claims an artifact that did not", async () => {
	// The stored context is over the read cap, so characters of it really are hidden from the model;
	// the reply's context shape is unusable, so CONTEXT.md is left unchanged. Reporting the hidden
	// count anyway would attribute a loss to an artifact that never reached disk — and the receipt
	// used to claim both artifacts were updated.
	const root = await memoryProject("dsh-memory-unlanded-loss-", "# Project Memory\n\n## Project\n- original\n");
	await writeFile(path.join(root, ".agents", "memory", "CONTEXT.md"), "x".repeat(60_000), "utf8");
	const { ctx, agent } = await consolidationFixture({
		root,
		replies: [{
			text: JSON.stringify({
				memory_markdown: "# Project Memory\n\n## Project\n- kept even though the context shape was unusable\n",
				context: { title: "t", summary: 42, key_points: [], open_tasks: [] },
			}),
			reason: { kind: "stop" },
		}],
	});
	const config = resolvePluginConfig({ maxTokens: 8192, maxOutputTokens: 32_768, consolidateTurns: 1, maxMemoryChars: 40_000, forceDedupeMs: 0 });

	const report = await consolidateProject(ctx, config, agent, { force: true, silent: true });

	assert.equal(report.status, "updated", JSON.stringify(report));
	assert.equal(report.memoryWritten, true, "the memory landed");
	assert.equal(report.contextWritten, false, "an unusable context leaves CONTEXT.md unchanged");
	assert.equal(report.contextHiddenChars, 0, "a context that never landed reports no hidden characters");
	assert.equal(report.contextDroppedChars, 0);
	assert.equal(memoryUpdateReply(report).text, "Memory: updated MEMORY.md.", "the receipt must not claim the context was updated");
	const unusable = (await readFile(path.join(root, ".agents", "memory", "errors.log"), "utf8")).split("\n").filter((line) => line.includes("context whose shape is unusable"));
	assert.equal(unusable.length, 1, "the first pass reports it");
	const second = await consolidateProject(ctx, config, agent, { force: true, silent: true });
	assert.equal(second.contextWritten, false);
	const repeated = (await readFile(path.join(root, ".agents", "memory", "errors.log"), "utf8")).split("\n").filter((line) => line.includes("context whose shape is unusable"));
	assert.equal(repeated.length, 2, `a third once-per-project gate would leave only one line, got ${JSON.stringify(repeated)}`);
});

test("a shortening that did not land is never receipted as clipped", async () => {
	// R1: the pass derives `clipped` from the landed hidden counts, so a shortening that belonged to an
	// artifact which did not land cannot read as a loss. Here the input fit hid characters of the
	// MEMORY, the reply's memory was below the length floor so no memory landed, and the (fully shown)
	// context did: the receipt must report a plain context update, leave the memory file untouched, and
	// still record the pass-level shortening in errors.log.
	const root = await memoryProject("dsh-unlanded-clip-", undefined);
	const stored = `# Project Memory\n\n${"字".repeat(39_000)}\n`;
	await writeFile(path.join(root, ".agents", "memory", "MEMORY.md"), stored, "utf8");
	// Guard the fixture: this test proves nothing unless the fit really hides memory characters and
	// the context is shown whole.
	const fitted = fitMemoryInput(stored, "", 8192, {}, 32_768);
	assert.ok(fitted.memoryHiddenChars > 0 && fitted.contextHiddenChars === 0, `fixture: the memory is the clipped artifact (${JSON.stringify(fitted)})`);

	const { ctx, agent } = await consolidationFixture({
		root,
		replies: [{ text: JSON.stringify({ memory_markdown: "x", context: { title: "t", summary: "s", key_points: ["k"], open_tasks: [] } }), reason: { kind: "stop" } }],
	});
	const config = resolvePluginConfig({ maxTokens: 8192, maxOutputTokens: 32_768, consolidateTurns: 1, maxMemoryChars: 40_000, forceDedupeMs: 0 });

	const report = await consolidateProject(ctx, config, agent, { force: true, silent: true });

	assert.equal(report.status, "updated", `a shortening that never landed must not be reported as clipped (got ${JSON.stringify(report)})`);
	assert.equal(report.memoryWritten, false, "the below-floor reply wrote no memory");
	assert.equal(report.contextWritten, true, "the context landed");
	assert.equal(report.memoryHiddenChars, 0, "no landed artifact lost characters");
	assert.equal(report.contextHiddenChars, 0, "the context the model was shown whole");
	assert.equal(memoryUpdateReply(report).text, "Memory: updated CONTEXT.md.", "the receipt must not claim a shortening");
	assert.equal(await readFile(path.join(root, ".agents", "memory", "MEMORY.md"), "utf8"), stored, "the stored memory is untouched");
	const shortened = (await readFile(path.join(root, ".agents", "memory", "errors.log"), "utf8"))
		.split("\n")
		.filter((line) => line.includes("shortened version of the existing memory"));
	assert.equal(shortened.length, 1, `the pass-level shortening still leaves its own line, got ${JSON.stringify(shortened)}`);
});

test("a clipped pass that landed nothing still leaves its own line", async () => {
	// The line is the trace for the shortening the status no longer carries, so it must not depend on
	// a write: with a below-floor memory and an unusable context nothing lands at all, the pass reports
	// `unchanged`, and the hidden characters would otherwise vanish from every surface.
	const root = await memoryProject("dsh-nothing-landed-clip-", undefined);
	const stored = `# Project Memory\n\n${"字".repeat(39_000)}\n`;
	await writeFile(path.join(root, ".agents", "memory", "MEMORY.md"), stored, "utf8");
	await writeFile(path.join(root, ".agents", "memory", "CONTEXT.md"), "# Project Context\n\n## Summary\n\nold summary\n", "utf8");
	// Guard the fixture: the fit hides memory characters, and the non-empty context keeps the fallback
	// from writing one.
	assert.ok(fitMemoryInput(stored, "", 8192, {}, 32_768).memoryHiddenChars > 0, "fixture: the input fit hides memory characters");

	const { ctx, agent } = await consolidationFixture({
		root,
		replies: [{ text: JSON.stringify({ memory_markdown: "x", context: { title: "t", summary: 42, key_points: [], open_tasks: [] } }), reason: { kind: "stop" } }],
	});
	const config = resolvePluginConfig({ maxTokens: 8192, maxOutputTokens: 32_768, consolidateTurns: 1, maxMemoryChars: 40_000, forceDedupeMs: 0 });

	const report = await consolidateProject(ctx, config, agent, { force: true, silent: true });

	assert.equal(report.status, "unchanged", `fixture: nothing landed (got ${JSON.stringify(report)})`);
	assert.equal(report.memoryWritten, false);
	assert.equal(report.contextWritten, false);
	assert.equal(memoryUpdateReply(report).text, "Consolidation ran but produced no new memory or context.");
	const shortened = (await readFile(path.join(root, ".agents", "memory", "errors.log"), "utf8"))
		.split("\n")
		.filter((line) => line.includes("shortened version of the existing memory"));
	assert.equal(shortened.length, 1, `a pass that landed nothing still leaves the line, got ${JSON.stringify(shortened)}`);
});

test("the context read cap is counted as characters the model was not shown", async () => {
	// `existingContext` is sliced to MAX_CONTEXT_CHARS before the fit ever sees it, so an over-cap
	// stored context loses that much on every pass. The receipt has to count it, or it understates
	// what the model was shown.
	const root = await memoryProject("dsh-context-read-cap-", "# Project Memory\n\n## Project\n- original\n");
	const storedContext = "x".repeat(60_000);
	await writeFile(path.join(root, ".agents", "memory", "CONTEXT.md"), storedContext, "utf8");
	const { ctx, agent } = await consolidationFixture({
		root,
		replies: [{ text: JSON.stringify({ memory_markdown: "# Project Memory\n\n## Project\n- rewritten\n", context: { title: "t", summary: "s", key_points: [], open_tasks: [] } }), reason: { kind: "stop" } }],
	});
	const config = resolvePluginConfig({ maxTokens: 8192, maxOutputTokens: 32_768, consolidateTurns: 1, maxMemoryChars: 40_000, forceDedupeMs: 0 });

	const report = await consolidateProject(ctx, config, agent, { force: true, silent: true });

	assert.equal(report.contextWritten, true, JSON.stringify(report));
	assert.ok(report.contextHiddenChars >= storedContext.length - MAX_CONTEXT_CHARS, `the read cap is counted (got ${report.contextHiddenChars})`);
	assert.equal(report.status, "clipped", "a landed read-cap shortening is what `clipped` means, for the context side too");
	assert.match(memoryUpdateReply(report).text, new RegExp(`${report.contextHiddenChars} character\\(s\\) of the stored context`));
	// The pass-level flag covers the read cap too, so the diagnostic line is not reserved for the
	// output fit: a permanently over-cap stored context is worth a line on every pass.
	const shortened = (await readFile(path.join(root, ".agents", "memory", "errors.log"), "utf8"))
		.split("\n")
		.filter((line) => line.includes("shortened version of the existing memory"));
	assert.equal(shortened.length, 1, `the context read cap leaves its own line, got ${JSON.stringify(shortened)}`);
});

test("the memory read cap is counted as characters the model was not shown", async () => {
	// R2: `loadMemory` caps a stored document before the pass sees it (a hand edit, or a
	// `maxMemoryChars` lowered below what an earlier pass wrote). The input fit cannot count that cut —
	// it receives the already-capped text — so the loader reports its own cut and the pass folds it in.
	const root = await memoryProject("dsh-memory-read-cap-", undefined);
	const body = Array.from({ length: 100 }, (_, i) => `- fact ${i} ${"字".repeat(100)}`).join("\n");
	const stored = `# Project Memory\n\n${body}\n`;
	await writeFile(path.join(root, ".agents", "memory", "MEMORY.md"), stored, "utf8");
	const cap = 8_000;
	const loaded = await loadMemory(root, cap);
	assert.ok(loaded.cappedDroppedChars > 0, `fixture: the loader cut the document (${loaded.text.length} of ${stored.trimEnd().length})`);
	assert.equal(loaded.text.length + loaded.cappedDroppedChars, stored.trimEnd().length, "fixture: this read path clips without a marker, so the cut is the exact difference");
	// Guard the other half: the fit must not clip, or the count below could be the fit's.
	assert.equal(fitMemoryInput(loaded.text, "", 8192, {}, 32_768).clipped, false, "fixture: the input fit is not the cap here");

	const reply = JSON.stringify({ memory_markdown: "# Project Memory\n\n- a durable fact this pass rewrote, past the floor\n", context: { title: "t", summary: "s", key_points: [], open_tasks: [] } });
	const { ctx, agent } = await consolidationFixture({ root, replies: [{ text: reply, reason: { kind: "stop" } }] });
	const config = resolvePluginConfig({ maxTokens: 8192, maxOutputTokens: 32_768, consolidateTurns: 1, maxMemoryChars: cap, forceDedupeMs: 0 });

	const report = await consolidateProject(ctx, config, agent, { force: true, silent: true });

	assert.equal(report.memoryWritten, true, JSON.stringify(report));
	assert.equal(report.memoryHiddenChars, loaded.cappedDroppedChars, "the read cap's own cut, counted exactly once");
	assert.equal(report.status, "clipped", "a landed shortening is what `clipped` means");
	assert.match(memoryUpdateReply(report).text, new RegExp(`${report.memoryHiddenChars} character\\(s\\) of the stored memory`));
	// The pass-level flag reaches the loader's cut as well, so the diagnostic line is not reserved for
	// the output fit.
	const shortened = (await readFile(path.join(root, ".agents", "memory", "errors.log"), "utf8"))
		.split("\n")
		.filter((line) => line.includes("shortened version of the existing memory"));
	assert.equal(shortened.length, 1, `the memory read cap leaves its own line, got ${JSON.stringify(shortened)}`);
});

test("the read cap and the input fit are counted separately, never substituted for each other", async () => {
	// Both caps are reachable on one pass: the stored document is over `maxMemoryChars`, and what is
	// left is over the model's output budget. Folding either into the other's place would understate
	// what the model was not shown, so the two must add up to the stored-minus-sent difference.
	const root = await memoryProject("dsh-double-cap-", undefined);
	const body = Array.from({ length: 200 }, (_, i) => `- fact ${i} ${"字".repeat(200)}`).join("\n");
	const stored = `# Project Memory\n\n${body}\n`;
	await writeFile(path.join(root, ".agents", "memory", "MEMORY.md"), stored, "utf8");
	const cap = 40_000;
	const loaded = await loadMemory(root, cap);
	assert.ok(loaded.cappedDroppedChars > 0, "fixture: the read cap cut the stored document");
	assert.equal(fitMemoryInput(loaded.text, "", 8192, {}, 32_768).clipped, true, "fixture: the fit cuts the already-capped text too");

	const reply = JSON.stringify({ memory_markdown: "# Project Memory\n\n- a durable fact this pass rewrote, past the floor\n", context: { title: "t", summary: "s", key_points: [], open_tasks: [] } });
	const { calls, ctx, agent } = await consolidationFixture({ root, replies: [{ text: reply, reason: { kind: "stop" } }] });
	const config = resolvePluginConfig({ maxTokens: 8192, maxOutputTokens: 32_768, consolidateTurns: 1, maxMemoryChars: cap, forceDedupeMs: 0 });

	const report = await consolidateProject(ctx, config, agent, { force: true, silent: true });

	assert.equal(calls.length, 1, "fixture: no retry, so the one call carries the fitted input");
	const sentMemory = /<existing-memory>\n([\s\S]*?)\n<\/existing-memory>/.exec(calls[0].messages[0].content.map((block) => block.text ?? "").join("\n"))[1];
	const fitHidden = loaded.text.length - sentMemory.length;
	assert.ok(fitHidden > 0, "fixture: the fit really hid characters of the capped text");
	assert.equal(
		report.memoryHiddenChars,
		loaded.cappedDroppedChars + fitHidden,
		"the read cap and the input fit are two counts, and neither absorbs the other",
	);
});

test("a clipped CONTEXT.md render reaches the receipt and logs on every pass", async () => {
	const root = await memoryProject("dsh-context-clip-receipt-", "# Project Memory\n\n## Project\n- original\n");
	const reply = JSON.stringify({
		memory_markdown: "# Project Memory\n\n## Project\n- a durable fact kept by this pass, past the length floor\n",
		context: { title: "t", summary: "s".repeat(20_000), key_points: [], open_tasks: [] },
	});
	const { ctx, agent } = await consolidationFixture({ root, replies: [{ text: reply, reason: { kind: "stop" } }] });
	const config = resolvePluginConfig({ maxTokens: 8192, maxOutputTokens: 32_768, consolidateTurns: 1, maxMemoryChars: 40_000, forceDedupeMs: 0 });

	const first = await consolidateProject(ctx, config, agent, { force: true, silent: true });
	assert.ok(first.contextDroppedChars > 0, `the context render dropped characters (got ${JSON.stringify(first)})`);
	assert.match(memoryUpdateReply(first).text, /character\(s\) of the context were dropped to fit its section budgets/);
	assert.notEqual(memoryUpdateReply(first).text, memoryUpdateReply(plainReport("updated")).text, "a clipped context must not read as a clean pass");

	const second = await consolidateProject(ctx, config, agent, { force: true, silent: true });
	assert.ok(second.contextDroppedChars > 0, "the second pass drops too");
	const logged = (await readFile(path.join(root, ".agents", "memory", "errors.log"), "utf8"))
		.split("\n")
		.filter((line) => line.includes("CONTEXT.md was clipped"));
	assert.equal(logged.length, 2, `each clipped render leaves its own line, got ${JSON.stringify(logged)}`);
});

test("an over-cap opaque reply is refused instead of landing a capped document", async () => {
	// Opaque (not a four-section bullet document) replies never reach the section renderer, so the write
	// cap used to be the only place this loss was recorded at all — and it landed a capped document with
	// a truncation marker. Tier C now measures that loss in the pass, retries it once and refuses it,
	// which is why `memoryWriteDroppedChars` can no longer be non-zero on a landed write: the branch is
	// kept as the invariant's own alarm, and the refused number is what the receipt and log carry.
	const root = await memoryProject("dsh-memory-write-cap-", "# Project Memory\n\n## Project\n- original\n");
	const storedBefore = await readFile(path.join(root, ".agents", "memory", "MEMORY.md"), "utf8");
	const prose = `# Project Memory\n\n${"a prose memory paragraph. ".repeat(400)}`;
	const { calls, ctx, agent } = await consolidationFixture({
		root,
		replies: [{ text: JSON.stringify({ memory_markdown: prose, context: { title: "t", summary: "s", key_points: [], open_tasks: [] } }), reason: { kind: "stop" } }],
	});
	const config = resolvePluginConfig({ maxTokens: 8192, maxOutputTokens: 32_768, consolidateTurns: 1, maxMemoryChars: 4000, forceDedupeMs: 0 });

	const report = await consolidateProject(ctx, config, agent, { force: true, silent: true });

	assert.equal(calls.length, 2, "the write-cap loss gets the one retry too");
	assert.match(JSON.stringify(calls[1].messages), /over the memory cap/, "and the retry names the cap");
	assert.equal(report.status, "lossy-refused", JSON.stringify(report));
	assert.equal(report.memoryWriteDroppedChars, 0, "no capped document landed at all");
	assert.ok(report.refusedLoss.writeCapDroppedChars > 0, `the refused reply's own cap loss is what is reported (got ${JSON.stringify(report)})`);
	assert.equal(await readFile(path.join(root, ".agents", "memory", "MEMORY.md"), "utf8"), storedBefore, "the stored memory is untouched");
	assert.doesNotMatch(storedBefore, /a prose memory paragraph/, "fixture check: the refused reply is not what was stored");
	assert.match(memoryUpdateReply(report).text, /character\(s\) of the reply exceeded the memory cap/);
	assert.match(await readFile(path.join(root, ".agents", "memory", "errors.log"), "utf8"), /exceeded the 4000-character memory cap/);
});

test("a reply below the length floor is logged instead of discarded silently", async () => {
	const stored = "# Project Memory\n\n## Project\n- an existing durable fact\n";
	const root = await memoryProject("dsh-memory-floor-log-", stored);
	const { ctx, agent } = await consolidationFixture({
		root,
		replies: [{ text: JSON.stringify({ memory_markdown: "# Project Memory\n- tiny\n", context: { title: "t", summary: "s", key_points: [], open_tasks: [] } }), reason: { kind: "stop" } }],
	});
	const config = resolvePluginConfig({ consolidateTurns: 1, maxMemoryChars: 40_000, forceDedupeMs: 0 });

	const report = await consolidateProject(ctx, config, agent, { force: true, silent: true });

	assert.equal(report.memoryWritten, false, "the floor keeps the stored memory");
	assert.equal(await readFile(path.join(root, ".agents", "memory", "MEMORY.md"), "utf8"), stored);
	assert.equal(memoryUpdateReply(report).text, "Memory: updated CONTEXT.md.", "the receipt no longer claims a memory that was not written");
	assert.match(await readFile(path.join(root, ".agents", "memory", "errors.log"), "utf8"), /below the 40-character floor/);
});

test("a failure after the memory landed keeps the landed loss in the receipt", async () => {
	const root = await memoryProject("dsh-memory-partial-land-", "# Project Memory\n\n## Project\n- original\n");
	// Make the context write fail: CONTEXT.md is a directory, so the atomic replace cannot land.
	await mkdir(path.join(root, ".agents", "memory", "CONTEXT.md"), { recursive: true });
	// A whole-entry drop no longer lands at all (tier C refuses it), so the loss that has to survive
	// into the failed report is the other one: an entry cut to its section's per-item cap and kept.
	const reply = JSON.stringify({
		memory: { project: [], invariants: [], pitfalls: [], index: ["x".repeat(1000)] },
		context: { title: "t", summary: "s", key_points: [], open_tasks: [] },
	});
	const { ctx, agent } = await consolidationFixture({
		root,
		replies: [{ toolCall: { name: "record_memory", arguments: reply }, reason: { kind: "tool-calls" } }],
	});
	const config = resolvePluginConfig({ consolidateTurns: 1, maxMemoryChars: 4000, forceDedupeMs: 0 });

	const report = await consolidateProject(ctx, config, agent, { force: true, silent: true });

	assert.equal(report.status, "failed", JSON.stringify(report));
	assert.equal(report.memoryWritten, true, "the memory landed before the failure");
	assert.equal(report.contextWritten, false);
	assert.equal(report.itemTruncated, 1, "the landed truncation survives into the failed report");
	const receipt = memoryUpdateReply(report).text;
	assert.match(receipt, /The memory had already landed, with this loss/);
	assert.match(receipt, /per-item cap/, "the surviving loss names its mechanism");
});

test("the /memory reply reports a memory that is riding the character cap", () => {
	// The cap is the one degraded state the document cannot surface on its own: the marker is
	// written into MEMORY.md but nothing reads it back, so before this note the receipt called a
	// memory that had lost a third of itself perfectly healthy. Measured on this repo at 41733
	// characters, the loaded document is capped at 31888 with 9621 dropped and every other flag clean.
	const projectRoot = "/tmp/project";
	const context = { projectRoot, journal: ".agents/memory/memory.jsonl", maxMemoryChars: 32_000 };
	const capped = normalizeMemoryDocument(`# Project Memory\n\n${"x".repeat(40_000)}\n`, 32_000);
	assert.equal(isMemoryTruncated(capped), true, "the fixture really is capped");

	const reply = memoryStatusReply({ text: capped, source: ".agents/memory/MEMORY.md" }, context);
	assert.equal(reply.kind, "success");
	assert.match(reply.text, /32000-character cap/, "the note names the configured cap");
	assert.match(reply.text, /dropped on write/, "and says what the consequence is");
	assert.match(reply.text, /Memory: \.agents\/memory\/MEMORY\.md/, "the normal line is still there");

	// An uncapped memory must not cry wolf, or the warning stops meaning anything.
	const healthy = memoryStatusReply({ text: "# Project Memory\n\n- a fact\n", source: ".agents/memory/MEMORY.md" }, context);
	assert.doesNotMatch(healthy.text, /cap|dropped|truncat/i, "a memory inside the cap is reported as plain healthy");
	assert.equal(healthy.text, "Memory: .agents/memory/MEMORY.md");

	// The loader's own cut raises the warning by itself: the no-journal read clips without writing a
	// marker into the document, so a marker-only trigger stayed silent about exactly the read the
	// count exists for.
	const cutNoMarker = memoryStatusReply({ text: "# Project Memory\n\n- partial\n", source: ".agents/memory/MEMORY.md", cappedDroppedChars: 1200 }, context);
	assert.equal(cutNoMarker.kind, "success");
	assert.match(cutNoMarker.text, /32000-character cap/, "a cut the loader reports raises the warning even without a marker");

	// No memory yet keeps its own wording and gains no warning.
	const empty = memoryStatusReply({ text: "", source: ".agents/memory/MEMORY.md" }, context);
	assert.match(empty.text, /Memory: none yet — \/tmp\/project\/\.agents\/memory\/MEMORY\.md/);
	assert.doesNotMatch(empty.text, /cap/i);

	// The cap must not replace the other degraded states: a damaged journal that is also capped
	// reports both, and the damaged wording survives intact.
	const damaged = memoryStatusReply({ text: capped, source: ".agents/memory/MEMORY.md", damaged: 3 }, context);
	assert.match(damaged.text, /3 unusable line\(s\) skipped/, "the damaged wording is unchanged");
	assert.match(damaged.text, /errors\.log/);
	assert.match(damaged.text, /32000-character cap/, "and the cap is reported alongside it");

	// A poisoned source likewise keeps its own wording, and the cap count follows the configured
	// limit rather than a hardcoded 32000.
	const poisoned = memoryStatusReply({ text: capped, source: ".agents/memory/MEMORY.md", poisoned: true }, { ...context, maxMemoryChars: 40_000 });
	assert.match(poisoned.text, /stored as raw JSON from the old bug/);
	assert.match(poisoned.text, /40000-character cap/, "the note follows the configured cap");

	// An unreadable source stays an error and claims nothing about the cap it never loaded.
	const unreadable = memoryStatusReply({ text: "", source: "/tmp/project/.agents/memory/memory.jsonl", unreadable: true }, context);
	assert.equal(unreadable.kind, "error");
	assert.doesNotMatch(unreadable.text, /cap/i);
});

test("resolvePluginConfig validates every documented bound", () => {
	assert.deepEqual(resolvePluginConfig(undefined), { ...DEFAULT_CONFIG });
	assert.throws(() => resolvePluginConfig({ nope: 1 }), /unknown config key/);
	assert.throws(() => resolvePluginConfig({ archiveEnabled: "yes" }), /archiveEnabled must be a boolean/);
	assert.throws(() => resolvePluginConfig({ consolidateTurns: 0 }), /consolidateTurns must be a number >= 1/);
	assert.throws(() => resolvePluginConfig({ handoffThresholdRatio: 0.96 }), /between 0.1 and 0.95/);
	assert.throws(() => resolvePluginConfig({ handoffBudgetSummaryTokens: 7_999 }), /between 8000 and 200000/);
	// `handoffThinking` was retired with the generated summary: a stored value is now an unknown key.
	assert.throws(() => resolvePluginConfig({ handoffThinking: "high" }), /unknown config key "handoffThinking"/);
	assert.throws(() => resolvePluginConfig({ handoffPendingQuestion: "skip" }), /handoffPendingQuestion/);
	assert.equal(resolvePluginConfig({ handoffPendingQuestion: "wait" }).handoffPendingQuestion, "wait");
	assert.throws(() => resolvePluginConfig("nope"), /config must be an object/);
	assert.throws(() => resolvePluginConfig({ provider: "p" }), /provider and model must be set together/);
	// The memory cap is configurable inside the bounds the normalizer can actually serve.
	assert.throws(() => resolvePluginConfig({ maxMemoryChars: 3_999 }), /maxMemoryChars must be a number between 4000 and 200000/);
	assert.throws(() => resolvePluginConfig({ maxMemoryChars: 200_001 }), /maxMemoryChars must be a number between 4000 and 200000/);
	assert.throws(() => resolvePluginConfig({ maxMemoryChars: "big" }), /maxMemoryChars must be a number between/);
	assert.equal(resolvePluginConfig({ maxMemoryChars: 5_000 }).maxMemoryChars, 5_000);
	assert.equal(DEFAULT_CONFIG.maxMemoryChars, 40_000, "the default cap is the documented 40000");

	const parsed = resolvePluginConfig({ consolidateTurns: 9.6, provider: "p", model: "m", handoffPendingQuestion: "wait" });
	assert.equal(parsed.consolidateTurns, 10, "whole-number fields round");
	assert.equal(parsed.provider, "p");
	assert.equal(parsed.model, "m");
	assert.equal(parsed.handoffPendingQuestion, "wait");
	assert.equal(parsed.memoryEnabled, DEFAULT_CONFIG.memoryEnabled);
});

test("clip and truncateMiddle keep the head and the tail inside the budget", () => {
	assert.equal(clip("  short  ", 20), "short");
	assert.match(clip("x".repeat(50), 10), /^x{10}\n\[\.\.\.truncated\.\.\.\]$/);

	const text = `${"h".repeat(60)}MIDDLE${"t".repeat(60)}`;
	const cut = truncateMiddle(text, 40);
	assert.match(cut, /^h+\n\n\[\.\.\.middle of conversation omitted\.\.\.\]\n\nt+$/);
	assert.ok(cut.length <= 40 + 50, `truncated length ${cut.length}`);
	assert.equal(truncateMiddle("short", 40), "short");
});

test("the output budget is raised to fit the reply and bounded by the ceiling", () => {
	// Dense scripts cost about a token per character; ASCII prose costs well under one.
	assert.ok(replyTokenRate("汉字" .repeat(10)) > 0.95);
	assert.ok(replyTokenRate("plain ascii prose") < 0.5);
	assert.equal(replyTokenRate(""), 0.4);

	// Configured wins unless more room is needed; the model's own limit and the ceiling bound it.
	assert.equal(adaptiveOutputTokens(8192, 100, {}, 32_768), 8192);
	assert.equal(adaptiveOutputTokens(8192, 20_000, {}, 32_768), 20_000);
	assert.equal(adaptiveOutputTokens(8192, 100_000, {}, 32_768), 32_768);
	assert.equal(adaptiveOutputTokens(8192, 100_000, { maxTokens: 12_000 }, 32_768), 12_000);
	assert.equal(adaptiveOutputTokens(8192, 100_000, { maxTokens: 0 }, 32_768), 32_768);

	// A small input passes through untouched and is not reported as clipped.
	const small = fitMemoryInput("# Project Memory\n\nsmall", "## Summary\nsmall", 8192, {}, 32_768);
	assert.equal(small.clipped, false);
	assert.equal(small.text, "# Project Memory\n\nsmall");
	assert.equal(small.maxTokens, 8192);

	// A huge input is shortened on both sides, and the estimate stays inside the budget.
	const memory = "m".repeat(400_000);
	const context = "c".repeat(400_000);
	const fitted = fitMemoryInput(memory, context, 8192, {}, 32_768);
	assert.equal(fitted.clipped, true);
	assert.ok(fitted.text.length < memory.length && fitted.contextText.length < context.length);
	const estimate = fitted.text.length * replyTokenRate(fitted.text) + fitted.contextText.length * replyTokenRate(fitted.contextText);
	// The real invariant: the reply must still have room for its own JSON scaffolding.
	assert.ok(estimate <= fitted.maxTokens - 64, `estimate ${estimate} leaves no margin inside ${fitted.maxTokens}`);
	assert.ok(fitted.maxTokens >= 8192, "the adaptive cap never drops below the configured maxTokens");
	assert.equal(fitted.maxTokens <= 32_768, true, "and never exceeds the ceiling");
	// Head and tail survive, the middle is what is dropped.
	assert.ok(fitted.text.startsWith("m") && fitted.text.endsWith("m"));
	assert.match(fitted.text, /\n\n/);
});

test("clipText never splits a surrogate pair and replyHead fences the raw reply", () => {
	const emoji = "a".repeat(50) + "🎉".repeat(50);
	const cut = clipText(emoji, 60);
	assert.ok(cut.length <= 60);
	// Re-encoding must not produce a replacement character.
	assert.equal(Buffer.from(cut, "utf8").toString("utf8"), cut);
	assert.match(cut, /\n\n/);

	// Sweep every limit: a clip must never end or start on half of a surrogate pair.
	for (let limit = 0; limit <= 70; limit += 1) {
		const piece = clipText(emoji, limit);
		assert.ok(piece.length <= limit, `limit ${limit} produced ${piece.length} chars`);
		assert.equal(Buffer.from(piece, "utf8").toString("utf8"), piece, `limit ${limit} split a character`);
	}

	const short = replyHead("{}");
	assert.match(short, /^--- raw reply ---\n\{\}$/);
	const long = replyHead("x".repeat(5000));
	assert.match(long, /\[\.\.\.reply omitted after 4000 of 5000 chars\.\.\.\]/);

	// This excerpt is embedded in an error that reaches `ctx.logger.warn`, which writes verbatim, so
	// the redaction has to happen here at the source — not only on the `errors.log` append path.
	const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signaturepart";
	const key = "sk-abcdefghijklmnop";
	const leaking = replyHead(`{"memory_markdown": "apiKey = ${key}", "note": "authorization: Bearer ${jwt}"}`);
	assert.ok(!leaking.includes(jwt), "the raw-reply excerpt must not carry a JWT");
	assert.ok(!leaking.includes(key), "the raw-reply excerpt must not carry a key");
	assert.match(leaking, /\[redacted/);
	// A caller may pass a shorter budget; the cap and its notice still apply.
	const bounded = replyHead("y".repeat(500), 100);
	assert.match(bounded, /\[\.\.\.reply omitted after 100 of 500 chars\.\.\.\]/);
});

test("fallbackUpdate summarizes a session from its first user message alone", () => {
	const session = fakeEventSession([
		{ type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "整理 log" }] } },
		{ type: "assistant/message", data: { message: { content: [{ type: "text", text: "好" }] } } },
	]);
	const update = fallbackUpdate(session);
	assert.equal(update.title, "Session recorded");
	assert.equal(update.summary, "整理 log");
	assert.deepEqual(update.key_points, []);

	const empty = fallbackUpdate(fakeEventSession([]));
	assert.match(empty.summary, /without a model summary/);
});

/** A fake session carrying only what the event-level helpers read. */
function fakeEventSession(events, id = "session-abcdef", cwd = "/tmp/fake-project") {
	return {
		id,
		header: { version: 3, createdAt: Date.UTC(2026, 8, 13), cwd, isSeeded: false },
		snapshotEvents: () => events,
		deriveMessages: () => [],
	};
}

test("writeAtomic and the synchronous text cache agree on the file they serve", async () => {
	const project = await mkdtemp(path.join(tmpdir(), "dsh-atomic-"));
	const file = path.join(project, "nested", "MEMORY.md");
	await writeAtomic(file, "first\n");
	assert.equal(await readFile(file, "utf8"), "first\n");
	assert.equal(readTextCachedSync(file), "first\n");

	// Rewrite through the same helper: the cache must not keep serving the old text.
	await writeAtomic(file, "second\n");
	// Pin a whole-second mtime so the external write below can restore it exactly.
	const stamp = new Date(1_700_000_000_000);
	await utimes(file, stamp, stamp);
	assert.equal(readTextCachedSync(file), "second\n");

	// An external write of the same size with its mtime restored is exactly what the
	// invalidator is for: the cache cannot notice it on its own.
	await writeFile(file, "third!\n"); // same byte count as "second\n"
	await utimes(file, stamp, stamp);
	assert.equal(readTextCachedSync(file), "second\n", "the cache keeps serving the primed text until it is invalidated");
	invalidateTextCache(file);
	assert.equal(readTextCachedSync(file), "third!\n");
	assert.equal(existsSync(file), true);

	// No temp file may survive a successful write.
	assert.deepEqual((await readdir(path.dirname(file))).sort(), ["MEMORY.md"]);
});

test("resolvePluginConfig, settingPatch and the pending-question check behave", () => {
	assert.deepEqual(settingPatch("on"), { patch: { handoffEnabled: true } });
	// The `/handoff thinking` verb was retired with the summary call it steered; no alias, no patch.
	assert.equal(settingPatch("thinking session"), undefined);
	assert.equal(settingPatch("thinking off"), undefined);
	assert.deepEqual(settingPatch("pending wait"), { patch: { handoffPendingQuestion: "wait" } });
	assert.equal(settingPatch("pending sometimes"), undefined);
	assert.deepEqual(settingPatch("threshold auto"), { patch: { handoffThresholdAuto: true } });
	assert.deepEqual(settingPatch("threshold 0.5"), { patch: { handoffThresholdAuto: false, handoffThresholdRatio: 0.5 } });
	assert.deepEqual(settingPatch("threshold 50%"), { patch: { handoffThresholdAuto: false, handoffThresholdRatio: 0.5 } });
	assert.match(settingPatch("threshold 0.96").error, /threshold needs auto or a ratio/);
	assert.deepEqual(settingPatch("budget summary 64k"), { patch: { handoffBudgetSummaryTokens: 64_000 } });
	assert.match(settingPatch("budget summary 1k").error, /8000–200000/);
	assert.deepEqual(settingPatch("budget recent 0"), { patch: { handoffBudgetRecentTokens: 0 } });
	assert.match(settingPatch("budget recent 300k").error, /0–200000/);
	assert.match(settingPatch("budget").error, /budget needs summary or recent/);
	// One fact, one spelling: the retired spellings must not act, and the usage line names the new one.
	assert.equal(settingPatch("auto"), undefined);
	assert.equal(settingPatch("0.5"), undefined);
	assert.equal(settingPatch("target 64k"), undefined);
	assert.equal(settingPatch("keep 0"), undefined);
	assert.match(USAGE, /threshold auto\|<ratio>/);
	assert.match(USAGE, /budget summary <tokens>\|budget recent <tokens>/);
	assert.doesNotMatch(USAGE, /\|auto\||target <tokens>|keep <tokens>/);
	// One fact, one spelling: the retired `thinking` verb must not survive in the usage line either.
	assert.doesNotMatch(USAGE, /thinking/);
	assert.equal(settingPatch("status"), undefined);

	assert.equal(textAsksQuestion("Done. What next?"), true);
	assert.equal(textAsksQuestion("Done. What next？"), true);
	assert.equal(textAsksQuestion("All set.\n\n```\nconst q = '?';\n```\nDone."), false);
	assert.equal(textAsksQuestion("Everything is committed."), false);

	const asking = {
		id: "s1",
		header: {},
		snapshotEvents: () => [],
		// `MessageBase.source` is required on every derived message; a fixture without it would not
		// be a Session shape at all.
		deriveMessages: () => [
			{ role: "user", source: { kind: "user" }, content: [{ type: "text", text: "go on" }] },
			{ role: "assistant", source: { kind: "model" }, content: [{ type: "text", text: "Which branch should I use?" }] },
		],
	};
	assert.match(pendingQuestion(asking), /Which branch/);
	const answered = {
		...asking,
		deriveMessages: () => [
			...asking.deriveMessages(),
			{ role: "user", source: { kind: "user" }, content: [{ type: "text", text: "main" }] },
		],
	};
	assert.equal(pendingQuestion(answered), undefined);
});

test("the /handoff command routes the new verbs and rejects the retired spellings", async () => {
	// The surface is the contract: `threshold` owns how the threshold is decided and `budget` owns the
	// two token amounts, so each fact has one name. A retired spelling must not act — it comes back as
	// the usage line that names the verb which does.
	const commands = new Map();
	const writes = [];
	const ctx = {
		on: () => () => undefined,
		commands: { register: (command) => { commands.set(command.name, command); return () => undefined; } },
		logger: { info: () => undefined, warn: () => undefined },
		get: (service) => (service === "settings" ? { update: async (namespace, patch) => { writes.push({ namespace, patch }); } } : undefined),
	};
	apply(ctx, { provider: "test-provider", model: "test-model" });
	const command = commands.get("handoff");
	assert.match(command.input.hint, /threshold auto\|0\.4/, "the hint names the threshold verb");
	assert.match(command.input.hint, /budget summary 64k/, "the hint names the budget verbs");
	assert.doesNotMatch(command.input.hint, /target 64k|keep 20k|\| auto \|/, "the hint teaches no retired spelling");
	const session = { id: "session-handoff-cmd", header: { cwd: process.cwd(), createdAt: Date.now() }, deriveMessages: () => [], requestHeader: () => undefined, snapshotEvents: () => [] };
	const call = (rawInput) => command.handler({ agent: { session }, rawInput, signal: new AbortController().signal });

	for (const retired of ["auto", "0.5", "target 64k", "keep 20k"]) {
		const reply = await call(retired);
		assert.equal(reply.kind, "error", `"${retired}" must not act`);
		assert.match(reply.text, /Usage: \/handoff/);
		assert.match(reply.text, /threshold auto/, `"${retired}" is told which verb owns the fact`);
		assert.match(reply.text, /budget summary/, `"${retired}" is told which verb owns the fact`);
	}
	assert.deepEqual(writes, [], "no retired spelling reached the settings service");

	// `force` is the one retirement that names a replacement instead of the usage line: it was a
	// synonym of `now`, so it is told the surviving spelling rather than having to infer it from usage.
	const forced = await call("force");
	assert.equal(forced.kind, "error", "`force` must not act");
	assert.equal(forced.text, "`/handoff force` was retired; use `/handoff now`.");
	assert.deepEqual(writes, [], "`force` did not reach the settings service");

	assert.equal((await call("threshold auto")).kind, "success");
	assert.deepEqual(writes.at(-1).patch, { handoffThresholdAuto: true });
	assert.equal((await call("threshold 0.6")).kind, "success");
	assert.deepEqual(writes.at(-1).patch, { handoffThresholdAuto: false, handoffThresholdRatio: 0.6 });
	assert.equal((await call("budget summary 64k")).kind, "success");
	assert.deepEqual(writes.at(-1).patch, { handoffBudgetSummaryTokens: 64_000 });
	assert.equal((await call("budget recent 20k")).kind, "success");
	assert.deepEqual(writes.at(-1).patch, { handoffBudgetRecentTokens: 20_000 });
});

test("the session log appends incrementally and rebuilds after an external rewrite", async () => {
	const project = await mkdtemp(path.join(tmpdir(), "dsh-session-log-"));
	const session = fakeEventSession([{ type: "user/message", seq: 0, data: { source: { kind: "user" }, content: [{ type: "text", text: "one" }] } }], "session-log-1", project);
	const raw = path.join(project, ".agents", "memory", "session-logs", "session-log-1", "session.jsonl");

	await writeSessionArtifacts(session, { markdown: false });
	assert.equal((await readFile(raw, "utf8")).trimEnd().split("\n").length, 2, "header plus one event");

	// A second flush appends only the new entry.
	const grown = [session.snapshotEvents()[0], { type: "user/message", seq: 1, data: { source: { kind: "user" }, content: [{ type: "text", text: "two" }] } }];
	session.snapshotEvents = () => grown;
	await writeSessionArtifacts(session, { markdown: false });
	assert.equal((await readFile(raw, "utf8")).trimEnd().split("\n").length, 3);

	// `scripts/import-archives.mjs --replace` (or any external tool) rewrites the
	// file behind the process: the next flush must rebuild, not concatenate.
	await writeFile(raw, '{"type":"session","id":"replaced"}\n');
	await writeSessionArtifacts(session, { markdown: false });
	const rebuilt = (await readFile(raw, "utf8")).trimEnd().split("\n");
	assert.equal(rebuilt.length, 3, "the external rewrite is repaired from the full snapshot");
	assert.match(rebuilt[0], /"session-log-1"/);
	assert.match(rebuilt[2], /"two"/);

	// The subtle case: an external rewrite of exactly the same length, which a
	// size-only comparison would accept and then append onto foreign bytes.
	const current = await readFile(raw, "utf8");
	await writeFile(raw, `${"f".repeat(current.length - 1)}\n`);
	await writeSessionArtifacts(session, { markdown: false });
	const again = (await readFile(raw, "utf8")).trimEnd().split("\n");
	assert.equal(again.length, 3, "a same-length external rewrite is rebuilt too");
	assert.match(again[0], /"session-log-1"/);

	// A *longer* foreign file is a different case: those extra records belong to somebody else (a
	// backfill with `--replace`, another host, a hand edit) and the rebuild would drop them with no
	// trace. They are preserved as a `.broken-*` sibling and named in the project log before the
	// rebuild overwrites the file.
	const foreign = [JSON.stringify({ type: "session", id: "foreign" }), ...Array.from({ length: 5 }, (_, index) => JSON.stringify({ type: "user/message", seq: index, data: { text: `foreign ${index}` } }))].join("\n");
	await writeFile(raw, `${foreign}\n`);
	await writeSessionArtifacts(session, { markdown: false });
	const kept = (await readdir(path.dirname(raw))).filter((name) => name.startsWith("session.jsonl.broken-"));
	assert.equal(kept.length, 1, "one recovery copy of the foreign bytes is kept");
	const preserved = await readFile(path.join(path.dirname(raw), kept[0]), "utf8");
	assert.ok(preserved.includes("foreign 4"), `the foreign records survive: ${preserved.slice(0, 80)}`);
	const log = await readOptional(path.join(project, ".agents", "memory", "errors.log"));
	assert.match(log, /rebuilt .*session\.jsonl over a longer file/, "the project log names the rebuild");
	assert.equal((await readFile(raw, "utf8")).trimEnd().split("\n").length, 3, "the canonical log is still this session's");

	releaseSessionQueue(session);
});

test("a flush with no new events writes nothing at all", async () => {
	const project = await mkdtemp(path.join(tmpdir(), "dsh-session-noop-"));
	const session = fakeEventSession([{ type: "user/message", seq: 0, data: { source: { kind: "user" }, content: [{ type: "text", text: "one" }] } }], "session-noop", project);
	const dir = path.join(project, ".agents", "memory", "session-logs", "session-noop");

	await writeSessionArtifacts(session, {});
	const rawBefore = await readFile(path.join(dir, "session.jsonl"), "utf8");
	const markdownBefore = await readFile(path.join(dir, "session.md"), "utf8");

	// `/session-log` re-writes the live session on demand, so a no-growth flush is
	// routine: it must not append a bare newline on every call.
	await writeSessionArtifacts(session, {});
	await writeSessionArtifacts(session, {});
	assert.equal(await readFile(path.join(dir, "session.jsonl"), "utf8"), rawBefore);
	assert.equal(await readFile(path.join(dir, "session.md"), "utf8"), markdownBefore);
	releaseSessionQueue(session);
});

test("errors.log is truncated past its cap and single records are bounded", async () => {
	const project = await mkdtemp(path.join(tmpdir(), "dsh-errors-log-"));
	const file = path.join(project, ".agents", "memory", "errors.log");
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, "old detail\n".repeat(100_000)); // ~1.1 MB, past the rotation cap

	await logError(project, "rotation-test", new Error("x".repeat(20_000)));

	const text = await readFile(file, "utf8");
	assert.ok(text.length < 200_000, `rotated log is ${text.length} chars`);
	assert.match(text, /\[\.\.\.truncated; newest entries kept\.\.\.\]/);
	assert.match(text, /\[rotation-test\]/, "the newest entry survives the rotation");
	assert.match(text, /\[\.\.\.detail truncated\.\.\.\]/, "one huge record is capped, not kept whole");
});

test("the streaming reader matches the string reader line for line", async () => {
	const project = await mkdtemp(path.join(tmpdir(), "dsh-archive-parity-"));
	const line = (text) => JSON.stringify({ type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text }] } });
	const cases = {
		lf: `${line("one")}\n${line("two")}\n`,
		crlf: `${line("one")}\r\n${line("two")}\r\n`,
		cr: `${line("one")}\r${line("two")}\r`,
		"no-eol": line("one"),
	};
	for (const [name, content] of Object.entries(cases)) {
		const file = path.join(project, `${name}.jsonl`);
		await writeFile(file, content);
		assert.equal(
			await readArchivedConversation(file, 10_000),
			archivedConversationText(content, 10_000),
			`${name} renders differently through the two readers`,
		);
	}
});

test("migration keeps the newer of two colliding files, and reports the legacy one as discarded", async () => {
	const project = await mkdtemp(path.join(tmpdir(), "dsh-migrate-newest-"));
	const memory = path.join(project, ".agents", "memory");
	await mkdir(memory, { recursive: true });
	await writeFile(path.join(memory, "MEMORY.md"), "# new\n");

	await mkdir(path.join(project, ".pi"), { recursive: true });
	await writeFile(path.join(project, ".pi", "MEMORY.md"), "# legacy\n");
	const old = new Date(Date.now() - 60_000);
	await utimes(path.join(project, ".pi", "MEMORY.md"), old, old);

	const result = await migrateProjectState(project);
	assert.equal(await readFile(path.join(memory, "MEMORY.md"), "utf8"), "# new\n", "the newer destination wins");
	assert.equal(existsSync(path.join(project, ".pi", "MEMORY.md")), false, "the consumed legacy file is gone");
	// `merged` used to cover this case too, so the migration said the legacy file had been moved when
	// its bytes had in fact been dropped. The outcome now names what happened.
	assert.deepEqual(result.moved, [], "nothing was adopted from the legacy side");
	assert.deepEqual(result.superseded, [path.join(".agents", "memory", "MEMORY.md")], "the discarded legacy path is named");
	assert.deepEqual(result.conflicts, []);
});

test("migration keeps a divergent legacy skill directory instead of deleting it", async () => {
	// The import used to delete `<legacy>/skills/<name>/` as soon as `.agents/skills/<name>/SKILL.md`
	// existed: a newer hand-edited body and every sibling asset went with it, silently and without a
	// conflict. A legacy directory is now consumed only when it is an exact duplicate after
	// normalization; otherwise it stays and is reported.
	const project = await mkdtemp(path.join(tmpdir(), "dsh-migrate-skills-"));
	const liveDocument = "---\nname: release-checklist\ndescription: \"live\"\n---\n\nlive body\n";
	await mkdir(path.join(project, ".agents", "memory"), { recursive: true });
	await mkdir(path.join(project, ".agents", "skills", "release-checklist"), { recursive: true });
	await writeFile(path.join(project, ".agents", "skills", "release-checklist", "SKILL.md"), liveDocument);

	const legacy = path.join(project, ".pi", "skills", "release-checklist");
	const legacyDocument = "---\nname: release-checklist\ndescription: \"hand edited\"\n---\n\nhand-edited body\n";
	await mkdir(legacy, { recursive: true });
	await writeFile(path.join(legacy, "SKILL.md"), legacyDocument);
	await writeFile(path.join(legacy, "reference.md"), "# Reference\n\nonly in the legacy copy\n");

	const result = await migrateProjectState(project);
	assert.equal(await readFile(path.join(legacy, "SKILL.md"), "utf8").catch(() => ""), legacyDocument, "the divergent legacy body survives");
	assert.ok(existsSync(path.join(legacy, "reference.md")), "the legacy-only sibling asset survives");
	// Conflicts are labelled by destination, like the file/directory type conflicts above: the label
	// names the artifact in conflict, and the legacy copy is what stays on disk.
	assert.deepEqual(result.conflicts, [path.join(".agents", "skills", "release-checklist")], "the kept legacy directory is reported");
	assert.equal(await readFile(path.join(project, ".agents", "skills", "release-checklist", "SKILL.md"), "utf8").catch(() => ""), liveDocument, "the live skill is untouched");

	// An exact duplicate is still consumed: keeping it would strand a stale copy in the legacy layout.
	const clean = await mkdtemp(path.join(tmpdir(), "dsh-migrate-skills-dup-"));
	await mkdir(path.join(clean, ".agents", "memory"), { recursive: true });
	await mkdir(path.join(clean, ".agents", "skills", "release-checklist"), { recursive: true });
	await writeFile(path.join(clean, ".agents", "skills", "release-checklist", "SKILL.md"), liveDocument);
	await mkdir(path.join(clean, ".pi", "skills", "release-checklist"), { recursive: true });
	await writeFile(path.join(clean, ".pi", "skills", "release-checklist", "SKILL.md"), liveDocument);
	const duplicate = await migrateProjectState(clean);
	assert.equal(existsSync(path.join(clean, ".pi", "skills", "release-checklist")), false, "an identical legacy copy is consumed");
	assert.deepEqual(duplicate.conflicts, [], "an identical copy is not a conflict");
});

test("maxOutputTokens bounds adaptive growth without capping the starting budget", () => {
	// The ceiling only bounds how far a request may grow (pi's rule); it never forces the request
	// below the configured starting cap, so a contradictory pair is used as written instead of
	// being rejected — an existing settings file must not stop the plugin from loading.
	assert.equal(resolvePluginConfig({ maxTokens: 8192, maxOutputTokens: 256 }).maxTokens, 8192);
	assert.equal(resolvePluginConfig({ maxTokens: 4096, maxOutputTokens: 4096 }).maxOutputTokens, 4096);
	assert.equal(resolvePluginConfig({}).maxOutputTokens, 32_768);

	// The ceiling wins over the model's own (larger) limit and over a request that would need more.
	assert.equal(adaptiveOutputTokens(4096, 100_000, { maxTokens: 1_000_000 }, 4096), 4096);
	// A ceiling below the starting cap is ignored rather than lowering the request below it.
	assert.equal(adaptiveOutputTokens(8192, 100, { maxTokens: 1_000_000 }, 256), 8192);
});

test("credentials are masked before a diagnostic reaches the project log", () => {
	const text = [
		'authorization: Bearer abcdefghijklmnop',
		"apiKey = sk-abcdefghijklmnop",
		"github token ghp_abcdefghijklmnop",
		"aws AKIAIOSFODNN7EXAMPLE",
		"jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signaturepart",
	].join("\n");
	const safe = redactSecrets(text);
	for (const secret of ["abcdefghijklmnop", "sk-abcdefghijklmnop", "ghp_abcdefghijklmnop", "AKIAIOSFODNN7EXAMPLE", "eyJhbGciOiJIUzI1NiJ9"]) {
		assert.ok(!safe.includes(secret), `${secret} must be masked`);
	}
	assert.match(safe, /\[redacted/);
	// Ordinary prose is left alone.
	assert.equal(redactSecrets("the token budget is 8192 tokens"), "the token budget is 8192 tokens");
});

test("a console diagnostic is masked, flattened and bounded", () => {
	// `ctx.logger.warn` writes verbatim and one consolidation failure can carry thousands of chars of
	// raw model reply, so the console helper must do both jobs — the mask is useless if the line is
	// unbounded, and the cap is useless if the secret survives it.
	const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signaturepart";
	const long = diagnosticMessage(new Error(`line one\n  apiKey = sk-abcdefghijklmnop\nthen ${"z".repeat(2000)}\nBearer ${jwt}`));
	assert.ok(!long.includes("sk-abcdefghijklmnop"), "the key must be masked");
	assert.ok(!long.includes(jwt), "the JWT must be masked");
	assert.ok(!/\n/.test(long), "the console line must be flattened to one line");
	assert.ok(long.length <= 420, `the console line must be bounded, got ${long.length} chars`);
	assert.match(long, /\[…truncated\]$/, "the bound is visible in the line");

	// A short diagnostic is passed through unchanged (after masking), and a non-Error value works.
	assert.equal(diagnosticMessage("nothing sensitive here"), "nothing sensitive here");
	assert.equal(diagnosticMessage(new Error("token: abcdefghij")).includes("[redacted]"), true);
});

test("the automatic handoff waits for background subagents to settle", async () => {
	// A session over the threshold whose last turn ended while a subagent is still running: when
	// that subagent settles, dsh wakes this session again, so handing off now would leave parent and
	// child working the same project.
	const conversation = Array.from({ length: 40 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", "x".repeat(1500)));
	const makeSession = (events) => ({
		id: "session-parent-000000000000",
		header: { cwd: process.cwd(), createdAt: Date.now() },
		deriveMessages: () => conversation,
		requestHeader: () => undefined,
		snapshotEvents: () => events,
	});
	const spawned = { type: "subagent/catalog", time: Date.now() - 60_000, data: { childId: "child-live", mode: "continuable" } };
	const settledEvent = { type: "user/message", time: Date.now() - 30_000, data: { source: { kind: "subagent-settled", senderSessionId: "child-live" } } };

	const created = [];
	const controller = { create: async () => { created.push(1); return { sessionId: "child-1" }; }, rename: async () => undefined };
	const ctxFor = () => ({
		get: (name) => (name === "sessionController" ? controller : name === "tokenMeter" ? { measure: () => ({ totalTokens: 199_000, surfaceTokens: 199_000 }) } : undefined),
		llm: { resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }) },
		logger: { info() {}, warn() {} },
	});
	const config = resolvePluginConfig({ provider: "test-provider", model: "test-model", handoffPendingQuestion: "wait", handoffBudgetRecentTokens: 0 });

	const running = makeSession([spawned]);
	// Resolves without a model call: the guard returns before the handoff is prepared.
	await maybeAutoHandoff(ctxFor(), running, config);
	assert.equal(created.length, 0, "no child session is created while a subagent is still running");

	// The same session with the child settled proceeds past the guard and creates a child session;
	// this fixture has no live agent registry, so the seed then fails. The creation is the proof
	// that only the guard stopped it above.
	const done = makeSession([spawned, settledEvent]);
	await maybeAutoHandoff(ctxFor(), done, config).catch(() => undefined);
	assert.equal(created.length, 1, "the settled child lets the run create a child session");
});

test("subagent work is read as turn activity, not as residency", async () => {
	const conversation = Array.from({ length: 40 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", "x".repeat(1500)));
	// Each case needs its own session id: the automatic path keeps per-session state, so a second
	// call on the same id could return before reaching any guard.
	let caseId = 0;
	const session = (events) => ({
		id: `session-registry-${caseId}`,
		header: { cwd: process.cwd(), createdAt: Date.now() },
		deriveMessages: () => conversation,
		requestHeader: () => undefined,
		snapshotEvents: () => events,
	});
	const created = [];
	const controller = { create: async () => { created.push(1); return { sessionId: "child-1" }; }, rename: async () => undefined };
	// The live Agent registry. `AgentStatus` is `'idle' | 'running'` and flips at every turn
	// boundary; dsh's own `list_agents` maps `idle` to `inactive` for the model.
	const agentsWith = (status) => ({ get: () => (status === undefined ? undefined : { status }) });
	// `agents` is passed explicitly in every case: the absent-service case must not silently become
	// a service that answers "no live child".
	const ctxWith = (subagents, agents) => ({
		get: (name) => (name === "sessionController" ? controller : name === "tokenMeter" ? { measure: () => ({ totalTokens: 199_000, surfaceTokens: 199_000 }) } : name === "subagents" ? subagents : name === "agents" ? agents : undefined),
		llm: { resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }) },
		logger: { info() {}, warn() {} },
	});
	const config = resolvePluginConfig({ provider: "test-provider", model: "test-model", handoffPendingQuestion: "wait", handoffBudgetRecentTokens: 0 });
	// dsh 0.1.6's classified row, and dsh 0.1.7-alpha.1's bare catalog row. Both carry `mode`.
	const classified = (mode, activity = "running") => ({ listChildren: async () => [{ kind: "child", id: "child-live", mode, activity, hasChildren: false }] });
	const catalog = (mode) => ({ listChildren: async () => [{ id: "child-live", createdAt: Date.now(), mode, label: "child-live" }] });
	const looksContinuable = [{ type: "subagent/catalog", time: Date.now() - 1_000, data: { childId: "child-live", mode: "continuable" } }];

	// One case at a time, reporting how many child sessions it created: 0 means the guard held, 1
	// means the run got past it. The counter is a delta because a case that proceeds now *creates*
	// (there is no summary call left to fail first), so an absolute count would misread later cases.
	const createsFor = async (ctx, events) => {
		caseId += 1;
		const before = created.length;
		await maybeAutoHandoff(ctx, session(events), config).catch(() => undefined);
		return created.length - before;
	};

	// The registry sees work the log cannot show at all (here: no events).
	assert.equal(await createsFor(ctxWith(classified("continuable"), agentsWith("running")), []), 0, "a child executing a turn defers before any child session is created");

	// It also outlives the log fallback's one-hour horizon: that entry alone would have proceeded.
	const ancient = [{ type: "subagent/catalog", time: Date.now() - 3 * 60 * 60_000, data: { childId: "child-live", mode: "continuable" } }];
	assert.equal(await createsFor(ctxWith(classified("continuable"), agentsWith("running")), ancient), 0);

	// A loaded child with no turn running is NOT work in flight — which is the normal state of a
	// teammate between messages. The listing's `activity` reads `running` for it (it only means the
	// Session store still holds the child), so reading that field instead of the registry would hold
	// this handoff until the child is evicted, i.e. possibly forever.
	assert.equal(await createsFor(ctxWith(classified("continuable", "running"), agentsWith("idle")), []), 1, "a resident child with no turn running does not hold the handoff");

	// `mode` wins over a contradicting log: a one-shot child never settles, so the log fallback would
	// defer forever, while the run must reach the handoff and create the child here.
	assert.equal(await createsFor(ctxWith(classified("one-shot"), agentsWith("running")), looksContinuable), 1, "a one-shot child is not pending work");

	// The bare catalog row of dsh 0.1.7-alpha.1+ carries `mode`, so one read serves both shapes.
	assert.equal(await createsFor(ctxWith(catalog("continuable"), agentsWith("running")), []), 0, "the bare catalog row is read, not discarded");

	// A live registry with no entry for the child (never resumed, evicted) is idle, not running.
	assert.equal(await createsFor(ctxWith(catalog("continuable"), agentsWith(undefined)), []), 1, "a child the registry does not hold is idle");

	// Without the live registry nothing distinguishes a working child from a resident one, and the
	// residency proxy must not stand in for it: the log answers instead.
	assert.equal(await createsFor(ctxWith(catalog("continuable"), undefined), looksContinuable), 0, "no live registry falls back to the log");

	// A listing that throws is not an answer either.
	assert.equal(await createsFor(ctxWith({ listChildren: async () => { throw new Error("projections unavailable"); } }, agentsWith("running")), looksContinuable), 0);

	// A diagnostic row names a child the host could not classify: it could be a running continuable
	// one, so `[]` is not an answer this plugin can give.
	assert.equal(await createsFor(ctxWith({ listChildren: async () => [{ kind: "diagnostic", id: "child-live", reason: "unavailable" }] }, agentsWith("running")), looksContinuable), 0, "a diagnostic listing falls back to the log");

	// Same rule for a row shape this version does not know.
	assert.equal(await createsFor(ctxWith({ listChildren: async () => [{ id: "child-live" }] }, agentsWith("running")), looksContinuable), 0, "an unreadable row shape falls back to the log");

	// An empty listing *is* an answer: no child below this session, so nothing holds the handoff.
	assert.equal(await createsFor(ctxWith({ listChildren: async () => [] }, agentsWith("running")), []), 1, "an empty listing releases the handoff");
});

test("a skipped automatic handoff says why in the server log", async () => {
	// The conversation fits the recent window, so there is nothing to drop: dsh has no host-side
	// notification channel, so the reason is a log line (findable with `/handoff status` next to it).
	const root = await mkdtemp(path.join(tmpdir(), "dsh-handoff-skip-"));
	const logs = [];
	const controller = { create: async () => ({ sessionId: "child-1" }), rename: async () => undefined };
	const ctx = {
		get: (name) => (name === "sessionController" ? controller : name === "tokenMeter" ? { measure: () => ({ totalTokens: 199_000, surfaceTokens: 199_000 }) } : undefined),
		llm: { resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }) },
		logger: { info: (...args) => { logs.push(args.join(" ")); }, warn() {} },
	};
	const session = {
		id: "session-skip-000000000000",
		header: { cwd: root, createdAt: Date.now() },
		deriveMessages: () => [message("user", "hello"), message("assistant", "hi")],
		requestHeader: () => undefined,
		snapshotEvents: () => [],
	};
	const config = resolvePluginConfig({ provider: "test-provider", model: "test-model", handoffPendingQuestion: "wait" });

	await maybeAutoHandoff(ctx, session, config);
	assert.equal(logs.filter((line) => line.includes("automatic handoff skipped")).length, 1);
	assert.match(logs.join("\n"), /handoffBudgetRecentTokens/, "the log names the setting that decides it");
	assert.match(logs.join("\n"), /nothing older to drop/, "the log does not claim a summary is coming");

	// The log is not a surface the user can read, so the same skip is reported by `/handoff status`.
	const signal = new AbortController().signal;
	const status = await statusText(ctx, session, config, signal);
	assert.match(status, /auto skipped since \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, "status reports when the skip started");
	assert.match(status, /everything is inside "Recent tokens kept"/, "status names the reason and the setting by its card label");
	assert.doesNotMatch(status, /keep ~/, "the internal shorthand never reaches the receipt");

	// The skip repeats on every idle; the receipt must keep the first occurrence rather than
	// reporting a session that looks skipped "just now" at every read.
	await new Promise((resolve) => setTimeout(resolve, 5));
	await maybeAutoHandoff(ctx, session, config);
	assert.equal(await statusText(ctx, session, config, signal), status, "a repeated skip keeps the first timestamp");

	// Once an idle finds something to drop, the marker is cleared: the receipt describes the
	// session as it is now, not a condition it has left. Every rendered message is clipped to
	// 4000 chars, so the older span has to clear MIN_DROP_TOKENS on its own. The fixture has no
	// agent registry, so the handoff itself cannot seed a child — the skip marker is what is pinned.
	const grown = resolvePluginConfig({ provider: "test-provider", model: "test-model", handoffPendingQuestion: "wait", handoffBudgetRecentTokens: 0 });
	const many = Array.from({ length: 12 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", "x".repeat(4_000)));
	const grownSession = { ...session, deriveMessages: () => many };
	await maybeAutoHandoff(ctx, grownSession, grown).catch(() => undefined);
	assert.doesNotMatch(await statusText(ctx, grownSession, grown, signal), /auto skipped since/, "a droppable idle clears the skip report");
});

test("the status receipt names the term that refused the threshold, not always the window", async () => {
	// `resolveThreshold` returns `undefined` from three different comparisons. The receipt used to
	// render all of them as "threshold unavailable at this window", which is a *false* claim in two
	// of the three: the window can be roomy and the threshold still refuses on the drop minimum, on
	// the reported envelope + keep, or on the 4K safety margin applied a second time.
	// A user told "at this window" swaps models or raises `/handoff budget summary` and nothing changes.
	const signal = new AbortController().signal;
	const session = {
		id: "session-refusal-000000000000",
		header: { cwd: process.cwd(), createdAt: Date.now() },
		deriveMessages: () => [],
		requestHeader: () => undefined,
		snapshotEvents: () => [],
	};
	// One measurement, three windows. `handoffBudgetRecentTokens: 0` makes the floor
	// `overhead + 0 + MIN_DROP_TOKENS`, and this fixture reports no envelope, so the floor is
	// exactly MIN_DROP_TOKENS and the refusals below come from the window and the margin alone.
	const statusAt = async (contextWindow, config, measurement = { totalTokens: 11_800, surfaceTokens: 11_800 }, projections) => {
		const ctx = {
			get: (name) => (name === "tokenMeter" ? { measure: () => measurement }
				: name === "sessionProjections" ? projections
				: undefined),
			llm: { resolveModelInfo: async () => ({ context: { contextWindow } }) },
		};
		return statusText(ctx, session, config, signal);
	};
	const adaptive = resolvePluginConfig({ provider: "test-provider", model: "test-model", handoffBudgetRecentTokens: 0 });
	// W=27_000: usable = 27_000 − 16_384 = 10_616 > floor = 0 + 8_000, but the capacity cap
	// (27_000 − 16_384 − 4_000 = 6_616) sits below that floor, so the drop minimum refuses. The
	// window is roomy, so blaming the window here is the bug.
	assert.equal(resolveThreshold(adaptive, { totalTokens: 11_800, surfaceTokens: 11_800 }, 27_000), undefined, "the fixture really is a refusal");
	const marginSqueezed = await statusAt(27_000, adaptive);
	assert.equal(thresholdRefusal(adaptive, { totalTokens: 11_800, surfaceTokens: 11_800 }, 27_000), "drop-floor");
	assert.match(marginSqueezed, /threshold unavailable: the window is not the limit/);
	assert.match(marginSqueezed, /10616 usable tokens clear the 8000-token floor/, "the receipt quotes the comparison that failed");
	assert.match(marginSqueezed, /4000-token safety margin/);
	assert.doesNotMatch(marginSqueezed, /window too small/, "a roomy window must not be blamed");

	// usable = 20_000 − 16_384 = 3_616 <= floor = 8_000: the window really is the binding term.
	assert.equal(thresholdRefusal(adaptive, { totalTokens: 11_800, surfaceTokens: 11_800 }, 20_000), "window-headroom");
	const tooSmall = await statusAt(20_000, adaptive);
	assert.match(tooSmall, /threshold unavailable: window too small/);
	assert.match(tooSmall, /leaves 3616 usable tokens/);
	assert.doesNotMatch(tooSmall, /the window is not the limit/);

	// A window wide enough to resolve must still print the resolved label, not a refusal.
	const resolved = await statusAt(200_000, adaptive);
	assert.match(resolved, /threshold auto \d+ \(\d+%\)/);
	assert.doesNotMatch(resolved, /threshold unavailable/);

	// The *other* term of the two-term rule can sit below the floor, and it wants the opposite lever: a
	// large **reported** envelope pushes the floor past the quality knee, so "a larger context window" is
	// backwards here (the curve approaches 157K from above — a wider window lowers the knee). The envelope
	// must come from the harness: with none reported the floor is `keep + 8_000` and the knee cannot
	// refuse at all, which is exactly why it may not be derived by subtraction.
	const heavyConfig = resolvePluginConfig({ provider: "test-provider", model: "test-model" });
	const heavy = { totalTokens: 512_000, surfaceTokens: 300_000, overheadTokens: 200_000 };
	assert.equal(resolveThreshold(heavyConfig, heavy, 1_000_000), undefined, "the heavy fixture really is a refusal");
	assert.equal(thresholdRefusal(heavyConfig, heavy, 1_000_000), "quality-knee");
	const kneeSqueezed = await statusAt(1_000_000, heavyConfig, heavy);
	assert.match(kneeSqueezed, /the model's quality knee allows only 157000 at this window/);
	// A 200K envelope leaves no value of that setting that clears a 157K knee, so the receipt must not
	// name it as the lever here — that is the same dead-lever defect the old "a smaller baseline" wording
	// had. The name it must use is the settings card's own label, not the internal `keep` shorthand.
	assert.match(kneeSqueezed, /no "Recent tokens kept" value clears this/);
	assert.doesNotMatch(kneeSqueezed, /lower "Recent tokens kept"/, "an inert lever must not be named");
	assert.match(kneeSqueezed, /raising it lowers the knee/, "the receipt corrects the backwards advice");

	// The reachable-today path is `keep` itself: it is bounded at 200_000, so at a 1M window 149_000
	// resolves and 149_001 refuses. Here `keep` *is* the lever, and the receipt must say so.
	const kneeByKeep = resolvePluginConfig({ provider: "test-provider", model: "test-model", handoffBudgetRecentTokens: 149_001 });
	assert.equal(thresholdRefusal(kneeByKeep, { totalTokens: 11_800, surfaceTokens: 0 }, 1_000_000), "quality-knee");
	const keepSqueezed = await statusAt(1_000_000, kneeByKeep, { totalTokens: 11_800, surfaceTokens: 0 });
	assert.match(keepSqueezed, /lower "Recent tokens kept"/, "the lever that really binds is named");
	// One token less of carried tail clears it, which is what makes `keep` the lever rather than a slogan.
	const oneLess = resolvePluginConfig({ provider: "test-provider", model: "test-model", handoffBudgetRecentTokens: 149_000 });
	assert.notEqual(resolveThreshold(oneLess, { totalTokens: 11_800, surfaceTokens: 0 }, 1_000_000), undefined);
	assert.doesNotMatch(kneeSqueezed, /is the lever, not this window alone/, "the margin sentence must not be reused");
	assert.doesNotMatch(kneeSqueezed, /safety margin/, "the margin is not what bound here");
	// The knee cannot be lifted by `/handoff budget summary` (the orchestrator deliberately keeps the
	// configured target off the trigger line), and the floor's envelope term is not a setting either —
	// only `keep` is. The setting that clears this refusal today is an explicit ratio, since the agreed
	// fence lets an explicit setting override the quality ceiling that governs the auto composition. The
	// override receipt already names it; this refusal must not leave the user at a dead lever.
	assert.match(kneeSqueezed, /\/handoff threshold 0\.4 is not checked against the knee/, "the refusal names the control that clears it");
	// …but it must not say where that trigger *lands*. Below the `knee(W)` / `0.4W` crossing (≈488K at the
	// current constants) a 0.4 trigger sits **under** the knee, so an earlier wording ("so auto can start
	// past it") was a false placement claim in a reachable band. Pin one point in that band, so the ban is
	// evidence-backed rather than a matter of taste.
	const bandW = 450_000;
	const bandMeasurement = { totalTokens: 600_000, surfaceTokens: 300_000, overheadTokens: 300_000 };
	const bandAuto = resolvePluginConfig({ provider: "test-provider", model: "test-model", handoffBudgetRecentTokens: 0 });
	assert.equal(thresholdRefusal(bandAuto, bandMeasurement, bandW), "quality-knee", "W=450K with a 300K reported envelope is a knee refusal");
	const bandFixed = resolvePluginConfig({ provider: "test-provider", model: "test-model", handoffThresholdAuto: false, handoffThresholdRatio: 0.4, handoffBudgetRecentTokens: 0 });
	// Probe the placement without the envelope: with the 300K envelope the same 0.4 trigger is refused by
	// fixed mode's physical floor instead (asserted next), which is precisely why the knee sentence must
	// not promise where a fixed trigger lands.
	const bandTrigger = resolveThreshold(bandFixed, { totalTokens: 600_000, surfaceTokens: 300_000 }, bandW);
	assert.ok(bandTrigger !== undefined && bandTrigger.tokens < qualityLimit(bandW),
		`a 0.4 trigger sits below the knee here: ${bandTrigger?.tokens} vs ${qualityLimit(bandW)}`);
	assert.equal(resolveThreshold(bandFixed, bandMeasurement, bandW), undefined, "the 300K envelope puts the same trigger under the floor");
	assert.equal(thresholdRefusal(bandFixed, bandMeasurement, bandW), "fixed-below-floor");
	assert.doesNotMatch(kneeSqueezed, /can start past it/, "no placement claim about where a fixed trigger lands");

	// The three receipts are pairwise different: this is the property that was missing.
	assert.notEqual(marginSqueezed, tooSmall);
	assert.notEqual(kneeSqueezed, marginSqueezed);
	assert.notEqual(kneeSqueezed, tooSmall);

	// Fixed mode has two refusals now, and naming the ratio as a lever is right for exactly one of them.
	// This is the `tokens <= 0` one, where no legal ratio can help; the floor case is separate and is
	// pinned in `threshold-floor.test.mjs`, where the ratio *is* the first lever.
	const fixed = resolvePluginConfig({ provider: "test-provider", model: "test-model", handoffThresholdAuto: false });
	assert.equal(resolveThreshold(fixed, { totalTokens: 0, surfaceTokens: 0 }, 4_000), undefined, "W = SAFETY_MARGIN is the boundary");
	assert.equal(thresholdRefusal(fixed, { totalTokens: 0, surfaceTokens: 0 }, 4_000), "no-positive-threshold", "at the boundary the trigger is not positive at all");
	assert.equal(thresholdRefusal(fixed, { totalTokens: 0, surfaceTokens: 0 }, 3_000), "no-positive-threshold");
	const fixedText = thresholdRefusalText("no-positive-threshold", fixed, { totalTokens: 0, surfaceTokens: 0 }, 3_000, "en");
	assert.match(fixedText, /a larger window is the only lever/, "the receipt names the lever that works");
	assert.match(fixedText, /the ratio cannot help/, "and says outright that the ratio does not");
	assert.doesNotMatch(fixedText, /raise the ratio or the window/, "the dead lever is gone");

	// A window below the request reserve makes `usable` negative; printing "-8192 usable tokens"
	// reads as nonsense, so the text must describe that case instead of quoting the negative number.
	const tiny = thresholdRefusalText("window-headroom", adaptive, { totalTokens: 0, surfaceTokens: 0 }, 8_192, "en");
	assert.doesNotMatch(tiny, /-\d+ usable tokens/, `a negative token count was printed: ${tiny}`);
	assert.match(tiny, /no usable tokens at all/);
	assert.match(tiny, /exceeds the 8192-token window by 8192/);

	// `usable === 0` is the boundary between the two phrasings: "exceeds … by 0" would contradict
	// itself, so it needs its own wording.
	const exact = thresholdRefusalText("window-headroom", adaptive, { totalTokens: 0, surfaceTokens: 0 }, 16_384, "en");
	assert.doesNotMatch(exact, /exceeds .* by 0\b/, `self-contradictory wording: ${exact}`);
	assert.match(exact, /consumes the entire 16384-token window/);

	// One token past the boundary is the singular case, and "1 usable tokens" is not English.
	const one = thresholdRefusalText("window-headroom", adaptive, { totalTokens: 0, surfaceTokens: 0 }, 16_385, "en");
	assert.match(one, /\b1 usable token after\b/, `plural used for one: ${one}`);
	assert.doesNotMatch(one, /1 usable tokens/);

	// The envelope is the harness's own `contextBreakdown` composition (`systemTokens + toolsTokens`),
	// read through `ctx.sessionProjections.snapshot`. Anything absent or malformed yields no envelope
	// rather than a guessed one, and the receipt reads the same envelope the automatic path does.
	const oneProjection = (breakdown) => ({
		snapshot: (_session, keys) => ({
			asOfSeq: 0,
			values: keys?.includes("contextBreakdown") ? { contextBreakdown: breakdown } : {},
		}),
	});
	assert.equal(projectionEnvelope(oneProjection({ systemTokens: 20_000, toolsTokens: 3_000 }), session), 23_000);
	assert.equal(projectionEnvelope(undefined, session), undefined, "no registry means no envelope, not a guess");
	assert.equal(projectionEnvelope(oneProjection(undefined), session), undefined, "no projection means no envelope");
	assert.equal(projectionEnvelope(oneProjection({ systemTokens: "x" }), session), undefined, "a malformed value is not a number");
	assert.equal(
		measuredContext({ measure: () => ({ totalTokens: 5, surfaceTokens: 5 }) }, oneProjection({ systemTokens: 1_000, toolsTokens: 500 }), session).overheadTokens,
		1_500,
		"one entry point folds the envelope into the measurement",
	);
	// A 200K envelope puts the floor past the knee at keep 0 (`157_000 < 208_000`); the identical
	// measurement without the projection resolves, which is what makes this a pin on the wiring.
	const squeezed = await statusAt(1_000_000, adaptive, { totalTokens: 11_800, surfaceTokens: 11_800 }, oneProjection({ systemTokens: 200_000, toolsTokens: 0 }));
	assert.match(squeezed, /threshold unavailable: not the window/);
	assert.doesNotMatch(squeezed, /threshold auto/, "the receipt must not claim a resolved trigger");
	const unsqueezed = await statusAt(1_000_000, adaptive, { totalTokens: 11_800, surfaceTokens: 11_800 });
	assert.match(unsqueezed, /threshold auto \d+ \(\d+%\)/, "without the projection the same numbers resolve");
});

test("the status receipt follows the handoff language and names the setting by its card label", async () => {
	// The receipt explains the decision `HANDOFF.md` documents, so it is written in the language
	// `resolveHandoffLanguage` picked for that handoff (an English-only explanation is a false boundary
	// for a Chinese session), and it names the knob the way the settings card does — in that language,
	// never by the internal `keep` shorthand.
	const signal = new AbortController().signal;
	const session = {
		id: "session-receipt-zh-00000000",
		header: { cwd: process.cwd(), createdAt: Date.now() },
		deriveMessages: () => [message("user", "这个记忆整理流程要怎么改？先把交接这块看一遍。")],
		requestHeader: () => undefined,
		snapshotEvents: () => [],
	};
	const ctx = {
		get: (name) => (name === "tokenMeter" ? { measure: () => ({ totalTokens: 11_800, surfaceTokens: 0 }) } : undefined),
		llm: { resolveModelInfo: async () => ({ context: { contextWindow: 1_000_000 } }) },
	};
	// `handoffBudgetRecentTokens: 149_001` at a 1M window is the reachable knee refusal whose lever *is* the
	// setting, so this fixture exercises the `lower …` sentence rather than the inert-lever branch.
	const config = resolvePluginConfig({ provider: "test-provider", model: "test-model", handoffBudgetRecentTokens: 149_001 });
	const status = await statusText(ctx, session, config, signal);
	assert.match(status, /lang auto \(zh\)/, "the receipt reports the language it resolved");
	assert.match(status, /阈值不可用：不是窗口的问题/);
	assert.match(status, /调小「保留最近对话（token）」/, "the lever is named by the card's own zh label");
	assert.doesNotMatch(status, /threshold unavailable/, "a Chinese session is not given the English account");
	assert.doesNotMatch(status, /keep\b/, "the internal shorthand never reaches the receipt");
});

test("the receipt names whether the harness envelope was read, because the threshold cannot", async () => {
	// `threshold auto <n>` is the *same string* whether the envelope arrived or not: at a 1M window with
	// the default 20_000 `keep`, the quality knee (157_000) sits above the floor both with a 45_000
	// envelope (73_000) and without one (28_000). So the only way to answer "did the harness's
	// `contextBreakdown` parse?" from `/handoff status` is for the receipt to name the read — the trigger
	// sentence it already printed cannot distinguish the two states.
	const signal = new AbortController().signal;
	const session = {
		id: `session-envelope-${Math.random().toString(16).slice(2, 10)}`,
		header: { cwd: process.cwd(), createdAt: Date.now() },
		deriveMessages: () => [],
		requestHeader: () => undefined,
		snapshotEvents: () => [],
	};
	const oneProjection = (breakdown) => ({
		snapshot: (_session, keys) => ({
			asOfSeq: 0,
			values: keys?.includes("contextBreakdown") ? { contextBreakdown: breakdown } : {},
		}),
	});
	const statusWith = async (measurement, projections) => {
		const ctx = {
			get: (name) => (name === "tokenMeter" ? { measure: () => measurement }
				: name === "sessionProjections" ? projections
				: undefined),
			llm: { resolveModelInfo: async () => ({ context: { contextWindow: 1_000_000 } }) },
		};
		return statusText(ctx, session, resolvePluginConfig({ provider: "test-provider", model: "test-model" }), signal);
	};
	const plain = { totalTokens: 120_000, surfaceTokens: 60_000 };
	const withEnvelope = await statusWith(plain, oneProjection({ systemTokens: 40_000, toolsTokens: 5_000 }));
	const without = await statusWith(plain);
	assert.match(withEnvelope, /harness envelope 45000/);
	assert.match(without, /harness envelope unavailable/);
	// The discriminator: the sentence the user reads is identical in both states, which is exactly why a
	// receipt carrying only that sentence reported two different situations identically. Deleting the new
	// line keeps every other assertion here green — this pair is what makes it load-bearing.
	for (const text of [withEnvelope, without]) assert.match(text, /threshold auto 157000 \(16%\)/);
	assert.notEqual(withEnvelope, without);

	// An envelope the *meter* volunteered is the same quantity from a different read. It must not be
	// presented as the harness's composition — a right number under a wrong attribution is this repo's
	// recurring defect class.
	const meterEnvelope = await statusWith({ ...plain, overheadTokens: 1_234 });
	assert.match(meterEnvelope, /meter envelope 1234 — not the harness composition/);
	assert.doesNotMatch(meterEnvelope, /harness envelope 1234/);
	// …and the projection wins when both are present, because that is the harness's own answer.
	const both = await statusWith({ ...plain, overheadTokens: 1_234 }, oneProjection({ systemTokens: 40_000, toolsTokens: 5_000 }));
	assert.match(both, /harness envelope 45000/);
	assert.doesNotMatch(both, /meter envelope/);

	// The attribution is decided in `measuredContext`, so pin it at the source as well.
	assert.equal(
		measuredContext({ measure: () => plain }, oneProjection({ systemTokens: 7, toolsTokens: 3 }), session).envelopeSource,
		"projection",
	);
	assert.equal(measuredContext({ measure: () => plain }, undefined, session).envelopeSource, undefined, "no registry, no claim");
	assert.equal(measuredContext({ measure: () => ({ ...plain, overheadTokens: 5 }) }, undefined, session).envelopeSource, "meter");
});

test("a guardrail override of the manual threshold is warned about, not silent", async () => {
	// The threshold has two sources: the guardrail (the quality layer, then the usable window) and the
	// manual setting (`/handoff budget summary`, or a fixed `/handoff threshold 0.95` ratio). The guardrail
	// owns the trigger, so a manual setting it cannot honour must be **named**: otherwise
	// `/handoff budget summary 200k`
	// on a 1M window renders "adaptive target 200000" beside a threshold of 157000 with no explanation,
	// and the user keeps turning a control that cannot move the number.
	const signal = new AbortController().signal;
	const session = {
		id: `session-override-${Math.random().toString(16).slice(2, 10)}`,
		header: { cwd: process.cwd(), createdAt: Date.now() },
		deriveMessages: () => [],
		requestHeader: () => undefined,
		snapshotEvents: () => [],
	};
	// No envelope is reported, so the floor and `asked` carry only `keep` (20_000 by default) and the target.
	const statusAt = async (contextWindow, over) => {
		const ctx = {
			get: (name) => (name === "tokenMeter" ? { measure: () => ({ totalTokens: 26_000, surfaceTokens: 20_000 }) } : undefined),
			llm: { resolveModelInfo: async () => ({ context: { contextWindow } }) },
		};
		return statusText(ctx, session, resolvePluginConfig({ provider: "test-provider", model: "test-model", ...over }), signal);
	};

	// Quality guardrail wins: at 1M the knee allows 157_000 while a 200_000 target needs 220_000.
	const quality = await statusAt(1_000_000, { handoffBudgetSummaryTokens: 200_000 });
	assert.match(quality, /not applied in full/, `expected a warning, got ${quality}`);
	assert.match(quality, /needs a 220000-token threshold/);
	assert.match(quality, /quality knee allows 157000/);
	// The default target fits under the guardrail, so there is nothing to warn about.
	const honoured = await statusAt(1_000_000, {});
	assert.doesNotMatch(honoured, /not applied in full/, `unexpected warning: ${honoured}`);
	// Capacity guardrail wins: at 65_536 the default target needs 84_000 and only 45_152 fit.
	const capacity = await statusAt(65_536, {});
	assert.match(capacity, /not applied in full/);
	assert.match(capacity, /only 45152 tokens fit this 65536-token window/);
	// Fixed mode: the ratio *is* the trigger, so a 95% ratio clamped by the safety margin on a small
	// window is the same silent-override class (62_259 asked → 61_536 resolved).
	const fixed = await statusAt(65_536, { handoffThresholdAuto: false, handoffThresholdRatio: 0.95 });
	assert.match(fixed, /fixed ratio 95% is not applied in full/);
	assert.match(fixed, /asks for 62259 of this 65536-token window and the 4000-token safety margin leaves 61536/);
	assert.match(fixed, /threshold 95% of window \(capped to 61536\)/, "the label stops claiming the full ratio");
	const fixedFits = await statusAt(131_072, { handoffThresholdAuto: false, handoffThresholdRatio: 0.95 });
	assert.doesNotMatch(fixedFits, /not applied in full/, `unexpected warning: ${fixedFits}`);
});

test("the quality layer is a fallback chain, and capacity has the last word", () => {
	// The quality layer is `autoCompactTokenLimit ?? knee(window)` — a **fallback**, not a sum and not a
	// cap. dsh's harness exposes only a combined `contextWindow` (`LlmModelContext`), so the chain
	// always takes its knee branch today; the upstream argument (Codex's `auto_compact_token_limit`)
	// is the seam for a harness that separates declared capacity from usable input.
	assert.equal(qualityLimit(1_000_000, 250_000), 250_000, "an upstream autoCompactTokenLimit wins outright");
	assert.equal(qualityLimit(1_000_000, undefined), 157_000, "with no upstream field the knee decides");
	assert.equal(qualityLimit(1_000_000, 0), 0, "`??` keeps a declared zero rather than falling through");
	// pi's fitted curve, at the points its own docs use. ≈`window` below ~250K (so capacity, not the
	// curve, binds there), then the transition, then the 157K asymptote.
	assert.equal(qualityLimit(128_000), 128_000);
	assert.equal(qualityLimit(1_000_000), 157_000);
	assert.equal(qualityLimit(2_000_000), 157_000);

	// Composition: `min(quality(window), capacity(room))`, exactly two terms, with keep 20000 and no
	// reported envelope (measurement below). No configured key appears on that line.
	const measurement = { totalTokens: 26_000, surfaceTokens: 20_000 };
	const config = (over) => resolvePluginConfig({ provider: "test-provider", model: "test-model", ...over });
	const at = (window, over) => resolveThreshold(config(over), measurement, window).tokens;
	// Honest windows below the transition: the curve says the model handles the whole window, so
	// capacity is what decides — `window − 16_384 − 4_000`, i.e. pi's boundary numbers.
	assert.equal(at(128_000), 107_616);
	assert.equal(at(200_000), 179_616);
	assert.equal(at(400_000), 379_616);
	// Large windows: the curve saturates at 157K and becomes the binding term (983_616 of capacity).
	assert.equal(at(1_000_000), 157_000);
	assert.equal(at(2_000_000), 157_000);
	// `handoffBudgetSummaryTokens` must **not** lift the trigger above the curve: a local preference cannot
	// reopen the hole the knee exists to close. pi's `max(boundary, targetValue)` lifts it (226_000
	// here), which is the same defect as the earlier `min(configured, knee)` cap wearing the opposite
	// sign; this port takes neither. Raising the key leaves the trigger identical.
	assert.equal(at(1_000_000, { handoffBudgetSummaryTokens: 200_000 }), 157_000, "the target cannot lift the trigger above the curve");
	assert.equal(at(1_000_000, { handoffBudgetSummaryTokens: 8_000 }), 157_000, "nor can lowering it move the trigger");
	// Capacity still has the last word over the curve: at 400K the curve allows 387_852 and the window
	// caps it at 379_616, whatever the target says.
	assert.equal(at(400_000, { handoffBudgetSummaryTokens: 200_000 }), 379_616);
	// Fixed ratio mode returns before the curve entirely, so an explicit user ratio is never touched.
	const fixed = resolveThreshold(config({ handoffThresholdAuto: false, handoffThresholdRatio: 0.5 }), measurement, 1_000_000);
	assert.equal(fixed.tokens, 500_000);
	// Regression: the W=40000 case the misattribution fix pinned as a refusal was a measurement-basis
	// artifact, not model behaviour. The fixture keeps a non-zero `totalTokens − surfaceTokens` on purpose:
	// with the subtraction restored the floor is 11_800 + 8_000 = 19_800, above the capacity cap 19_616, so
	// this assertion is the one that fails under the bug rather than passing for the wrong reason.
	const narrow = config({ handoffBudgetRecentTokens: 0 });
	assert.equal(resolveThreshold(narrow, { totalTokens: 11_800, surfaceTokens: 0 }, 40_000)?.tokens, 19_616);
	assert.equal(thresholdRefusal(narrow, { totalTokens: 11_800, surfaceTokens: 0 }, 40_000), undefined);
	// The shape a real CJK session produces — a provider-anchored total far above the density-priced
	// surface — must resolve on a 1M window. Read as a difference it was a 263K "envelope", which put the
	// floor above the knee and made the automatic trigger structurally unreachable.
	const cjk = { totalTokens: 495_117, surfaceTokens: 231_793 };
	assert.equal(resolveThreshold(config({}), cjk, 1_000_000)?.tokens, 157_000, "the real session's shape resolves");
	assert.equal(thresholdRefusal(config({}), cjk, 1_000_000), undefined);
});

test("a manual handoff on a conversation that fits the carried window is refused, not fabricated", async () => {
	const cwd = await mkdtemp(path.join(tmpdir(), "dsh-handoff-empty-"));
	const created = [];
	const controller = { create: async () => { created.push(1); return { sessionId: "child-1" }; }, rename: async () => undefined };
	let modelCalls = 0;
	const ctx = {
		get: (name) => (name === "sessionController" ? controller : undefined),
		llm: {
			resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
			stream: () => { modelCalls += 1; throw new Error("the model must not be called"); },
		},
		logger: { info() {}, warn() {} },
	};
	// Three short messages fit entirely inside the default `handoffBudgetRecentTokens`, so `older` is empty
	// even though the conversation is not: the reply must say why instead of handing off nothing.
	const session = {
		id: "session-short-000000000000",
		header: { cwd, createdAt: Date.now() },
		deriveMessages: () => [message("user", "hello"), message("assistant", "hi"), message("user", "again")],
		snapshotEvents: () => [],
		requestHeader: () => undefined,
	};
	const entry = resolvePluginConfig({ provider: "test-provider", model: "test-model" });
	const reply = await runManual(ctx, session, entry, new AbortController().signal);
	assert.equal(reply.kind, "error");
	assert.match(reply.text, /nothing to hand off/);
	assert.match(reply.text, /budget recent 0/, "the reply names the escape hatch");
	assert.equal(created.length, 0);
	assert.equal(modelCalls, 0);
});

test("the manual path is gated by neither the auto switch nor the auto threshold", async () => {
	// 自动档 is the `turn/end` listener: gated by `handoffEnabled` and by `resolveThreshold`. 手动档 is
	// `/handoff`, which the README documents as "始终执行". A one-shot command is temporary and must
	// beat the persisted switch: a user who turned automatic handoff off, or whose model window is too
	// narrow for the auto threshold, can still hand off on demand. `runManual` must consult neither
	// gate — share the quality/capacity *formula* with auto by all means, but never its gates.
	const root = await mkdtemp(path.join(tmpdir(), "dsh-handoff-manual-"));
	const conversation = Array.from({ length: 40 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", "x".repeat(1500)));
	const calls = [];
	// The seed reaches the child through `agents.get(childId).followup`, deliberately not through
	// `sessionController.prompt`: that RPC stamps `source.kind = "user"`, which would give a
	// machine-written seed the person's authority (and count it as one of their turns).
	const agents = { get: () => ({ followup: () => { calls.push("seed"); } }) };
	const model = noModelCalls();
	const ctx = {
		get: (name) => (name === "sessionController" ? {
			create: async () => { calls.push("create"); return { sessionId: "child-1" }; },
			rename: async () => undefined,
		} : name === "agents" ? agents : name === "workspaceRegistry" ? { resolveByPath: async () => undefined, archiveSession: async () => undefined } : undefined),
		llm: {
			resolveModelInfo: async () => ({ context: { contextWindow: 40_000 } }),
			stream: model.stream,
		},
		logger: { info() {}, warn() {} },
	};
	const session = {
		id: `session-manual-${Math.random().toString(16).slice(2, 10)}`,
		header: { cwd: root, createdAt: Date.now() },
		deriveMessages: () => conversation,
		requestHeader: () => undefined,
		ownEvents: () => [],
		snapshotEvents: () => [],
	};
	const entry = resolvePluginConfig({ provider: "test-provider", model: "test-model", handoffEnabled: false, handoffBudgetRecentTokens: 0 });
	// The switch is off, and the threshold gate is closed too — but at a narrower window than before: at
	// 40K the capacity cap (19_616) now clears the floor (keep 0 + 8_000), so a refusal has to come from
	// where it really binds, the drop minimum at 27K.
	assert.notEqual(resolveThreshold(entry, { totalTokens: 11_800, surfaceTokens: 11_800 }, 40_000), undefined, "the fixture's own window resolves");
	assert.equal(resolveThreshold(entry, { totalTokens: 11_800, surfaceTokens: 11_800 }, 27_000), undefined, "the auto threshold refuses here");

	const reply = await runManual(ctx, session, entry, new AbortController().signal);
	assert.equal(reply.kind, "success", `expected the manual handoff to run, got ${JSON.stringify(reply)}`);
	assert.deepEqual(calls, ["create", "seed"], "the one-shot command creates and seeds the child");
	model.assertNone("the manual path");
});

test("a manual handoff refuses while a background subagent is still running", async () => {
	// The manual path used to skip the subagent guard entirely, and a successful handoff now retires
	// the session it replaced — which cancels every running subagent descendant of it. A teammate
	// mid-task would lose its work with nothing to show for it, so the refusal must name what is
	// running and the lever, and must not create a child first.
	const root = await mkdtemp(path.join(tmpdir(), "dsh-handoff-subagent-"));
	const conversation = Array.from({ length: 40 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", "x".repeat(1500)));
	const calls = [];
	const controller = {
		create: async () => { calls.push("create"); return { sessionId: "child-1" }; },
		rename: async () => undefined,
	};
	// One registry answers both questions this fixture asks: the activity guard reads `status`, and
	// the seed reads `followup`. A child the guard calls running never reaches the seed anyway.
	const seedTarget = { followup: () => { calls.push("seed"); } };
	const agents = { get: (id) => (id === "child-live" ? { status: "running" } : seedTarget) };
	const model = noModelCalls();
	const ctxFor = (subagents, live = agents) => ({
		get: (name) => (name === "sessionController" ? controller : name === "subagents" ? subagents : name === "agents" ? live : undefined),
		llm: {
			resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
			stream: model.stream,
		},
		logger: { info() {}, warn() {} },
	});
	const sessionFor = (events) => ({
		id: `session-subagent-${Math.random().toString(16).slice(2, 10)}`,
		header: { cwd: root, createdAt: Date.now() },
		deriveMessages: () => conversation,
		requestHeader: () => undefined,
		snapshotEvents: () => events,
	});
	const entry = resolvePluginConfig({ provider: "test-provider", model: "test-model", handoffBudgetRecentTokens: 0 });

	// A registry reporting a running continuable child refuses before any child session exists.
	const listed = await runManual(
		ctxFor({ listChildren: async () => [{ kind: "child", id: "child-live", mode: "continuable", activity: "running", hasChildren: false }] }),
		sessionFor([]),
		entry,
		new AbortController().signal,
	);
	assert.equal(listed.kind, "error");
	assert.match(listed.text, /Handoff refused/);
	assert.match(listed.text, /child-live/, "the refusal names the running child");
	assert.match(listed.text, /interrupt_agent/, "and names the lever");
	assert.deepEqual(calls, [], "a refused handoff creates no child session");

	// A resident child with no turn running is the normal state of a teammate between messages: the
	// listing's `activity` says `running` for it, but only the live registry knows that nothing is
	// executing, so the handoff proceeds.
	const resident = await runManual(
		ctxFor(
			{ listChildren: async () => [{ kind: "child", id: "child-live", mode: "continuable", activity: "running", hasChildren: false }] },
			{ get: (id) => (id === "child-live" ? { status: "idle" } : seedTarget) },
		),
		sessionFor([]),
		entry,
		new AbortController().signal,
	);
	assert.equal(resident.kind, "success", `expected a resident-only child to allow the handoff, got ${JSON.stringify(resident)}`);
	assert.deepEqual(calls, ["create", "seed"]);
	calls.length = 0;

	// A listing that cannot be read is not an answer: the log's unsettled continuable child refuses too.
	const logged = await runManual(
		ctxFor({ listChildren: async () => { throw new Error("projections unavailable"); } }),
		sessionFor([{ type: "subagent/catalog", time: Date.now() - 60_000, data: { childId: "child-logged", mode: "continuable" } }]),
		entry,
		new AbortController().signal,
	);
	assert.equal(logged.kind, "error");
	assert.match(logged.text, /child-logged/);
	assert.deepEqual(calls, []);

	// The same fixture with nothing running hands off, so the refusals above are caused by the child.
	const allowed = await runManual(ctxFor({ listChildren: async () => [] }), sessionFor([]), entry, new AbortController().signal);
	assert.equal(allowed.kind, "success", `expected the idle session to hand off, got ${JSON.stringify(allowed)}`);
	assert.deepEqual(calls, ["create", "seed"]);
	model.assertNone("the subagent-guard path");
});

test("a handoff child inherits the parent's session-local model and permission preset", async () => {
	// `sessionController.create` takes neither a model nor a permission preset, so the child would
	// start on the deployment defaults and drop whatever the user had switched to — pi's 8a2e6e4 in
	// dsh terms. Both carries must land before the seed prompt, or the child's first turn is already
	// routed to the default and asks for approval the parent no longer required.
	const root = await mkdtemp(path.join(tmpdir(), "dsh-handoff-model-"));
	const conversation = Array.from({ length: 40 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", "x".repeat(1500)));
	const model = noModelCalls();

	const run = async ({ selectModel, requestHeader, preset, resident = true, setThrows = false, presetsAbsent = false }) => {
		const calls = [];
		const childSession = { id: "child-1" };
		const controller = {
			create: async () => { calls.push(["create"]); return { sessionId: "child-1" }; },
			rename: async () => undefined,
			...(selectModel === undefined ? {} : { selectModel: async (request) => { calls.push(["selectModel", request]); if (selectModel === "throw") throw new Error("selection rejected"); } }),
		};
		const presets = {
			current: (session) => { calls.push(["current", session?.id]); return preset; },
			set: (session, name) => { calls.push(["setPreset", name, session === childSession]); if (setThrows) throw new Error("switch rejected"); },
		};
		const ctx = {
			get: (name) => (name === "sessionController" ? controller
				: name === "agents" ? { get: () => ({ followup: () => { calls.push(["seed"]); } }) }
					: name === "permissionPresets" ? (presetsAbsent ? undefined : presets)
						: name === "sessions" ? { get: (id) => (resident && id === "child-1" ? childSession : undefined) }
							: undefined),
			llm: { resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }), stream: model.stream },
			logger: { info() {}, warn() {} },
		};
		const session = {
			id: `session-model-${calls.length}${Math.random().toString(16).slice(2, 8)}`,
			header: { cwd: root, createdAt: Date.now() },
			deriveMessages: () => conversation,
			requestHeader,
			snapshotEvents: () => [],
		};
		const entry = resolvePluginConfig({ provider: "test-provider", model: "test-model", handoffPendingQuestion: "wait", handoffBudgetRecentTokens: 0 });
		const reply = await runManual(ctx, session, entry, new AbortController().signal);
		return { calls, reply, sessionId: session.id };
	};

	const routed = () => ({ config: { provider: "parent-provider", model: "parent-model", reasoningEffort: "high" } });
	const carried = await run({ selectModel: true, requestHeader: routed, preset: "danger-full-access" });
	assert.equal(carried.reply.kind, "success");
	assert.deepEqual(carried.calls.map(([kind]) => kind), ["create", "current", "setPreset", "selectModel", "seed"], "both carries land before the seed");
	assert.deepEqual(carried.calls[1], ["current", carried.sessionId], "the preset is read from the parent session");
	assert.deepEqual(carried.calls[2], ["setPreset", "danger-full-access", true], "the switch lands on the child session");
	assert.deepEqual(carried.calls[3][1], { sessionId: "child-1", provider: "parent-provider", model: "parent-model", reasoningEffort: "high" });

	// A parent that never routed a request has no selection to carry, and the handoff is unchanged.
	// These four exercise the model carry on a profile without the permission service, so the
	// permission cases below stay independent of them.
	const unrouted = await run({ selectModel: true, requestHeader: () => undefined, presetsAbsent: true });
	assert.equal(unrouted.reply.kind, "success");
	assert.deepEqual(unrouted.calls.map(([kind]) => kind), ["create", "seed"]);

	// An empty pair in the header is not a selection either: installing it would break the route.
	const blank = await run({ selectModel: true, requestHeader: () => ({ config: { provider: "", model: "" } }), presetsAbsent: true });
	assert.equal(blank.reply.kind, "success");
	assert.deepEqual(blank.calls.map(([kind]) => kind), ["create", "seed"]);

	// Fail-open: a rejected selection, or a runtime without the call, must not fail a handoff whose
	// child already exists.
	const rejected = await run({ selectModel: "throw", requestHeader: routed, presetsAbsent: true });
	assert.equal(rejected.reply.kind, "success");
	assert.deepEqual(rejected.calls.map(([kind]) => kind), ["create", "selectModel", "seed"]);
	const absent = await run({ selectModel: undefined, requestHeader: routed, presetsAbsent: true });
	assert.equal(absent.reply.kind, "success");
	assert.deepEqual(absent.calls.map(([kind]) => kind), ["create", "seed"]);

	// The permission half, which the user reported as missing: a parent switched to full access must
	// not hand off into a child that asks for approval again.
	const permissive = await run({ selectModel: undefined, requestHeader: () => undefined, preset: "danger-full-access" });
	assert.equal(permissive.reply.kind, "success");
	assert.deepEqual(permissive.calls.map(([kind]) => kind), ["create", "current", "setPreset", "seed"]);

	// `custom` means the effective knobs match no preset and is never a switch target.
	const custom = await run({ selectModel: undefined, requestHeader: () => undefined, preset: "custom" });
	assert.deepEqual(custom.calls.map(([kind]) => kind), ["create", "current", "seed"]);

	// A child that is not resident, a profile without the service, and a rejected switch are all
	// fail-open: the handoff still completes with the child that was already created.
	const gone = await run({ selectModel: undefined, requestHeader: () => undefined, preset: "danger-full-access", resident: false });
	assert.deepEqual(gone.calls.map(([kind]) => kind), ["create", "seed"], "no child session, nothing to switch");
	const noService = await run({ selectModel: undefined, requestHeader: () => undefined, preset: "danger-full-access", presetsAbsent: true });
	assert.deepEqual(noService.calls.map(([kind]) => kind), ["create", "seed"]);
	const refused = await run({ selectModel: undefined, requestHeader: () => undefined, preset: "danger-full-access", setThrows: true });
	assert.equal(refused.reply.kind, "success");
	assert.deepEqual(refused.calls.map(([kind]) => kind), ["create", "current", "setPreset", "seed"]);
	model.assertNone("the model/permission carry");
});

test("the automatic handoff yields to a session that is already on its next turn", async () => {
	// `turn/end` is the trigger, but the harness pumps a queued user message into the next turn as
	// soon as the current one closes. On 2026-09-17 that turned an auto handoff into two sessions
	// editing this repo at once: the trigger fired at `turn/end` of turn 9, the queued message opened
	// turn 10 in the same second, and the child was created 8 seconds later — while the parent went on
	// to do the same fix. Every check below must abandon the handoff before a child exists.
	const root = await mkdtemp(path.join(tmpdir(), "dsh-handoff-settle-"));
	const conversation = Array.from({ length: 40 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", "x".repeat(1500)));

	const run = async ({ events, startTurnOnRoot, startTurnOnCreate, startTurnOnSeed, seedThrows, cancelThrows, cancelAbsent }) => {
		const calls = [];
		const renames = [];
		const cancels = [];
		const archives = [];
		const retired = [];
		const logs = [];
		const own = [...events];
		const controller = {
			create: async () => {
				calls.push("create");
				if (startTurnOnCreate) own.push({ type: "turn/start", seq: 11, time: Date.now() });
				return { sessionId: "child-1" };
			},
			rename: async (request) => { renames.push(request.title); },
			...(cancelAbsent ? {} : {
				cancel: async (request) => {
					cancels.push(request.sessionId);
					if (cancelThrows) throw new Error("cancel transport down");
				},
			}),
		};
		// The seed is a synchronous inbox admission, so a case that makes it fail must throw
		// synchronously — an `async` thrower would reject the promise nobody awaits instead.
		const seedTarget = {
			followup: () => {
				calls.push("seed");
				if (startTurnOnSeed) own.push({ type: "turn/start", seq: 11, time: Date.now() });
				if (seedThrows) throw new Error("seed rejected");
			},
		};
		const model = noModelCalls();
		const ctx = {
			get: (name) => (name === "sessionController" ? controller
				: name === "agents" ? { get: () => seedTarget }
					: name === "tokenMeter" ? { measure: () => ({ totalTokens: 190_000, surfaceTokens: 100_000 }) }
					: name === "workspaceRegistry" ? { resolveByPath: async () => undefined, archiveSession: async (id, options) => { archives.push(id); if (options?.stopActivity === true) retired.push(id); } }
						: undefined),
			llm: {
				resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
				stream: model.stream,
			},
			logger: {
				info: (format, ...args) => { logs.push(`${format} ${args.join(" ")}`); },
				warn: (format, ...args) => { logs.push(`warn ${format} ${args.join(" ")}`); },
			},
		};
		// The only wide window left inside `performHandoff` is resolving the project root, which reads
		// `header.cwd`: a getter that opens the next turn on its first read reproduces the race the
		// deleted summary call used to make (and keeps the second settle check pinned).
		let rootRead = false;
		const session = {
			id: `session-settle-${Math.random().toString(16).slice(2, 10)}`,
			header: {
				createdAt: Date.now(),
				get cwd() {
					if (startTurnOnRoot && !rootRead) {
						rootRead = true;
						own.push({ type: "turn/start", seq: 11, time: Date.now() });
					}
					return root;
				},
			},
			deriveMessages: () => conversation,
			requestHeader: () => undefined,
			ownEvents: () => own,
			snapshotEvents: () => own,
		};
		let error;
		try {
			await maybeAutoHandoff(ctx, session, resolvePluginConfig({ provider: "test-provider", model: "test-model", handoffBudgetRecentTokens: 0 }), 10);
		} catch (caught) {
			error = caught;
		}
		return { calls, error, modelCalls: model.count(), renames, cancels, archives, retired, logs, sessionId: session.id };
	};

	const turnEnd = { type: "turn/end", seq: 10, time: Date.now() };

	// The session already opened the next turn before the auto path even started: defer at once,
	// without creating a child or reaching a model.
	const early = await run({ events: [turnEnd, { type: "turn/start", seq: 11, time: Date.now() }] });
	assert.ok(early.error instanceof HandoffDeferred, `expected a deferral, got ${early.error}`);
	assert.deepEqual(early.calls, []);
	assert.equal(early.modelCalls, 0, "a session that is already working reaches no model");

	// The turn opens while the handoff is being prepared — the race that actually happened. Nothing
	// is created and nothing is left behind.
	const late = await run({ events: [turnEnd], startTurnOnRoot: true });
	assert.ok(late.error instanceof HandoffDeferred, `expected a deferral, got ${late.error}`);
	assert.deepEqual(late.calls, [], "no session is created once the parent moved on");
	assert.equal(late.modelCalls, 0, "the deferred attempt reaches no model");
	assert.ok(!existsSync(path.join(root, ".agents", "memory", "HANDOFF.md")), "the check precedes the document write");

	// The turn opens after the child was created but before it was seeded (the create RPC plus the
	// two carries are a wide window): the child must not be seeded, and it must not carry the switch
	// marker, or the browser half would follow the parent into a duplicate continuation.
	const duringCreate = await run({ events: [turnEnd], startTurnOnCreate: true });
	assert.ok(duringCreate.error instanceof HandoffDeferred, `expected a deferral, got ${duringCreate.error}`);
	assert.deepEqual(duringCreate.calls, ["create"], "the child is created but never seeded");
	assert.match(duringCreate.renames[0] ?? "", /^handoff deferred · /, "the switch marker is stripped");
	assert.ok(!existsSync(path.join(root, ".agents", "memory", "HANDOFF.md")), "the pre-prompt deferral writes no document either");
	assert.deepEqual(duringCreate.archives, ["child-1"], "the empty child is hidden from the workspace list");
	assert.deepEqual(duringCreate.cancels, [], "nothing was seeded, so there is no turn to cancel");

	// The turn opens inside the *prompt* RPC — the last window. The seed is already durable, so it is
	// cancelled, retitled and archived rather than left to run the duplicate continuation.
	const duringSeed = await run({ events: [turnEnd], startTurnOnSeed: true });
	assert.ok(duringSeed.error instanceof HandoffDeferred, `expected a deferral, got ${duringSeed.error}`);
	assert.deepEqual(duringSeed.calls, ["create", "seed"]);
	assert.deepEqual(duringSeed.cancels, ["child-1"], "the admitted seed is cancelled");
	assert.match(duringSeed.renames[0] ?? "", /^handoff deferred · /);
	assert.deepEqual(duringSeed.archives, ["child-1"]);
	assert.ok(!existsSync(path.join(root, ".agents", "memory", "HANDOFF.md")), "the document is written only after the last check");

	// A child whose seed could not be cancelled may still be running the duplicate continuation, so
	// it must stay visible instead of being quietly archived.
	const cancelBroke = await run({ events: [turnEnd], startTurnOnSeed: true, cancelThrows: true });
	assert.ok(cancelBroke.error instanceof HandoffDeferred, `expected a deferral, got ${cancelBroke.error}`);
	assert.deepEqual(cancelBroke.cancels, ["child-1"]);
	assert.match(cancelBroke.renames[0] ?? "", /^handoff deferred · /);
	assert.deepEqual(cancelBroke.archives, [], "an uncancelled child stays visible");
	assert.ok(cancelBroke.logs.some((line) => line.startsWith("warn")), "the failed cancel is reported");

	// A runtime without `cancel` cannot prove the child is idle: same rule, no warning to log.
	const noCancel = await run({ events: [turnEnd], startTurnOnSeed: true, cancelAbsent: true });
	assert.ok(noCancel.error instanceof HandoffDeferred, `expected a deferral, got ${noCancel.error}`);
	assert.deepEqual(noCancel.cancels, []);
	assert.deepEqual(noCancel.archives, [], "an uncancelled child stays visible");
	// …while a child that was never sent a prompt needs no cancel to be safely hidden.
	const noCancelUnseeded = await run({ events: [turnEnd], startTurnOnCreate: true, cancelAbsent: true });
	assert.deepEqual(noCancelUnseeded.archives, ["child-1"], "an unseeded child is hidden without a cancel");

	// A genuine failure is not a deferral: the child stays visible under a failed title instead of
	// being archived, so the user can see that a handoff was attempted and broke.
	const broken = await run({ events: [turnEnd], seedThrows: true });
	assert.ok(!(broken.error instanceof HandoffDeferred) && broken.error !== undefined, `expected a failure, got ${broken.error}`);
	assert.deepEqual(broken.calls, ["create", "seed"]);
	assert.match(broken.renames[0] ?? "", /^handoff failed · /);
	assert.deepEqual(broken.archives, [], "a failure stays visible");
	assert.deepEqual(broken.cancels, ["child-1"], "a rejected prompt may still have admitted the seed");

	// Control: a settled session still hands off, so the guard cannot pass by disabling the feature.
	const settled = await run({ events: [turnEnd, { type: "turn/start", seq: 4, time: Date.now() }] });
	assert.equal(settled.error, undefined);
	assert.deepEqual(settled.calls, ["create", "seed"]);
	assert.equal(settled.renames.length, 1, "a successful handoff publishes the switch marker");
	assert.ok(settled.renames[0].startsWith("↪ handoff · "), `expected the switch marker, got ${settled.renames[0]}`);
	assert.deepEqual(settled.cancels, [], "a successful handoff cancels nothing");
	// The fork's parent is retired so the continuation is not one of two live sessions: the host
	// refuses to archive a session that still reports activity, so the stop has to be requested too.
	// The abandoned *child* is what must never be archived here.
	assert.deepEqual(settled.archives, [settled.sessionId], "a successful handoff archives the session it replaced");
	assert.deepEqual(settled.retired, [settled.sessionId], "and asks the host to stop its running work");
	// The whole fixture, every scenario: not one auxiliary model call.
	for (const [label, outcome] of Object.entries({ early, late, duringCreate, duringSeed, cancelBroke, noCancel, noCancelUnseeded, broken, settled })) {
		assert.equal(outcome.modelCalls, 0, `${label}: the handoff must not call a model`);
	}
	// The predicate itself: only a turn that started *after* the trigger defers.
	const session = { ownEvents: () => [{ type: "turn/start", seq: 4 }, { type: "turn/end", seq: 10 }], snapshotEvents: () => [] };
	assert.equal(turnStartedAfter(session, 10), false);
	assert.equal(turnStartedAfter(session, 3), true);
	assert.equal(turnStartedAfter({ ownEvents: () => [{ type: "turn/end", seq: 10 }], snapshotEvents: () => [] }, 10), false);
	// The trigger's own offset is not "after" the trigger.
	assert.equal(turnStartedAfter({ ownEvents: () => [{ type: "turn/start", seq: 10 }], snapshotEvents: () => [] }, 10), false);
	// A runtime without `ownEvents` falls back to the snapshot (the inherited prefix is older, so it
	// cannot read as this session's own later turn).
	assert.equal(turnStartedAfter({ snapshotEvents: () => [{ type: "turn/start", seq: 11 }] }, 10), true);
	assert.equal(turnStartedAfter({ snapshotEvents: () => [{ type: "turn/start", seq: 4 }] }, 10), false);
});

test("the auto-handoff listener passes the trigger offset through to the settle guard", async () => {
	// The listener is the only place that knows *which* `turn/end` fired, so an untested call site
	// could drop it and silently disable the guard (the mutated `event.seq` is invisible to the
	// direct `maybeAutoHandoff` tests above).
	const root = await mkdtemp(path.join(tmpdir(), "dsh-handoff-listener-"));
	const conversation = Array.from({ length: 40 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", "x".repeat(1500)));
	const own = [
		{ type: "turn/end", seq: 10, time: Date.now() },
		{ type: "turn/start", seq: 11, time: Date.now() },
	];
	const created = [];
	const logs = [];
	const handlers = {};
	const model = noModelCalls();
	let measures = 0;
	const session = {
		id: `session-listener-${Math.random().toString(16).slice(2, 10)}`,
		header: { cwd: root, createdAt: Date.now() },
		deriveMessages: () => conversation,
		requestHeader: () => undefined,
		ownEvents: () => own,
		snapshotEvents: () => own,
	};
	const ctx = {
		on: (name, handler) => { (handlers[name] ??= []).push(handler); return () => undefined; },
		effect: () => () => undefined,
		inject: () => () => undefined,
		commands: { register: () => () => undefined },
		logger: {
			info: (format, ...args) => { logs.push(`${format} ${args.join(" ")}`); },
			warn: (format, ...args) => { logs.push(`warn ${format} ${args.join(" ")}`); },
		},
		get: (name) => (name === "sessionController" ? {
			create: async () => { created.push(1); return { sessionId: "child-1" }; },
			rename: async () => undefined,
		} : name === "agents" ? { get: () => ({ followup: () => undefined }) } : name === "tokenMeter" ? { measure: () => { measures += 1; return { totalTokens: 190_000, surfaceTokens: 100_000 }; } } : undefined),
		llm: {
			resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
			stream: model.stream,
		},
	};
	apply(ctx, { provider: "test-provider", model: "test-model", handoffBudgetRecentTokens: 0 });
	const listener = handlers["session/event"]?.[0];
	assert.ok(listener, "apply registers a session/event listener");
	const waitFor = async (predicate) => {
		for (let i = 0; i < 400 && !predicate(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
	};
	const deferrals = () => logs.filter((line) => line.includes("automatic handoff deferred")).length;

	// Round 1: the session is already on its next turn — the guard must defer.
	listener(session, { type: "turn/end", seq: 10, time: Date.now() });
	await waitFor(() => deferrals() > 0);
	assert.equal(deferrals(), 1, `expected one deferral log, got ${JSON.stringify(logs)}`);
	assert.deepEqual(created, [], "a session that is already on its next turn gets no child");
	assert.ok(!logs.some((line) => line.startsWith("warn")), "a deferral is not a failure");

	// Round 2: still busy. The rate limit keeps this from spamming the log, and the offset must be
	// the *triggering* one — a constant would make a settled session defer too (round 3). Reaching a
	// second measurement also proves a deferral does not stop the next `turn/end` from re-measuring.
	own.push({ type: "turn/end", seq: 12, time: Date.now() }, { type: "turn/start", seq: 13, time: Date.now() });
	listener(session, { type: "turn/end", seq: 12, time: Date.now() });
	await waitFor(() => measures >= 2);
	assert.ok(measures >= 2, "the next turn/end re-measures after a deferral");
	assert.equal(deferrals(), 1, "a second deferral inside the interval is not logged again");
	assert.deepEqual(created, []);

	// Round 3: the session truly settled (no `turn/start` after the trigger). The deferral must not
	// have wedged the session — no failure backoff, no stale in-flight marker.
	own.push({ type: "turn/end", seq: 14, time: Date.now() });
	listener(session, { type: "turn/end", seq: 14, time: Date.now() });
	await waitFor(() => created.length > 0);
	assert.equal(created.length, 1, "the next settled turn/end hands off normally");
	assert.ok(!logs.some((line) => line.startsWith("warn")), "no deferral was recorded as a failure");
	assert.ok(!existsSync(path.join(root, ".agents", "memory", "errors.log")), "a deferral writes no errors.log");
	model.assertNone("the listener");
});

test("a turn/end that lands while an attempt is in flight is re-evaluated, not lost", async () => {
	// One attempt runs per session. A `turn/end` arriving mid-attempt used to be dropped outright, so
	// a *settled* turn could pass unevaluated — and if the user then stopped, the session never handed
	// off at all. The finished attempt must re-run against that trigger.
	const root = await mkdtemp(path.join(tmpdir(), "dsh-handoff-pending-"));
	const conversation = Array.from({ length: 40 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", "x".repeat(1500)));
	const own = [
		{ type: "turn/end", seq: 10, time: Date.now() },
		{ type: "turn/start", seq: 11, time: Date.now() },
		{ type: "turn/end", seq: 12, time: Date.now() },
		{ type: "turn/start", seq: 13, time: Date.now() },
		{ type: "turn/end", seq: 14, time: Date.now() },
	];
	const created = [];
	const logs = [];
	const handlers = {};
	const model = noModelCalls();
	const session = {
		id: `session-pending-${Math.random().toString(16).slice(2, 10)}`,
		header: { cwd: root, createdAt: Date.now() },
		deriveMessages: () => conversation,
		requestHeader: () => undefined,
		ownEvents: () => own,
		snapshotEvents: () => own,
	};
	const ctx = {
		on: (name, handler) => { (handlers[name] ??= []).push(handler); return () => undefined; },
		effect: () => () => undefined,
		inject: () => () => undefined,
		commands: { register: () => () => undefined },
		logger: { info: (format, ...args) => { logs.push(`${format} ${args.join(" ")}`); }, warn: (format, ...args) => { logs.push(`warn ${format} ${args.join(" ")}`); } },
		get: (name) => (name === "sessionController" ? {
			create: async () => { created.push(1); return { sessionId: "child-1" }; },
			rename: async () => undefined,
		} : name === "agents" ? { get: () => ({ followup: () => undefined }) } : name === "tokenMeter" ? { measure: () => ({ totalTokens: 190_000, surfaceTokens: 100_000 }) } : undefined),
		llm: {
			resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
			stream: model.stream,
		},
	};
	apply(ctx, { provider: "test-provider", model: "test-model", handoffBudgetRecentTokens: 0 });
	const listener = handlers["session/event"]?.[0];
	assert.ok(listener, "apply registers a session/event listener");

	// seq 10 is busy (turn/start 11 follows); seq 12 is busy too; seq 14 is the settled turn. All
	// fire before the first attempt can finish, and the *newest* trigger is the one that matters —
	// keeping the oldest would stall on a busy turn and never hand off.
	listener(session, { type: "turn/end", seq: 10, time: Date.now() });
	listener(session, { type: "turn/end", seq: 12, time: Date.now() });
	listener(session, { type: "turn/end", seq: 14, time: Date.now() });
	for (let i = 0; i < 400 && created.length === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(created.length, 1, "the settled turn/end was evaluated after the in-flight attempt");
	assert.equal(logs.filter((line) => line.includes("automatic handoff deferred")).length, 1);
	assert.ok(!logs.some((line) => line.startsWith("warn")), `unexpected failure log: ${JSON.stringify(logs)}`);

	// A session disposed while an attempt is in flight must not be resurrected by the retry: the
	// dispose handler clears the pending trigger.
	const disposedOwn = [
		{ type: "turn/end", seq: 20, time: Date.now() },
		{ type: "turn/start", seq: 21, time: Date.now() },
		{ type: "turn/end", seq: 22, time: Date.now() },
	];
	const disposedSession = { ...session, id: `session-disposed-${Math.random().toString(16).slice(2, 10)}`, ownEvents: () => disposedOwn, snapshotEvents: () => disposedOwn };
	const dispose = handlers["session/disposed"]?.[0];
	assert.ok(dispose, "apply registers a session/disposed handler");
	listener(disposedSession, { type: "turn/end", seq: 20, time: Date.now() });
	listener(disposedSession, { type: "turn/end", seq: 22, time: Date.now() });
	dispose(disposedSession);
	for (let i = 0; i < 40 && !logs.some((line) => line.includes("deferred")); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert.equal(created.length, 1, "the disposed session was not handed off after disposal");
	model.assertNone("the in-flight retry");
});

test("the in-flight retry honours the same gates as a fresh attempt", async () => {
	// The retry runs through `attempt()`, so it must re-check `handedOff`, `handoffEnabled` and the
	// failure backoff instead of blindly handing off again.
	const root = await mkdtemp(path.join(tmpdir(), "dsh-handoff-retry-"));
	const conversation = Array.from({ length: 40 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", "x".repeat(1500)));
	const make = (createThrows = false) => {
		const created = [];
		const prompts = [];
		const logs = [];
		const handlers = {};
		const model = noModelCalls();
		const session = {
			id: `session-retry-${Math.random().toString(16).slice(2, 10)}`,
			header: { cwd: root, createdAt: Date.now() },
			deriveMessages: () => conversation,
			requestHeader: () => undefined,
			ownEvents: () => [{ type: "turn/end", seq: 10, time: Date.now() }],
			snapshotEvents: () => [],
		};
		const ctx = {
			on: (name, handler) => { (handlers[name] ??= []).push(handler); return () => undefined; },
			effect: () => () => undefined,
			inject: () => () => undefined,
			commands: { register: () => () => undefined },
			logger: { info: (format, ...args) => { logs.push(`${format} ${args.join(" ")}`); }, warn: (format, ...args) => { logs.push(`warn ${format} ${args.join(" ")}`); } },
			get: (name) => (name === "sessionController" ? {
				// The failure this fixture needs is a genuine one; with the model call gone, the create
				// RPC is the first step that can break.
				create: async () => { if (createThrows) throw new Error("create exploded"); created.push(1); return { sessionId: "child-1" }; },
				rename: async () => undefined,
			} : name === "agents" ? { get: () => ({ followup: () => { prompts.push(1); } }) } : name === "tokenMeter" ? { measure: () => ({ totalTokens: 190_000, surfaceTokens: 100_000 }) } : undefined),
			llm: {
				resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
				stream: model.stream,
			},
		};
		apply(ctx, { provider: "test-provider", model: "test-model", handoffBudgetRecentTokens: 0 });
		return { created, prompts, logs, listener: handlers["session/event"]?.[0], session, model };
	};
	const waitFor = async (predicate) => {
		for (let i = 0; i < 400 && !predicate(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
	};

	// A settled trigger recorded during a *successful* attempt must not hand the same session off
	// twice, and a *failed* attempt keeps its backoff: both retries go through `attempt()`. The two
	// `turn/end` events are delivered back to back so the gate itself has to reject the second one —
	// the automatic path re-measures every turn, so nothing else could be silencing it.
	const twice = make();
	twice.listener(twice.session, { type: "turn/end", seq: 10, time: Date.now() });
	twice.listener(twice.session, { type: "turn/end", seq: 12, time: Date.now() });
	await waitFor(() => twice.created.length > 0);
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert.equal(twice.created.length, 1, "one handoff per session, even with a pending trigger");
	assert.equal(twice.prompts.length, 1);
	twice.model.assertNone("a successful attempt");

	const failed = make(true);
	failed.listener(failed.session, { type: "turn/end", seq: 10, time: Date.now() });
	failed.listener(failed.session, { type: "turn/end", seq: 12, time: Date.now() });
	await waitFor(() => failed.logs.some((line) => line.startsWith("warn")));
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert.equal(failed.logs.filter((line) => line.startsWith("warn")).length, 1, "the backoff suppresses the retry");
	assert.deepEqual(failed.created, []);
	failed.model.assertNone("a failed attempt");
});

test("a disabled automatic handoff ignores turn/end entirely", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "dsh-handoff-off-"));
	const conversation = Array.from({ length: 40 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", "x".repeat(1500)));
	const created = [];
	const handlers = {};
	let modelCalls = 0;
	const session = {
		id: `session-off-${Math.random().toString(16).slice(2, 10)}`,
		header: { cwd: root, createdAt: Date.now() },
		deriveMessages: () => conversation,
		requestHeader: () => undefined,
		ownEvents: () => [{ type: "turn/end", seq: 10, time: Date.now() }],
		snapshotEvents: () => [],
	};
	const ctx = {
		on: (name, handler) => { (handlers[name] ??= []).push(handler); return () => undefined; },
		effect: () => () => undefined,
		inject: () => () => undefined,
		commands: { register: () => () => undefined },
		logger: { info() {}, warn() {} },
		get: (name) => (name === "sessionController" ? {
			create: async () => { created.push(1); return { sessionId: "child-1" }; },
			rename: async () => undefined,
		} : name === "agents" ? { get: () => ({ followup: () => undefined }) } : name === "tokenMeter" ? { measure: () => ({ totalTokens: 190_000, surfaceTokens: 100_000 }) } : undefined),
		llm: {
			resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
			stream: () => { modelCalls += 1; return (async function* generate() { yield { type: "text-delta", text: "## Goal\n\ncontinue" }; })(); },
		},
	};
	apply(ctx, { provider: "test-provider", model: "test-model", handoffEnabled: false, handoffBudgetRecentTokens: 0 });
	handlers["session/event"]?.[0](session, { type: "turn/end", seq: 10, time: Date.now() });
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert.deepEqual(created, [], "the switch is off");
	assert.equal(modelCalls, 0, "a disabled handoff never reaches the model");
});

test("a nothing-to-summarize skip and a deferral have separate log gates", async () => {
	// Both logs are rate-limited per session, but they answer different questions: whichever fires
	// first must not silence the other for the next ten minutes.
	const root = await mkdtemp(path.join(tmpdir(), "dsh-handoff-logs-"));
	const conversation = Array.from({ length: 40 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", "x".repeat(1500)));
	const own = [{ type: "turn/end", seq: 10, time: Date.now() }, { type: "turn/start", seq: 11, time: Date.now() }];
	const logs = [];
	const handlers = {};
	const model = noModelCalls();
	const session = {
		id: `session-logs-${Math.random().toString(16).slice(2, 10)}`,
		header: { cwd: root, createdAt: Date.now() },
		deriveMessages: () => conversation,
		requestHeader: () => undefined,
		ownEvents: () => own,
		snapshotEvents: () => own,
	};
	const ctx = {
		on: (name, handler) => { (handlers[name] ??= []).push(handler); return () => undefined; },
		effect: () => () => undefined,
		inject: () => () => undefined,
		commands: { register: () => () => undefined },
		logger: { info: (format, ...args) => { logs.push(`${format} ${args.join(" ")}`); }, warn: (format, ...args) => { logs.push(`warn ${format} ${args.join(" ")}`); } },
		get: (name) => (name === "sessionController" ? {
			create: async () => ({ sessionId: "child-1" }),
			rename: async () => undefined,
		} : name === "tokenMeter" ? { measure: () => ({ totalTokens: 190_000, surfaceTokens: 100_000 }) } : undefined),
		llm: {
			resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
			stream: model.stream,
		},
	};
	apply(ctx, { provider: "test-provider", model: "test-model", handoffBudgetRecentTokens: 1_000 });
	const listener = handlers["session/event"]?.[0];
	const waitFor = async (predicate) => {
		for (let i = 0; i < 400 && !predicate(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
	};

	// Round 1: the turn is already running, so the attempt defers (and logs it).
	listener(session, { type: "turn/end", seq: 10, time: Date.now() });
	await waitFor(() => logs.some((line) => line.includes("deferred")));
	assert.equal(logs.filter((line) => line.includes("automatic handoff deferred")).length, 1, `expected a deferral log, got ${JSON.stringify(logs)}`);

	// Round 2: the conversation now fits the carried window, so the attempt reports a skip instead.
	conversation.length = 0;
	conversation.push(message("user", "hello"), message("assistant", "hi"));
	own.push({ type: "turn/end", seq: 12, time: Date.now() });
	listener(session, { type: "turn/end", seq: 12, time: Date.now() });
	await waitFor(() => logs.some((line) => line.includes("fits the recent window")));
	assert.equal(logs.filter((line) => line.includes("fits the recent window")).length, 1, `the deferral must not mute the skip, got ${JSON.stringify(logs)}`);
	model.assertNone("the log-gate fixture");
});

test("an open question defers the handoff, and the answer’s first idle takes it", async () => {
	// `handoffPendingQuestion` defaults to "defer": while the last assistant message is an open
	// question the automatic path must not hand off (the continuation would answer it instead), and
	// the first idle after the user answers is the one that performs the handoff.
	const root = await mkdtemp(path.join(tmpdir(), "dsh-handoff-pending-"));
	let conversation = Array.from({ length: 40 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", "x".repeat(1500)));
	conversation.push(message("assistant", "Should I delete the stale branches?"));
	const calls = [];
	const model = noModelCalls();
	const ctx = {
		get: (name) => (name === "sessionController" ? {
			create: async () => { calls.push("create"); return { sessionId: "child-1" }; },
			rename: async () => undefined,
		} : name === "agents" ? { get: () => ({ followup: () => { calls.push("seed"); } }) }
			: name === "tokenMeter" ? { measure: () => ({ totalTokens: 190_000, surfaceTokens: 100_000 }) }
				: name === "workspaceRegistry" ? { resolveByPath: async () => undefined, archiveSession: async () => undefined } : undefined),
		llm: {
			resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
			stream: model.stream,
		},
		logger: { info: () => undefined, warn: () => undefined },
	};
	const session = {
		id: `session-pending-${Math.random().toString(16).slice(2, 10)}`,
		header: { cwd: root, createdAt: Date.now() },
		deriveMessages: () => conversation,
		requestHeader: () => undefined,
		ownEvents: () => [],
		snapshotEvents: () => [],
	};
	const config = resolvePluginConfig({ provider: "test-provider", model: "test-model", handoffBudgetRecentTokens: 0 });

	await maybeAutoHandoff(ctx, session, config);
	assert.deepEqual(calls, [], "an open question defers before any child exists");

	conversation = [...conversation, message("user", "yes, go ahead")];
	await maybeAutoHandoff(ctx, session, config);
	assert.deepEqual(calls, ["create", "seed"], "the answer’s first idle completes the handoff");
	model.assertNone("the pending-question gate");
});
test("a retryable manual handoff failure is not reported with the terminal wording", async () => {
	// `/handoff now` renders its `catch` verbatim. Every failure used to come back as
	// "Handoff failed: <message>", which tells the user the operation is over — even when the cause
	// is a transient the automatic path already treats as non-terminal (a turn still open on the
	// child, a rate-limited route, a dropped connection). The fix must discriminate in
	// *both* directions: a genuine bug must still say "failed", so the retry advice is trustworthy.
	const root = await mkdtemp(path.join(tmpdir(), "dsh-handoff-transient-"));
	const conversation = Array.from({ length: 40 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", "x".repeat(1500)));
	const model = noModelCalls();
	const replyFor = async (followupImpl) => {
		const session = {
			id: `session-transient-${Math.random().toString(16).slice(2, 10)}`,
			header: { cwd: root, createdAt: Date.now() },
			deriveMessages: () => conversation,
			requestHeader: () => undefined,
			ownEvents: () => [],
			snapshotEvents: () => [],
		};
		const ctx = {
			get: (name) => (name === "sessionController" ? {
				create: async () => ({ sessionId: "child-1" }),
				rename: async () => undefined,
			} : name === "agents" ? { get: () => ({ followup: followupImpl }) } : undefined),
			llm: {
				resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
				stream: model.stream,
			},
			logger: { info() {}, warn() {} },
		};
		return runManual(ctx, session, resolvePluginConfig({ provider: "test-provider", model: "test-model", handoffBudgetRecentTokens: 0 }), new AbortController().signal);
	};

	// Retryable: a turn is still open on the child, which is exactly the condition the automatic
	// path defers on rather than failing. The seed is admitted synchronously, so these throwers are
	// synchronous too — an `async` one would reject a promise nothing awaits.
	const busy = await replyFor(() => { throw new Error("a turn is already running for this session"); });
	assert.equal(busy.kind, "error");
	assert.match(busy.text, /Handoff deferred \(temporarily failed, safe to retry\)/);
	assert.match(busy.text, /a turn is already running for this session/, "the true cause is still quoted");
	assert.match(busy.text, /run \/handoff now again/, "the receipt names the recovery");
	assert.doesNotMatch(busy.text, /Handoff failed/, "a retryable cause must not claim the handoff failed");

	// Retryable by error code, with no hint in the prose.
	const reset = await replyFor(() => { const error = new Error("socket hang up"); error.code = "ECONNRESET"; throw error; });
	assert.match(reset.text, /Handoff deferred \(temporarily failed, safe to retry\)/);
	assert.doesNotMatch(reset.text, /Handoff failed/);

	// Terminal: a genuine programming error, so the retry advice must NOT appear — otherwise the
	// user retries a handoff that can never succeed.
	const broken = await replyFor(() => { throw new Error("child.followup is not a function"); });
	assert.equal(broken.kind, "error");
	assert.match(broken.text, /^Handoff failed: child\.followup is not a function$/);
	assert.doesNotMatch(broken.text, /safe to retry/);
	assert.doesNotMatch(broken.text, /deferred/);
	// Every one of the three verdicts above ran a handoff; none may reach a model.
	model.assertNone("the transient-verdict fixture");

	// The classifier itself, asserted directly on the user-visible verdict.
	assert.equal(handoffFailureIsTransient(new Error("429 Too Many Requests")), true);
	assert.equal(handoffFailureIsTransient(new Error("503 Service Unavailable")), true);
	assert.equal(handoffFailureIsTransient(new Error("model not found: gpt-nope")), false);
	assert.equal(handoffFailureIsTransient(new Error("child.followup is not a function")), false);
	assert.equal(handoffFailureIsTransient("a bare string"), false, "an unknown shape is terminal, never a promised retry");

	// Upstream spells these as identifiers, not as standalone words. A single outer `\b…\b` around
	// the alternation silently demoted every one of them to "terminal", so the user was told a
	// retryable overload had failed for good.
	for (const identifier of [
		"overloaded_error",
		"rate_limit_exceeded",
		"rate_limit_error",
		"service temporarily unavailable",
		"temporary failure in name resolution",
		"ETIMEDOUT",
	]) {
		assert.equal(handoffFailureIsTransient(new Error(identifier)), true, `${identifier} is a transient, not a terminal failure`);
	}

	// A `fetch` rejection puts the real reason on `.cause` and leaves `.code` unset at the top level.
	// Ignoring `.cause` called a dropped connection terminal — the opposite of the truth.
	const dropped = new Error("fetch failed");
	dropped.cause = Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" });
	assert.equal(handoffFailureIsTransient(dropped), true, "the cause's code decides, not only the top level");
	const refused = new Error("fetch failed");
	refused.cause = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
	assert.equal(handoffFailureIsTransient(refused), true);
	const nested = new Error("fetch failed");
	nested.cause = new Error("wrapped", { cause: Object.assign(new Error("deep"), { code: "ECONNRESET" }) });
	assert.equal(handoffFailureIsTransient(nested), true, "the cause chain is walked, not just one level");

	// The converse must hold, or the retry advice becomes noise: a status code inside a token count
	// or a model name is not an HTTP status, and a policy denial is not a transient.
	for (const notTransient of [
		"request is 429 tokens over the context limit",
		"model gpt-502-mini is not available",
		"network access is disabled by policy",
		"the workspace is offline by configuration",
		"response is 503 tokens",
		"error: 503 tokens over the limit",
		// A bare count has the *same shape* as a bare status ("429 requests" vs "429 Too Many
		// Requests"). The separator is structural — a count's unit follows the number, so the number
		// is not final — not a unit list. They were unpinned before: the whole class left the suite
		// green when the rule was neutered.
		"429 tokens",
		"429 tokens used",
		"429 requests",
		"503 chars",
		"429 ms",
		"502 bytes",
		"504 seconds",
		// `rate limit` and `overload` are also config nouns; only a *leading* boundary separates
		// `max_rate_limit`/`overload_factor` from `rate_limit_exceeded`/`overloaded_error`.
		"invalid max_rate_limit: must be positive",
		"invalid overload_factor: must be > 0",
		"deliberate limitation",
		"separate limits apply",
		"overload protection enabled",
		// `timeout`/`temporar` are ordinary identifiers in a config key and a path; matching them
		// inside a word was the cost of removing the boundaries, so both directions are pinned.
		"invalid requestTimeout: must be a positive number",
		"temporary directory is read-only",
		"could not create the temporary file",
		// A negated retry advice is the opposite instruction, and the negation may be a few words
		// away. `unsafe to retry` also proves the advice needs a *leading* boundary: it must not
		// match on its `safe to retry` tail.
		"do not try again",
		"not safe to retry",
		"unsafe to retry",
		"no need to try again",
		"it will never be safe to retry",
		// A code the message *ends* on is a status unless a configured value is being quoted — no HTTP
		// context is needed for that (see the transient list's bare `429`). The CJK case pins the
		// boundary class: `\w` is ASCII, so an ASCII lookbehind would let the code match inside `数量429`.
		"the limit is 429",
		"the offset is 429",
		"the max is 502",
		"the quota is 429",
		"数量429",
		// A unit after the code makes it a count even when an HTTP context word precedes it. The list
		// is a best effort; these pin that the guard is live at all.
		"error 429 users",
		"code 429 errors",
		"status 429 attempts",
		"HTTP 429 users affected",
		"status 503 retries",
		"response 503 records",
		"error 429 quota",
		// The value noun that explains a trailing code has to be recognized inside the project's own
		// config keys — `max_tokens`, `maxTokens`, `token_limit`, `handoffBudgetSummaryTokens`. Requiring a
		// *trailing* word boundary rejected every one of them, which is the over-promise direction:
		// a configured limit was reported as a retryable server status. The suite was green for the
		// whole class until these were named.
		"limits: 503",
		"max_tokens=429",
		"maxTokens=429",
		"maxTokens: 429",
		"token_limit=429",
		"window_size=503",
		"handoffBudgetSummaryTokens=429",
		// `timeout` must not match a config key being validated, and `overload` only counts next to a
		// status or an actor — both were over-promises from a bare stem.
		"timeout_ms must be positive",
		"overload protection enabled",
		"invalid overload_factor: must be > 0",
		// The actor branch must not read a config statement as a transient overload — these are the
		// rows that a bare actor prefix got wrong, and the whole set was green until they were named.
		"service overload protection enabled",
		"invalid service overload_factor: must be > 0",
		"server overload threshold 0.8",
		"error overload protection is disabled",
		"api overload control enabled",
	]) {
		assert.equal(handoffFailureIsTransient(new Error(notTransient)), false, `${notTransient} must stay terminal`);
	}

	// The wording a runtime actually produces, including the passive forms and bare statuses. These
	// regressed when the pattern was narrowed, so each is named.
	for (const transient of [
		"network is unreachable",
		"connection was reset",
		"connection reset by peer",
		"429",
		"503",
		"HTTP 503",
		"HTTP 503 Service Unavailable",
		"429 Too Many Requests",
		"502 Bad Gateway",
		"504 Gateway Timeout",
		"Error: 429",
		"ERR_HTTP_503",
		"request_timeout",
		"the request timed out",
		// Plural and gerund are the forms a runtime reports timeouts with; the trailing boundary that
		// fixed `requestTimeout` also dropped these.
		"timeouts",
		"repeated timeouts",
		"socket timeouts",
		"timing out",
		// The inflections are what Cloudflare and the providers actually send. A trailing boundary
		// placed after the stem (rather than after the inflected alternative) drops every one of
		// these, and nothing pinned it.
		"429 rate limited",
		"429 rate-limited",
		"rate limiting",
		"rate limits exceeded",
		"provider rate limited the request",
		// `overload` is an actor noun as well as a config noun; next to a status or an actor it counts.
		"429 overload",
		"service overload, try later",
		// A status code with more text after it cannot use the end rule, so it needs an HTTP context
		// word before it and no unit after it.
		"HTTP 503: upstream unavailable",
		"HTTP/1.1 503",
		"status 503 backend unhealthy",
		"status_code 503",
		"err 503",
		"error 502 from upstream",
		"HTTP 503: upstream connect error or disconnect/reset before headers",
		// A code the message *ends* on is a status when no configured value is being quoted. Dropping
		// the end rule to fix that case cost this whole class, which nothing pinned.
		"server returned 503",
		"request failed with 503",
		"got 429",
		"backend responded 502",
		"upstream 503",
		"gateway 502",
		"provider returned 429",
		"the server said 503",
		"retrying after 503",
		"429, 503",
		"[503]",
		"(429)",
		// The distinguishing feature of a prohibition is grammatical, not lexical: the negation has to
		// be in the same *clause* as a retry verb. Each of these contains a negation word and a retry
		// verb separated by a comma or a unrelated verb, so none forbids retrying. They are the rows
		// that a proximity-only guard got wrong, and the whole class was green until they were named.
		"not a fatal error, please retry",
		"the failure is not permanent, please retry",
		"this is not fatal, please retry",
		"don't worry, please retry",
		"cannot fail, please retry",
		"won't hurt, please retry",
		"no, please retry",
		"never mind, please retry",
		// The clause break is what makes this group transient, and *only* a comma or a sentence end
		// breaks the match. These three are the minimal forms that exercise it; without them the comma
		// in the prohibition pattern was unpinned — removing it left the suite green.
		"not x, please retry",
		"cannot x, please retry",
		"never x, please retry",
	]) {
		assert.equal(handoffFailureIsTransient(new Error(transient)), true, `${transient} is a transient`);
	}

	// The converse: a negation *in the same clause* as a retry verb is a prohibition, so the advice
	// must not fire. `don't retry` and `avoid retrying` have no advice phrase of their own, so they
	// stay terminal because nothing matches — which is the correct answer for a different reason.
	for (const prohibited of [
		"do not retry",
		"never retry",
		"don't retry",
		"cannot retry",
		"avoid retrying",
	]) {
		assert.equal(handoffFailureIsTransient(new Error(prohibited)), false, `${prohibited} forbids retrying`);
	}

	// `ENETUNREACH` has no matching message wording, so it must be in the code set — the narrowing
	// that dropped it made "network is unreachable" terminal even though the code is unambiguous.
	const unreachable = new Error("connect failed");
	unreachable.code = "ENETUNREACH";
	assert.equal(handoffFailureIsTransient(unreachable), true, "the code set covers codes with no wording");

	// Any transient code on the cause chain wins: an outer wrapper code must not mask a nested one.
	const masked = new Error("model not found");
	masked.code = "ERR_MODEL_NOT_FOUND";
	masked.cause = Object.assign(new Error("socket closed"), { code: "ECONNRESET" });
	assert.equal(handoffFailureIsTransient(masked), true, "a nested transient code is not hidden by the outer code");
	const allTerminal = new Error("boom");
	allTerminal.code = "ERR_BAD_STATE";
	allTerminal.cause = Object.assign(new Error("also boom"), { code: "ERR_OTHER" });
	assert.equal(handoffFailureIsTransient(allTerminal), false, "a fully terminal chain stays terminal");

	// A cyclic `.cause` must terminate rather than overflow the stack.
	const cyclic = new Error("cyclic");
	cyclic.cause = cyclic;
	assert.equal(handoffFailureIsTransient(cyclic), false, "a cyclic cause chain is walked safely");
});

test("the manual handoff stays exempt from the settle guard", async () => {
	// `/handoff now` executes *inside* its own turn, so a `turn/start` in the log can never mean the
	// user moved on; applying the guard there would make the command useless.
	const root = await mkdtemp(path.join(tmpdir(), "dsh-handoff-manual-settle-"));
	const conversation = Array.from({ length: 40 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", "x".repeat(1500)));
	const calls = [];
	const model = noModelCalls();
	const session = {
		id: `session-manual-settle-${Math.random().toString(16).slice(2, 10)}`,
		header: { cwd: root, createdAt: Date.now() },
		deriveMessages: () => conversation,
		requestHeader: () => undefined,
		ownEvents: () => [{ type: "turn/start", seq: 5, time: Date.now() }, { type: "turn/end", seq: 6, time: Date.now() }],
		snapshotEvents: () => [],
	};
	const ctx = {
		get: (name) => (name === "sessionController" ? {
			create: async () => { calls.push("create"); return { sessionId: "child-1" }; },
			rename: async () => undefined,
		} : name === "agents" ? { get: () => ({ followup: () => { calls.push("seed"); } }) } : undefined),
		llm: {
			resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
			stream: model.stream,
		},
		logger: { info() {}, warn() {} },
	};
	const reply = await runManual(ctx, session, resolvePluginConfig({ provider: "test-provider", model: "test-model", handoffBudgetRecentTokens: 0 }), new AbortController().signal);
	assert.equal(reply.kind, "success", `expected a handoff, got ${JSON.stringify(reply)}`);
	assert.deepEqual(calls, ["create", "seed"]);
	assert.equal(turnStartedAfter(session, 0), true, "the fixture really does look busy");
	model.assertNone("the manual settle exemption");
});

test("tool results reach the live transcript, not just the tool name", () => {
	// dsh 0.1.7-rc.2 removed the `tool-result` content block: a tool result is now a first-class
	// `role: 'tool'` message whose own `text` blocks hold the output. A walk that only understood the
	// old nested wrapper rendered every output empty and dropped the section — the handoff tail
	// carried hundreds of `[tool: …]` stubs with zero results, and the consolidation prompt never saw
	// a command's output.
	assert.equal(textOf([{ type: "text", text: "all green" }]), "all green");
	assert.equal(textOf([{ type: "image", attachment: {} }, { type: "text", text: "all green" }]), "all green");

	const session = {
		deriveMessages: () => [
			{ role: "user", source: { kind: "user" }, content: [{ type: "text", text: "run the suite" }] },
			{ role: "assistant", source: { kind: "model" }, content: [{ type: "tool-call", id: "c1", name: "bash", arguments: "{}" }] },
			{ role: "tool", source: { kind: "tool", callId: "c1" }, toolCallId: "c1", content: [{ type: "text", text: "all green" }] },
		],
	};
	const transcript = conversationText(session);
	assert.match(transcript, /## assistant\n\[tool: bash\]/);
	assert.match(transcript, /## tool result\nall green/, "the output is in the transcript the callers read");
});

// ---------------------------------------------------------------------------
// Output budget for reasoning routes, and the visible/retryable truncation path.
// Hidden reasoning is a *subset of the same output cap* as the visible reply, so a
// reasoning route that is not given a reserve spends the budget thinking and gets its
// JSON cut off mid-string. dsh reports that as `max-tokens` — never pi's `length`.
// ---------------------------------------------------------------------------

test("reasoningReserveTokens reserves only for a reasoning route", () => {
	// A non-reasoning route reserves nothing, whatever the content size.
	assert.equal(reasoningReserveTokens(100_000, {}), 0, "an unknown route is not a reasoning route");
	assert.equal(reasoningReserveTokens(100_000, { reasoning: false }), 0);
	// No content means nothing to reserve for — the floor is not unconditional.
	assert.equal(reasoningReserveTokens(0, { reasoning: true }), 0);
	assert.equal(reasoningReserveTokens(-5, { reasoning: true }), 0);

	// Proportional in between the two clamps, computed from the bare constants.
	const mid = 10_000;
	assert.equal(reasoningReserveTokens(mid, { reasoning: true }), Math.round(mid * REASONING_RESERVE_RATIO));
	assert.ok(mid * REASONING_RESERVE_RATIO > MIN_REASONING_RESERVE_TOKENS && mid * REASONING_RESERVE_RATIO < MAX_REASONING_RESERVE_TOKENS);

	// Floor: a tiny content estimate still gets the minimum reserve.
	assert.equal(reasoningReserveTokens(1, { reasoning: true }), MIN_REASONING_RESERVE_TOKENS);
	assert.equal(reasoningReserveTokens(100, { reasoning: true }), MIN_REASONING_RESERVE_TOKENS);
	// Ceiling: a huge one is clamped, not proportional.
	assert.equal(reasoningReserveTokens(1_000_000, { reasoning: true }), MAX_REASONING_RESERVE_TOKENS);
});

test("the non-reasoning budget is unchanged value for value", () => {
	// The invariant pi demands: with no reasoning flag and no retry headroom, `fitMemoryInput`
	// must behave exactly as it did before the reserve existed. The expectation is computed from
	// the OLD formula transcribed here, never by calling the helper under test.
	const oldBudget = (memory, context, configuredMaxTokens, model, ceilingTokens) => {
		const memoryRate = replyTokenRate(memory);
		const contextRate = replyTokenRate(context);
		const needed = Math.ceil(memory.length * memoryRate + context.length * contextRate) + REPLY_OUTPUT_MARGIN_TOKENS;
		const maxTokens = adaptiveOutputTokens(configuredMaxTokens, needed, model, ceilingTokens);
		const reserved = Math.min(REPLY_OUTPUT_MARGIN_TOKENS, maxTokens, Math.max(64, maxTokens - 400));
		return { maxTokens, budget: Math.max(0, maxTokens - reserved) };
	};

	// Dense, ASCII, and empty inputs, over caps that exercise the floor and the ceiling.
	const cases = [
		["", ""],
		["# Project Memory\n\nsmall", "## Summary\nsmall"],
		["m".repeat(400_000), "c".repeat(400_000)],
		["记".repeat(60_000), "录".repeat(60_000)],
		["a\"\\".repeat(9_000), "plain prose"],
	];
	for (const [memory, context] of cases) {
		for (const configured of [256, 1024, 8192, 32_768]) {
			for (const ceiling of [256, 4096, 32_768, 100_000]) {
				for (const modelCap of [undefined, 0, 12_000, 1_000_000]) {
					const model = { maxTokens: modelCap };
					const expected = oldBudget(memory, context, configured, model, ceiling);
					const actual = fitMemoryInput(memory, context, configured, model, ceiling);
					const label = `mem=${memory.length} ctx=${context.length} configured=${configured} ceiling=${ceiling} modelCap=${modelCap}`;
					assert.equal(actual.maxTokens, expected.maxTokens, `maxTokens drifted for ${label}`);
					// The clipping decision must match too: agreement of `clipped` with the old
					// "content fits the old budget" test is what proves the same text is sent.
					const contentTokens = memory.length * replyTokenRate(memory) + context.length * replyTokenRate(context);
					assert.equal(actual.clipped, !(contentTokens <= expected.budget), `clipped drifted for ${label}`);
					if (!actual.clipped) {
						assert.equal(actual.text, memory, `text drifted for ${label}`);
						assert.equal(actual.contextText, context, `contextText drifted for ${label}`);
					}
				}
			}
		}
	}

	// Passing the headroom explicitly as 0 is the same as omitting it.
	const base = fitMemoryInput("abc", "def", 8192, {});
	const explicit = fitMemoryInput("abc", "def", 8192, {}, MAX_ADAPTIVE_OUTPUT_TOKENS, 0);
	assert.deepEqual(explicit, base);
});

test("a reasoning route gets a strictly larger budget than the same non-reasoning input", () => {
	// The reserve feeds `needed`, so it raises the requested cap while the cap is still below the
	// ceiling. (Once the ceiling binds, the same reserve instead shows up as less content sent —
	// the next test pins that half.) Both are the reserve being really charged to the request.
	const memory = "m".repeat(200_000);
	const context = "c".repeat(200_000);
	const ceiling = 2_000_000;
	const plain = fitMemoryInput(memory, context, 8192, {}, ceiling);
	const reasoning = fitMemoryInput(memory, context, 8192, { reasoning: true }, ceiling);
	assert.ok(reasoning.maxTokens > plain.maxTokens, `reasoning cap ${reasoning.maxTokens} must exceed ${plain.maxTokens}`);
	// The reserve is taken out of what the visible input may use, so under a binding ceiling the
	// reasoning route must send strictly *less* stored content than the non-reasoning one.
	const tightCeiling = 32_768;
	const plainTight = fitMemoryInput(memory, context, 8192, {}, tightCeiling);
	const reasoningTight = fitMemoryInput(memory, context, 8192, { reasoning: true }, tightCeiling);
	assert.ok(plainTight.clipped && reasoningTight.clipped, "fixture: both fits are budget-bound here");
	assert.ok(reasoningTight.text.length < plainTight.text.length, `reasoning sent ${reasoningTight.text.length} chars, plain ${plainTight.text.length}`);
});

test("extra headroom is held back from the input the pass sends", () => {
	// The headroom is spent on the request, so it can show up either as a larger `maxTokens`
	// (when the ceiling is what binds) or as less stored content sent inside the same cap
	// (when the model's own limit binds). Both are the reserve being really taken out.
	const memory = "m".repeat(400_000);
	const context = "c".repeat(400_000);

	const base = fitMemoryInput(memory, context, 8192, {}, 32_768);
	const retried = fitMemoryInput(memory, context, 8192, {}, 32_768, RETRY_OUTPUT_HEADROOM_TOKENS);
	assert.ok(retried.maxTokens >= base.maxTokens, "the retry never asks for less room than the first attempt");
	assert.ok(retried.text.length < base.text.length, `the retry must send less content (${retried.text.length} vs ${base.text.length})`);

	// With a model cap in range, the same reserve visibly raises the requested cap instead.
	const capped = fitMemoryInput("m".repeat(20_000), "c".repeat(20_000), 8192, {}, 32_768);
	const cappedRetry = fitMemoryInput("m".repeat(20_000), "c".repeat(20_000), 8192, {}, 32_768, RETRY_OUTPUT_HEADROOM_TOKENS);
	assert.ok(cappedRetry.maxTokens > capped.maxTokens, `headroom cap ${cappedRetry.maxTokens} must exceed ${capped.maxTokens}`);
});

/** A consolidation pass over a temp project with a scripted `ctx.llm.stream`. */
async function consolidationFixture({ root, replies, modelInfo, throwOnCall }) {
	const calls = [];
	const warnings = [];
	const ctx = {
		logger: { info() {}, warn: (format, ...args) => { warnings.push(`${format} ${args.join(" ")}`); } },
		llm: {
			resolveModelInfo: async () => modelInfo ?? { context: { contextWindow: 200_000 } },
			stream(options) {
				calls.push(options);
				const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
				// `throwOnCall` models a model call that dies for its own reason (a transport error):
				// the nth call throws where the adapter would have thrown instead of streaming.
				if (throwOnCall === calls.length) {
					return (async function* generate() {
						throw new Error(`retry transport error on call ${calls.length}`);
					})();
				}
				return (async function* generate() {
					if (reply.usage) yield { type: "usage", usage: reply.usage };
					// A reply may carry a tool call instead of (or as well as) text. The stream is
					// reproduced the way the adapter really sends it: the first delta names the tool,
					// the next carries the arguments, and `block-end` carries the assembled call.
					if (reply.toolCall) {
						yield { type: "tool-call-delta", index: 0, id: "call-1", name: reply.toolCall.name, argumentsDelta: "" };
						yield { type: "tool-call-delta", index: 0, id: "call-1", argumentsDelta: reply.toolCall.arguments };
						yield { type: "block-end", index: 0, block: { type: "tool-call", id: "call-1", name: reply.toolCall.name, arguments: reply.toolCall.arguments } };
					}
					if (reply.text !== undefined) yield { type: "text-delta", index: 0, text: reply.text };
					// `skipFinish` models a stream that ends with no terminal event, which leaves the
					// finish reason empty — a call whose completion was never signalled.
					if (reply.skipFinish !== true) yield { type: "finish", reason: reply.reason ?? { kind: "stop" } };
				})();
			},
		},
	};
	const agent = {
		options: { provider: "test-provider", model: "test-model" },
		session: {
			id: "session-truncation",
			header: { cwd: root, createdAt: Date.now() },
			snapshotEvents: () => [],
			deriveMessages: () => [],
			requestHeader: () => undefined,
		},
	};
	return { calls, warnings, ctx, agent };
}

const COMPLETE_REPLY = '{"memory_markdown":"# Project Memory\\n\\nkept\\n","context":{"title":"t","summary":"s","key_points":[],"open_tasks":[]}}';
const CUT_REPLY = '{"memory_markdown":"# Project Memory\\n\\nwas cut off here';

test("a reply cut off by the output limit is retried once with more headroom", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "dsh-truncation-retry-"));
	await mkdir(path.join(root, ".agents", "memory"), { recursive: true });
	// Dense content, sized to fit the read cap, so the first fit really is budget-bound and the
	// retry (which reserves RETRY_OUTPUT_HEADROOM_TOKENS more) is distinguishable from it.
	await writeFile(path.join(root, ".agents", "memory", "MEMORY.md"), `# Project Memory\n\n${"记".repeat(30_000)}\n`, "utf8");
	const stored = await readFile(path.join(root, ".agents", "memory", "MEMORY.md"), "utf8");
	assert.equal((await loadMemory(root, 40_000)).text.length, stored.trimEnd().length, "the fixture memory survives the read cap");

	const { calls, warnings, ctx, agent } = await consolidationFixture({
		root,
		replies: [
			{ text: CUT_REPLY, reason: { kind: "max-tokens" }, usage: { inputTokens: 10, outputTokens: 8192, reasoningTokens: 5000 } },
			{ text: COMPLETE_REPLY, reason: { kind: "stop" }, usage: { inputTokens: 10, outputTokens: 200 } },
		],
	});
	const config = resolvePluginConfig({ maxTokens: 8192, maxOutputTokens: 32_768, consolidateTurns: 1, maxMemoryChars: 40_000 });

	// Capture rather than await: if the retry never happens the pass *rejects*, and an assertion
	// about the call count is a far better failure signal than a propagated "not a usable JSON
	// object" error. The count is asserted before anything touches the reply text.
	let outcome;
	let failure;
	try {
		outcome = await consolidateProjectState(ctx, agent, config, { force: true });
	} catch (error) {
		failure = error;
	}
	assert.equal(calls.length, 2, `one retry after the truncation, and no more (failure: ${failure?.message ?? "none"})`);
	assert.equal(failure, undefined, `the retried pass must succeed, got: ${failure?.message}`);
	// The retry reserves RETRY_OUTPUT_HEADROOM_TOKENS more out of the same cap, which shows up as
	// a larger requested cap or as less stored content sent — the retry never sends more.
	const sentMemory = (call) => /<existing-memory>\n([\s\S]*?)\n<\/existing-memory>/.exec(call.messages[0].content.map((block) => block.text ?? "").join("\n"))[1];
	assert.ok(
		calls[1].maxTokens > calls[0].maxTokens || sentMemory(calls[1]).length < sentMemory(calls[0]).length,
		`the retry must reserve more room: caps ${calls[0].maxTokens} -> ${calls[1].maxTokens}, memory ${sentMemory(calls[0]).length} -> ${sentMemory(calls[1]).length}`,
	);
	const retryPrompt = calls[1].messages[0].content.map((block) => block.text ?? "").join("\n");
	assert.match(retryPrompt, /cut off by the model output limit/i, "the retry says why it is being asked again");
	assert.match(retryPrompt, /compact|shorter/i, "the retry asks for a shorter reply");
	// The first prompt must NOT carry the retry instruction.
	const firstPrompt = calls[0].messages[0].content.map((block) => block.text ?? "").join("\n");
	assert.doesNotMatch(firstPrompt, /cut off by the model output limit/i);
	assert.equal(outcome.result.memory, "# Project Memory\n\nkept\n", "the successful retry is accepted");
	assert.deepEqual(warnings, [], `a recovered truncation is not a failure: ${JSON.stringify(warnings)}`);
});

test("a reply cut off twice is reported as an output-limit failure and writes nothing", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "dsh-truncation-double-"));
	await mkdir(path.join(root, ".agents", "memory"), { recursive: true });
	await writeFile(path.join(root, ".agents", "memory", "MEMORY.md"), "# Project Memory\n\noriginal\n", "utf8");

	const { calls, ctx, agent } = await consolidationFixture({
		root,
		replies: [{ text: CUT_REPLY, reason: { kind: "max-tokens" }, usage: { inputTokens: 10, outputTokens: 8192, reasoningTokens: 4096 } }],
	});
	const config = resolvePluginConfig({ maxTokens: 8192, maxOutputTokens: 32_768, consolidateTurns: 1 });

	await assert.rejects(
		() => consolidateProjectState(ctx, agent, config, { force: true }),
		(error) => {
			assert.match(error.message, /cut off by the model output limit/, "the failure names the output limit");
			assert.match(error.message, /\d+ tokens requested/, "it reports the cap it asked for");
			assert.match(error.message, /4096 spent on hidden reasoning/, "and the hidden reasoning it paid for");
			assert.doesNotMatch(error.message, /not a usable JSON object/, "not the generic parse wording");
			return true;
		},
	);
	assert.equal(calls.length, 2, "it retried once before giving up");
	// Fail-closed: the truncated fragment must never reach MEMORY.md.
	assert.equal(await readFile(path.join(root, ".agents", "memory", "MEMORY.md"), "utf8"), "# Project Memory\n\noriginal\n");
});

test("a complete JSON reply is accepted even when the model stopped on max-tokens", async () => {
	// The converse guard: truncation alone must not trigger a retry. If the object parsed, the
	// reply is usable and spending a second model call on it is waste.
	const root = await mkdtemp(path.join(tmpdir(), "dsh-truncation-complete-"));
	await mkdir(path.join(root, ".agents", "memory"), { recursive: true });

	const { calls, warnings, ctx, agent } = await consolidationFixture({
		root,
		replies: [{ text: COMPLETE_REPLY, reason: { kind: "max-tokens" }, usage: { inputTokens: 10, outputTokens: 8192 } }],
	});
	const config = resolvePluginConfig({ maxTokens: 8192, maxOutputTokens: 32_768, consolidateTurns: 1 });

	const outcome = await consolidateProjectState(ctx, agent, config, { force: true });

	assert.equal(calls.length, 1, "a parseable reply is never retried");
	assert.equal(outcome.result.memory, "# Project Memory\n\nkept\n");
	assert.deepEqual(warnings, []);
});

test("clipped follows the input that was actually sent last", async () => {
	// The retry fits with extra headroom, so it may send *less* stored content than the first
	// attempt. The reported `clipped` must describe that last call, not the first fit — and the
	// input size here is chosen so the two differ: the first fit sends everything, the retry clips.
	const root = await mkdtemp(path.join(tmpdir(), "dsh-truncation-clipped-"));
	await mkdir(path.join(root, ".agents", "memory"), { recursive: true });
	const content = "字".repeat(27_673);
	await writeFile(path.join(root, ".agents", "memory", "MEMORY.md"), `# Project Memory\n\n${content}\n`, "utf8");

	// Guard the fixture itself: this test only proves anything while the two fits disagree.
	const stored = await readFile(path.join(root, ".agents", "memory", "MEMORY.md"), "utf8");
	assert.equal(fitMemoryInput(stored, "", 8192, {}, 32_768).clipped, false, "the first fit must not clip");
	assert.equal(fitMemoryInput(stored, "", 8192, {}, 32_768, RETRY_OUTPUT_HEADROOM_TOKENS).clipped, true, "the retry fit must clip");

	const { calls, ctx, agent } = await consolidationFixture({
		root,
		replies: [
			{ text: CUT_REPLY, reason: { kind: "max-tokens" } },
			{ text: COMPLETE_REPLY, reason: { kind: "stop" } },
		],
	});
	const config = resolvePluginConfig({ maxTokens: 8192, maxOutputTokens: 32_768, consolidateTurns: 1, maxMemoryChars: 40_000 });

	const outcome = await consolidateProjectState(ctx, agent, config, { force: true }).catch((error) => error);

	assert.equal(calls.length, 2, `the retry must run (got: ${outcome?.message ?? "a success"})`);
	const sentMemory = (call) => /<existing-memory>\n([\s\S]*?)\n<\/existing-memory>/.exec(call.messages[0].content.map((block) => block.text ?? "").join("\n"))[1];
	assert.ok(sentMemory(calls[1]).length < sentMemory(calls[0]).length, "the retry really did send less");
	assert.equal(outcome.clipped, true, "clipped mirrors the last input sent, not the first fit");
});

/** The four-section shape a `record_memory` call carries, as the adapter would stream it. */
const RECORD_MEMORY_ARGS = JSON.stringify({
	memory: { project: ["p1"], invariants: ["i1"], pitfalls: ["q1"], index: ["x1"] },
	context: { title: "t", summary: "s", key_points: ["k"], open_tasks: ["o"] },
});

/** A project root with the memory directory in place. */
async function memoryProject(prefix, memory) {
	const root = await mkdtemp(path.join(tmpdir(), prefix));
	await mkdir(path.join(root, ".agents", "memory"), { recursive: true });
	if (memory !== undefined) await writeFile(path.join(root, ".agents", "memory", "MEMORY.md"), memory, "utf8");
	return root;
}

test("the pass offers record_memory first and renders its call into the four sections", async () => {
	const root = await memoryProject("dsh-memory-tool-");
	const { calls, ctx, agent } = await consolidationFixture({
		root,
		replies: [{ toolCall: { name: "record_memory", arguments: RECORD_MEMORY_ARGS }, reason: { kind: "tool-calls" } }],
	});
	const config = resolvePluginConfig({ consolidateTurns: 1, maxMemoryChars: 40_000 });

	const outcome = await consolidateProjectState(ctx, agent, config, { force: true });

	assert.equal(calls.length, 1, "a tool call needs no retry");
	assert.deepEqual(calls[0].tools?.map((tool) => tool.name), ["record_memory"], "the first call offers the tool");
	assert.equal(outcome.kind, "structured");
	assert.match(outcome.result.memory, /^# Project Memory\n\n## Project\n- p1\n\n## Invariants\n- i1\n\n## Pitfalls\n- q1\n\n## Index\n- x1\n$/);
	assert.equal(outcome.result.context.summary, "s", "the context comes from the same call");
	assert.equal(outcome.semanticEmpty, false);
	assert.equal(outcome.sectionDropped, 0);
	// The prompt has to prefer the tool, or the model keeps answering in the old JSON shape. The
	// tool rule must come first, and the old "always return JSON" instruction must be gone — the
	// fallback line is the one that still mentions the JSON object, and it is conditional.
	const rules = [...CONSOLIDATION_PROMPT_RULES];
	const toolIndex = rules.findIndex((rule) => rule.includes("Prefer calling the record_memory tool"));
	const jsonIndex = rules.findIndex((rule) => rule.includes("memory_markdown and context"));
	assert.ok(toolIndex !== -1, "the tool rule is present");
	assert.ok(jsonIndex !== -1, "the JSON fallback rule is present");
	assert.ok(toolIndex < jsonIndex, "the tool rule precedes the fallback");
	assert.ok(!rules.some((rule) => rule.startsWith("Return exactly one JSON object")), "the old JSON-first instruction is gone");
	assert.match(rules[jsonIndex], /If you cannot call that tool/, "the JSON shape is a fallback, not the default");
});

test("a tool call cut off at the output cap is refused, and the retry carries no tool", async () => {
	const root = await memoryProject("dsh-memory-tool-cut-");
	const { calls, ctx, agent } = await consolidationFixture({
		root,
		replies: [
			// The adapter repairs a cut arguments string into a shape-valid object, so "there is a
			// tool call" must not be treated as evidence that its contents arrived.
			{ toolCall: { name: "record_memory", arguments: '{"memory":{"project":["p' }, reason: { kind: "max-tokens" } },
			{ text: COMPLETE_REPLY, reason: { kind: "stop" } },
		],
	});
	const config = resolvePluginConfig({ maxTokens: 8192, maxOutputTokens: 32_768, consolidateTurns: 1 });

	const outcome = await consolidateProjectState(ctx, agent, config, { force: true });

	assert.equal(calls.length, 2, "the truncated call is retried rather than accepted");
	assert.equal(calls[1].tools, undefined, "the retry asks for the JSON text shape, so it drops the tool");
	assert.equal(outcome.kind, "fallback-opaque", "the accepted reply is the retry's text");
	assert.equal(outcome.result.memory, "# Project Memory\n\nkept\n");
});

test("a tool call the pass did not ask for falls back to text, and fails loudly with no text", async () => {
	const withText = await memoryProject("dsh-memory-other-tool-");
	const first = await consolidationFixture({
		root: withText,
		replies: [{ toolCall: { name: "other_tool", arguments: "{}" }, text: COMPLETE_REPLY, reason: { kind: "tool-calls" } }],
	});
	const config = resolvePluginConfig({ consolidateTurns: 1 });
	const outcome = await consolidateProjectState(first.ctx, first.agent, config, { force: true });
	assert.equal(first.calls.length, 1);
	assert.equal(outcome.kind, "fallback-opaque", "readable text is the fail-open path");

	// With nothing to parse, returning an empty memory would read as a silent success: it is an error.
	const withoutText = await memoryProject("dsh-memory-other-tool-empty-");
	const second = await consolidationFixture({
		root: withoutText,
		replies: [{ toolCall: { name: "other_tool", arguments: "{}" }, reason: { kind: "tool-calls" } }],
	});
	await assert.rejects(
		() => consolidateProjectState(second.ctx, second.agent, config, { force: true }),
		/model called other_tool without text; expected record_memory/,
	);
});

test("a record_memory call whose sections carry no content never replaces a stored memory", async () => {
	// The stored memory is a real one; the reply is a shape-valid call with nothing in it. Without
	// the semantic gate the rendered bare skeleton is over the length floor and would overwrite it.
	const stored = "# Project Memory\n\n## Project\n- a real durable fact\n\n## Invariants\n\n## Pitfalls\n\n## Index\n";
	const root = await memoryProject("dsh-memory-empty-gate-", stored);
	const { ctx, agent } = await consolidationFixture({
		root,
		replies: [{
			toolCall: {
				name: "record_memory",
				arguments: JSON.stringify({
					memory: { project: [""], invariants: [" "], pitfalls: ["\u200b"], index: ["##"] },
					context: { title: "t", summary: "s", key_points: [], open_tasks: [] },
				}),
			},
			reason: { kind: "tool-calls" },
		}],
	});
	const config = resolvePluginConfig({ consolidateTurns: 1, maxMemoryChars: 40_000 });

	const outcome = await consolidateProjectState(ctx, agent, config, { force: true });
	assert.equal(outcome.semanticEmpty, true, "the pass judges the normalized sections, not the array lengths");

	// The write decision lives in the feature's own pass: a body-less reply must not land on disk.
	await consolidateProject(ctx, config, agent, { force: true, silent: true });
	assert.equal(await readFile(path.join(root, ".agents", "memory", "MEMORY.md"), "utf8"), stored, "the stored memory is untouched");
});

test("a headings-only record_memory call never replaces a stored memory either", async () => {
	// The two halves of the gate must agree on the same document. An entry that is itself a heading
	// carries letters, so the array-level check passes — but it renders to a line the opaque half
	// treats as structural, and the document would be a skeleton. This is the case the entry-level
	// filter cannot see, so it is the one that pins the rendered-document half of the gate.
	const stored = "# Project Memory\n\n## Project\n- a real durable fact\n\n## Invariants\n\n## Pitfalls\n\n## Index\n";
	const root = await memoryProject("dsh-memory-heading-gate-", stored);
	const { ctx, agent } = await consolidationFixture({
		root,
		replies: [{
			toolCall: {
				name: "record_memory",
				arguments: JSON.stringify({
					memory: { project: ["## Project"], invariants: ["## Invariants"], pitfalls: ["## Pitfalls"], index: ["# Project Memory"] },
					context: { title: "t", summary: "s", key_points: [], open_tasks: [] },
				}),
			},
			reason: { kind: "tool-calls" },
		}],
	});
	const config = resolvePluginConfig({ consolidateTurns: 1, maxMemoryChars: 40_000 });

	const outcome = await consolidateProjectState(ctx, agent, config, { force: true });
	assert.equal(outcome.semanticEmpty, true, "the gate judges the rendered document, not only the arrays");

	await consolidateProject(ctx, config, agent, { force: true, silent: true });
	assert.equal(await readFile(path.join(root, ".agents", "memory", "MEMORY.md"), "utf8"), stored, "the stored memory is untouched");
});

test("a tool call cut off with no finish reason at all is refused too", async () => {
	// `max-tokens` is how dsh names a cut reply, but a stream that ends without a terminal event
	// leaves the finish reason empty — and a call whose completion was never signalled may be a
	// repaired half. Both are refused; a reply that carries no call is unaffected.
	const root = await memoryProject("dsh-memory-tool-nofinish-");
	const { calls, ctx, agent } = await consolidationFixture({
		root,
		replies: [
			{ toolCall: { name: "record_memory", arguments: RECORD_MEMORY_ARGS }, skipFinish: true },
			{ text: COMPLETE_REPLY, reason: { kind: "stop" } },
		],
	});
	const config = resolvePluginConfig({ maxTokens: 8192, maxOutputTokens: 32_768, consolidateTurns: 1 });

	const outcome = await consolidateProjectState(ctx, agent, config, { force: true });

	assert.equal(calls.length, 2, "the unsignalled call is retried rather than accepted");
	assert.equal(calls[1].tools, undefined, "the retry drops the tool");
	assert.equal(outcome.kind, "fallback-opaque", "the accepted reply is the retry's text");
});

test("a complete record_memory call beside a max-tokens finish is refused, even with text", async () => {
	// The truncation guard must not be a text-path affair: a reply that carries BOTH a tool call and
	// readable text is still refused when the call may be a repaired half, and the retry is text-only.
	const root = await memoryProject("dsh-memory-tool-cut-text-");
	const { calls, ctx, agent } = await consolidationFixture({
		root,
		replies: [
			{ toolCall: { name: "record_memory", arguments: RECORD_MEMORY_ARGS }, text: COMPLETE_REPLY, reason: { kind: "max-tokens" } },
			{ text: COMPLETE_REPLY, reason: { kind: "stop" } },
		],
	});
	const config = resolvePluginConfig({ maxTokens: 8192, maxOutputTokens: 32_768, consolidateTurns: 1 });

	const outcome = await consolidateProjectState(ctx, agent, config, { force: true });

	assert.equal(calls.length, 2, "the call is refused despite the readable text");
	assert.equal(calls[1].tools, undefined, "the retry asks for the text shape");
	assert.equal(outcome.kind, "fallback-opaque", "the retry's text decides");
});

test("the memory section rule states the same sections, order and character budgets the renderer enforces", () => {
	const cap = 40_000;
	const rule = memorySectionRule(cap);
	const budgets = memorySectionBudgets(cap);
	const targets = memorySectionPromptBudgets(cap);
	for (const [index, section] of budgets.entries()) {
		const target = targets[index].chars;
		assert.equal(targets[index].heading, section.heading);
		// Both numbers are stated, and they come from the one table: the figure the prompt asks for and
		// the budget the renderer refuses past.
		assert.ok(
			rule.includes(`## ${section.heading}: ${section.description} (aim for about ${target} characters; never past ${section.chars})`),
			`the rule budgets ${section.heading}`,
		);
		assert.ok(target < section.chars, `${section.heading}: the stated target is inside the hard budget`);
	}
	for (const [index, section] of budgets.entries()) {
		if (index === 0) continue;
		assert.ok(rule.indexOf(`## ${budgets[index - 1].heading}:`) < rule.indexOf(`## ${section.heading}:`), `the order is fixed at ${section.heading}`);
	}
	assert.match(rule, /no bullet prefix/);
	// Every bound stated is in characters; a word hint is what the code does not enforce.
	assert.doesNotMatch(rule, /\b(?:below|under|at most)\s+\d[\d,]*\s+words?\b/i);
});

test("requestPluginText and its meta variant keep the error and abort semantics", async () => {
	// Regression: `max-tokens` must NOT throw — it is "content, but cut off", which the caller
	// retries. `error` and `aborted` must still throw exactly the message they always did.
	const streamOf = (chunks) => ({ llm: { stream: () => (async function* generate() { for (const chunk of chunks) yield chunk; })() } });
	const target = { provider: "p", model: "m" };

	const ok = await requestPluginTextWithMeta(streamOf([
		{ type: "text-delta", index: 0, text: "  hello  " },
		{ type: "usage", usage: { inputTokens: 1, outputTokens: 9, reasoningTokens: 4 } },
		{ type: "finish", reason: { kind: "max-tokens" } },
	]), target, 16, "prompt", undefined);
	assert.deepEqual(ok, { text: "hello", stopReason: "max-tokens", reasoningTokens: 4 }, "the meta variant reports the reason and the hidden thinking");

	// The thin wrapper keeps its old signature and returns just the text.
	const text = await requestPluginText(streamOf([{ type: "text-delta", index: 0, text: "  hi  " }, { type: "finish", reason: { kind: "stop" } }]), target, 16, "prompt", undefined);
	assert.equal(text, "hi");

	// An adapter that reports no usage leaves the reasoning count at 0 rather than NaN.
	const noUsage = await requestPluginTextWithMeta(streamOf([{ type: "text-delta", index: 0, text: "x" }, { type: "finish", reason: { kind: "stop" } }]), target, 16, "prompt", undefined);
	assert.deepEqual(noUsage, { text: "x", stopReason: "stop", reasoningTokens: 0 });

	for (const kind of ["error", "aborted"]) {
		const failure = { message: "upstream exploded", code: "boom" };
		await assert.rejects(
			() => requestPluginText(streamOf([{ type: "finish", reason: { kind, failure } }]), target, 16, "prompt", undefined),
			(error) => {
				assert.equal(error.message, "plugin model call failed (boom): upstream exploded");
				// The code must survive this boundary: routing on it is the only way a caller can tell a
				// refused request's shape from a quota or an outage, and dsh's own contract forbids
				// parsing the message. Dropping it here silently disables the tools-free fallback.
				assert.equal(error.code, "boom", "the harness failure code must ride on the thrown error");
				return true;
			},
			`${kind} must still throw`,
		);
		await assert.rejects(
			() => requestPluginTextWithMeta(streamOf([{ type: "finish", reason: { kind, failure } }]), target, 16, "prompt", undefined),
			/plugin model call failed \(boom\): upstream exploded/,
			`the meta variant must throw for ${kind} too`,
		);
	}
});

test("a plugin call forwards the tools it was offered, and only then", async () => {
	// The wiring this repo owns: `requestPluginTextWithMeta` used to drop `tools` on the floor, so a
	// caller could not offer one at all. A call that offers none must still send the same request.
	const seen = [];
	const ctx = {
		llm: {
			stream: (options) => {
				seen.push(options);
				return (async function* generate() {
					yield { type: "finish", reason: { kind: "stop" } };
				})();
			},
		},
	};
	const target = { provider: "p", model: "m" };
	const tool = { name: "record_memory", description: "d", parameters: { type: "object", properties: {}, additionalProperties: false } };

	const plain = await requestPluginTextWithMeta(ctx, target, 16, "prompt", undefined);
	assert.equal("tools" in seen[0], false, "a call with no tools sends no tools key at all");
	assert.equal("toolCalls" in plain, false, "a reply with no call carries no toolCalls key");

	await requestPluginTextWithMeta(ctx, target, 16, "prompt", undefined, { tools: [tool] });
	assert.deepEqual(seen[1].tools, [tool], "the offered tool reaches the request");

	await requestPluginTextWithMeta(ctx, target, 16, "prompt", undefined, { tools: [] });
	assert.equal("tools" in seen[2], false, "an empty tool list is the same request as no tools");
});

test("tool-call deltas assemble per block, and block-end wins", async () => {
	// Measured on the live route (see .agents/evidence/2026-10-04-record-memory-tool-probe): the first
	// delta of a block carries the tool name and an empty fragment, the rest carry fragments with
	// `name` absent, and `block-end` carries the join. Both shapes must reach the caller.
	const streamOf = (chunks) => ({
		llm: {
			stream: () =>
				(async function* generate() {
					for (const chunk of chunks) yield chunk;
				})(),
		},
	});
	const target = { provider: "p", model: "m" };
	const run = (chunks) =>
		requestPluginTextWithMeta(streamOf(chunks), target, 16, "prompt", undefined, { tools: [{ name: "record_memory", description: "d", parameters: {} }] });

	const deltasOnly = await run([
		{ type: "tool-call-delta", index: 1, id: "call_1", name: "record_memory", argumentsDelta: "" },
		{ type: "tool-call-delta", index: 1, id: "call_1", argumentsDelta: '{"a"' },
		{ type: "tool-call-delta", index: 1, id: "call_1", argumentsDelta: ":1}" },
		{ type: "finish", reason: { kind: "tool-calls" } },
	]);
	assert.deepEqual(deltasOnly.toolCalls, [{ name: "record_memory", arguments: '{"a":1}' }], "fragments join, and the name survives from the first delta");
	assert.equal(deltasOnly.stopReason, "tool-calls");

	const assembled = await run([
		{ type: "tool-call-delta", index: 1, id: "call_1", name: "record_memory", argumentsDelta: '{"a"' },
		{ type: "block-end", index: 1, block: { type: "tool-call", id: "call_1", name: "record_memory", arguments: '{"a":1}' } },
		{ type: "finish", reason: { kind: "tool-calls" } },
	]);
	assert.deepEqual(assembled.toolCalls, [{ name: "record_memory", arguments: '{"a":1}' }], "the assembled block is authoritative");

	// Blocks come back in index order, a nameless block is dropped, and a non-tool block is ignored.
	const mixed = await run([
		{ type: "tool-call-delta", index: 2, id: "c2", name: "second", argumentsDelta: "{}" },
		{ type: "tool-call-delta", index: 0, id: "c0", name: "first", argumentsDelta: "{}" },
		{ type: "block-end", index: 3, block: { type: "text", text: "not a call" } },
		{ type: "finish", reason: { kind: "tool-calls" } },
	]);
	assert.deepEqual(mixed.toolCalls?.map((call) => call.name), ["first", "second"], "stream order by index, tool blocks only");
});

test("pickToolCall separates the fail-open text path from having nothing to fall back to", () => {
	const other = [{ name: "other", arguments: "{}" }];
	assert.equal(pickToolCall([{ name: "record_memory", arguments: '{"a":1}' }], "record_memory", ""), '{"a":1}', "the accepted call's raw arguments come back");
	assert.equal(pickToolCall(other, "record_memory", "prose reply"), undefined, "another tool plus text falls open to the text parser");
	assert.equal(pickToolCall(undefined, "record_memory", ""), undefined, "no calls at all is the text parser's business");
	assert.throws(
		() => pickToolCall(other, "record_memory", "   "),
		/model called other without text; expected record_memory/,
		"another tool and no text is an error, not an empty memory",
	);
});

test("a handoff retires the session it replaced, and never mid-turn", async () => {
	// A handoff *forks*: the child is a separate session, so the session that was handed off stayed live
	// and — being active — sat above its own continuation in the workspace list. The host has no "end
	// session" RPC; retiring it means archiving it with `stopActivity` (without that flag the host
	// *refuses* a session with running work instead of stopping it). The archive only hides, so the log
	// survives and the client can undo it.
	const root = await mkdtemp(path.join(tmpdir(), "dsh-handoff-retire-"));
	const conversation = Array.from({ length: 40 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", "x".repeat(1500)));
	const archived = [];
	const handlers = {};
	const commands = new Map();
	const model = noModelCalls();
	const session = {
		id: `session-retire-${Math.random().toString(16).slice(2, 10)}`,
		header: { cwd: root, createdAt: Date.now() },
		deriveMessages: () => conversation,
		requestHeader: () => undefined,
		ownEvents: () => [],
		snapshotEvents: () => [],
	};
	const ctx = {
		on: (name, handler) => { (handlers[name] ??= []).push(handler); return () => undefined; },
		effect: () => () => undefined,
		inject: () => () => undefined,
		commands: { register: (command) => { commands.set(command.name, command); return () => undefined; } },
		logger: { info: () => undefined, warn: () => undefined },
		get: (name) => (name === "sessionController" ? {
			create: async () => ({ sessionId: "child-1" }),
			rename: async () => undefined,
		} : name === "agents" ? { get: () => ({ followup: () => undefined }) } : name === "workspaceRegistry" ? {
			resolveByPath: async () => undefined,
			archiveSession: async (id, options) => { archived.push([id, options?.stopActivity === true]); },
		} : undefined),
		llm: {
			resolveModelInfo: async () => ({ context: { contextWindow: 200_000 } }),
			stream: model.stream,
		},
	};
	apply(ctx, { provider: "test-provider", model: "test-model", handoffBudgetRecentTokens: 0 });
	const listener = handlers["session/event"]?.[0];
	assert.ok(listener, "apply registers a session/event listener");

	const reply = await commands.get("handoff").handler({ agent: { session }, rawInput: "now", signal: new AbortController().signal });
	assert.equal(reply.kind, "success", `expected the manual handoff to run: ${JSON.stringify(reply)}`);
	// The command runs inside its own turn: archiving with `stopActivity` here would stop the very turn
	// rendering this reply, so the retirement waits for that turn's end.
	assert.deepEqual(archived, [], "nothing is archived while the parent's own turn is still open");
	assert.ok(pendingRetire.has(String(session.id)), "the retirement is scheduled for that turn's end");

	// The turn ends: the session it replaced is stopped and archived, and the child never is.
	listener(session, { type: "turn/end", seq: 7, time: Date.now() });
	assert.deepEqual(archived, [[String(session.id), true]], "the handed-off session is stopped and archived once its turn ends");
	assert.ok(!pendingRetire.has(String(session.id)), "the retirement is consumed rather than retried");

	// One-shot: a later turn/end must not archive it again.
	listener(session, { type: "turn/end", seq: 8, time: Date.now() });
	model.assertNone("the retirement path");
	assert.equal(archived.length, 1, "retiring is one-shot");
});

test("the session index names the lines its cap drops", async () => {
	// The index is capped at 200 lines. The dropped archives stay on disk, but the index is the only
	// navigation autolearn and the handoff pointers have, so a silent drop reads as "that session never
	// existed" — the document has to say so, in a form the parser cannot mistake for an entry.
	const project = await mkdtemp(path.join(tmpdir(), "dsh-index-cap-"));
	const total = 205;
	for (let index = 0; index < total; index += 1) {
		const id = `capped-${String(index).padStart(3, "0")}`;
		const day = String((index % 27) + 1).padStart(2, "0");
		await queueIndexLine(project, id, `- [${id}](session-logs/${id}/session.md) — 2026-08-${day} — Capped ${index}`);
	}
	const document = await readFile(sessionIndexFile(project), "utf8");
	const entries = parseSessionIndex(document);
	assert.equal(entries.length, 200, `the cap keeps 200 entries, got ${entries.length}`);
	assert.match(document, /<!-- 5 older sessions dropped from this index by the 200-line cap; their archives remain in session-logs\/ -->/);
	// The marker is a comment, not an entry: the parser must not see it as a session.
	assert.ok(!entries.some((entry) => String(entry.id ?? "").includes("older sessions")), "the comment is not parsed as an entry");
	// And the newest session survived the cap.
	assert.ok(entries.some((entry) => String(entry.id ?? "").includes("capped-204")), "the newest entry is kept");

	// The count is cumulative, not "one per write": every write re-reads an already-capped document, so
	// without carrying the previous number forward the marker would always claim a single drop.
	await queueIndexLine(project, "capped-205", "- [capped-205](session-logs/capped-205/session.md) — 2026-08-28 — Capped 205");
	await queueIndexLine(project, "capped-206", "- [capped-206](session-logs/capped-206/session.md) — 2026-08-29 — Capped 206");
	const carried = await readFile(sessionIndexFile(project), "utf8");
	assert.match(carried, /<!-- 7 older sessions dropped/, "the dropped count is carried forward");
	assert.equal((carried.match(/older session/g) ?? []).length, 1, "the marker is replaced, not accumulated");
	assert.equal(parseSessionIndex(carried).length, 200, "the marker never becomes an entry");
});
