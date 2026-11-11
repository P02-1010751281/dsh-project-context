/**
 * Reading a dsh session export (`.zip`): the central directory, the raw-deflate entries, and
 * the one entry that carries `session.jsonl`.
 */
/**
 * Minimal ZIP reader: locate the entry through the central directory, then
 * inflate the entry data.
 * @param buffer - the whole zip file.
 * @param entryName - exact central-directory name to read.
 * @returns the entry's bytes, or `undefined` when no entry has that name.
 */
export declare function readZipEntry(buffer: Buffer, entryName: string): Buffer | undefined;
/** Read one archive file (`.zip` holding the exported session log, or a bare `.jsonl`). */
export declare function readArchiveFile(file: string): Promise<string>;
