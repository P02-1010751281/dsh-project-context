/**
 * The routing skill (`.agents/skills/dsh-project-context-maintenance/SKILL.md`) is the entry point
 * that tells an agent which command, file or procedure skill owns a maintenance task on the four
 * plugins. Its failure mode is silent: a renamed or deleted target skill turns a row into a dead
 * pointer, and a corpus-wide name collision makes one skill unreachable without any error — dsh's
 * filesystem provider resolves by frontmatter `name` and never reports the shadowing.
 *
 * So the gate is mechanical: the file parses under the provider's own rules, every name it points at
 * exists on the layer it lives on, every command it names is really registered in `src/`, and the
 * body stays a single decision table instead of growing a second copy of the procedures.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const skillsRoot = path.join(repositoryRoot, ".agents", "skills");
const routingName = "dsh-project-context-maintenance";
const routingPath = path.join(skillsRoot, routingName, "SKILL.md");

/**
 * Skills the table reaches that do not live in this repo's project layer. They are installed in the
 * user layer (`~/.agents/skills`), so a clean clone cannot prove them and only the names are pinned.
 */
const USER_LAYER_SKILLS = new Set(["agents-memory-recovery", "dsh-session-archive-repair"]);

/** dsh's own skill-name grammar (`packages/skill/skill/src/index.ts`): kebab, no leading digit run. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The provider's frontmatter split: a leading `---` block, then the body. */
function parseSkillDocument(text) {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
	assert.ok(match, "the skill starts with a YAML frontmatter block");
	const data = {};
	for (const line of match[1].split(/\r?\n/)) {
		const pair = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line);
		if (pair === null) continue;
		data[pair[1]] = pair[2].trim().replace(/^"(.*)"$/, "$1");
	}
	return { data, body: text.slice(match[0].length).trim() };
}

/** The decision table's rows, header and separator excluded. */
function tableRows(body) {
	return body.split("\n").filter((line) => line.startsWith("|")).slice(2);
}

/** The skill a row hands off to: its last cell, or `undefined` for the rows that need no procedure. */
function rowSkill(row) {
	const cells = row.split("|").map((cell) => cell.trim());
	return /^`([a-z0-9-]+)`$/.exec(cells[cells.length - 2])?.[1];
}

/**
 * Every skill the body points at: the `dsh-…` tokens it names anywhere, plus whatever a row hands
 * off to, so a row naming a user-layer skill must declare it above instead of pointing at nothing a
 * clean clone can prove.
 */
function referencedSkillNames(body) {
	return [...new Set([...(body.match(/\bdsh-[a-z0-9]+(?:-[a-z0-9]+)*\b/g) ?? []), ...tableRows(body).map(rowSkill).filter((name) => name !== undefined)])];
}

/**
 * Every `/command` token the body routes to, deduplicated, in source order. A path segment
 * (`/share-fit.mjs`, `.agents/memory/…`) is not a command, so the token must stand alone: neither
 * preceded nor followed by a word character, a dot, a slash or a hyphen.
 */
function referencedCommands(body) {
	return [...new Set(body.match(/(?<![\w./-])\/[a-z][a-z-]*(?![\w./-])/g) ?? [])].map((token) => token.slice(1));
}

/** The command names the four plugins register, read from the source that registers them. */
function registeredCommands() {
	const names = new Set();
	for (const plugin of readdirSync(path.join(repositoryRoot, "src"))) {
		const file = path.join(repositoryRoot, "src", plugin, "index.ts");
		let source;
		try {
			source = readFileSync(file, "utf8");
		} catch {
			continue;
		}
		for (const match of source.matchAll(/ctx\.commands\.register\(\{\s*name:\s*"([^"]+)"/g)) names.add(match[1]);
	}
	return names;
}

/** Every skill directory in the project layer with its frontmatter name, or `undefined` when it has none. */
function corpusNames() {
	const found = new Map();
	for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		let text;
		try {
			text = readFileSync(path.join(skillsRoot, entry.name, "SKILL.md"), "utf8");
		} catch {
			continue;
		}
		const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
		const name = match === null ? undefined : /^name:\s*(.+)$/m.exec(match[1])?.[1].trim().replace(/^"(.*)"$/, "$1");
		found.set(entry.name, name);
	}
	return found;
}

test("the routing skill parses under the provider's rules: kebab name, a description, a body", () => {
	const { data, body } = parseSkillDocument(readFileSync(routingPath, "utf8"));
	assert.equal(data.name, routingName, "the frontmatter name matches its directory, so one name finds it");
	assert.match(data.name, SKILL_NAME);
	assert.ok((data.description ?? "").length > 80, "the description carries the trigger branches, not a label");
	assert.ok((data.description ?? "").length < 500, "a description is permanent context load, so it stays short");
	assert.ok(body.length > 0, "the body is what the tool loads");
});

test("no two project-layer skills claim one name", () => {
	const corpus = corpusNames();
	const owners = new Map();
	for (const [directory, name] of corpus) {
		if (name === undefined) continue;
		owners.set(name, [...(owners.get(name) ?? []), directory]);
	}
	const collisions = [...owners].filter(([, directories]) => directories.length > 1);
	assert.deepEqual(collisions, [], "a duplicated frontmatter name silently shadows one directory");
	assert.equal(owners.get(routingName)?.length, 1, "the routing skill owns its name outright");
});

test("every skill the table points at exists on the layer it lives on", () => {
	const { body } = parseSkillDocument(readFileSync(routingPath, "utf8"));
	const referenced = referencedSkillNames(body);
	assert.ok(referenced.length >= 8, `expected the table to route to the procedure skills it replaces; got ${referenced.join(", ")}`);
	const corpus = corpusNames();
	for (const name of referenced) {
		if (USER_LAYER_SKILLS.has(name)) continue;
		assert.ok(corpus.has(name), `the routing table points at ${name}, which has no .agents/skills/${name}/SKILL.md`);
	}
});

test("every command the table routes to is really registered", () => {
	const { body } = parseSkillDocument(readFileSync(routingPath, "utf8"));
	const registered = registeredCommands();
	assert.deepEqual([...registered].sort(), ["autolearn", "context", "handoff", "memory", "session-log"], "the five command surfaces are the ones the plugins register");
	for (const command of referencedCommands(body)) {
		assert.ok(registered.has(command), `the routing table names /${command}, which no plugin registers`);
	}
});

test("the body stays a router: four blocks, one table, no procedure", () => {
	const { body } = parseSkillDocument(readFileSync(routingPath, "utf8"));
	// Read the markers off the table rows, not the prose: the intro names all four, so an
	// anywhere-in-body check would stay green after a whole block lost its rows.
	const rows = body.split("\n").filter((line) => line.startsWith("|"));
	for (const marker of ["①", "②", "③", "④"]) {
		assert.ok(rows.some((row) => row.startsWith(`| ${marker} |`)), `the table routes all four plugin blocks; no row carries ${marker}`);
	}
	assert.ok(body.length < 3000, `a router is a table, not a manual: body is ${body.length} characters`);
	assert.ok(!body.includes("```"), "no code blocks: the procedures belong to the skills the rows name");
	assert.ok(rows.length >= 12, `the table routes the maintenance surface; only ${rows.length} table lines`);
	assert.ok(rows[0].includes("Procedure skill"), "the decision table names the skill each row hands off to");
	for (const row of tableRows(body)) {
		const cells = row.split("|").map((cell) => cell.trim());
		const last = cells[cells.length - 2];
		assert.ok(/^(`[a-z0-9-]+`|—)$/.test(last), `every row ends in one procedure skill or an em dash, never prose: ${row}`);
	}
});
