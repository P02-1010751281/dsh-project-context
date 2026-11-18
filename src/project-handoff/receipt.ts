/**
 * The handoff receipt **core**: what one seed carried, as a pure DTO → string renderer.
 *
 * Host-free by construction — no `@deepseek-ai/*`, no `Session`, no filesystem, no `ctx`. The adapter
 * that produced the artifacts (`perform.ts`) hands in the numbers it already stated, and the adapter
 * that prints them (`perform.ts` recorded it, `command.ts` renders it) never re-derives them: a
 * receipt that recomputed what the seed contained would be a second opinion about an artifact that
 * was written once, and the two could disagree exactly when something went wrong.
 *
 * The three facts are the ones a successor's transcript cannot show on its own: how much of the
 * conversation travelled verbatim, how many files the index named, and what the seed told the child
 * about a question that was still open.
 */

import { type HandoffLanguage } from "./language.js";

/**
 * How the question that was open at a handoff was disposed of.
 *
 * The adapter fills this from `questionDisposition` (`conversation.ts`), which reads the same
 * `readSessionInputs` pass the seed's own carry uses — this module only decides how the word renders.
 * It is deliberately **not** "what the seed carried": under `handoffPendingQuestion: defer` a manual
 * `/handoff now` carries nothing while the question is still open, and a receipt that reported that
 * as "no question" would be the wrong cause this package treats as its worst defect class.
 *  - `answered`: the user's own last input came after the question, so the continuation has it;
 *  - `deferred`: the question is still the newest thing — the answer is still with the user;
 *  - `nothing`: no assistant text ever asked a question.
 */
export type SeedQuestion = "answered" | "deferred" | "nothing";

/**
 * One handoff's seed, as the artifacts stated it.
 *
 * Every field is a number or a word the seed itself produced; `0` is a fact ("no tail messages"),
 * never an omission, so a receipt always shows all three.
 */
export interface SeedReceipt {
	/** Messages the seed carried verbatim in its tail; `0` when the budget carried none. */
	readonly tailMessages: number;
	/** Entries in the file index — the same `<read-files>` / `<modified-files>` list `HANDOFF.md` holds. */
	readonly files: number;
	readonly question: SeedQuestion;
}

/** The four tag lines of the index `fileOperations()` renders; every other non-empty line is a path. */
const INDEX_TAGS = new Set(["<read-files>", "</read-files>", "<modified-files>", "</modified-files>"]);

/**
 * Count the entries of the file index a handoff writes into `HANDOFF.md` and the seed.
 *
 * It takes the rendered string rather than the two sets behind it on purpose: that string **is** the
 * artifact, so counting it cannot disagree with what the successor was handed. A future change to the
 * renderer (a new block, a different heading) shows up as a changed count instead of a count that
 * quietly describes the old shape.
 * @param fileOperations - the `<read-files>` / `<modified-files>` block, or `""` when nothing qualified.
 */
export function countFileIndex(fileOperations: string): number {
	let count = 0;
	for (const line of fileOperations.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "" || INDEX_TAGS.has(trimmed)) continue;
		count += 1;
	}
	return count;
}

/** The word each disposition renders as, per language; the enum value stays the fact. */
const QUESTION_TEXT: Readonly<Record<HandoffLanguage, Readonly<Record<SeedQuestion, string>>>> = {
	en: { answered: "answered", deferred: "deferred", nothing: "nothing" },
	zh: { answered: "已回答", deferred: "待答", nothing: "未带入" },
};

/**
 * The `/handoff status` seed line.
 *
 * Terse on purpose, like the rest of the receipt: `seed: tail 12 message(s), 3 file(s), question
 * answered`. It is rendered only for a session this process seeded — a session that merely carries
 * `handedOff` (the one that was replaced) must not print another session's numbers.
 */
export function seedReceiptLine(receipt: SeedReceipt, language: HandoffLanguage): string {
	const question = QUESTION_TEXT[language][receipt.question];
	return language === "zh"
		? `种子：尾料 ${receipt.tailMessages} 条消息、文件 ${receipt.files} 个、问题处置 ${question}`
		: `seed: tail ${receipt.tailMessages} message(s), ${receipt.files} file(s), question ${question}`;
}
