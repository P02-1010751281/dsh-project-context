/**
 * The two mechanical texts a handoff emits: the archived `HANDOFF.md` document and the child's
 * first message. Neither carries a generated summary — the dropped prefix stays reachable through
 * the session log the payload points at, and the recent tail rides verbatim — so this module holds
 * no model call, no output budget and no timeout.
 */
import { type Session } from "../host/contract.js";
import { type UserDecision } from "./conversation.js";
import { type ContinuationNotice, type HandoffLanguage } from "./language.js";
/**
 * The seed's own identity line, in ASCII in both languages so a tool can find it without knowing
 * which language the handoff ran in.
 *
 * A continuation prompt is the one artifact whose provenance nothing else records: `HANDOFF.md` is
 * per project and is overwritten by the next handoff, while the child session keeps its seed forever.
 * Stamping the seed with a digest of its own body lets a later reader answer "is the seed this child
 * read the one this handoff produced" by hashing the message instead of re-rendering it with whatever
 * version of the scaffolding is current.
 */
export declare const SEED_ID_LABEL = "- handoff-seed: ";
/**
 * The seed's identity, read back from the seed itself.
 *
 * `verified` recomputes the digest over the body with the identity line removed, which is exactly how
 * it was produced: a payload edited after the fact no longer matches its own stamp. Returns
 * `undefined` for text that carries no identity line at all, which is what every seed written before
 * this existed looks like.
 * @param seed - the continuation prompt as stored in the child session.
 * @returns the stamped id and whether the body still hashes to it.
 */
export declare function seedIdentityOf(seed: string): {
    id: string;
    verified: boolean;
} | undefined;
/**
 * The archived `HANDOFF.md` document: header, archive pointers and the file index, and nothing
 * generated. The relative pointers are what the document carries — see `perform.ts` for why the
 * child's first message needs absolute ones instead.
 */
export declare function renderHandoff(session: Session, fileOperations: string, archive: {
    log: string;
    index: string;
}, language: HandoffLanguage, seedId?: string): string;
/**
 * The first message of the fresh session; the archive pointers keep the raw history reachable.
 *
 * The carried state is stated explicitly in three shapes, mirroring pi's post-J `carryKept` /
 * `carryTrimmed` / `carryNothing`: a tail was carried verbatim, a tail was carried but one of its
 * messages was cut at the render cap, or nothing was carried at all (a zero recent budget). The third
 * one matters because a silent seed reads as "nothing to see here", while pi tells the successor to
 * work from the log instead.
 */
export declare function continuation(parentId: string, fileOperations: string, tail: string, archive: {
    log: string;
    index: string;
}, language?: HandoffLanguage, pending?: string, decision?: UserDecision, trimmedTail?: boolean, notice?: ContinuationNotice): string;
