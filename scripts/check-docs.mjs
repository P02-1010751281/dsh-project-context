#!/usr/bin/env node
/**
 * The repository's own documentation gate.
 *
 * Everything `RULES.md` says about docs is mechanical enough to check: links resolve from the
 * document's own directory, a `path:line` evidence ref points at a real line, a symbol named next
 * to that ref is present at it, the oversized-file baselines in 3.2 match the tree, and the
 * dependency whitelist in `docs/architecture.md` §2 matches the imports in `src/`.
 *
 * The point is that these cannot rot silently: the numbers live in the rules, the rules point at
 * this command, and this command reads the tree. `--root` exists so the tests can feed it known
 * bad documents instead of mutating the real ones.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, posix, resolve, sep } from "node:path";

const failures = [];
const checked = { links: 0, anchors: 0, symbols: 0, baselines: 0, edges: 0 };

/** Root of the tree under test; the real repo unless a test fixture overrides it. */
function parseRoot(argv) {
	const index = argv.indexOf("--root");
	if (index === -1) return resolve(dirname(new URL(import.meta.url).pathname), "..");
	const value = argv[index + 1];
	if (value === undefined) throw new Error("--root needs a directory");
	return resolve(value);
}

function fail(check, detail) {
	failures.push(`${check}: ${detail}`);
}

function read(path) {
	return readFileSync(path, "utf8");
}

/** Markdown files that are current documentation (the frozen archive is out of the link gate). */
function currentDocs(root) {
	const files = ["README.md", "RULES.md", "AGENTS.md", "CHANGELOG.md"].map((name) => join(root, name)).filter(existsSync);
	const docs = join(root, "docs");
	const walk = (dir) => {
		if (!existsSync(dir)) return;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === "archive" || entry.name === "changelog") continue;
				walk(path);
			} else if (entry.name.endsWith(".md")) {
				files.push(path);
			}
		}
	};
	walk(docs);
	return files;
}

/**
 * Links must resolve from the document's own directory (standard Markdown semantics). Fragments
 * are not checked: every anchor we use is a plain file.
 */
function prose(text) {
	const lines = [];
	let fenced = false;
	for (const line of text.split("\n")) {
		if (/^\s*```/.test(line)) {
			fenced = !fenced;
			continue;
		}
		if (fenced) continue;
		lines.push(line.replace(/`[^`]*`/g, ""));
	}
	return lines.join("\n");
}

function checkLinks(root) {
	for (const file of currentDocs(root)) {
		checked.links += 1;
		const text = prose(read(file));
		for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
			const target = match[1];
			if (/^(?:https?:|mailto:|#)/.test(target)) continue;
			const path = resolve(dirname(file), target.split("#")[0]);
			if (!existsSync(path)) fail("link", `${relative(root, file)} -> ${target}`);
		}
	}
}

const REF = /`([^`]+\.(?:ts|tsx|mjs|json|yml)):(\d+)(?:-(\d+))?`/g;
/** A ref directly paired with the symbol it claims: `` `symbol`（`path:line`） ``. */
const SYMBOL_BEFORE = /`([A-Za-z_$][A-Za-z0-9_$]*)`\s*（\s*$/;
/** The same pair written the other way: `` `path:line` 的 `symbol` ``. */
const SYMBOL_AFTER = /^\s*(?:的\s*)?`([A-Za-z_$][A-Za-z0-9_$]*)`/;

function sourceFiles(root, refPath) {
	const candidates = [resolve(dirname(refPath), ""), join(root, "docs")];
	return candidates;
}

/** Resolve a ref target: relative to the document's directory first, then the repo root. */
function resolveRef(root, docPath, target) {
	for (const base of [dirname(docPath), root]) {
		const path = join(base, target);
		if (existsSync(path)) return path;
	}
	return undefined;
}

function checkAnchors(root) {
	const files = ["RULES.md", "AGENTS.md", join("docs", "architecture.md"), join("docs", "GLOSSARY.md")]
		.map((name) => join(root, name))
		.filter(existsSync);
	for (const file of files) {
		const lines = read(file).split("\n");
		for (const [index, line] of lines.entries()) {
			for (const match of line.matchAll(REF)) {
				checked.anchors += 1;
				const [whole, target, from, to] = match;
				const path = resolveRef(root, file, target);
				if (path === undefined) {
					fail("anchor", `${relative(root, file)}:${index + 1} -> ${target} (no such file)`);
					continue;
				}
				const total = read(path).split("\n").length;
				const last = to === undefined ? Number(from) : Number(to);
				if (Number(from) < 1 || last > total || Number(from) > last) {
					fail("anchor", `${relative(root, file)}:${index + 1} -> ${target}:${from}${to === undefined ? "" : `-${to}`} (file has ${total} lines)`);
					continue;
				}
				const before = SYMBOL_BEFORE.exec(line.slice(0, match.index));
				const after = SYMBOL_AFTER.exec(line.slice(match.index + whole.length));
				const symbol = before?.[1] ?? after?.[1];
				if (symbol === undefined) continue;
				checked.symbols += 1;
				const window = read(path).split("\n").slice(Math.max(0, Number(from) - 5), last + 8).join("\n");
				if (!window.includes(symbol)) {
					fail("symbol", `${relative(root, file)}:${index + 1} claims ${symbol} at ${target}:${from} but it is not within that line's window`);
				}
			}
		}
	}
}

/** 3.2: the declared oversized-file baselines must equal the tree, and nothing else may exceed 900. */
function checkBaselines(root) {
	const rules = join(root, "RULES.md");
	if (!existsSync(rules)) return;
	const declared = new Map();
	for (const match of read(rules).matchAll(/`([^`]+\.ts)`\s*(\d+)\s*行/g)) declared.set(match[1], Number(match[2]));
	// An empty baseline list is the healthy state (no file over 900 lines), not a reason to skip the
	// oversize half below — that half is what keeps the next 900+ line file from landing undeclared.
	const files = [];
	for (const dir of ["src", "client"]) {
		const walk = (path) => {
			if (!existsSync(path)) return;
			for (const entry of readdirSync(path, { withFileTypes: true })) {
				const child = join(path, entry.name);
				if (entry.isDirectory()) walk(child);
				else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(child);
			}
		};
		walk(join(root, dir));
	}
	const measured = new Map(files.map((file) => [relative(root, file), read(file).split("\n").length - 1]));
	for (const [file, lines] of declared) {
		checked.baselines += 1;
		const actual = measured.get(file);
		if (actual === undefined) {
			fail("baseline", `RULES.md names ${file} but it is missing`);
		} else if (actual !== lines) {
			fail("baseline", `RULES.md says ${file} is ${lines} lines; it is ${actual}`);
		}
	}
	for (const [file, lines] of measured) {
		if (lines > 900 && !declared.has(file)) fail("baseline", `${file} is ${lines} lines and is not declared in RULES.md 3.2`);
	}
}

/** 4.2: the architecture edge table and specifier list must match the imports in `src/`. */
function checkEdges(root) {
	const arch = join(root, "docs", "architecture.md");
	if (!existsSync(arch)) return;
	const text = read(arch);
	const section = text.split("## 2 ")[1]?.split("\n## ")[0];
	if (section === undefined) return;
	const declared = new Set();
	for (const match of section.matchAll(/`(src\/[^`]+\.ts):(\d+)`/g)) declared.add(`${match[1]}:${match[2]}`);
	const listAt = section.indexOf("specifier 集合");
	const listText = listAt === -1 ? "" : section.slice(listAt).split("\n\n")[0];
	const specifiers = new Set([...listText.matchAll(/`(\.\.\/project-[^`]+\.js)`/g)].map((match) => match[1]));
	const actual = new Set();
	const specifierHits = [];
	const walk = (dir) => {
		if (!existsSync(dir)) return;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (entry.name.endsWith(".ts")) {
				for (const [index, line] of read(path).split("\n").entries()) {
					for (const match of line.matchAll(/from\s+"(\.\.\/project-[^"]+)"/g)) {
						actual.add(`${relative(root, path)}:${index + 1}`);
						specifierHits.push(match[1]);
					}
				}
			}
		}
	};
	walk(join(root, "src"));
	checked.edges += 1;
	for (const ref of actual) if (!declared.has(ref)) fail("edges", `${ref} is not in the architecture whitelist`);
	for (const ref of declared) if (!actual.has(ref)) fail("edges", `${ref} is declared in the architecture whitelist but no longer imports a project module`);
	for (const specifier of new Set(specifierHits)) {
		if (!specifiers.has(specifier)) fail("edges", `specifier ${specifier} is not in the architecture specifier list`);
	}
	const rule = read(join(root, "RULES.md"));
	const counts = /(\d+) 个不同 specifier、共 (\d+) 处/.exec(rule);
	if (counts !== null) {
		const distinct = new Set(specifierHits).size;
		if (distinct !== Number(counts[1]) || specifierHits.length !== Number(counts[2])) {
			fail("edges", `RULES.md says ${counts[1]} specifiers / ${counts[2]} imports; the tree has ${distinct} / ${specifierHits.length}`);
		}
	}
}

function relative(root, path) {
	return path.startsWith(root) ? path.slice(root.length + 1).split(sep).join(posix.sep) : path;
}

const root = parseRoot(process.argv);
checkLinks(root);
checkAnchors(root);
checkBaselines(root);
checkEdges(root);

const total = Object.values(checked).reduce((sum, value) => sum + value, 0);
const scope = `${checked.links} doc link file(s), ${checked.anchors} anchor ref(s), ${checked.symbols} symbol ref(s), ${checked.baselines} baseline file(s), ${checked.edges} dependency check`;
for (const failure of failures) console.error(`FAIL ${failure}`);
console.log(`docs check: ${total} item(s) (${scope}), ${failures.length} failure(s)`);
process.exitCode = failures.length === 0 ? 0 : 1;
