/**
 * Session artifact writer: raw event JSONL plus a full Markdown rendering, per
 * session, under `<project>/.agents/memory/session-logs/<session-id>/`.
 * Ported from pi's `session-log.ts`, adapted to dsh's event-sourced sessions.
 *
 * Both files are append-only within a process run: after the initial full
 * write, each flush appends only the new entries instead of rebuilding the
 * log, so a long session does not rewrite itself on every turn.
 */
import type { Session } from "@deepseek-ai/dsh-session";
export interface SessionFileHeader {
    type: "session";
    harness: "dsh";
    id: string;
    version: number;
    createdAt: number;
    cwd: string | null;
    parentSession?: string;
    origin?: string;
    agentPreset?: string;
    isSeeded: boolean;
}
/**
 * Full Markdown rendering of one session. Shared by the live writer and the
 * archive backfill (`import-archive.ts`) so both produce byte-identical output.
 */
export declare function renderSessionMarkdown(header: SessionFileHeader, entries: readonly unknown[]): string;
/** Keep local transcripts out of version control without touching project ignore files. */
export declare function ensureLogsIgnored(projectRoot: string): Promise<void>;
export declare function writeSessionArtifacts(session: Session, options?: {
    markdown?: boolean;
}): Promise<{
    dir: string;
}>;
export declare function queueSessionArtifacts(session: Session, options?: {
    markdown?: boolean;
}): Promise<void>;
/** Release a disposed session's queue entry and append bookkeeping after its writes settle. */
export declare function releaseSessionQueue(session: Session): void;
