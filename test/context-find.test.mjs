/**
 * `/context find` — the read-only search surface.
 *
 * Two halves, both pinned here because each fails invisibly on its own:
 *  - the **core** (`search.ts`) ranks and budgets a plain corpus. The rank order is the command's
 *    promise (whole query, then all terms, then any term), CJK needs the bigram fallback, and ASCII
 *    needs word boundaries — without that last one `find cat` reports every `catalog`.
 *  - the **wiring** (`search-source.ts` + the command) reads the real `.agents/memory` layout. The
 *    fixture writes actual files and drives the real `apply()`, so the cases prove the paths, the
 *    line numbers and the recent-session window against disk rather than against a hand-made DTO.
 *
 * The read-only claim is pinned mechanically: `treeSnapshot` compares every file's bytes before and
 * after a query, which no cache file, journal line or accidental index write could survive.
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { renderSearchReport, search } from "../lib/project-context/search.js";
import { DEFAULT_RECENT_SESSIONS } from "../lib/project-context/search-source.js";
import { fakeAgent, memoryRoot, treeSnapshot, withContext, writeMemory, writeSession } from "./context-fixtures.mjs";

/** One corpus document with no line filtering. */
function doc(lines, { path = ".agents/memory/MEMORY.md", age = 0 } = {}) {
	return { path, age, lines };
}

test("the whole query outranks all terms, and all terms outrank one", () => {
	const corpus = [doc([
		"- alpha only",
		"- alpha and beta far apart",
		"- the alpha beta phrase",
	])];
	const result = search(corpus, "alpha beta");
	assert.equal(result.kind, "hits");
	assert.deepEqual(result.hits.map((hit) => hit.score), [3, 2, 1], "phrase, then all terms, then any term");
	assert.deepEqual(result.hits.map((hit) => hit.line), [3, 2, 1], "the phrase line comes first");
	assert.equal(result.matched, 3);
	assert.equal(result.hidden, 0);
});

test("ASCII terms match on word boundaries, so `cat` is not `catalog`", () => {
	const result = search([doc(["- catalog of things", "- the cat sat"])], "cat");
	assert.equal(result.kind, "hits");
	assert.deepEqual(result.hits.map((hit) => hit.line), [2], "only the whole word");
});

test("one document's transcript cannot fill the whole Top N", () => {
	// A `session.md` is a pretty-printed dump of every event, so a single transcript can hold thousands
	// of matching lines. Without a per-document cap the receipt is eight lines of that one file, and the
	// curated memory bullet that also matches never appears — the command stops answering "where does
	// this fact live".
	const flood = doc(Array.from({ length: 10 }, (_, index) => `- the cat fact ${index}`), {
		path: ".agents/memory/session-logs/session-x/session.md",
		age: 1,
	});
	const curated = doc(["- the cat fact in memory"], { age: 0 });
	const result = search([flood, curated], "cat");
	assert.equal(result.kind, "hits");
	assert.equal(result.hits.filter((hit) => hit.path === flood.path).length, 3, "the transcript keeps three lines");
	assert.ok(result.hits.some((hit) => hit.path === curated.path), "the curated line is still printed");
	assert.equal(result.matched, 11, "the matches the cap kept back are still counted");
});

test("CJK matches through its adjacent bigrams, and only through them", () => {
	const corpus = [doc(["- 会话交接的记录在这里", "- 压缩之后仍然偏满"])];
	const reordered = search(corpus, "交接会话");
	assert.equal(reordered.kind, "hits");
	assert.deepEqual(reordered.hits.map((hit) => hit.line), [1], "the characters are present, the run is not");
	const absent = search(corpus, "部署回滚");
	assert.equal(absent.kind, "no-matches", "a term whose bigrams are absent still matches nothing");
});

test("a filtered document still reports the file's own line number", () => {
	const corpus = [{ path: ".agents/memory/MEMORY.md", age: 0, lines: ["b", "a"], lineNumbers: [3, 7] }];
	const result = search(corpus, "a");
	assert.equal(result.kind, "hits");
	assert.equal(result.hits[0].line, 7, "the shim's numbering, not the array index");
});

test("the character budget bounds the whole receipt and names what it kept back", () => {
	const long = "alpha " + "x".repeat(300);
	const corpus = [doc(Array.from({ length: 12 }, () => `- ${long}`))];
	const result = search(corpus, "alpha", { maxChars: 600 });
	assert.equal(result.kind, "hits");
	assert.ok(result.hits.length > 0 && result.hits.length < 8, `the budget must bite before the hit cap (${result.hits.length} hits)`);
	assert.equal(result.hidden, result.matched - result.hits.length);
	const text = renderSearchReport(result).text;
	assert.ok(text.length <= 600, `the whole receipt stays inside its budget (${text.length})`);
	assert.match(text, /… and \d+ more not shown/);
});

test("each zero is named: empty query, empty corpus, no matches", () => {
	assert.deepEqual(search([], ""), { kind: "empty-query" });
	assert.deepEqual(search([], "anything"), { kind: "empty-corpus" });
	assert.deepEqual(search([doc(["- one line"])], "nothing-here"), { kind: "no-matches", query: "nothing-here", documents: 1 });
	assert.match(renderSearchReport({ kind: "empty-query" }).text, /^Usage: \/context find <query>/);
	assert.match(renderSearchReport({ kind: "empty-corpus" }).text, /Nothing to search yet/);
	assert.match(renderSearchReport({ kind: "no-matches", query: "q", documents: 2 }).text, /No matches for "q" in 2 document\(s\)/);
});

test("equal scores rank newest first, then by path", () => {
	const corpus = [
		{ path: "b.md", age: 2, lines: ["- alpha"] },
		{ path: "a.md", age: 2, lines: ["- alpha"] },
		{ path: "c.md", age: 0, lines: ["- alpha"] },
	];
	const result = search(corpus, "alpha");
	assert.equal(result.kind, "hits");
	assert.deepEqual(result.hits.map((hit) => hit.path), ["c.md", "a.md", "b.md"], "recency first, then a stable path order");
});

// --- wiring: the real plugin over a real project ------------------------------------------------

test("/context find reports path:line from the memory document and writes nothing", async () => {
	const root = await memoryRoot("dsh-find-memory-");
	await writeMemory(root, [
		"# Project Memory",
		"",
		"## Project",
		"",
		"- the archive keeps every session",
		"",
		"## Invariants",
		"",
		"- never rewrite a released tag",
		"",
		"## Pitfalls",
		"",
		"- the gate reads the log twice",
		"",
		"## Index",
		"",
		"- docs/README.md",
		"",
	].join("\n"));
	await withContext(root, {}, async ({ command }) => {
		const before = await treeSnapshot(root);
		const reply = await command.handler({ agent: fakeAgent(root), rawInput: "find released tag" });
		assert.equal(reply.kind, "success", reply.text);
		assert.match(reply.text, /\.agents\/memory\/MEMORY\.md:9: - never rewrite a released tag/, "the entry's own line, not a synthetic one");
		assert.match(reply.text, /Found 1 line\(s\)/);
		assert.deepEqual(await treeSnapshot(root), before, "a query writes nothing");
	});
});

test("/context find reads a session's transcript and handoff document, and searches every session's metadata", async () => {
	const root = await memoryRoot("dsh-find-session-");
	await writeSession(root, {
		id: "session-alpha",
		date: "2026-11-02",
		title: "ALPHA-TITLE-MARKER",
		sessionMd: "## user\nthe TRANSCRIPT-MARKER decision\n",
		handoff: "Handoff document: HANDOFF-MARKER context\n",
	});
	await withContext(root, {}, async ({ command }) => {
		const transcript = await command.handler({ agent: fakeAgent(root), rawInput: "find TRANSCRIPT-MARKER" });
		assert.match(transcript.text, /session-logs\/session-alpha\/session\.md:2: the TRANSCRIPT-MARKER decision/);
		const handoff = await command.handler({ agent: fakeAgent(root), rawInput: "find HANDOFF-MARKER" });
		assert.match(handoff.text, /session-logs\/session-alpha\/HANDOFF\.md:1: Handoff document: HANDOFF-MARKER context/);
		const meta = await command.handler({ agent: fakeAgent(root), rawInput: "find ALPHA-TITLE-MARKER" });
		assert.match(meta.text, /session-logs\/session-alpha\/meta\.json:\d+: .*ALPHA-TITLE-MARKER/);
	});
});

test("only the most recent sessions contribute a transcript; every session contributes its metadata", async () => {
	const root = await memoryRoot("dsh-find-window-");
	// The oldest archive is outside the transcript window by construction.
	await writeSession(root, {
		id: "session-oldest",
		date: "2026-01-01",
		title: "OLDEST-META-MARKER",
		sessionMd: "## user\nOUT-OF-WINDOW-MARKER\n",
	});
	for (let index = 0; index < DEFAULT_RECENT_SESSIONS; index += 1) {
		await writeSession(root, {
			id: `session-new-${String(index).padStart(2, "0")}`,
			date: `2026-02-${String(index + 1).padStart(2, "0")}`,
			title: `recent ${index}`,
			sessionMd: "## user\nordinary conversation\n",
		});
	}
	await withContext(root, {}, async ({ command }) => {
		const outside = await command.handler({ agent: fakeAgent(root), rawInput: "find OUT-OF-WINDOW-MARKER" });
		assert.match(outside.text, /No matches for "OUT-OF-WINDOW-MARKER"/, "the transcript window is what bounds the read");
		const meta = await command.handler({ agent: fakeAgent(root), rawInput: "find OLDEST-META-MARKER" });
		assert.match(meta.text, /session-oldest\/meta\.json/, "metadata is small and searched for every session");
	});
});

test("/context find refuses an empty query and an empty project by name", async () => {
	const root = await memoryRoot("dsh-find-empty-");
	await withContext(root, {}, async ({ command }) => {
		const empty = await command.handler({ agent: fakeAgent(root), rawInput: "find" });
		assert.equal(empty.kind, "error");
		assert.match(empty.text, /Usage: \/context find <query>/);
		const nothing = await command.handler({ agent: fakeAgent(root), rawInput: "find anything" });
		assert.equal(nothing.kind, "success");
		assert.match(nothing.text, /Nothing to search yet/);
	});
});

test("an unknown /context verb names the whole usage line, find and export included", async () => {
	const root = await memoryRoot("dsh-find-usage-");
	await withContext(root, {}, async ({ command }) => {
		const reply = await command.handler({ agent: fakeAgent(root), rawInput: "widget" });
		assert.equal(reply.kind, "error");
		assert.match(reply.text, /Usage: \/context \| \/context find <query> \| \/context export \[--write\]/);
	});
});
