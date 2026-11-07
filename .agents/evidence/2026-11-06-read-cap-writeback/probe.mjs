#!/usr/bin/env node
/**
 * Reproduce the read-cap write-back loss, offline, against the built `lib/` (the code the host loads).
 *
 * Setup: a stored MEMORY.md longer than `maxMemoryChars`. `loadMemory(root, cap)` caps the read, so the
 * consolidation pass is shown only the head of the document. This probe drives the real pass with a
 * fixture reply that re-emits the view it was shown, and then reads the stored document back:
 *
 *  - today: the write lands, and every character the read cap kept back is gone from disk;
 *  - with the guard: the pass refuses before the model call, and MEMORY.md stays byte-identical.
 *
 * Read-only against the repo; writes only inside a mkdtemp directory.
 *
 * Usage: node /tmp/read-cap-writeback-probe.mjs [repo-root]
 * Exit: 0 = a lossless outcome (guard present, or nothing lost), 1 = the stored tail was deleted.
 */

import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repo = path.resolve(process.argv[2] ?? process.cwd());
const load = (rel) => import(pathToFileURL(path.join(repo, "lib", rel)).href);

const { loadMemory } = await load("project-memory/memory-store.js");
const { consolidateProjectState } = await load("project-memory/consolidate.js");
const { consolidateProject } = await load("project-memory/index.js");
const { resolvePluginConfig } = await load("shared/config.js");

const CAP = 4000;
/** Four sections, one entry per line, comfortably over the cap: the tail is what the cap hides. */
function storedDocument() {
	const section = (heading, tag, count) =>
		[`## ${heading}`, ...Array.from({ length: count }, (_, i) => `- ${tag}${String(i).padStart(3, "0")} ${"字".repeat(90)}`)].join("\n");
	return `# Project Memory\n\n${section("Project", "PROJ", 16)}\n\n${section("Invariants", "INV", 16)}\n\n${section("Pitfalls", "PIT", 16)}\n\n${section("Index", "IDX", 16)}\n`;
}

/**
 * What a model shown only the capped view plausibly re-emits: the entries it can see, re-rendered as
 * the required four-section document (a section the cap hid becomes an empty heading, which is what
 * the prompt's schema asks for). This is the honest model, not a hostile one.
 */
const viewReply = (shown) => {
	const headings = ["Project", "Invariants", "Pitfalls", "Index"];
	const body = shown.split("\n").filter((line) => !/^_\[memory truncated/.test(line)).join("\n").trimEnd();
	const missing = headings.filter((heading) => !body.includes(`## ${heading}`));
	const document = missing.length === 0 ? body : `${body}\n\n${missing.map((heading) => `## ${heading}`).join("\n\n")}\n`;
	return JSON.stringify({
		memory_markdown: document,
		context: { title: "t", summary: "s", key_points: [], open_tasks: [] },
	});
};

const root = await mkdtemp(path.join(tmpdir(), "read-cap-writeback-"));
await mkdir(path.join(root, ".agents", "memory"), { recursive: true });
const file = path.join(root, ".agents", "memory", "MEMORY.md");
const stored = storedDocument();
await writeFile(file, stored, "utf8");

const config = resolvePluginConfig({ maxTokens: 8192, maxOutputTokens: 32_768, consolidateTurns: 1, maxMemoryChars: CAP });

const shownViews = [];
const ctx = {
	logger: { info() {}, warn() {} },
	llm: {
		stream(options) {
			const prompt = options.messages[0].content.map((block) => block.text ?? "").join("\n");
			const shown = /<existing-memory>\n([\s\S]*?)\n<\/existing-memory>/.exec(prompt)[1];
			shownViews.push(shown);
			return (async function* generate() {
				yield { type: "text-delta", text: viewReply(shown) };
			})();
		},
	},
};
const agent = {
	options: { provider: "test-provider", model: "test-model" },
	session: {
		id: "session-read-cap",
		header: { cwd: root, createdAt: Date.now() },
		snapshotEvents: () => [],
		deriveMessages: () => [],
		requestHeader: () => undefined,
	},
};

const loaded = await loadMemory(root, CAP);
const hidden = loaded.cappedDroppedChars;
console.log(`stored ${stored.trimEnd().length} chars, cap ${CAP}, the pass is shown ${loaded.text.length}, hidden ${hidden}`);
if (hidden === 0) {
	console.log("UNREACHABLE: the fixture is not over the cap");
	process.exit(2);
}

const outcome = await consolidateProjectState(ctx, agent, config, { force: true });
// `outcome.clipped` and the two pass-level hidden counts were removed once both input gates started
// refusing before the model call: past them they could only ever be zero/false (2026-11-07,
// commit 49083b7). The refusal payload carries the counts instead, so read them from there.
const readCapped = outcome.readCappedRefused;
const hiddenTotal = readCapped === undefined ? 0 : readCapped.memoryHiddenChars + readCapped.contextHiddenChars;
console.log(`calls ${shownViews.length}; refusal ${readCapped === undefined ? "none" : `read-capped at cap ${readCapped.cap}`}; hidden ${hiddenTotal}; memoryLossyRefused ${outcome.memoryLossyRefused}`);
if (shownViews.length === 0) console.log("no model call: the pass refused before spending one");
if (shownViews.length > 0) {
	const sent = shownViews[0];
	const tailMarker = sent.includes("IDX");
	console.log(`the view the model was shown contains the Index section: ${tailMarker}`);
}

const report = await consolidateProject(ctx, config, agent, { force: true, silent: true });
console.log(`status ${report.status}; memoryWritten ${report.memoryWritten}; refusedLoss ${JSON.stringify(report.refusedLoss ?? null)}`);

const after = await readFile(file, "utf8");
const byteIdentical = after === stored;
const tailSurvived = after.includes("IDX007") && after.includes("PIT007");
console.log(`MEMORY.md byte-identical: ${byteIdentical}; tail (IDX007/PIT007) survived: ${tailSurvived}; stored now ${after.length} chars`);
await import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true }));
console.log(byteIdentical && tailSurvived ? "RESULT: LOSSLESS" : "RESULT: TAIL DELETED");
process.exit(byteIdentical && tailSurvived ? 0 : 1);
