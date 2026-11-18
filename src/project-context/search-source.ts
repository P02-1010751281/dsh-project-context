/**
 * The **shim** behind `/context find`: `.agents/memory` on disk → the core's {@link SearchDoc} corpus.
 *
 * This is the only file in the search path that knows the archive layout, which files are documents
 * and how a line number is counted. `search.ts` folds those DTOs and stays host- and fs-free.
 *
 * What it mirrors:
 *  - `<memory>/MEMORY.md` — one line per `- ` entry (the four policy sections);
 *  - `<memory>/CONTEXT.md` — its sections and Open tasks;
 *  - `<memory>/tasks/<slug>.md` — one document per task;
 *  - `<memory>/session-logs/<id>/meta.json` — the session's title / task / kind / date, read as the
 *    file's own lines so `path:line` points at the line that matched;
 *  - `<memory>/session-logs/<id>/{HANDOFF.md,session.md}` — the handoff document and the rendered
 *    transcript, restricted to the most recent sessions (the archive can be large; the window is what
 *    bounds one query's read).
 *
 * Removal condition: none of its own — the layout is the contract shared with pi, not a host API. It
 * changes only when the archive moves off `.agents/memory`.
 *
 * Deliberately absent: a persistent index, an mtime cache and any write. Each file is added exactly
 * once by this walk, so the corpus needs no dedupe pass of its own.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { contextFile, memoryFile, tasksDir } from "../shared/project-state.js";
import { listArchivedSessions } from "./archive-source.js";
import { type SearchDoc } from "./search.js";

/** Sessions whose handoff document and transcript are searched; the archive beyond them is metadata only. */
export const DEFAULT_RECENT_SESSIONS = 20;

/** What one query may read. */
export interface SearchCorpus {
	readonly docs: readonly SearchDoc[];
	/** Archived sessions whose metadata entered the corpus. */
	readonly sessions: number;
}

/** A missing or unreadable file is an empty document, never an error the command has to explain. */
async function readText(file: string): Promise<string> {
	try {
		return await readFile(file, "utf8");
	} catch {
		return "";
	}
}

/** The project-relative POSIX path the receipt prints. */
function relativePath(projectRoot: string, file: string): string {
	return path.relative(projectRoot, file).split(path.sep).join("/");
}

/** A line worth searching: content, not the blank line the renderers leave between sections. */
function content(line: string): boolean {
	return line.trim() !== "";
}

/**
 * Read one query's corpus.
 *
 * Recency ranks feed the tiebreak only: the project's own documents (memory, context, tasks) are the
 * current state and rank `0`; session documents rank by their place in the newest-first archive list,
 * so two equally good hits prefer the session that happened later.
 * @param projectRoot - the project whose `.agents/memory` is read.
 * @param options - how many recent sessions contribute their transcript and handoff document.
 * @returns the corpus and how many sessions it covered.
 */
export async function readSearchCorpus(projectRoot: string, options: { recentSessions?: number } = {}): Promise<SearchCorpus> {
	const recent = Math.max(0, options.recentSessions ?? DEFAULT_RECENT_SESSIONS);
	const docs: SearchDoc[] = [];
	const add = (file: string, text: string, age: number, keep: (line: string) => boolean): void => {
		const shown = relativePath(projectRoot, file);
		const lines: string[] = [];
		const lineNumbers: number[] = [];
		for (const [index, line] of text.split("\n").entries()) {
			if (!keep(line)) continue;
			lines.push(line);
			lineNumbers.push(index + 1);
		}
		// An empty document would only make the "N documents" count a lie.
		if (lines.length > 0) docs.push({ path: shown, age, lines, lineNumbers });
	};

	add(memoryFile(projectRoot), await readText(memoryFile(projectRoot)), 0, (line) => /^\s*-\s+\S/.test(line));
	add(contextFile(projectRoot), await readText(contextFile(projectRoot)), 0, content);
	for (const entry of await taskFiles(projectRoot)) {
		add(entry, await readText(entry), 0, content);
	}

	const sessions = await listArchivedSessions(projectRoot);
	for (const [index, session] of sessions.entries()) {
		const age = index + 1;
		add(path.join(session.dir, "meta.json"), await readText(path.join(session.dir, "meta.json")), age, content);
		if (index >= recent) continue;
		add(path.join(session.dir, "HANDOFF.md"), await readText(path.join(session.dir, "HANDOFF.md")), age, content);
		add(path.join(session.dir, "session.md"), await readText(path.join(session.dir, "session.md")), age, content);
	}
	return { docs, sessions: sessions.length };
}

/** Every `*.md` under the tasks directory, sorted so a corpus is stable between reads. */
async function taskFiles(projectRoot: string): Promise<string[]> {
	let entries: string[];
	try {
		entries = await readdir(tasksDir(projectRoot));
	} catch {
		return [];
	}
	return entries
		.filter((entry) => entry.endsWith(".md"))
		.sort()
		.map((entry) => path.join(tasksDir(projectRoot), entry));
}
