/**
 * The byte-level backup taken before the render is replaced, and the prune that keeps a burst of
 * writes from growing the directory without bound.
 */
/** Backups younger than this are never pruned, so a backup named in a notice stays reviewable
 * until roughly MEMORY_BACKUPS_MAX further writes have pushed it past the hard ceiling. */
export declare const MEMORY_BACKUP_MIN_AGE_MS: number;
/**
 * Keep the current bytes of a memory file next to it before the writer replaces it, and report
 * whether the bytes on disk are a stored reply. Reads the disk at write time, so a concurrent
 * writer's file is what gets backed up. Older backups beyond the newest few are pruned.
 * @param target - the rendered document about to be replaced.
 * @returns the backup path (absent when there was nothing to keep) and whether it was poisoned.
 */
export declare function backupMemoryBeforeWrite(target: string): Promise<{
    path?: string;
    poisoned: boolean;
}>;
