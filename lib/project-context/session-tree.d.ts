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
/**
 * Build the forest from the archived metadata.
 *
 * Pure and total: any input — duplicate ids, a self-parent, a cycle, a parent that is a subagent — ends
 * with every visible session in the result exactly once.
 * @param metas - every archived session's metadata, in any order.
 * @returns the forest and the header counts.
 */
export declare function buildSessionTree(metas: readonly SessionMeta[]): SessionTree;
/**
 * Render one forest as the command's reply.
 *
 * A receipt has no scrollbar to speak of, so the row count is bounded; the tail says where the rest is
 * rather than silently truncating.
 * @param tree - the forest from {@link buildSessionTree}.
 * @returns the reply text.
 */
export declare function renderSessionTree(tree: SessionTree): string;
/**
 * Read one project's archive and render its tree.
 *
 * A missing `session-logs/` is an empty archive, not an error: the reply says so, which is the same
 * answer the bare `/session-log` gives about the paths themselves.
 * @param projectRoot - the project whose archive to read.
 * @returns the reply text.
 */
export declare function readSessionTree(projectRoot: string): Promise<string>;
export {};
