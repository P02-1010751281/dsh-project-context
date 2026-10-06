/**
 * The two mechanical texts a handoff emits: the archived `HANDOFF.md` document and the child's
 * first message. Neither carries a generated summary — the dropped prefix stays reachable through
 * the session log the payload points at, and the recent tail rides verbatim — so this module holds
 * no model call, no output budget and no timeout.
 */
import { type Session } from "@deepseek-ai/dsh-session";
import { type UserDecision } from "./conversation.js";
import { type HandoffLanguage } from "./language.js";
/**
 * The archived `HANDOFF.md` document: header, archive pointers and the file index, and nothing
 * generated. The relative pointers are what the document carries — see `perform.ts` for why the
 * child's first message needs absolute ones instead.
 */
export declare function renderHandoff(session: Session, fileOperations: string, archive: {
    log: string;
    index: string;
}, language: HandoffLanguage): string;
/** The first message of the fresh session; the archive pointers keep the raw history reachable. */
export declare function continuation(parentId: string, fileOperations: string, tail: string, archive: {
    log: string;
    index: string;
}, language?: HandoffLanguage, pending?: string, decision?: UserDecision): string;
