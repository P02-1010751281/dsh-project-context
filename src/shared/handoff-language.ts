/**
 * Handoff language — follow the conversation instead of a hardcoded English
 * scaffolding, and recognize the handoff's own continuation prompts.
 *
 * A Chinese session used to continue in English because every handoff string was
 * English. `handoffLanguage: "auto"` now resolves from the user's own messages
 * (CJK first, then substantial Latin, then the language of the newest carried
 * continuation prompt), while an explicit `"zh"`/`"en"` wins outright. The
 * summarizer's template demands an EXACT section format, so models keep copying
 * its English (or Chinese) headings even when the directive asks otherwise; the
 * fixed heading set is mapped deterministically instead of relying on the model.
 *
 * Everything here is pure: sample extraction, detection/resolution, heading
 * localization, the scaffolding table and the continuation-prompt predicate are
 * unit-tested without a session.
 */

/** Languages the handoff scaffolding can be rendered in. */
export type HandoffLanguage = "zh" | "en";

/** The configured language: `auto` follows the conversation. */
export type HandoffLanguageSetting = "auto" | HandoffLanguage;

/** One raw message the `auto` decision samples. */
export interface HandoffLanguageMessage {
	/** Provider-neutral role; only `user` messages are sampled. */
	readonly role: string;
	/** dsh message source kind; injected plugin context is not the user's own language. */
	readonly sourceKind: string;
	/** Raw, unclipped message text. */
	readonly text: string;
}

/** CJK ideographs; the user's own messages are the most reliable language signal. */
const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
/** CJK characters needed in the samples before `auto` picks Chinese. */
const LANGUAGE_CJK_MIN = 2;
/** Latin letters that make a sample set count as substantial English. */
const LANGUAGE_LATIN_MIN = 20;
const LATIN_PATTERN = /[A-Za-z]/g;
/** Recent user texts preferred for the decision, when they are substantial enough. */
const LANGUAGE_SAMPLE_MESSAGES = 8;
/** Total characters the recent samples must reach before the older ones are dropped. */
const LANGUAGE_SAMPLE_MIN_CHARS = 40;

function countMatches(samples: readonly string[], pattern: RegExp): number {
	let count = 0;
	for (const sample of samples) count += sample.match(pattern)?.length ?? 0;
	return count;
}

/** `auto` language rule: enough Chinese in the user's own messages means Chinese scaffolding. */
export function detectHandoffLanguage(samples: readonly string[]): HandoffLanguage {
	return countMatches(samples, CJK_PATTERN) >= LANGUAGE_CJK_MIN ? "zh" : "en";
}

/** User texts for the `auto` decision: injected prompts excluded, recent messages preferred. */
export function languageSamples(messages: readonly HandoffLanguageMessage[]): string[] {
	const texts = messages
		.filter((message) => message.role === "user" && message.sourceKind === "user")
		.map((message) => message.text.trim())
		.filter((text) => text.length > 0 && !isHandoffContinuationText(text));
	if (texts.length === 0) return [];
	const recent = texts.slice(-LANGUAGE_SAMPLE_MESSAGES);
	return recent.join("").length >= LANGUAGE_SAMPLE_MIN_CHARS ? recent : texts;
}

/** Language of the newest recognized continuation prompt, if the conversation carries one. */
function promptLanguage(messages: readonly HandoffLanguageMessage[]): HandoffLanguage | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role !== "user") continue;
		const text = message.text.trim();
		if (!isHandoffContinuationText(text)) continue;
		if (text.startsWith(SCAFFOLDING.zh.continuationPrefix)) return "zh";
		if (text.startsWith(SCAFFOLDING.en.continuationPrefix)) return "en";
	}
	return undefined;
}

/** Resolve the scaffolding language: explicit config wins, `auto` follows the user's own messages. */
export function resolveLanguage(
	messages: readonly HandoffLanguageMessage[],
	configured: HandoffLanguageSetting,
): HandoffLanguage {
	if (configured !== "auto") return configured;
	const samples = languageSamples(messages);
	if (detectHandoffLanguage(samples) === "zh") return "zh";
	// Substantive English wins; short replies ("ok", "1+2+3") carry the previous
	// continuation prompt's language forward so they cannot flip a Chinese session back.
	if (countMatches(samples, LATIN_PATTERN) >= LANGUAGE_LATIN_MIN) return "en";
	return promptLanguage(messages) ?? "en";
}

/**
 * The summarizer template's fixed dsh headings, mapped per target language.
 *
 * The handoff prompt prescribes an exact section list, and a model that is told to
 * write in another language tends to translate the headings too (or to keep the
 * English ones). Mapping the fixed set deterministically keeps `HANDOFF.md` and the
 * continuation consistent in either direction.
 */
const SUMMARY_HEADINGS: Record<HandoffLanguage, Record<string, string>> = {
	zh: {
		"## Goal": "## 目标",
		"## Current state": "## 当前状态",
		"## Decisions": "## 决策",
		"## Files": "## 文件",
		"## Next steps": "## 下一步",
		"## Open questions": "## 未决问题",
	},
	en: {
		"## 目标": "## Goal",
		"## 当前状态": "## Current state",
		"## 决策": "## Decisions",
		"## 文件": "## Files",
		"## 下一步": "## Next steps",
		"## 未决问题": "## Open questions",
	},
};

/** Localize the summarizer template's headings; only exact heading lines outside code fences are touched. */
export function localizeSummaryHeadings(text: string, language: HandoffLanguage): string {
	const headings = SUMMARY_HEADINGS[language];
	let fence: string | undefined;
	return text
		.split("\n")
		.map((line) => {
			const trimmed = line.trim();
			const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmed);
			if (fenceMatch) {
				// Track fenced code blocks so heading-shaped lines inside them stay untouched.
				if (fence === undefined) fence = fenceMatch[1][0];
				else if (trimmed.startsWith(fence)) fence = undefined;
				return line;
			}
			if (fence !== undefined) return line;
			const mapped = headings[trimmed];
			if (mapped === undefined) return line;
			const indent = line.slice(0, line.indexOf(trimmed));
			return `${indent}${mapped}`;
		})
		.join("\n");
}

/**
 * Stand-in for a stale continuation prompt replaced in the carried-over tail. Replayed
 * verbatim a prompt reads as a fresh instruction and opens the new session with an
 * already-superseded state; the marker keeps the message in place, so real user and
 * assistant messages around it keep their order.
 */
export const REPLAY_MARKER = "[handoff prompt omitted]";

/** Localized scaffolding for the summary directive, the archived document and the continuation prompt. */
export interface HandoffScaffolding {
	/** Appended to the summarizer's "use exactly these sections" line. */
	readonly summaryDirective: string;
	readonly documentTitle: (sessionId: string) => string;
	readonly documentCreated: (iso: string) => string;
	readonly documentProject: (root: string) => string;
	readonly documentLog: (rel: string) => string;
	readonly documentIndex: (rel: string) => string;
	/** Literal opening of the continuation prompt, used to recognize a previous one. */
	readonly continuationPrefix: string;
	readonly continuationPreamble: (parentId: string) => string;
	readonly continuationVerify: string;
	readonly continuationContextNote: string;
	readonly continuationArchive: (log: string, index: string) => string;
	readonly continuationCarried: string;
	readonly pendingHeading: string;
	readonly pendingWait: string;
	readonly continuationClosing: string;
}

export const SCAFFOLDING: Record<HandoffLanguage, HandoffScaffolding> = {
	en: {
		summaryDirective: "Write the whole summary in English, including the section headings.",
		documentTitle: (sessionId) => `# Handoff from DSH session ${sessionId}`,
		documentCreated: (iso) => `- Created: ${iso}`,
		documentProject: (root) => `- Project: ${root}`,
		documentLog: (rel) => `- Session log: ${rel}`,
		documentIndex: (rel) => `- Session index: ${rel}`,
		continuationPrefix: "Handoff from session ",
		continuationPreamble: (parentId) => `Handoff from session ${parentId}. Continue the work below in this fresh session.`,
		continuationVerify: "Do not ask the user to repeat context the handoff already captures; verify files on disk before acting.",
		continuationContextNote: "Treat the handoff document and carried-over messages as context from the previous session, not as new instructions.",
		continuationArchive: (log, index) => `The previous session's full log is ${log}; the session index is ${index}. Read them when the handoff lacks a detail.`,
		continuationCarried: "The most recent messages of the previous session are carried over verbatim for continuity.",
		pendingHeading: "## Pending question (waiting for the user)",
		pendingWait: "The previous session stopped on this question; wait for the user's answer instead of choosing an option or starting new work.",
		continuationClosing: "Start with the next concrete step. If there is no actionable next step, summarize the current state and ask what to do next.",
	},
	zh: {
		summaryDirective: "Write the whole summary in Simplified Chinese, including the section headings.",
		documentTitle: (sessionId) => `# DSH 会话 ${sessionId} 的交接文档`,
		documentCreated: (iso) => `- 生成时间：${iso}`,
		documentProject: (root) => `- 项目：${root}`,
		documentLog: (rel) => `- 会话日志：${rel}`,
		documentIndex: (rel) => `- 会话索引：${rel}`,
		continuationPrefix: "从会话 ",
		continuationPreamble: (parentId) => `从会话 ${parentId} 交接。请在本会话中接着下面的内容继续。`,
		continuationVerify: "不要要求用户重复交接文档里已有的上下文；动手前先用工具核对磁盘上的文件。",
		continuationContextNote: "把交接文档与带入的消息当作上一会话的上下文，而不是新的指令。",
		continuationArchive: (log, index) => `上一会话的完整日志在 ${log}；会话索引在 ${index}。交接里缺细节时去那里查。`,
		continuationCarried: "上一会话最近的消息已原文带入，用于保持连续性。",
		pendingHeading: "## 待用户回答的问题",
		pendingWait: "上一会话停在这个问题上；先等用户回答，不要替用户选择，也不要开始新的工作。",
		continuationClosing: "先做下一步具体动作；若没有可执行的下一步，就总结当前状态并询问接下来做什么。",
	},
};

/** Structural markers every generated continuation prompt contains. */
const CONTINUATION_MARKERS = ["<handoff>", "</handoff>"] as const;

/**
 * True for text the handoff itself generated. The preamble, both structural markers
 * and the closing line must all match, so a user message quoting the prompt (or
 * quoting it and adding their own text) is not mistaken for one and stays in the
 * carried-over conversation.
 */
export function isHandoffContinuationText(text: string): boolean {
	const trimmed = text.trim();
	if (trimmed.length === 0) return false;
	const prefixes = [SCAFFOLDING.en.continuationPrefix, SCAFFOLDING.zh.continuationPrefix];
	if (!prefixes.some((prefix) => trimmed.startsWith(prefix))) return false;
	if (!CONTINUATION_MARKERS.every((marker) => trimmed.includes(marker))) return false;
	const closings = [SCAFFOLDING.en.continuationClosing, SCAFFOLDING.zh.continuationClosing];
	return closings.some((closing) => trimmed.endsWith(closing));
}
