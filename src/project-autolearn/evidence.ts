/**
 * The autolearn **core** for promotion evidence: session citations, the receipt text that shows them,
 * and the mechanical conflict check between a candidate body and what the project already documents.
 *
 * Nothing here reads a file, a context or a host type. The input is a string or a plain data row; the
 * output is data or a string. The on-disk layout — where a project keeps its skills, how a `SKILL.md`
 * frontmatter spells the evidence keys, which legacy comment an older candidate carries — belongs to
 * the sibling shim `evidence-source.ts`, so a layout change touches that file alone and these rules
 * stay testable from plain strings.
 *
 * Why evidence at all: `/autolearn approve` promotes a candidate that a human never saw the *source*
 * of. Recording the session ids the pass verified is what makes the skill's provenance checkable
 * later, without a side file that can drift from the artifact.
 *
 * Why a mechanical conflict check: two learned skills describing the same procedure is the failure a
 * memory/skill corpus accumulates silently. The check is deliberately narrow — it compares backticked
 * key tokens (paths, line references, commands) and reports overlaps; it never decides semantics, never
 * blocks a write, and never calls a model. A false "no conflict" costs nothing (the report is advice);
 * a false conflict on every shared `pnpm test` would train the reader to ignore it.
 *
 * Both receipts are translated here rather than at the call sites: the sentence and the words inside
 * it (`N session(s)`, `skill "x"`, `MEMORY.md entry "…"`) are one vocabulary, and a caller that
 * translated half of it would leave the other half English.
 */

import { type DocumentLanguage, pick } from "../shared/language.js";

/** The provenance value a promoted skill records: the pipeline that produced it. */
export const EVIDENCE_DERIVED_FROM = "autolearn";

/**
 * How many characters of a session id the receipt shows.
 *
 * dsh ids are spelled `session-<uuid>`, so the *first* eight characters would print `session-` for
 * every one of them and identify nothing. The prefix is dropped before the shortening; an id that
 * does not carry it keeps its own first eight characters.
 */
const SHORT_SESSION_ID_CHARS = 8;

const SESSION_PREFIX = "session-";

/** Text the receipt shows when a skill (usually one promoted before evidence was recorded) cites none. */
export const NO_EVIDENCE_TEXT = "no evidence recorded";

/**
 * Normalize a citation list: trimmed, blanks dropped, duplicates collapsed, original order kept.
 *
 * Order is kept rather than sorted because the frontmatter is read by a human as much as by the code:
 * the order the pass verified the ids in is the order they meant something.
 */
export function normalizeEvidence(ids: readonly string[] | undefined): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const raw of ids ?? []) {
		if (typeof raw !== "string") continue;
		const id = raw.trim();
		// A citation is one token on one line: anything else would corrupt a comma-separated frontmatter
		// list or claim a provenance the file cannot represent.
		if (id === "" || /[\s,]/.test(id) || seen.has(id)) continue;
		seen.add(id);
		result.push(id);
	}
	return result;
}

/** The shortened id the receipts show; see {@link SHORT_SESSION_ID_CHARS} for why the prefix is cut. */
export function shortSessionId(id: string): string {
	const trimmed = id.trim();
	const bare = trimmed.startsWith(SESSION_PREFIX) ? trimmed.slice(SESSION_PREFIX.length) : trimmed;
	return bare.slice(0, SHORT_SESSION_ID_CHARS);
}

/**
 * The evidence clause a receipt carries: the count plus every id, shortened.
 *
 * Every id is listed, not the first few: the pass verifies at most a handful (the model asks for up
 * to three sessions), and "2 sessions" without the ids would be a claim the reader cannot check.
 */
export function evidenceText(ids: readonly string[] | undefined, language: DocumentLanguage = "en"): string {
	const unique = normalizeEvidence(ids);
	if (unique.length === 0) return pick(language, "没有记录证据", NO_EVIDENCE_TEXT);
	return pick(
		language,
		`${unique.length} 个会话 — ${unique.map(shortSessionId).join("、")}`,
		`${unique.length} session(s) — ${unique.map(shortSessionId).join(", ")}`,
	);
}

// --- the mechanical conflict check ----------------------------------------------------------

/** One place the candidate overlaps what the project already documents. */
export interface ConflictFinding {
	/** What it overlaps: a skill name, or the memory entry it restates. */
	readonly target: string;
	/** The overlapping key tokens, in the candidate's order. */
	readonly shared: readonly string[];
}

/** A document the conflict check compares against, already reduced to its body text. */
export interface ConflictDocument {
	readonly name: string;
	readonly text: string;
}

/** One `MEMORY.md` bullet, as the shim read it. */
export type MemoryEntry = string;

/** Fenced and inline code: the only place a procedure states a concrete path or command. */
const INLINE_CODE = /`([^`\n]+)`/g;

/** `path/to/file.ts:12` or `path/to/file.ts:12-18`. */
const LINE_REFERENCE = /^[^\s:]+:\d+(?:-\d+)?$/;

/** A file name with a known extension (`MEMORY.md`, `session.jsonl`); stronger with a directory part. */
const FILE_WITH_EXTENSION = /^[\w./@-]+\.(?:ts|tsx|js|mjs|cjs|md|json|jsonl|ya?ml|toml|sh|py|rs|txt)$/;

/** First words that make a backticked span an invocation rather than a bare word. */
const COMMAND_VERBS = new Set([
	"pnpm", "npm", "yarn", "npx", "node", "deno", "bun", "git", "make", "bash", "sh", "zsh",
	"python", "python3", "pytest", "tsc", "eslint", "vitest", "dsh", "curl", "ssh", "docker",
	"ls", "cat", "rm", "cp", "mv", "mkdir", "grep", "sed", "awk", "chmod", "ln",
]);

/**
 * Sub-verbs that name a routine the corpus mentions constantly. `pnpm test` and `pnpm typecheck` are
 * boilerplate in nearly every skill here; counting them as overlap would fire on unrelated skills and
 * make the report noise. A flag or a second argument makes the same span specific again
 * (`pnpm test --filter x`, `pnpm run release`).
 */
const GENERIC_SUBVERBS = new Set([
	"build", "test", "typecheck", "install", "lint", "dev", "start", "status", "diff", "log",
	"version", "add", "commit", "push", "pull", "checkout", "fetch", "run",
]);

/** Whether one backticked span names a concrete place or invocation the corpus can compare. */
function isKeyToken(token: string): boolean {
	if (LINE_REFERENCE.test(token)) return true;
	// A directory part is already decisive, whatever the extension: `src/a/b` is a place, not a word.
	if (token.includes("/") || token.includes("\\")) return true;
	if (FILE_WITH_EXTENSION.test(token)) return true;
	const words = token.split(/\s+/).filter(Boolean);
	if (words.length === 0 || !COMMAND_VERBS.has(words[0])) return false;
	const rest = words.slice(1);
	// A flag carries the specifics (`--filter`, `--dry-run`, `--write`); a bare verb plus a routine
	// sub-verb is the boilerplate case above.
	if (rest.some((word) => word.startsWith("-"))) return true;
	if (rest.length === 0) return false;
	if (rest.length === 1 && GENERIC_SUBVERBS.has(rest[0])) return false;
	return true;
}

/**
 * The key tokens of one document, deduplicated in first-seen order.
 *
 * Only backticked spans are read. A path written as prose (``run the release script``) is not a token
 * this check can compare without becoming a semantics engine, and the prompt already asks for exact
 * commands and paths in backticks, so the corpus speaks this shape.
 */
export function keyTokens(text: string): string[] {
	const seen = new Set<string>();
	const tokens: string[] = [];
	for (const match of text.matchAll(INLINE_CODE)) {
		const token = match[1].trim().replace(/\s+/g, " ");
		if (token === "" || seen.has(token) || !isKeyToken(token)) continue;
		seen.add(token);
		tokens.push(token);
	}
	return tokens;
}

/** The bare file/word tokens: compared only through containment, never on their own. */
function containsAll(outer: readonly string[], inner: readonly string[]): boolean {
	const set = new Set(outer);
	return inner.every((token) => set.has(token));
}

/** How many overlapping tokens a finding names before it summarises the rest. */
const MAX_SHARED_SHOWN = 4;

/**
 * Compare one candidate body against the existing skills and memory entries.
 *
 * The rule is narrow on purpose, and each branch is a *shape* signal rather than a similarity score:
 *
 * 1. A shared **path** (one containing `/`) or a shared `path:line` reference fires immediately —
 *    two procedures that name the same concrete file are describing the same ground, even if only one
 *    token overlaps.
 * 2. Otherwise three or more shared key tokens fire: one or two shared file names can be incidental,
 *    three is a procedure-shaped overlap.
 *
 * A `MEMORY.md` entry is judged by containment instead: every one of the candidate's key tokens
 * (three or more) sits inside the single entry. Memory names every file in the project, so a shared
 * path there means nothing; a whole-token containment does mean the entry already records this
 * workflow. That branch is containment-only because the shared-count rule would fire on any memory
 * line that happens to mention the same three files.
 *
 * @param candidate - the proposed document's name and body.
 * @param skills - existing skills' names and body text (the caller excludes the candidate's own name).
 * @param memory - `MEMORY.md` bullets, already split by the shim.
 * @param language - the language the receipt is written in; the target label is part of the sentence.
 */
export function conflictFindings(
	candidate: { readonly name: string; readonly text: string },
	skills: readonly ConflictDocument[],
	memory: readonly MemoryEntry[],
	language: DocumentLanguage = "en",
): ConflictFinding[] {
	const candidateTokens = keyTokens(candidate.text);
	if (candidateTokens.length === 0) return [];
	const findings: ConflictFinding[] = [];
	for (const skill of skills) {
		if (skill.name === candidate.name) continue;
		const skillTokens = keyTokens(skill.text);
		const shared = candidateTokens.filter((token) => skillTokens.includes(token));
		if (shared.length === 0) continue;
		const decisive = shared.some((token) => token.includes("/") || LINE_REFERENCE.test(token));
		if (!decisive && shared.length < 3) continue;
		findings.push({ target: pick(language, `技能「${skill.name}」`, `skill "${skill.name}"`), shared: shared.slice(0, MAX_SHARED_SHOWN) });
	}
	if (candidateTokens.length >= 3) {
		for (const entry of memory) {
			if (!containsAll(keyTokens(entry), candidateTokens)) continue;
			findings.push({ target: pick(language, `MEMORY.md 条目「${excerpt(entry)}」`, `MEMORY.md entry "${excerpt(entry)}"`), shared: candidateTokens.slice(0, MAX_SHARED_SHOWN) });
			break;
		}
	}
	// Most overlap first, then by name, so the order is deterministic across runs.
	return findings.sort((left, right) => right.shared.length - left.shared.length || left.target.localeCompare(right.target));
}

/** The first line of a memory entry, clipped: enough to recognize it in a receipt, never a paragraph. */
function excerpt(text: string): string {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length <= 60 ? line : `${line.slice(0, 59)}…`;
}

/** How many findings a receipt lists before it summarises the rest. */
const MAX_FINDINGS_SHOWN = 3;

/**
 * The conflict verdict a receipt carries. Always one line per finding, and always a verdict — "no
 * conflict" is a conclusion the check reached, not the absence of a conclusion.
 * @param findings - what the check found, in its deterministic order.
 * @param language - the language the receipt is written in.
 * @returns one `Conflict:` line per finding, or the sentence that says there is none.
 */
export function conflictText(findings: readonly ConflictFinding[], language: DocumentLanguage = "en"): string {
	if (findings.length === 0) return pick(language, "与现有技能或记忆没有重叠的关键 token。", "No token conflict with existing skills or memory.");
	const shown = findings.slice(0, MAX_FINDINGS_SHOWN).map((finding) => pick(
		language,
		`冲突：${finding.target} 共享 ${finding.shared.map((token) => `\`${token}\``).join("、")}`,
		`Conflict: ${finding.target} shares ${finding.shared.map((token) => `\`${token}\``).join(", ")}`,
	));
	if (findings.length > MAX_FINDINGS_SHOWN) {
		shown.push(pick(
			language,
			`（另有 ${findings.length - MAX_FINDINGS_SHOWN} 处冲突）`,
			`(+${findings.length - MAX_FINDINGS_SHOWN} more conflict(s))`,
		));
	}
	return shown.join("\n");
}
