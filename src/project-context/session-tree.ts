/**
 * `/session-log tree` — the handoff lineage the archive already records, as one readable forest.
 *
 * `meta.json` has carried `parentId`/`kind` since the handoff started writing them, and before this
 * module nothing read them back: the archive held a session *graph* while every surface presented a
 * flat list, so "which continuation replaced this session, and what did it continue" could only be
 * answered by opening metadata files by hand.
 *
 * Two shapes have to be handled rather than assumed away:
 *
 *   - a `parentId` naming a session that is not archived (pruned, or an import that brought the child
 *     without its parent). Rendering it as a child of nothing would silently drop it from the tree, so
 *     it becomes a root that *says* which parent is missing — the same rule `INDEX.md` follows, where a
 *     row exists exactly when the directory does;
 *   - a parent cycle (only reachable through hand-edited metadata, since the handoff only ever points
 *     at an older session). The walk treats an already-emitted node as a leaf, which both terminates and
 *     keeps every session in the output exactly once — the tree is a navigation surface, so losing a
 *     session to a malformed link is worse than showing it unlinked.
 *
 * Subagent archives are hidden from the tree for the same reason `INDEX.md` never lists them: the
 * archive path refuses to index a delegated child, so counting them here would make the two surfaces
 * disagree about what "a session" is. They are counted in the header instead, because a child that is
 * missing from the tree must have an explanation.
 */

import { clipTitle } from "../shared/text.js";
import { listArchivedSessions } from "./session-index.js";
import type { SessionMeta } from "./session-meta.js";

/** One node and its continuations, in archive order. */
interface SessionTreeNode {
	readonly meta: SessionMeta;
	readonly children: readonly SessionTreeNode[];
	/** The `parentId` that is not in the archive, when this node is an orphan. */
	readonly missingParentId?: string;
}

/** The whole forest plus the counts the header reports. */
interface SessionTree {
	readonly roots: readonly SessionTreeNode[];
	/** Sessions rendered (subagent archives excluded). */
	readonly sessionCount: number;
	/** Delegated children present on disk and deliberately not rendered. */
	readonly hiddenSubagents: number;
	/** Continuations (`kind: "handoff"`) among the rendered sessions. */
	readonly handoffCount: number;
}

/** Title width, matching the index: a stored title is already clipped, a hand-edited one may not be. */
const MAX_TITLE_CHARS = 160;

/** How many rows one receipt may carry; `INDEX.md` is the unbounded listing. */
const MAX_TREE_ROWS = 500;

/** Indentation stops growing here, so a long chain cannot push its label off the line. */
const MAX_INDENT_DEPTH = 8;

/** Archive order: oldest first, the direction the handoff chain grows. */
function byDateThenId(left: SessionMeta, right: SessionMeta): number {
	if (left.date !== right.date) return left.date < right.date ? -1 : 1;
	return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/**
 * Build the forest from the archived metadata.
 *
 * Pure and total: any input — duplicate ids, a self-parent, a cycle, a parent that is a subagent — ends
 * with every visible session in the result exactly once.
 * @param metas - every archived session's metadata, in any order.
 * @returns the forest and the header counts.
 */
export function buildSessionTree(metas: readonly SessionMeta[]): SessionTree {
	const visible = metas.filter((meta) => meta.kind !== "subagent");
	const byId = new Map(visible.map((meta) => [meta.id, meta]));
	const children = new Map<string, SessionMeta[]>();
	for (const meta of visible) {
		const parent = meta.parentId;
		// A self-parent and a parent outside the archive are both roots: the first because it would loop,
		// the second because there is nothing to hang it under (it is reported as an orphan instead).
		if (parent === undefined || parent === meta.id || !byId.has(parent)) continue;
		const siblings = children.get(parent);
		if (siblings === undefined) children.set(parent, [meta]);
		else siblings.push(meta);
	}

	const visited = new Set<string>();
	const build = (meta: SessionMeta, missingParentId: string | undefined): SessionTreeNode => {
		visited.add(meta.id);
		const kids = (children.get(meta.id) ?? [])
			.filter((child) => !visited.has(child.id))
			.sort(byDateThenId)
			.map((child) => build(child, undefined));
		return { meta, children: kids, ...(missingParentId === undefined ? {} : { missingParentId }) };
	};

	const roots = visible
		.filter((meta) => !isChildOf(meta, byId, children))
		.sort(byDateThenId)
		.map((meta) => build(meta, meta.parentId !== undefined && !byId.has(meta.parentId) ? meta.parentId : undefined));

	// A cycle is unreachable from every root (each of its nodes has a parent), so whatever the walk did
	// not reach is emitted as its own root. Order is archive order, so the output stays deterministic.
	for (const meta of [...visible].sort(byDateThenId)) {
		if (!visited.has(meta.id)) roots.push(build(meta, undefined));
	}

	return {
		roots,
		sessionCount: visible.length,
		hiddenSubagents: metas.length - visible.length,
		handoffCount: visible.filter((meta) => meta.kind === "handoff").length,
	};
}

/**
 * Whether one session is hung under a visible parent.
 *
 * The children map is the answer, but a node whose parent *is* itself never entered it, so a self-parent
 * is a root here rather than a missing child.
 */
function isChildOf(meta: SessionMeta, byId: Map<string, SessionMeta>, children: Map<string, SessionMeta[]>): boolean {
	const parent = meta.parentId;
	if (parent === undefined || parent === meta.id) return false;
	if (!byId.has(parent)) return false;
	return (children.get(parent) ?? []).some((child) => child.id === meta.id);
}

/**
 * Render one forest as the command's reply.
 *
 * A receipt has no scrollbar to speak of, so the row count is bounded; the tail says where the rest is
 * rather than silently truncating.
 * @param tree - the forest from {@link buildSessionTree}.
 * @returns the reply text.
 */
export function renderSessionTree(tree: SessionTree): string {
	if (tree.sessionCount === 0) return "# Session tree\n\nNo archived sessions yet.";
	const summary = [`${tree.sessionCount} session(s)`, `${tree.roots.length} root(s)`, `${tree.handoffCount} handoff continuation(s)`];
	if (tree.hiddenSubagents > 0) summary.push(`${tree.hiddenSubagents} subagent archive(s) hidden`);
	const lines = ["# Session tree", "", summary.join(" · "), ""];
	let shown = 0;
	const walk = (node: SessionTreeNode, depth: number): void => {
		if (shown >= MAX_TREE_ROWS) return;
		shown += 1;
		lines.push(`${"  ".repeat(Math.min(depth, MAX_INDENT_DEPTH))}- ${renderNode(node, depth)}`);
		for (const child of node.children) walk(child, depth + 1);
	};
	for (const root of tree.roots) walk(root, 0);
	if (tree.sessionCount > shown) lines.push("", `… and ${tree.sessionCount - shown} more session(s) — INDEX.md lists every row.`);
	return lines.join("\n");
}

/** One row: a link to the archive, the date, the title, then only the annotations that add a fact. */
function renderNode(node: SessionTreeNode, depth: number): string {
	const { meta } = node;
	const title = clipTitle(meta.title.trim() === "" ? "Untitled session" : meta.title, MAX_TITLE_CHARS);
	const annotations: string[] = [];
	// A continuation's indentation already says it continues something; only a *root* has to name the
	// kind, and only an orphan has to name the parent it could not be hung under.
	if (depth === 0 && meta.kind === "handoff") annotations.push("handoff");
	if (node.missingParentId !== undefined) annotations.push(`parent ${node.missingParentId} not archived`);
	if (meta.task !== undefined) annotations.push(`task ${meta.task}`);
	const suffix = annotations.length === 0 ? "" : ` · ${annotations.join(" · ")}`;
	return `[${meta.id}](${meta.id}/session.jsonl) — ${meta.date} — ${title}${suffix}`;
}

/**
 * Read one project's archive and render its tree.
 *
 * A missing `session-logs/` is an empty archive, not an error: the reply says so, which is the same
 * answer the bare `/session-log` gives about the paths themselves.
 * @param projectRoot - the project whose archive to read.
 * @returns the reply text.
 */
export async function readSessionTree(projectRoot: string): Promise<string> {
	const metas = await listArchivedSessions(projectRoot);
	return renderSessionTree(buildSessionTree(metas));
}
