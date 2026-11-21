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

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat } from "node:fs/promises";
import path from "node:path";
import { anchorCandidates, isLocalArtifact } from "../shared/anchors.js";
import { readOptional, writeAtomic } from "../shared/files.js";
import { memoryDir, skillsDir } from "../shared/paths.js";
import { withMemoryLock } from "../shared/lock.js";
import { logError } from "../shared/error-log.js";
import { autolearnProvenance } from "./skill.js";
import { type SkillFacts, type SkillStateReport, skillStates } from "./skill-state.js";

/** The sidecar that holds one fingerprint per cited path, per learned skill. Local, never tracked. */
export function skillBindingsFile(projectRoot: string): string {
	return path.join(memoryDir(projectRoot), "skill-bindings.json");
}

/** Where an expired skill is parked: out of the harness's skill directory, back under the project. */
export function expiredSkillsDir(projectRoot: string): string {
	return path.join(memoryDir(projectRoot), "expired-skills");
}

/** <name> -> <path> -> <fingerprint>. */
type Bindings = Map<string, Map<string, string>>;

/** Read the bindings. An absent or unreadable file means "nothing recorded", which the state calls unbaselined. */
export async function readSkillBindings(projectRoot: string): Promise<{ readable: boolean; skills: Bindings }> {
	const raw = await readOptional(skillBindingsFile(projectRoot));
	if (raw.trim() === "") return { readable: true, skills: new Map() };
	try {
		const parsed = JSON.parse(raw) as { skills?: Record<string, Record<string, unknown>> };
		const skills: Bindings = new Map();
		for (const [name, paths] of Object.entries(parsed.skills ?? {})) {
			const bindings = new Map<string, string>();
			for (const [file, fingerprint] of Object.entries(paths)) {
				if (typeof fingerprint === "string" && /^[0-9a-f]{16}$/.test(fingerprint)) bindings.set(file, fingerprint);
			}
			if (bindings.size > 0) skills.set(name, bindings);
		}
		return { readable: true, skills };
	} catch {
		return { readable: false, skills: new Map() };
	}
}

/** Replace the bindings file. The map is sorted so two runs of the same corpus write the same bytes. */
async function writeSkillBindings(projectRoot: string, skills: Bindings): Promise<void> {
	const document: Record<string, Record<string, string>> = {};
	for (const name of [...skills.keys()].sort()) {
		const paths = [...(skills.get(name) ?? new Map())].sort(([left], [right]) => left.localeCompare(right));
		if (paths.length === 0) continue;
		document[name] = Object.fromEntries(paths);
	}
	await writeAtomic(skillBindingsFile(projectRoot), `${JSON.stringify({ version: 1, skills: document }, null, "\t")}\n`);
}

/** The fingerprint this project records: a lower-case SHA-256 prefix. */
function fingerprint(bytes: Buffer): string {
	return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

/** The cited paths a skill can be bound to: repo-relative, not a generated or memory artifact, still a file. */
async function bindableAnchors(projectRoot: string, body: string): Promise<string[]> {
	const found: string[] = [];
	for (const token of anchorCandidates(body)) {
		const candidate = token.path;
		if (path.isAbsolute(candidate)) continue;
		if (candidate.startsWith(".agents/memory/") || candidate.startsWith("lib/")) continue;
		if (isLocalArtifact(candidate)) continue;
		if (found.includes(candidate)) continue;
		try {
			if (!(await stat(path.join(projectRoot, candidate))).isFile()) continue;
		} catch {
			continue;
		}
		found.push(candidate);
	}
	return found;
}

/** Every learned skill: a directory under `.agents/skills/` whose document carries the provenance marker. */
export async function learnedSkills(projectRoot: string): Promise<Array<{ name: string; body: string }>> {
	const entries = await readdir(skillsDir(projectRoot), { withFileTypes: true }).catch(() => []);
	const skills: Array<{ name: string; body: string }> = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const body = await readOptional(path.join(skillsDir(projectRoot), entry.name, "SKILL.md"));
		if (body === "" || !autolearnProvenance(body)) continue;
		skills.push({ name: entry.name, body });
	}
	return skills.sort((left, right) => left.name.localeCompare(right.name));
}

/** How many memory/context lines cite one skill by path. */
function referenceCount(documents: readonly string[], name: string): number {
	const needle = new RegExp(`\\.agents/skills/${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
	return documents.reduce((total, document) => total + document.split("\n").filter((line) => needle.test(line)).length, 0);
}

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
export async function bindSkills(projectRoot: string, names?: readonly string[]): Promise<Array<{ name: string; paths: number }>> {
	const learned = await learnedSkills(projectRoot);
	const existing = await readSkillBindings(projectRoot);
	const bound: Array<{ name: string; paths: number }> = [];
	await withMemoryLock(skillBindingsFile(projectRoot), async () => {
		const next = new Map((await readSkillBindings(projectRoot)).skills);
		for (const skill of learned) {
			if (names !== undefined && !names.includes(skill.name)) continue;
			if (names === undefined && existing.skills.has(skill.name)) continue;
			if (next.has(skill.name)) continue;
			const anchors = await bindableAnchors(projectRoot, skill.body);
			if (anchors.length === 0) continue;
			const paths = new Map<string, string>();
			for (const anchor of anchors) paths.set(anchor, fingerprint(await readFile(path.join(projectRoot, anchor))));
			next.set(skill.name, paths);
			bound.push({ name: skill.name, paths: paths.size });
		}
		if (bound.length > 0) await writeSkillBindings(projectRoot, next);
	});
	return bound;
}

/**
 * Judge every learned skill against its baseline and the files it cites.
 * @param projectRoot - the project whose skills and memory documents are read.
 * @returns the report plus the per-skill facts an action needs.
 */
export async function measureSkillStates(projectRoot: string): Promise<SkillStateReport & { facts: ReadonlyMap<string, SkillFacts> }> {
	const learned = await learnedSkills(projectRoot);
	const allDirs = (await readdir(skillsDir(projectRoot), { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory()).length;
	const bindings = await readSkillBindings(projectRoot);
	const documents = [await readOptional(path.join(memoryDir(projectRoot), "MEMORY.md")), await readOptional(path.join(memoryDir(projectRoot), "CONTEXT.md"))];
	const facts: SkillFacts[] = [];
	for (const skill of learned) {
		const recorded = bindings.skills.get(skill.name) ?? new Map<string, string>();
		const changed: string[] = [];
		const missing: string[] = [];
		const moved: string[] = [];
		for (const [file, baseline] of recorded) {
			const absolute = path.join(projectRoot, file);
			try {
				const bytes = await readFile(absolute);
				if (fingerprint(bytes) !== baseline) changed.push(file);
			} catch {
				missing.push(file);
				const parentExists = await stat(path.dirname(absolute)).then((stats) => stats.isDirectory()).catch(() => false);
				if (!parentExists) moved.push(file);
			}
		}
		facts.push({ name: skill.name, bound: recorded.size, changed, missing, moved, references: referenceCount(documents, skill.name) });
	}
	return { ...skillStates(facts, { total: allDirs }), facts: new Map(facts.map((entry) => [entry.name, entry])) };
}

/** What one expiry attempt did. Every refusal is named, because the receipt repeats it. */
export type ExpireOutcome =
	| { readonly status: "moved"; readonly from: string; readonly to: string }
	| { readonly status: "no-such-skill" }
	| { readonly status: "not-expired"; readonly state: string }
	| { readonly status: "unbaselined" };

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
export async function expireSkill(projectRoot: string, name: string): Promise<ExpireOutcome> {
	const report = await measureSkillStates(projectRoot);
	const facts = report.facts.get(name);
	if (facts === undefined) return { status: "no-such-skill" };
	if (facts.bound === 0) return { status: "unbaselined" };
	const verdict = report.verdicts.find((entry) => entry.name === name);
	if (verdict?.state !== "expired") return { status: "not-expired", state: verdict?.state ?? "unknown" };
	const source = path.join(skillsDir(projectRoot), name);
	const destination = path.join(expiredSkillsDir(projectRoot), name);
	await mkdir(expiredSkillsDir(projectRoot), { recursive: true });
	await rename(source, destination);
	await withMemoryLock(skillBindingsFile(projectRoot), async () => {
		const current = await readSkillBindings(projectRoot);
		const next = new Map(current.skills);
		next.delete(name);
		await writeSkillBindings(projectRoot, next);
	});
	return { status: "moved", from: source, to: destination };
}

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
export async function retireExpiredSkills(projectRoot: string): Promise<Array<{ name: string; to: string }>> {
	const report = await measureSkillStates(projectRoot);
	const moved: Array<{ name: string; to: string }> = [];
	for (const verdict of report.verdicts) {
		if (verdict.state !== "expired") continue;
		const outcome = await expireSkill(projectRoot, verdict.name);
		if (outcome.status !== "moved") continue;
		moved.push({ name: verdict.name, to: outcome.to });
		await logError(projectRoot, "autolearn", `learned skill "${verdict.name}" was moved out of service: ${verdict.detail}`);
	}
	return moved;
}
