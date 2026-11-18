/**
 * The on-disk **shim** for skill evidence: the only file that knows where a project keeps its skills,
 * how a `SKILL.md` frontmatter spells the evidence keys, and which legacy comment an older candidate
 * carries.
 *
 * Mirror: `<project>/.agents/skills/<name>/SKILL.md` (frontmatter `derived_from` / `evidence`, body
 * marker) and `<project>/.agents/memory/MEMORY.md` bullet entries. The domain rules — which session
 * ids count as evidence, how a receipt spells them, when two documents conflict — live in the sibling
 * core `evidence.ts` and stay pure; this file only turns files into those DTOs and the DTOs into the
 * frontmatter block a `SKILL.md` carries.
 *
 * Removal condition: dsh currently accepts only `{name, description, source, content}` for a skill
 * (`ctx.skills.register`), so provenance has to live in the file. Once the host exposes per-skill
 * metadata that round-trips arbitrary fields, the two frontmatter keys can move there and
 * {@link withEvidenceFrontmatter} / {@link evidenceOfDocument} can be deleted. Until then this shim is
 * the one place a `SKILL.md` layout change lands; it is registered as `SH-11` in the harness
 * integration registry.
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { memoryFile, readOptional, skillsDir, validSkillName } from "../shared/project-state.js";
import {
	type ConflictDocument,
	type MemoryEntry,
	EVIDENCE_DERIVED_FROM,
	normalizeEvidence,
} from "./evidence.js";
import { autolearnProvenance, skillBody, withoutAutolearnProvenance } from "./skill.js";

/** One existing skill, reduced to what the evidence and conflict readers need. */
export interface EvidenceSkillRow extends ConflictDocument {
	/** Session ids the skill records, already normalized; empty for a skill promoted before this batch. */
	readonly evidence: readonly string[];
	/** True when this pipeline wrote the skill (the body marker), i.e. an old learned skill with no evidence. */
	readonly learned: boolean;
}

/** The project-side corpus one conflict check reads: every skill body plus the memory bullets. */
export interface EvidenceCorpus {
	readonly skills: readonly EvidenceSkillRow[];
	readonly memory: readonly MemoryEntry[];
}

/** The `SKILL.md` frontmatter block this shim owns: exactly the first one, at the top of the file. */
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;

/** One `evidence:` line, as this shim writes it: a quoted YAML flow sequence. */
const EVIDENCE_LINE = /^evidence:\s*\[(.*)\]\s*$/;

/** The legacy candidate comment: `<!-- evidence: a, b — reason -->`, written before the frontmatter keys. */
const LEGACY_EVIDENCE_COMMENT = /<!--\s*evidence:\s*([^>\n]*?)\s*-->/;

/**
 * Read the evidence a `SKILL.md` (or a candidate document) records.
 *
 * The frontmatter is authoritative. The legacy comment is the fallback for candidates written before
 * this batch: they carry the ids only there, and an approved old candidate must not silently lose
 * them. The comment also carries a free-text reason after an em dash, so the ids are taken from its
 * front and a token that is not id-shaped ends the list.
 */
export function evidenceOfDocument(raw: string): string[] {
	const frontmatter = FRONTMATTER.exec(raw);
	if (frontmatter) {
		for (const line of frontmatter[1].split("\n")) {
			const match = EVIDENCE_LINE.exec(line.trim());
			if (match) return normalizeEvidence(parseFlowSequence(match[1]));
		}
	}
	const comment = LEGACY_EVIDENCE_COMMENT.exec(raw);
	if (!comment) return [];
	const beforeReason = comment[1].split("—")[0];
	return normalizeEvidence(beforeReason.split(",").map((part) => part.trim()).filter(isIdShaped));
}

function isIdShaped(value: string): boolean {
	return value !== "" && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

/** Read a YAML flow sequence's items; quoting is ours, so stripping the surrounding quotes is enough. */
function parseFlowSequence(value: string): string[] {
	return value.split(",").map((part) => {
		const item = part.trim();
		if ((item.startsWith('"') && item.endsWith('"')) || (item.startsWith("'") && item.endsWith("'"))) {
			return item.slice(1, -1);
		}
		return item;
	});
}

/**
 * Insert the optional evidence keys into a promoted document's frontmatter.
 *
 * Absent evidence leaves the bytes untouched rather than writing an empty list: a document with no
 * citation is exactly the historical shape, and `evidence: []` would claim a check that recorded
 * nothing. A document without frontmatter is returned unchanged too — this shim rewrites only the
 * layout it wrote.
 */
export function withEvidenceFrontmatter(document: string, evidence: readonly string[] | undefined, derivedFrom = EVIDENCE_DERIVED_FROM): string {
	const ids = normalizeEvidence(evidence);
	if (ids.length === 0) return document;
	const frontmatter = FRONTMATTER.exec(document);
	if (!frontmatter) return document;
	const block = [
		"---",
		frontmatter[1],
		`derived_from: ${derivedFrom}`,
		`evidence: [${ids.map((id) => JSON.stringify(id)).join(", ")}]`,
		"---",
		"",
	].join("\n");
	// A function replacement: the block contains `$` in no position today, but a path-like id with `$&`
	// would otherwise be reinterpreted as a replacement pattern.
	return document.replace(frontmatter[0], () => block);
}

/**
 * Read every project skill body plus the memory bullets the conflict check compares against.
 *
 * @param projectRoot - resolved project root.
 * @param options.exclude - a skill name to leave out (the candidate being approved already owns that
 *   name, so comparing it against its own previous body would report the supersede as a conflict with
 *   itself).
 */
export async function readEvidenceCorpus(projectRoot: string, options: { exclude?: string } = {}): Promise<EvidenceCorpus> {
	const entries = await readdir(skillsDir(projectRoot), { withFileTypes: true }).catch(() => []);
	const skills: EvidenceSkillRow[] = [];
	for (const entry of entries.slice().sort((left, right) => left.name.localeCompare(right.name))) {
		if (!entry.isDirectory() || !validSkillName(entry.name) || entry.name === options.exclude) continue;
		const raw = await readOptional(path.join(skillsDir(projectRoot), entry.name, "SKILL.md"));
		skills.push({
			name: entry.name,
			text: withoutAutolearnProvenance(skillBody(raw)),
			evidence: evidenceOfDocument(raw),
			learned: autolearnProvenance(raw),
		});
	}
	return { skills, memory: memoryEntries(await readOptional(memoryFile(projectRoot))) };
}

/**
 * `MEMORY.md` as the bullet entries the conflict check reads.
 *
 * One entry per top-level `- ` bullet: a memory line is the unit that either restates a procedure or
 * does not, and a continuation line has no meaning on its own.
 */
function memoryEntries(raw: string): string[] {
	return raw
		.split("\n")
		.map((line) => line.trimEnd())
		.filter((line) => line.startsWith("- "))
		.map((line) => line.slice(2));
}
