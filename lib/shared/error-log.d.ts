/**
 * Swallowed-failure reporting: one rotated `errors.log` per project, with the diagnostic
 * truncation and redaction every entry goes through.
 */
/** Rotate `errors.log` once its on-disk size passes this many bytes. */
export declare const MAX_ERROR_LOG_BYTES = 1000000;
/**
 * The bytes a rotation keeps: a marker plus the newest tail, starting on a whole record.
 *
 * Exported because batch Z4's cleaning channel archives the whole file first and then truncates it
 * with exactly this rule; a second copy of "how much survives" would drift from the live rotation.
 * @param raw - the file's text before rotation.
 * @returns the rotated text to write back.
 */
export declare function errorLogAfterRotation(raw: string): string;
/**
 * Redact a diagnostic, then flatten and bound it for a console line. `ctx.logger` writes what it
 * is given verbatim, and one consolidation failure embeds up to 4000 characters of raw model reply
 * (`replyHead`), so the host log needs the mask as well as a cheaper ceiling. Exported for tests.
 * @param error - the thrown value.
 * @returns a single-line redacted diagnostic, never longer than the console cap.
 */
export declare function diagnosticMessage(error: unknown): string;
export declare function logError(projectRoot: string, scope: string, error: unknown): Promise<void>;
