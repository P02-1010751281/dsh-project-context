/**
 * The character budgets of the stored documents and the rendered prompt inputs.
 */
/** Default cap on the rendered memory document; the project's `maxMemoryChars` overrides it. */
export declare const MAX_MEMORY_CHARS = 40000;
/** Accepted bounds for `maxMemoryChars`: below this a memory is useless, above it cannot be re-emitted. */
export declare const MIN_MEMORY_CHARS = 4000;
export declare const MAX_MEMORY_CHARS_LIMIT = 200000;
export declare const MAX_CONTEXT_CHARS = 32000;
export declare const MAX_CONVERSATION_CHARS = 50000;
export declare const MAX_SKILL_BODY_CHARS = 20000;
export declare const MAX_SUMMARY_CHARS = 6000;
export declare const MAX_LIST_ITEM_CHARS = 800;
/** Maximum bullet items a CONTEXT.md list section renders. */
export declare const MAX_LIST_ENTRIES = 50;
