/**
 * The derived-view marker on `/context export --write`.
 *
 * AOCI's `derived=true / authoritative=false` distinction, borrowed at zero dependency cost: an export
 * is a projection, and the marker may only say the journal is the authority when `loadMemory` actually
 * answered from the journal. With no journal record — or a newer MEMORY.md — MEMORY.md is the source,
 * and claiming otherwise names the wrong authority.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { fakeAgent, memoryRoot, withContext, writeMemory } from "./context-fixtures.mjs";

/** Four sections, one entry each — enough for the export to have entries. */
const DOCUMENT = `# Project Memory

## Project
- uses dsh

## Invariants
- the journal is the authority

## Pitfalls
- tsc tagged templates

## Index
- docs/README.md
`;

/** One append-only journal record holding the document, so `loadMemory` answers from the journal. */
async function writeJournalRecord(root) {
	const dir = path.join(root, ".agents", "memory");
	await mkdir(dir, { recursive: true });
	await writeFile(
		path.join(dir, "memory.jsonl"),
		`${JSON.stringify({ ts: new Date().toISOString(), op: "replace", text: DOCUMENT })}\n`,
		"utf8",
	);
}

test("/context export --write names the export a derived view when the journal is the source", async () => {
	const root = await memoryRoot("dsh-export-derived-");
	await writeMemory(root, DOCUMENT);
	await writeJournalRecord(root);

	await withContext(root, {}, async ({ command }) => {
		const reply = await command.handler({ agent: fakeAgent(root), rawInput: "export --write" });
		assert.equal(reply.kind, "success", reply.text);
		assert.match(reply.text, /Exported \d+ entr(y|ies) to /, "the written path still leads");
		// Its own line, not a trailing clause: the client only creates an expandable <pre> when the
		// text contains a newline, and a single-line row is clipped where the marker would sit.
		assert.match(reply.text, /\nThe export is a derived view; the authority is the memory journal\.$/, reply.text);
	});
});

test("/context export --write does not call the journal the authority when MEMORY.md is the source", async () => {
	// No journal record at all: `loadMemory` falls through to MEMORY.md, which is then the authority.
	const root = await memoryRoot("dsh-export-derived-negative-");
	await writeMemory(root, DOCUMENT);

	await withContext(root, {}, async ({ command }) => {
		const reply = await command.handler({ agent: fakeAgent(root), rawInput: "export --write" });
		assert.equal(reply.kind, "success", reply.text);
		assert.doesNotMatch(reply.text, /derived view/, reply.text);
	});
});
