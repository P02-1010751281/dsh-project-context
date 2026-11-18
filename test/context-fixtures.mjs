/**
 * Shared fixtures for the three read-only `/context` surfaces (`find`, `export`, `task` numbers).
 *
 * Not a `*.test.mjs` file, so the package's test glob does not pick it up — the same trick
 * `session-views.mjs` uses. Everything here builds the real `.agents/memory` layout and drives the
 * real `apply()`, because the commands under test are file readers and a hand-shaped DTO would prove
 * nothing about the files they actually read.
 */

import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { apply as applyContext } from "../lib/project-context/index.js";
import { renderTaskDocument } from "../lib/project-memory/context-doc.js";
import { withTodoLines } from "../lib/project-memory/todo.js";
import { contextFile, logsDir, memoryFile, tasksDir } from "../lib/shared/project-state.js";

/** A throwaway project with its memory directory in place. */
export async function memoryRoot(prefix) {
	const root = await mkdtemp(path.join(tmpdir(), prefix));
	await mkdir(path.join(root, ".agents", "memory"), { recursive: true });
	return root;
}

/** Write the project's memory document. */
export async function writeMemory(root, text) {
	await writeFile(memoryFile(root), text, "utf8");
}

/** Write the project's context document. */
export async function writeContext(root, text) {
	await writeFile(contextFile(root), text, "utf8");
}

/**
 * One archived session: its `meta.json`, plus the rendered transcript and handoff document when the
 * case needs them. The metadata shape is the one `session-meta.ts` writes.
 */
export async function writeSession(root, { id, date, title, task, kind, sessionMd, handoff, meta: metaOverride }) {
	const dir = path.join(logsDir(root), id);
	await mkdir(dir, { recursive: true });
	const meta = metaOverride ?? {
		id,
		date,
		title,
		...(task === undefined ? {} : { task }),
		...(kind === undefined ? {} : { kind }),
	};
	await writeFile(path.join(dir, "meta.json"), `${JSON.stringify(meta, undefined, "\t")}\n`, "utf8");
	if (sessionMd !== undefined) await writeFile(path.join(dir, "session.md"), sessionMd, "utf8");
	if (handoff !== undefined) await writeFile(path.join(dir, "HANDOFF.md"), handoff, "utf8");
	return dir;
}

/**
 * One task document, rendered by the real renderer so its metadata line and sections are the ones
 * the plugin parses. `todos` go through `withTodoLines`, the writer that owns the `- [todo] …` shape.
 */
export async function writeTask(root, { slug, title = slug, status = "active", created = "2026-10-01", lastSeen = "2026-10-01", openTasks = [], todos = [] }) {
	await mkdir(tasksDir(root), { recursive: true });
	let text = renderTaskDocument(
		{ title, summary: "", key_points: [], open_tasks: openTasks },
		{ updatedAt: "2026-10-01T00:00:00.000Z", slug, meta: { created, status, lastSeen, title } },
	).text;
	if (todos.length > 0) text = withTodoLines(text, todos).text;
	await writeFile(path.join(tasksDir(root), `${slug}.md`), text, "utf8");
	return text;
}

/** A session stand-in: the command handler only reads its id and cwd. */
export function fakeAgent(root, { id = "session-command" } = {}) {
	return {
		session: {
			id,
			header: { cwd: root, createdAt: Date.now() },
			snapshotEvents: () => [],
			deriveMessages: () => [],
		},
	};
}

/**
 * Run one case against a freshly applied plugin, and dispose the settings publication afterwards.
 *
 * `publishProjectContextSettings` writes module-level state, so a case that leaves it published makes
 * the next case's `effectivePluginConfig` read a config from another project. `tasks.test.mjs` tracks
 * the same disposers for the same reason.
 */
export async function withContext(root, config, run) {
	const commands = new Map();
	const disposers = [];
	const ctx = {
		on: () => () => undefined,
		effect: (callback) => {
			const dispose = callback();
			if (typeof dispose === "function") disposers.push(dispose);
			return () => undefined;
		},
		commands: {
			register: (command) => {
				commands.set(command.name, command);
				return () => undefined;
			},
		},
		get: () => undefined,
		logger: { info: () => undefined, warn: () => undefined },
	};
	applyContext(ctx, config);
	try {
		return await run({ command: commands.get("context"), root });
	} finally {
		for (const dispose of disposers) dispose();
	}
}

/**
 * Every file under `root` with its bytes.
 *
 * The read-only commands are pinned by this: a `find` or a printed `export` that wrote anything — a
 * cache, a journal line, a stray index — changes the snapshot, while `stat` alone would miss a
 * same-size rewrite.
 */
export async function treeSnapshot(root) {
	const files = [];
	const walk = async (dir) => {
		const entries = await readdir(dir, { withFileTypes: true });
		entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(full);
				continue;
			}
			files.push(`${path.relative(root, full).split(path.sep).join("/")}=${(await readFile(full)).toString("base64")}`);
		}
	};
	await walk(root);
	return files;
}
