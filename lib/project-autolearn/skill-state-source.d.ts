/**
 * The skill-expiry pass, I/O half: read a learned skill's citations, keep the baselines, and move an
 * expired one out of service.
 *
 * Three rules decide what this file may do, and each one is a refusal of the easy version:
 *
 * 1. **Only a skill this pipeline generated** is ever moved. The provenance marker is the permission
 *    slip; a hand-written skill is read and reported, never touched.
 * 2. **A moved directory is not an expiry.** A citation whose parent directory is gone is ambiguous (the
 *    memory core refuses to judge it for the same reason), so `expired` requires every citation to be
 *    missing from directories that still exist.
 * 3. **The baseline is written once**, when the skill is promoted, and never refreshed while its body is
 *    unchanged — a refresh would erase the very drift the pass exists to find.
 */
import { type SkillFacts, type SkillStateReport } from "./skill-state.js";
/** The sidecar that holds one fingerprint per cited path, per learned skill. Local, never tracked. */
export declare function skillBindingsFile(projectRoot: string): string;
/** Where an expired skill is parked: out of the harness's skill directory, back under the project. */
export declare function expiredSkillsDir(projectRoot: string): string;
/** <name> -> <path> -> <fingerprint>. */
type Bindings = Map<string, Map<string, string>>;
/** Read the bindings. An absent or unreadable file means "nothing recorded", which the state calls unbaselined. */
export declare function readSkillBindings(projectRoot: string): Promise<{
    readable: boolean;
    skills: Bindings;
}>;
/** Every learned skill: a directory under `.agents/skills/` whose document carries the provenance marker. */
export declare function learnedSkills(projectRoot: string): Promise<Array<{
    name: string;
    body: string;
}>>;
/**
 * Record a baseline for one learned skill, or for every learned skill without one.
 *
 * The only writer of a first baseline. Called when a skill is promoted and, on request, to backfill the
 * corpus that predates this pass — never from a read, because a status command that wrote would change
 * what the next status says.
 * @param projectRoot - the project whose skills are bound.
 * @param names - the skills to bind; omit for every learned skill that has no baseline yet.
 * @returns the names that were bound, with how many paths each recorded.
 */
export declare function bindSkills(projectRoot: string, names?: readonly string[]): Promise<Array<{
    name: string;
    paths: number;
}>>;
/**
 * Judge every learned skill against its baseline and the files it cites.
 * @param projectRoot - the project whose skills and memory documents are read.
 * @returns the report plus the per-skill facts an action needs.
 */
export declare function measureSkillStates(projectRoot: string): Promise<SkillStateReport & {
    facts: ReadonlyMap<string, SkillFacts>;
}>;
/** What one expiry attempt did. Every refusal is named, because the receipt repeats it. */
export type ExpireOutcome = {
    readonly status: "moved";
    readonly from: string;
    readonly to: string;
} | {
    readonly status: "no-such-skill";
} | {
    readonly status: "not-expired";
    readonly state: string;
} | {
    readonly status: "unbaselined";
};
/**
 * Move one expired skill out of the harness's view and drop its baseline.
 *
 * A move rather than a delete: `.agents/memory/expired-skills/<name>/` keeps the document and the history
 * that explains why it existed, and restoring it is moving the directory back. Only a skill whose state is
 * `expired` is moved, and only a generated one — the provenance check runs again here rather than trusting
 * the caller, because this is the one place that touches a directory the harness loads.
 * @param projectRoot - the project the skill lives in.
 * @param name - the skill name.
 * @returns what happened.
 */
export declare function expireSkill(projectRoot: string, name: string): Promise<ExpireOutcome>;
/**
 * Move every `expired` learned skill out of service, and log each move.
 *
 * The one transition the plugin fires by itself, and the reason the state exists: a skill whose cited
 * files are all gone is not merely stale, it is pointing a reader at code that no longer exists, and
 * waiting for a human to notice is how the corpus accumulated unmaintained entries. The refusals above
 * (provenance, moved directories) still apply — this is a loop over `expireSkill`, not a second rule.
 * @param projectRoot - the project whose learned skills are checked.
 * @returns the skills that were moved.
 */
export declare function retireExpiredSkills(projectRoot: string): Promise<Array<{
    name: string;
    to: string;
}>>;
export {};
