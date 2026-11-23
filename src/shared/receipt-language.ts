/**
 * The language a command receipt is rendered in, resolved once for every plugin.
 *
 * `project-handoff` already decides this for its scaffolding: `handoffLang: "auto"` samples the
 * user's own messages (CJK first, then substantial Latin, then the newest carried continuation
 * prompt), and an explicit `"zh"`/`"en"` wins outright. The other three plugins printed English
 * literals, so one session saw Chinese and English lines side by side — the settings card's labels
 * were Chinese while the receipt around them was not.
 *
 * This module is the single door to that decision. It lives in `shared/` because all four plugins
 * need it and none of them may own the rule: two copies of "enough Chinese" could disagree about the
 * same conversation, which is the failure mode the shared language primitive exists to prevent.
 *
 * The session messages come from the handoff splitter's append-origin read, not the derived surface:
 * a compaction can summarize away every message in the user's own language, and the receipt would
 * then flip to English while the seed it describes stayed Chinese.
 */

import type { Session } from "../host/contract.js";
import type { PluginConfig } from "./config.js";
import type { DocumentLanguage } from "./language.js";
import { resolveHandoffLanguage, sessionLanguageMessages } from "../project-handoff/conversation.js";

/**
 * The receipt language for one session.
 * @param session - the session whose user messages are sampled.
 * @param config - the plugin config, whose `handoffLang` is the explicit override.
 * @returns the resolved language.
 */
export function receiptLanguage(session: Session, config: PluginConfig): DocumentLanguage {
	return resolveHandoffLanguage(sessionLanguageMessages(session), config);
}
