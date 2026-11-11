/**
 * The numeric contracts shared by the host plugins and the client card: the character budgets of the
 * stored documents and the rendered prompt inputs, and the accepted range of a fixed window fraction
 * (the ratio branch of `handoffThreshold`).
 */
/** Default cap on the rendered memory document; the project's `maxMemoryChars` overrides it. */
export const MAX_MEMORY_CHARS = 40_000;
/** Accepted bounds for `maxMemoryChars`: below this a memory is useless, above it cannot be re-emitted. */
export const MIN_MEMORY_CHARS = 4_000;
export const MAX_MEMORY_CHARS_LIMIT = 200_000;
export const MAX_CONTEXT_CHARS = 32000;
export const MAX_CONVERSATION_CHARS = 50000;
export const MAX_SKILL_BODY_CHARS = 20000;
export const MAX_SUMMARY_CHARS = 6000;
export const MAX_LIST_ITEM_CHARS = 800;
/** Maximum bullet items a CONTEXT.md list section renders. */
export const MAX_LIST_ENTRIES = 50;
/**
 * Accepted range for a fixed window fraction — the ratio branch of `handoffThreshold` — the one source
 * the config validator, the settings schema, the command parser, the usage sentence and the card hints
 * all read, so no two of them can disagree about what a ratio may be.
 *
 * Exported as a **pair** on purpose. pi exported only its maximum, left a literal minimum in its parser,
 * and its guard stayed green while the parser accepted `0.95` that the validator then dropped back to the
 * default on the next load; the mirror mutation (move the minimum, keep the parser) slipped through both
 * the guard and the config tests. A guard on this pair must therefore cover both bounds, not one.
 */
export const MIN_THRESHOLD_RATIO = 0.1;
export const MAX_THRESHOLD_RATIO = 0.95;
/**
 * Accepted bounds for the two handoff budget amounts — the one source the settings schema, the config
 * validator, the `/handoff budget` parser and the settings card all read, so a value the card accepts
 * is a value the Host keeps. `summary` sizes the override report, `recent` sizes the verbatim tail.
 */
/**
 * Default for `handoffBudgetSummaryTokens`. It lives here rather than only in `config.ts` because the
 * card's hint states it: `config.ts` pulls `node:` modules, so the browser half cannot read
 * `DEFAULT_CONFIG` — and a default restated in copy is the drift class this file exists to prevent.
 */
export const DEFAULT_HANDOFF_SUMMARY_TOKENS = 64_000;
export const MIN_HANDOFF_SUMMARY_TOKENS = 8_000;
export const MAX_HANDOFF_SUMMARY_TOKENS = 200_000;
export const MIN_HANDOFF_RECENT_TOKENS = 0;
export const MAX_HANDOFF_RECENT_TOKENS = 200_000;
