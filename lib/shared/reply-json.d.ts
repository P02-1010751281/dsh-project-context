/**
 * Reading the structured reply out of a model response: a tolerant JSON object scan (models
 * wrap JSON in prose or fences), the string-field reader, and the consolidation parser whose
 * per-field verdicts the caller reports.
 */
export type ContextUpdate = {
    title: string;
    summary: string;
    key_points: string[];
    open_tasks: string[];
};
export type ConsolidationResult = {
    memory: string;
    context?: ContextUpdate;
    /**
     * True when the reply carried a `context` the shape check refused: a non-object, a missing
     * `summary`, or a `key_points`/`open_tasks` that is present but not an array of strings.
     * Distinct from an absent `context`, which means the model chose to say nothing. A refused
     * context leaves `context` undefined so the caller keeps the existing CONTEXT.md rather than
     * overwriting it with hollowed-out fields, and the caller logs the fact once per project.
     */
    contextUnusable?: boolean;
};
export declare function parseJsonObject(text: string): Record<string, unknown> | undefined;
/**
 * Read an optional list of strings out of a context field. `undefined` means the key was absent
 * (nothing to say), a string[] means it was usable, and `null` means it was present but
 * malformed — a caller must refuse the whole context rather than treat that as an empty list,
 * since doing the latter overwrites a good CONTEXT.md with hollowed-out sections.
 */
export declare function readContextList(value: unknown): string[] | null | undefined;
/** Undefined means the pass must fail without touching MEMORY.md. */
export declare function parseConsolidation(text: string): ConsolidationResult | undefined;
/**
 * Validate one `context` member, whether it came from the JSON reply or from a tool call's
 * arguments. `undefined` means the member could not be used — absent, null, a non-object, or an
 * object that cannot yield a complete update.
 *
 * The caller has to tell "absent" from "unusable" apart to decide whether to log a notice, and it
 * does that by looking at the raw value: this function deliberately collapses both to `undefined`
 * so the shape rule lives in exactly one place.
 */
export declare function parseContextMember(value: unknown): ContextUpdate | undefined;
/**
 * Decode the raw JSON argument text a tool call carried.
 *
 * dsh's adapter streams a tool call's arguments as text (`tool-call-delta` fragments, joined
 * authoritatively by `block-end`), where the pi sibling's plumbing hands back an already-parsed
 * object; so the decode happens here, through the same tolerant reader the text path uses. An
 * undefined result means the text was not a JSON object at all, which the caller treats as an
 * unusable call rather than an empty one.
 */
export declare function parseToolArguments(text: string): Record<string, unknown> | undefined;
