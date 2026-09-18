/**
 * Tests for the durable memory store: the append-only journal, the rendered MEMORY.md, the
 * backup-before-overwrite rule, the stored-reply decoder and the cross-process write lock.
 *
 * Ported with the feature from the pi sibling's `tests/consolidation-test.mjs`; the cases below
 * mirror its coverage so a regression on either side is visible here too.
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	MEMORY_LOCK_STALE_MS,
	MEMORY_LOCK_WAIT_MS,
	appendMemoryOp,
	backupMemoryBeforeWrite,
	foldMemoryJournal,
	importLegacyMemory,
	loadMemory,
	loadMemorySync,
	memoryJournalFile,
	normalizeMemoryDocument,
	readMemoryJournal,
	recordMemoryDocument,
	withMemoryLock,
} from "../lib/shared/memory-store.js";
import { legacyOmpDir, logError, memoryFile } from "../lib/shared/project-state.js";
import { consolidateProject } from "../lib/memory.js";
import { consolidateProjectState } from "../lib/shared/learn.js";
import { DEFAULT_CONFIG, resolvePluginConfig } from "../lib/shared/config.js";

/** A project root with the memory directory present. */
async function project() {
	const root = await mkdtemp(path.join(tmpdir(), "dsh-memory-"));
	await mkdir(path.join(root, ".agents", "memory"), { recursive: true });
	return root;
}

test("the journal folds replace and append records in order", () => {
	const entries = [
		{ op: "replace", text: "# Project Memory\n\nfirst" },
		{ op: "append", text: "second" },
		{ op: "append", text: "third" },
	];
	const folded = foldMemoryJournal(entries);
	assert.match(folded, /^# Project Memory\n\nfirst\n\nsecond\n\nthird\n$/);
	// A later replace supersedes everything before it.
	assert.equal(foldMemoryJournal([...entries, { op: "replace", text: "final" }]), "# Project Memory\n\nfinal\n");
	assert.equal(foldMemoryJournal([]), "");
});

test("appendMemoryOp appends one record per call and repairs a torn tail", async () => {
	const root = await project();
	const journal = memoryJournalFile(root);
	await appendMemoryOp(journal, "replace", "one");
	await appendMemoryOp(journal, "append", "two");
	assert.deepEqual((await readMemoryJournal(journal)).entries.map((entry) => entry.text), ["one", "two"]);

	// A crash can leave a partial last line; the next append must terminate it instead of gluing
	// its own record onto the fragment.
	await writeFile(journal, `${await readFile(journal, "utf8")}{"op":"rep`, "utf8");
	await appendMemoryOp(journal, "append", "three");
	const after = await readMemoryJournal(journal);
	assert.equal(after.unreadable, false);
	assert.equal(after.damaged, 1, "the torn fragment is counted, not silently merged");
	assert.deepEqual(after.entries.map((entry) => entry.text), ["one", "two", "three"]);
});

test("an unreadable journal fails closed instead of falling back to the render", async () => {
	const root = await project();
	await writeFile(memoryFile(root), "# Project Memory\n\nfrom the render\n");
	await writeFile(memoryJournalFile(root), "not json at all\n", "utf8");

	const loaded = await loadMemory(root);
	assert.equal(loaded.unreadable, true, "content that yields no record must not be shown as empty");
	assert.equal(loaded.text, "");
	assert.equal(loaded.source, memoryJournalFile(root));
});

test("loadMemory decodes a stored JSON reply left by the old bug", async () => {
	const root = await project();
	const reply = `\`\`\`json\n{"memory_markdown":"# Project Memory\\n\\n- durable fact","context":{"title":"t"}}\n\`\`\``;
	await writeFile(memoryFile(root), reply, "utf8");

	const loaded = await loadMemory(root);
	assert.equal(loaded.poisoned, true);
	assert.match(loaded.text, /durable fact/);
	assert.doesNotMatch(loaded.text, /memory_markdown/);

	// A documented example inside a real document is not a stored reply.
	const documented = "# Project Memory\n\nsee the sample:\n\n```json\n{\"memory_markdown\":\"# Project Memory\"}\n```\n";
	await writeFile(memoryFile(root), documented, "utf8");
	const kept = await loadMemory(root);
	assert.equal(kept.poisoned, false, "a nested example must not be decoded");
	assert.match(kept.text, /see the sample/);
});

test("recordMemoryDocument seeds the journal from the memory a project already has", async () => {
	const root = await project();
	await writeFile(memoryFile(root), "# Project Memory\n\nlegacy line\n", "utf8");

	await recordMemoryDocument(root, "new line");
	const journal = await readMemoryJournal(memoryJournalFile(root));
	assert.deepEqual(journal.entries.map((entry) => entry.op), ["replace", "replace"]);
	assert.match(journal.entries[0].text, /legacy line/, "the pre-journal document becomes the base record");
	assert.match(journal.entries[1].text, /new line/);
	// The render is derived from the last record and the directory ignores its local artifacts.
	assert.equal(await readFile(memoryFile(root), "utf8"), "# Project Memory\n\nnew line\n");
	assert.match(await readFile(path.join(root, ".agents", "memory", ".gitignore"), "utf8"), /memory\.jsonl/);

	// The journal (not the render) is what a reader gets.
	const loaded = await loadMemory(root);
	assert.match(loaded.text, /new line/);
	assert.equal(loaded.source, memoryJournalFile(root));
});

test("an external edit wins the read and is adopted into the journal on the next write", async () => {
	const root = await project();
	await recordMemoryDocument(root, "written by the plugin");
	const journal = memoryJournalFile(root);
	// Backdate the journal so the hand edit is unambiguously newer.
	const past = new Date(Date.now() - 60_000);
	await utimes(journal, past, past);
	await writeFile(memoryFile(root), "# Project Memory\n\nedited by hand\n", "utf8");

	const loaded = await loadMemory(root);
	assert.match(loaded.text, /edited by hand/, "a newer, different render is an external edit");
	assert.equal(loaded.source, memoryFile(root));

	await recordMemoryDocument(root, "after the edit");
	const entries = (await readMemoryJournal(journal)).entries;
	assert.equal(entries.length, 3, "the edit entered the journal before the new document");
	assert.match(entries[1].text, /edited by hand/);
	assert.match((await loadMemory(root)).text, /after the edit/);
	assert.match(await readFile(path.join(root, ".agents", "memory", "errors.log"), "utf8"), /externally edited/);
});

test("loadMemorySync folds the same document the async reader returns", async () => {
	const root = await project();
	await recordMemoryDocument(root, "sync and async agree");
	assert.equal(loadMemorySync(root), (await loadMemory(root)).text);

	// A render that never reached disk (crash between append and render) must not hide the record.
	await appendMemoryOp(memoryJournalFile(root), "replace", "only in the journal");
	assert.match(loadMemorySync(root), /only in the journal/);
	assert.match((await loadMemory(root)).text, /only in the journal/);

	// With no journal at all the rendered document is still readable, poison decoded.
	const legacy = await project();
	await writeFile(memoryFile(legacy), "# Project Memory\n\nlegacy only\n", "utf8");
	assert.match(loadMemorySync(legacy), /legacy only/);
	assert.equal(loadMemorySync(await project()), "");
});

test("loadMemorySync folds a journal whose render is missing, and fails closed on a corrupt one", async () => {
	// The append lands before the render does, so a crash in that window (or a hand-deleted
	// MEMORY.md) leaves records that only the journal holds. Losing them here would silently drop
	// the project's memory from the system prompt.
	const root = await project();
	await recordMemoryDocument(root, "journal only");
	await rm(memoryFile(root));
	assert.match(loadMemorySync(root), /journal only/);
	assert.equal(loadMemorySync(root), (await loadMemory(root)).text);

	// A torn tail is skipped record-by-record, so the good records still beat a stale render.
	await writeFile(memoryFile(root), "# Project Memory\n\nstale render\n", "utf8");
	await writeFile(memoryJournalFile(root), `${await readFile(memoryJournalFile(root), "utf8")}{"op":"rep`, "utf8");
	assert.match(loadMemorySync(root), /journal only/);
	assert.doesNotMatch(loadMemorySync(root), /stale render/);
	assert.equal(loadMemorySync(root), (await loadMemory(root)).text);

	// Nothing usable at all: fail closed instead of injecting a render the journal superseded.
	const corrupt = await project();
	await writeFile(memoryFile(corrupt), "# Project Memory\n\nstale render\n", "utf8");
	await writeFile(memoryJournalFile(corrupt), "not a journal at all\n", "utf8");
	assert.equal(loadMemorySync(corrupt), "");
	assert.equal((await loadMemory(corrupt)).text, "");
});

test("an unreadable render fails closed in both readers", async () => {
	const root = await project();
	// A directory where the render belongs: it exists, and it cannot be read.
	await mkdir(memoryFile(root), { recursive: true });
	await mkdir(path.join(root, ".pi"), { recursive: true });
	await writeFile(path.join(root, ".pi", "MEMORY.md"), "# Project Memory\n\npi legacy\n", "utf8");

	assert.equal((await loadMemory(root)).unreadable, true, "the async reader reports it");
	assert.equal(loadMemorySync(root), "", "and the sync reader must not serve the legacy file instead");
});

test("the legacy .omp import never overrides a journal, and the sync reader reads it", async () => {
	// `legacyOmpDir` resolves against the home directory at call time, so point HOME at a fixture.
	const home = await mkdtemp(path.join(tmpdir(), "dsh-home-"));
	const previousHome = process.env.HOME;
	process.env.HOME = home;
	try {
		const root = await project();
		await mkdir(legacyOmpDir(root), { recursive: true });
		await writeFile(path.join(legacyOmpDir(root), "MEMORY.md"), "# Project Memory\n\nlegacy omp\n", "utf8");
		// Nothing owns the project yet: the sync reader injects the legacy document.
		assert.match(loadMemorySync(root), /legacy omp/);

		// Once a journal exists, the legacy file must never be imported over it — even when the
		// render is gone (which is when an unguarded import would look like an external edit).
		await recordMemoryDocument(root, "consolidated memory");
		await rm(memoryFile(root), { force: true });
		assert.equal(await importLegacyMemory(root), false, "the journal owns the memory");
		assert.match((await loadMemory(root)).text, /consolidated memory/);

		// A fresh project with no journal does import it.
		const fresh = await project();
		await mkdir(legacyOmpDir(fresh), { recursive: true });
		await writeFile(path.join(legacyOmpDir(fresh), "MEMORY.md"), "# Project Memory\n\nlegacy omp\n", "utf8");
		assert.equal(await importLegacyMemory(fresh), true);
		assert.match((await loadMemory(fresh)).text, /legacy omp/);
	} finally {
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		await rm(home, { recursive: true, force: true });
	}
});

test("a failed pass releases its version claim so the next forced pass retries", async () => {
	const root = await project();
	// Make the memory write fail for good: the render path is a directory.
	await mkdir(memoryFile(root), { recursive: true });
	const reply = JSON.stringify({ memory_markdown: `# Project Memory\n\n${"x".repeat(200)}`, context: { title: "t", summary: "s", key_points: [], open_tasks: [] } });
	const ctx = {
		logger: { info() {}, warn() {} },
		llm: {
			stream() {
				return (async function* generate() {
					yield { type: "text-delta", text: reply };
				})();
			},
		},
	};
	const agent = {
		options: { provider: "test-provider", model: "test-model" },
		session: { id: "session-claim", header: { cwd: root, createdAt: Date.now() }, snapshotEvents: () => [], deriveMessages: () => [], requestHeader: () => undefined },
	};
	// Keep the default force-dedupe window: the second forced pass then reuses the *cached*
	// outcome (same version), which is exactly the case the release protects.
	const config = resolvePluginConfig({ maxTokens: 8192 });

	assert.equal(await consolidateProject(ctx, config, agent, { force: true, silent: true }), "failed");
	// Without the release this would answer "deduped" — a false "already up to date" after a write
	// that never landed.
	assert.notEqual(await consolidateProject(ctx, config, agent, { force: true, silent: true }), "deduped");
});

test("a malformed model reply cannot leak credentials into the logs", async () => {
	// `replyHead` embeds the reply the model actually sent, and the consolidation failure is
	// reported twice from the same thrown error: `errors.log` (redacted on the append path) and
	// `ctx.logger.warn`, which writes whatever it is handed. Before this test the console copy was
	// verbatim, so one bad reply printed the credentials it contained.
	const root = await project();
	const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signaturepart";
	const key = "sk-abcdefghijklmnop";
	const warnings = [];
	const ctx = {
		logger: { info() {}, warn: (format, ...args) => { warnings.push(`${format} ${args.join(" ")}`); } },
		llm: {
			stream() {
				return (async function* generate() {
					// JSON-looking but truncated: `looksLikeJsonReply` is true, the parse fails, and the
					// reply holds no recoverable `memory_markdown` field, so the pass throws with the raw
					// reply attached — the credential-bearing path. (A plain non-JSON reply is accepted
					// as Markdown memory by design, so it never reaches this error.)
					yield { type: "text-delta", text: `{\n"context": {"apiKey": "${key}"},\n"raw": "authorization: Bearer ${jwt}"` };
				})();
			},
		},
	};
	const agent = {
		options: { provider: "test-provider", model: "test-model" },
		session: { id: "session-redact", header: { cwd: root, createdAt: Date.now() }, snapshotEvents: () => [], deriveMessages: () => [], requestHeader: () => undefined },
	};
	const config = resolvePluginConfig({ maxTokens: 8192 });

	assert.equal(await consolidateProject(ctx, config, agent, { force: true, silent: false }), "failed");
	assert.equal(warnings.length, 1, `expected one warning, got ${JSON.stringify(warnings)}`);

	// The console is the unguarded sink: mask and bound there.
	assert.ok(!warnings[0].includes(jwt), "the JWT must not reach the console");
	assert.ok(!warnings[0].includes(key), "the key must not reach the console");
	assert.match(warnings[0], /\[redacted/);
	assert.ok(warnings[0].length < 1000, `the console line must stay bounded, got ${warnings[0].length} chars`);

	// The file sink keeps the raw head for diagnosis, but never the credential itself.
	const logged = await readFile(path.join(root, ".agents", "memory", "errors.log"), "utf8");
	assert.ok(!logged.includes(jwt), "the JWT must not reach errors.log");
	assert.ok(!logged.includes(key), "the key must not reach errors.log");
	assert.match(logged, /--- raw reply ---/, "the raw reply is still attached for diagnosis");
});

test("the console copy of a failure is redacted even when its source is not", async () => {
	// The console sink must hold on its own: `ctx.logger.warn` is handed error text from paths whose
	// source is not redacted (a filesystem path, a lock error), so this drives one of those through
	// the real pass rather than relying on the redaction `replyHead` already applied upstream.
	const key = "sk-abcdefghijklmnop";
	// A credential in the project path reaches the logger verbatim: the failing write reports the
	// path it could not open ("ENOTDIR: …/.agents/memory/MEMORY.md.lock") and no upstream layer
	// masks a path.
	const dir = await mkdtemp(path.join(tmpdir(), `dsh-${key}-`));
	// `.agents` as a regular file makes every write under it fail with the full path in the message.
	await writeFile(path.join(dir, ".agents"), "not a directory", "utf8");
	const warnings = [];
	const ctx = {
		logger: { info() {}, warn: (format, ...args) => { warnings.push(`${format} ${args.join(" ")}`); } },
		llm: {
			stream() {
				return (async function* generate() {
					yield { type: "text-delta", text: JSON.stringify({ memory_markdown: `# Project Memory\n\n${"x".repeat(200)}` }) };
				})();
			},
		},
	};
	const agent = {
		options: { provider: "test-provider", model: "test-model" },
		session: { id: "session-path-redact", header: { cwd: dir, createdAt: Date.now() }, snapshotEvents: () => [], deriveMessages: () => [], requestHeader: () => undefined },
	};
	const config = resolvePluginConfig({ maxTokens: 8192 });

	assert.equal(await consolidateProject(ctx, config, agent, { force: true, silent: false }), "failed");
	assert.equal(warnings.length, 1, `expected one warning, got ${JSON.stringify(warnings)}`);
	assert.ok(warnings[0].includes(".agents/memory"), "the failure is the memory write, not something else");
	assert.ok(!warnings[0].includes(key), "the console sink must mask a secret it was not given masked");
	assert.match(warnings[0], /\[redacted-key\]/);
});

test("the consolidation prompt sends the fitted, clipped artifacts", async () => {
	// The budget only matters if it reaches the model call. The artifacts are already capped on
	// read (24k memory / 32k context chars), so the trigger is *dense* content: CJK costs about a
	// token per character and 56k characters cannot fit a 32,768-token reply.
	const root = await project();
	const memory = `# Project Memory\n\n${"记".repeat(60_000)}\n`;
	await writeFile(memoryFile(root), memory, "utf8");
	await writeFile(path.join(root, ".agents", "memory", "CONTEXT.md"), `# Project Context\n\n${"录".repeat(60_000)}\n`, "utf8");

	const calls = [];
	const ctx = {
		logger: { info() {}, warn() {} },
		llm: {
			stream(options) {
				calls.push(options);
				return (async function* generate() {
					yield { type: "text-delta", text: '{"memory_markdown":"# Project Memory\\n\\nshort","context":{"title":"t","summary":"s","key_points":[],"open_tasks":[]}}' };
				})();
			},
		},
	};
	const agent = {
		options: { provider: "test-provider", model: "test-model" },
		session: {
			id: "session-consolidate",
			header: { cwd: root, createdAt: Date.now() },
			snapshotEvents: () => [],
			deriveMessages: () => [],
			requestHeader: () => undefined,
		},
	};
	const config = resolvePluginConfig({ maxTokens: 8192, maxOutputTokens: 32_768, consolidateTurns: 1 });

	const outcome = await consolidateProjectState(ctx, agent, config, { force: true });

	assert.equal(calls.length, 1, "one model call");
	const prompt = calls[0].messages[0].content.map((block) => block.text ?? "").join("\n");
	assert.equal(outcome.clipped, true, "the oversized input is reported as clipped");
	const sent = /<existing-memory>\n([\s\S]*?)\n<\/existing-memory>/.exec(prompt)[1];
	assert.ok(sent.length < 24_000, `the prompt carries ${sent.length} of the 24000-char memory budget`);
	assert.ok(calls[0].maxTokens > config.maxTokens, "the adaptive cap was raised to fit the reply");
	assert.ok(calls[0].maxTokens <= config.maxOutputTokens, "and stayed inside the configured ceiling");
});

test("the sync reader falls back to legacy layouts, and the locked import respects a journal", async () => {
	const root = await project();
	await mkdir(path.join(root, ".pi"), { recursive: true });
	await writeFile(path.join(root, ".pi", "MEMORY.md"), "# Project Memory\n\npi legacy\n", "utf8");

	// The synchronous reader (prompt injection) falls back exactly like the asynchronous one.
	assert.match(loadMemorySync(root), /pi legacy/);
	assert.match((await loadMemory(root)).text, /pi legacy/);

	// The legacy `.omp` import holds the lock and refuses to run once the journal owns the project.
	await recordMemoryDocument(root, "consolidated");
	assert.equal(await importLegacyMemory(root), false, "a journal already owns the memory");
	assert.match((await loadMemory(root)).text, /consolidated/);
});

test("logError also writes the memory ignore file and redacts credentials", async () => {
	const root = await project();
	await logError(root, "test", new Error("failed with sk-abcdefghijklmnop and ghp_abcdefghijklmnop"));

	const directory = path.join(root, ".agents", "memory");
	assert.ok((await readdir(directory)).includes(".gitignore"), "logging alone creates the ignore file");
	assert.match(await readFile(path.join(directory, ".gitignore"), "utf8"), /errors\.log/);
	const logged = await readFile(path.join(directory, "errors.log"), "utf8");
	assert.doesNotMatch(logged, /sk-abcdefghijklmnop/, "the credential is masked");
	assert.doesNotMatch(logged, /ghp_abcdefghijklmnop/);
	assert.match(logged, /\[redacted/);
});

test("backupMemoryBeforeWrite keeps the exact bytes and flags a stored reply", async () => {
	const root = await project();
	const target = memoryFile(root);
	await writeFile(target, "# Project Memory\n\noriginal\n", "utf8");

	const kept = await backupMemoryBeforeWrite(target);
	assert.equal(kept.poisoned, false);
	assert.ok(kept.path);
	assert.equal(await readFile(kept.path, "utf8"), "# Project Memory\n\noriginal\n");

	const poisoned = await project();
	await writeFile(memoryFile(poisoned), '```json\n{"memory_markdown":"# Project Memory\\n\\nx"}\n```\n', "utf8");
	assert.equal((await backupMemoryBeforeWrite(memoryFile(poisoned))).poisoned, true);

	// Nothing to keep is not an error.
	assert.deepEqual(await backupMemoryBeforeWrite(path.join(await project(), "MEMORY.md")), { poisoned: false });
});

test("backup pruning keeps the newest few and never a user file", async () => {
	const root = await project();
	const target = memoryFile(root);
	await writeFile(target, "current\n", "utf8");
	const directory = path.dirname(target);
	const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
	for (let index = 0; index < 9; index += 1) {
		const name = `MEMORY.md.memory-backup-2026-01-0${index}T00-00-00-000Z-${String(index).repeat(8)}`;
		await writeFile(path.join(directory, name), `old ${index}\n`, "utf8");
		await utimes(path.join(directory, name), old, old);
	}
	// A user file that merely looks similar must survive.
	await writeFile(path.join(directory, "MEMORY.md.memory-backup-notes.md"), "mine\n", "utf8");

	await backupMemoryBeforeWrite(target);

	const names = await readdir(directory);
	const generated = names.filter((name) => /^MEMORY\.md\.memory-backup-\d{4}-/.test(name));
	assert.equal(generated.length, 5, `kept ${generated.join(", ")}`);
	assert.ok(names.includes("MEMORY.md.memory-backup-notes.md"), "an unrelated file is never pruned");
});

test("withMemoryLock serializes writers and steals a stale lock", async () => {
	const root = await project();
	const target = memoryFile(root);
	const events = [];
	let releaseFirst;
	let firstLocked;
	const held = new Promise((resolve) => { releaseFirst = resolve; });
	const acquired = new Promise((resolve) => { firstLocked = resolve; });
	const first = withMemoryLock(target, async () => {
		events.push("first:start");
		firstLocked();
		await held;
		events.push("first:end");
	});
	// Wait until the first writer actually owns the lock, then start the second.
	await acquired;
	const second = withMemoryLock(target, async () => {
		events.push("second:start");
		events.push("second:end");
	});
	releaseFirst();
	await Promise.all([first, second]);
	assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"], "the second writer waits for the first");
	assert.equal(existsSync(`${target}.lock`), false, "the lock is released");
	assert.equal(existsSync(`${target}.lock.steal`), false, "the claim is released");

	// A lock left by a crashed writer is stolen once it is older than any live write.
	await writeFile(`${target}.lock`, "999-dead\n", { mode: 0o600 });
	const old = new Date(Date.now() - 60_000);
	await utimes(`${target}.lock`, old, old);
	let ran = false;
	await withMemoryLock(target, async () => {
		ran = true;
	});
	assert.equal(ran, true, "a stale lock does not block the write forever");
	assert.equal(existsSync(`${target}.lock`), false);
});

test("an oversized journal collapses into one record and archives the previous bytes", async () => {
	const root = await project();
	const journal = memoryJournalFile(root);
	const body = "x".repeat(1_000);
	for (let index = 0; index < 600; index += 1) await appendMemoryOp(journal, "append", `${body}${index}`);
	assert.ok((await stat(journal)).size > 512 * 1024, "the journal grew past the rotation threshold");

	await recordMemoryDocument(root, "collapsed");

	const entries = (await readMemoryJournal(journal)).entries;
	assert.ok(entries.length <= 2, `journal collapsed to ${entries.length} record(s)`);
	const archives = (await readdir(path.dirname(journal))).filter((name) => /^memory-log-.*\.jsonl$/.test(name));
	assert.equal(archives.length, 1, "the previous bytes are archived, not deleted");
	assert.ok((await readFile(path.join(path.dirname(journal), archives[0]), "utf8")).length > 0);
});

test("normalizeMemoryDocument rebuilds one canonical document", () => {
	assert.equal(normalizeMemoryDocument("```markdown\n# Project Memory\n\nbody\n```"), "# Project Memory\n\nbody\n");
	assert.equal(normalizeMemoryDocument("body only"), "# Project Memory\n\nbody only\n");
	assert.equal(normalizeMemoryDocument(""), "# Project Memory\n");
	// The cap keeps the document inside the injection budget.
	const huge = normalizeMemoryDocument("y".repeat(100_000));
	assert.ok(huge.length <= 24_000 + "# Project Memory\n\n".length);
});

test("the lock waiter outlives the staleness horizon", () => {
	// A lock is only stealable once it is older than the staleness horizon, so a wait shorter than
	// that horizon would make a pass fail for the rest of the window instead of taking the abandoned
	// lock over. This pins the production relationship; the behavior is exercised below.
	assert.ok(MEMORY_LOCK_WAIT_MS > MEMORY_LOCK_STALE_MS, `wait ${MEMORY_LOCK_WAIT_MS} must exceed stale ${MEMORY_LOCK_STALE_MS}`);
});

test("an orphaned lock is stolen past the horizon and left alone before it", async () => {
	const root = await project();
	const target = memoryFile(root);
	const lock = `${target}.lock`;
	let ran = 0;

	// Younger than the horizon: the writer waits its budget out and fails rather than stealing.
	await writeFile(lock, "orphan-token");
	const young = new Date(Date.now() - 20);
	await utimes(lock, young, young);
	await assert.rejects(() => withMemoryLock(target, async () => { ran += 1; }, { staleMs: 5_000, waitMs: 150 }), /timed out waiting for the memory write lock/);
	assert.equal(ran, 0, "a lock inside the horizon is never stolen");

	// Older than the horizon: the same orphan is taken over and the write goes through.
	const old = new Date(Date.now() - 200);
	await utimes(lock, old, old);
	const result = await withMemoryLock(target, async () => { ran += 1; return "written"; }, { staleMs: 50, waitMs: 2_000 });
	assert.equal(result, "written");
	assert.equal(ran, 1, "the abandoned lock is stolen instead of failing the pass");
});
