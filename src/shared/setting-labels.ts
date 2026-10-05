/**
 * The settings card's own name for a config field, per language.
 *
 * A host-side receipt that tells a user to turn a knob must call that knob what the card calls it —
 * `keep` was an internal shorthand that appears nowhere the user can see. The card's dictionaries in
 * `client/locales.ts` read these same strings, so there is one definition per label rather than a
 * copy per bundle that can drift. Add a label here only when a receipt needs to name it.
 */

/** `handoffKeepTokens` — "keep" is never the user-visible name of this setting. */
export const HANDOFF_KEEP_TOKENS_LABEL = {
	zh: "保留最近对话（token）",
	en: "Recent tokens kept",
} as const;
