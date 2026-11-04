/**
 * The measurement's shape, in a module that imports nothing of its own.
 *
 * These two declarations lived in `runtime.ts` until the decision seam (`decide.ts`) needed them. That
 * mattered: `runtime.ts` imports the host session package, and with `verbatimModuleSyntax` a type-only
 * import is still emitted as `import {} from "…"` — a real module load. A decision module taking the
 * type from `runtime.ts` would therefore load the host's session package at runtime, which is exactly
 * what makes it unusable on a host that does not ship that package. A type that only describes numbers
 * needs no host to be read, so it lives alone here and `runtime.ts` re-exports it for its own callers.
 */
export {};
