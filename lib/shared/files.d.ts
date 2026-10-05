/**
 * Filesystem primitives: the atomic write, optional/cached reads, existence and mtime probes,
 * move/merge with rollback, and stale-temp cleanup.
 */
export declare function readOptional(file: string): Promise<string>;
/**
 * Synchronous cached read for prompt providers. Re-reads only when the file
 * mtime or size changed, so an assembly stays cheap.
 */
export declare function readTextCachedSync(file: string): string;
export declare function invalidateTextCache(file: string): void;
export declare function pathExists(target: string): Promise<boolean>;
/** Modification time in milliseconds, or 0 when the file does not exist. */
export declare function fileMtimeMs(file: string): Promise<number>;
/**
 * Publish a file by writing a unique temp name and renaming it over the target, so readers only
 * ever see the old or the new bytes. `content` may be raw bytes: the memory backup keeps the exact
 * bytes it found, not a re-encoded string.
 * @param file - destination path.
 * @param content - UTF-8 text or raw bytes.
 */
export declare function writeAtomic(file: string, content: string | Uint8Array): Promise<void>;
/**
 * What {@link mergePath} did with the source.
 *
 * `merged` means the source's bytes survived (moved, copied over an older destination, or removed as
 * an identical duplicate). `superseded` means the destination was at least as new, so the source was
 * deleted **without** being copied.
 */
export type MergeOutcome = "merged" | "superseded" | "absent" | "conflict";
/**
 * Merge one legacy artifact into the new location; newest content wins, then the
 * legacy path is removed.
 *
 * A file/directory type conflict cannot be merged automatically. Deleting the
 * legacy side would destroy the user's data, and `cp` would throw
 * `ERR_FS_CP_NON_DIR_TO_DIR` and abort the whole migration, so both sides stay
 * where they are and the caller reports the conflict.
 *
 * @param source - the legacy path to consume.
 * @param destination - the new location.
 * @returns `absent` when there is nothing to move, `conflict` when the two paths
 *   have incompatible types, `merged` when the source's bytes survived, and
 *   `superseded` when the destination was at least as new so the source was
 *   deleted without being copied.
 */
export declare function mergePath(source: string, destination: string): Promise<MergeOutcome>;
/** Remove leftover `<name>.<pid>.tmp` files from interrupted atomic writes. */
export declare function cleanStaleTemps(directory: string): Promise<void>;
