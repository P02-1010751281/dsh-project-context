/**
 * Secret redaction applied to anything this package logs.
 */

/** Mask credential-looking substrings before anything lands in the project's log file. */
export function redactSecrets(text: string): string {
	return text
		.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[redacted-jwt]")
		.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{10,}/gi, "Bearer [redacted]")
		.replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}\b/g, "[redacted-key]")
		.replace(/\b(gh[pousr]|github_pat)_[A-Za-z0-9_]{8,}\b/g, "[redacted-token]")
		.replace(/\b(xox[baprs]|glpat)-[A-Za-z0-9_-]{8,}\b/g, "[redacted-token]")
		.replace(/\b(?:npm|pypi)_[A-Za-z0-9]{20,}\b/g, "[redacted-token]")
		.replace(/\bAIza[0-9A-Za-z_-]{30,}\b/g, "[redacted-key]")
		.replace(/\bAKIA[0-9A-Z]{12,}\b/g, "[redacted-key]")
		.replace(/(\b(?:api[_-]?key|token|secret|password|passwd|authorization)\b\s*[:=]\s*)["']?[^\s"',}\]]{6,}/gi, "$1[redacted]");
}
