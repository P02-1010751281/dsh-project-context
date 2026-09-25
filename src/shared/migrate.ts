/**
 * One-time migration of the legacy layouts (`.pi/`, `.agents/memory/skills`, `~/.omp`)
 * into the current `.agents` tree.
 */

import { readdir, rm, rmdir } from "node:fs/promises";
import { type Dirent } from "node:fs";
import path from "node:path";
import { cleanStaleTemps, mergePath, readOptional, writeAtomic } from "./files.js";
import { SESSION_LOGS_SUBDIR, SKILLS_SUBDIR, contextFile, legacyOmpDir, legacyPiDir, logsDir, memoryDir, memoryFile, skillsDir, validSkillName } from "./paths.js";

function normalizeSkillDocument(name: string, raw: string): string {
	if (raw.startsWith("---")) return `${raw.trimEnd()}\n`;
	const description = raw.split("\n")[0]!.trim().slice(0, 1024);
	return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${raw.trim()}\n`;
}

/**
 * Import legacy `<name>/SKILL.md` directories.
 *
 * A destination that already carries the skill is only consumed when the legacy directory holds
 * **nothing the destination lacks**: the previous version deleted the whole source directory as soon
 * as the destination `SKILL.md` existed, taking a newer hand-edited body and every sibling asset
 * (`reference.md`, examples, scripts) with it, with no comparison, no backup and no report. A
 * divergent directory is left in place and returned as a conflict so the caller can say so.
 */
async function importSkillDirs(sourceDir: string, targetDir: string, options: { remove?: boolean } = {}): Promise<{ imported: number; conflicts: string[] }> {
	let entries: Dirent<string>[];
	try {
		entries = await readdir(sourceDir, { withFileTypes: true });
	} catch {
		return { imported: 0, conflicts: [] };
	}

	let imported = 0;
	const conflicts: string[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory() || !validSkillName(entry.name)) continue;
		const source = path.join(sourceDir, entry.name);
		const raw = (await readOptional(path.join(source, "SKILL.md"))).trim();
		if (!raw) continue;
		const destinationDir = path.join(targetDir, entry.name);
		const destination = path.join(destinationDir, "SKILL.md");
		const existing = await readOptional(destination);
		if (existing) {
			const normalized = normalizeSkillDocument(entry.name, raw);
			const siblings = (await readdir(source, { withFileTypes: true })).filter((child) => child.name !== "SKILL.md");
			if (siblings.length > 0 || normalized !== existing) {
				conflicts.push(destinationDir);
				continue;
			}
			// An exact duplicate of the live skill: nothing is lost by consuming it.
			if (options.remove) await rm(source, { recursive: true, force: true });
			continue;
		}
		await writeAtomic(destination, normalizeSkillDocument(entry.name, raw));
		if (options.remove) await rm(source, { recursive: true, force: true });
		imported += 1;
	}
	if (options.remove) await rmdir(sourceDir).catch(() => undefined);
	return { imported, conflicts };
}

export type MigrationResult = {
	moved: string[];
	importedSkills: number;
	/** Destination paths whose legacy counterpart was newer and was discarded, not merged. */
	superseded: string[];
	/** Destination paths whose legacy counterpart could not be merged and was left in place. */
	conflicts: string[];
};

/** Consolidate legacy memory, context, logs and skills into the `.agents/` layout. */
export async function migrateProjectState(projectRoot: string): Promise<MigrationResult> {
	const moved: string[] = [];
	const superseded: string[] = [];
	const conflicts: string[] = [];
	const legacyPi = legacyPiDir(projectRoot);
	const moves: Array<[string, string]> = [
		[path.join(legacyPi, "MEMORY.md"), memoryFile(projectRoot)],
		[path.join(legacyPi, "CONTEXT.md"), contextFile(projectRoot)],
		[path.join(legacyPi, SESSION_LOGS_SUBDIR), logsDir(projectRoot)],
	];
	for (const [source, destination] of moves) {
		const label = path.relative(projectRoot, destination) || destination;
		const outcome = await mergePath(source, destination);
		if (outcome === "merged") moved.push(label);
		if (outcome === "superseded") superseded.push(label);
		if (outcome === "conflict") conflicts.push(label);
	}

	const imported = [
		await importSkillDirs(path.join(legacyPi, SKILLS_SUBDIR), skillsDir(projectRoot), { remove: true }),
		await importSkillDirs(path.join(memoryDir(projectRoot), SKILLS_SUBDIR), skillsDir(projectRoot), { remove: true }),
		await importSkillDirs(path.join(legacyOmpDir(projectRoot), SKILLS_SUBDIR), skillsDir(projectRoot)),
	];
	const importedSkills = imported.reduce((sum, result) => sum + result.imported, 0);
	for (const result of imported) {
		for (const directory of result.conflicts) conflicts.push(path.relative(projectRoot, directory) || directory);
	}

	await cleanStaleTemps(legacyPi);
	await cleanStaleTemps(memoryDir(projectRoot));
	// Drop the legacy directory when migration emptied it.
	await rmdir(legacyPi).catch(() => undefined);

	return { moved, importedSkills, superseded, conflicts };
}
