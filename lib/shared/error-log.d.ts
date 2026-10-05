/**
 * Swallowed-failure reporting: one rotated `errors.log` per project, with the diagnostic
 * truncation and redaction every entry goes through.
 */
/**
 * Redact a diagnostic, then flatten and bound it for a console line. `ctx.logger` writes what it
 * is given verbatim, and one consolidation failure embeds up to 4000 characters of raw model reply
 * (`replyHead`), so the host log needs the mask as well as a cheaper ceiling. Exported for tests.
 * @param error - the thrown value.
 * @returns a single-line redacted diagnostic, never longer than the console cap.
 */
export declare function diagnosticMessage(error: unknown): string;
export declare function logError(projectRoot: string, scope: string, error: unknown): Promise<void>;
