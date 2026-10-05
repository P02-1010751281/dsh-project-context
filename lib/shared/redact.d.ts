/**
 * Secret redaction applied to anything this package logs.
 */
/** Mask credential-looking substrings before anything lands in the project's log file. */
export declare function redactSecrets(text: string): string;
