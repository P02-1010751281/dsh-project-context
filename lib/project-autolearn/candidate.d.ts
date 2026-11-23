/**
 * Candidate skills on disk: the pending `<name>.md` files, the admission rules a proposal must
 * pass, and the approve/reject transitions the `/autolearn` command drives.
 */
import { type DocumentLanguage } from "../shared/language.js";
import { type ProposedSkill } from "./skill.js";
/**
 * The shape rules every skill must pass, whichever path read it. A proposal from the model and a
 * candidate file on disk are the *same document*, so judging them with two copies of the rules is
 * how `approveCandidate` ended up re-deriving four of them — and a candidate approved by hand could
 * have skipped any rule the copy forgot. One pure predicate, shared by both callers.
 *
 * The name is deliberately not part of this predicate: `rejectionReason` checks it, and the
 * approve/reject CLI paths validate their argument themselves. The pass path does **not**
 * pre-validate it — `parseAutolearnReply` only requires `typeof name === "string"` (then trims it) — so the
 * name rule in `rejectionReason` is load-bearing, not caller-guaranteed. That rule also runs before
 * the shape rules, so a doubly-invalid proposal reports the name; both facts are pinned by tests.
 */
export declare function shapeRejection(description: string, body: string): string | undefined;
/**
 * Save a proposed skill. Returns `"live"`/`"candidate"` when written, or the rejection reason so
 * the caller can report *why* instead of claiming the model proposed nothing.
 *
 * A supersede always lands through the candidate gate: the gate lets a marked name through, but the
 * direct publish below may only *create* a name, never replace one. So the only path that replaces
 * a marked skill is `/autolearn approve`, and "the pipeline updated a skill" is always a change a
 * human approved.
 *
 * `shownNames` is the set of learned names whose body this pass actually rendered. A marked name
 * outside it is refused, because a merge over text the model never saw is a blind rewrite wearing a
 * merge's clothes.
 */
export declare function saveProposedSkill(projectRoot: string, skill: ProposedSkill, archived: Set<string>, shownNames?: ReadonlySet<string>): Promise<"live" | "candidate" | {
    rejected: string;
}>;
/** One stored candidate and the citations it records, for `/autolearn list`. */
export interface CandidateDetail {
    readonly name: string;
    readonly evidence: readonly string[];
}
/**
 * Stored candidates with their recorded evidence, sorted by name.
 *
 * The evidence is read from the candidate's own file: it is the same fact `/autolearn approve` later
 * writes into the promoted skill, so the list cannot show one set of ids and the approval record
 * another.
 */
export declare function listCandidateDetails(projectRoot: string): Promise<CandidateDetail[]>;
/** Candidate names, sorted (used by the tests and the reject path's siblings). */
export declare function listCandidates(projectRoot: string): Promise<string[]>;
/** Promote a candidate to a live skill. Exported for the plugin. */
export declare function approveCandidate(projectRoot: string, name: string | undefined, language?: DocumentLanguage): Promise<{
    ok: boolean;
    message: string;
}>;
/** Drop a candidate. Exported for the plugin. */
export declare function rejectCandidate(projectRoot: string, name: string | undefined, language?: DocumentLanguage): Promise<{
    ok: boolean;
    message: string;
}>;
