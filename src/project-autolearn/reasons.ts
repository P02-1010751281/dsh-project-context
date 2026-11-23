/**
 * Why an `/autolearn` pass wrote nothing, as a **code plus its parameters** rather than a sentence.
 *
 * The reasons used to be English sentences produced inside the pass core and printed verbatim after a
 * Chinese lead-in (`技能被拒：body too short。`). A Chinese receipt is not allowed to carry an English
 * clause, but the pass core runs before a session — and therefore before a language — exists: the
 * automatic pass fires on `turn/end`, and the receipt is built later by whichever command asks. So the
 * core emits a stable machine identity and the receipt renders the sentence, which also keeps the
 * English log lines and the Chinese receipt from drifting apart.
 *
 * Two vocabularies, one owner: {@link AutolearnRejection} (the model proposed a skill and the admission
 * rules refused it) and {@link AutolearnSkip} (the pass did not ask the model at all). They stay
 * separate because the reader's next move differs — rewrite the proposal vs re-prompt later or add
 * material.
 */

import { type DocumentLanguage, pick } from "../shared/language.js";

/** A proposal the admission rules refused. `name` is carried where the sentence has to quote it. */
export type AutolearnRejection =
	| { readonly code: "invalid-name" }
	| { readonly code: "missing-description" }
	| { readonly code: "description-too-long" }
	| { readonly code: "body-too-short" }
	| { readonly code: "body-too-long" }
	| { readonly code: "injection" }
	| { readonly code: "needs-candidate-evidence" }
	| { readonly code: "needs-two-sessions" }
	| { readonly code: "skill-exists"; readonly name: string }
	| { readonly code: "body-not-shown" }
	| { readonly code: "candidate-exists"; readonly name: string };

/** A pass that declined to call the model at all. */
export type AutolearnSkip =
	| { readonly code: "recent-pass" }
	| { readonly code: "no-material" }
	| { readonly code: "no-archive" };

/**
 * The refusal as a receipt (or a log line) names it.
 *
 * The English column is byte-identical to the sentences the core used to return, so existing logs,
 * tests and docs keep meaning what they said. The Chinese column is what a Chinese session reads.
 * @param reason - the code the pass produced.
 * @param language - the language the sentence is written in.
 * @returns one clause, without a trailing full stop (the caller owns the punctuation).
 */
export function rejectedText(reason: AutolearnRejection, language: DocumentLanguage = "en"): string {
	switch (reason.code) {
		case "invalid-name":
			return pick(language, "名称不是 kebab-case（小写字母、数字与中间连字符）", "invalid kebab-case name");
		case "missing-description":
			return pick(language, "缺少描述", "missing description");
		case "description-too-long":
			return pick(language, "描述过长", "description too long");
		case "body-too-short":
			return pick(language, "正文过短", "body too short");
		case "body-too-long":
			return pick(language, "正文过长", "body too long");
		case "injection":
			return pick(language, "正文像一条指令注入", "body looks like an instruction injection");
		case "needs-candidate-evidence":
			return pick(language, "需要一个已核对的会话 id", "needs at least one verified session id");
		case "needs-two-sessions":
			return pick(language, "需要来自至少两个不同会话的证据", "needs evidence from at least two different sessions");
		case "skill-exists":
			return pick(language, `技能「${reason.name}」已存在`, `skill "${reason.name}" already exists`);
		case "body-not-shown":
			return pick(language, "本轮没有展示正文", "body not shown this pass");
		case "candidate-exists":
			return pick(language, `候选「${reason.name}」已存在`, `candidate "${reason.name}" already exists`);
	}
}

/**
 * The skip as a receipt names it.
 *
 * Every branch says the same load-bearing half — *no model call was made* — because that is the fact
 * the old single `{skill: null}` shape hid: a reply about "the model proposed nothing" would have been
 * false.
 * @param reason - the code the pass produced.
 * @param language - the language the sentence is written in.
 * @returns one clause, without a trailing full stop.
 */
export function skippedText(reason: AutolearnSkip, language: DocumentLanguage = "en"): string {
	switch (reason.code) {
		case "recent-pass":
			return pick(language, "刚才已经跑过一次；没有发起模型调用", "a pass ran moments ago; no model call was made");
		case "no-material":
			return pick(
				language,
				"项目没有可学习的记忆或上下文；没有发起模型调用",
				"the project has no memory or context to learn from; no model call was made",
			);
		case "no-archive":
			return pick(language, "没有已归档的会话能支撑一个新技能；没有发起模型调用", "no archived session grounds a new skill; no model call was made");
	}
}
