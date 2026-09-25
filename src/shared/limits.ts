/**
 * The character budgets of the stored documents and the rendered prompt inputs.
 */

/** Default cap on the rendered memory document; the project's `maxMemoryChars` overrides it. */
export const MAX_MEMORY_CHARS = 32_000;

/** Accepted bounds for `maxMemoryChars`: below this a memory is useless, above it cannot be re-emitted. */
export const MIN_MEMORY_CHARS = 4_000;

export const MAX_MEMORY_CHARS_LIMIT = 200_000;

export const MAX_CONTEXT_CHARS = 32000;

export const MAX_CONVERSATION_CHARS = 50000;

export const MAX_SKILL_BODY_CHARS = 20000;

export const MAX_SUMMARY_CHARS = 6000;

export const MAX_LIST_ITEM_CHARS = 800;
