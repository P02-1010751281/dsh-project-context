/**
 * Progressive disclosure for the two documents injected into every turn's system prompt.
 *
 * The kept sections are the ones where a wrong answer is a violation or the repeat of a fixed bug;
 * each of the rest costs one line naming the file instead of its whole body, and the block ends with
 * a read-first sentence. The split is by heading, never by meaning: the headings are the ones the
 * render schemas own, so a section is either rendered whole or replaced by its own line and can
 * never take another's slot. A heading the spec does not name stays inline, and a document with no
 * usable heading is injected whole — a schema change degrades to the previous behaviour instead of
 * dropping content.
 *
 * The read-first sentence is not decoration: pi's own probe found a bare pointer leaves a
 * non-reading model answering confidently and wrongly, while the same pointer with this sentence
 * makes it read. The language follows the document, through the detector the handoff shares.
 */

import path from "node:path";
import { detectDocumentLanguage, type DocumentLanguage } from "../shared/language.js";

/** One string per language; either can be rendered into the same slot. */
type LocalizedText = Record<DocumentLanguage, string>;

export interface InjectionSpec {
	/**
	 * Headings declared as staying inline. The renderer does not branch on this: a heading with no
	 * pointer is inline by construction, so the list states the intent and lets a test check coverage.
	 */
	readonly keep: readonly string[];
	/** One line per indexed heading; a heading here must not also be kept. */
	readonly pointers: Readonly<Record<string, LocalizedText>>;
	/** Introduces the pointer list; `{path}` is replaced with the resolved path. */
	readonly heading: LocalizedText;
	/** The read-first sentence that follows the pointer list. */
	readonly instruction: LocalizedText;
	/** The path the pointers resolve to, shown to the reader. */
	readonly path: string;
}

interface InjectionSection {
	heading: string;
	body: string;
}

/** Level-two headings are the only ones the render schemas own. */
const HEADING_RE = /^## (.+?)\s*$/;
/** A fenced code block's opening or closing run: three or more backticks or tildes. */
const FENCE_RE = /^(`{3,}|~{3,})/;

/**
 * A document-level note (`_[...]_`) belongs to no section: the render appends the truncation marker
 * after the last section's body, so without this it would be indexed away with the section it landed
 * in. Only a trailing line can be that marker, so the shape is honoured in the last section alone
 * and a `_[x]_` line in the middle of a document stays where it was written.
 */
const DOCUMENT_NOTE_RE = /^_\[[^\]]+\]_$/;

/**
 * What one traversal of a rendered document yields: the preamble (everything before the first
 * heading, which belongs to no section) and the sections in document order.
 */
interface ScannedDocument {
	preamble: string;
	sections: InjectionSection[];
}

/**
 * Walk a rendered document once, tracking fenced code blocks so a `## …` line inside one is content
 * rather than a heading. One traversal yields both the preamble and the sections: finding the
 * preamble with a separate, fence-blind scan could disagree with the sections about where the
 * document starts — the defect pi had to fix twice.
 *
 * A closing fence is the opening character repeated at least as many times with nothing but
 * whitespace after it, which is the same CommonMark rule `project-memory`'s skeleton detector and
 * the handoff's heading localizer use; a shorter run, a different character or trailing text stays
 * inside the block.
 */
function scanDocument(text: string): ScannedDocument {
	const preamble: string[] = [];
	const sections: InjectionSection[] = [];
	let fence: string | undefined;
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		const run = FENCE_RE.exec(trimmed);
		if (fence === undefined) {
			if (run) fence = run[1];
		} else if (run && run[1][0] === fence[0] && run[1].length >= fence.length && trimmed.slice(run[1].length).trim() === "") {
			fence = undefined;
		}
		const match = fence === undefined ? HEADING_RE.exec(line) : null;
		if (match) sections.push({ heading: match[1], body: "" });
		else if (sections.length > 0) sections[sections.length - 1].body += `${line}\n`;
		else preamble.push(line);
	}
	return {
		preamble: preamble.join("\n").trim(),
		sections: sections.map((section) => ({ heading: section.heading, body: section.body.trim() })),
	};
}

/**
 * The body for one injected document: the preamble and every document-level note stay inline, the
 * kept sections follow in document order, and the sections with a pointer are reduced to one line
 * each. `root` is where the pointer path resolves when the caller knows the project root, because
 * the reader's `read` tool resolves relative paths against its own cwd, not against the directory
 * the injected prompt was built in. Returns the text unchanged when no section has a pointer.
 */
export function renderProgressiveBody(text: string, spec: InjectionSpec, language: DocumentLanguage, root?: string): string {
	const { preamble, sections } = scanDocument(text);
	const dash = language === "zh" ? "——" : "—";
	const inline: string[] = [];
	const notes: string[] = [];
	const pointerLines: string[] = [];
	for (const [index, section] of sections.entries()) {
		const isLast = index === sections.length - 1;
		const bodyLines = section.body.split("\n");
		const noteLines = isLast ? bodyLines.filter((line) => DOCUMENT_NOTE_RE.test(line.trim())) : [];
		for (const line of noteLines) notes.push(line.trim());
		const body = bodyLines.filter((line) => !noteLines.includes(line)).join("\n").trim();
		const pointer = spec.pointers[section.heading];
		if (pointer) pointerLines.push(`- \`## ${section.heading}\` ${dash} ${pointer[language]}`);
		else inline.push(`## ${section.heading}\n\n${body}`);
	}
	if (pointerLines.length === 0) return text;
	const shown = root === undefined ? spec.path : path.join(root, spec.path);
	return [
		preamble,
		...inline,
		notes.join("\n"),
		`${spec.heading[language].replace("{path}", shown)}\n${pointerLines.join("\n")}\n${spec.instruction[language]}`,
	]
		.filter(Boolean)
		.join("\n\n");
}

/** The project-relative path both injected documents live at. */
export const MEMORY_INJECTION_PATH = ".agents/memory/MEMORY.md";
export const CONTEXT_INJECTION_PATH = ".agents/memory/CONTEXT.md";

/** The two documents as they enter the system prompt. Exported so a test can pin the specs. */
export const MEMORY_INJECTION: InjectionSpec = {
	keep: ["Invariants", "Pitfalls"],
	pointers: {
		Project: {
			zh: "目的、技术栈与目录结构；需要结构性背景时读它。",
			en: "purpose, stack and structure; read it when you need structural background.",
		},
		Index: {
			zh: "文档、源文件与命令的指针；需要定位「某功能在哪个文件」时读它。",
			en: "pointers to docs, source files and commands; read it to locate where a feature lives.",
		},
	},
	heading: { zh: "其余小节在 `{path}`：", en: "The remaining sections are in `{path}`:" },
	instruction: {
		zh: "凡涉及本项目的具体事实（字段名、路径、阈值、约束）而你不确定时，必须先 read 该文件再回答，不得凭印象作答。",
		en: "When a project fact (a field name, a path, a threshold, a constraint) decides the answer and you are not certain of it, read that file before answering instead of answering from impression.",
	},
	path: MEMORY_INJECTION_PATH,
};

export const CONTEXT_INJECTION: InjectionSpec = {
	keep: ["Key points", "Open tasks"],
	pointers: {
		Summary: {
			zh: "本会话在做什么、进行到哪里；需要「之前发生过什么」时读它。",
			en: "what this session is about and where it stands; read it for what happened before this.",
		},
	},
	heading: { zh: "其余小节在 `{path}`：", en: "The remaining sections are in `{path}`:" },
	instruction: {
		zh: "凡涉及本项目或本会话的具体事实（字段名、路径、阈值、约束）而你不确定时，必须先 read 该文件再回答，不得凭印象作答。",
		en: "When a project or session fact (a field name, a path, a threshold, a constraint) decides the answer and you are not certain of it, read that file before answering instead of answering from impression.",
	},
	path: CONTEXT_INJECTION_PATH,
};

/** MEMORY.md as it enters the system prompt. */
export function buildMemoryInjection(text: string, projectRoot: string): string {
	return renderProgressiveBody(text, MEMORY_INJECTION, detectDocumentLanguage([text]), projectRoot);
}

/** CONTEXT.md as it enters the system prompt, the same shape as the memory injection. */
export function buildContextInjection(text: string, projectRoot: string): string {
	return renderProgressiveBody(text, CONTEXT_INJECTION, detectDocumentLanguage([text]), projectRoot);
}
