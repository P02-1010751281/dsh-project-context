/**
 * The two mechanical texts a handoff emits: the archived `HANDOFF.md` document and the child's
 * first message. Neither carries a generated summary — the dropped prefix stays reachable through
 * the session log the payload points at, and the recent tail rides verbatim — so this module holds
 * no model call, no output budget and no timeout.
 */

import { createHash } from "node:crypto";
import { type Session } from "@deepseek-ai/dsh-session";
import { type UserDecision } from "./conversation.js";
import { type ContinuationNotice, type HandoffLanguage, SCAFFOLDING } from "./language.js";

/**
 * The seed's own identity line, in ASCII in both languages so a tool can find it without knowing
 * which language the handoff ran in.
 *
 * A continuation prompt is the one artifact whose provenance nothing else records: `HANDOFF.md` is
 * per project and is overwritten by the next handoff, while the child session keeps its seed forever.
 * Stamping the seed with a digest of its own body lets a later reader answer "is the seed this child
 * read the one this handoff produced" by hashing the message instead of re-rendering it with whatever
 * version of the scaffolding is current.
 */
export const SEED_ID_LABEL = "- handoff-seed: ";

/** Hex characters of the digest kept in the line; enough to name a seed, short enough to grep. */
const SEED_ID_CHARS = 12;

/**
 * The identity line **including its newline**, so the text left after a removal is byte-identical to
 * the body the digest was taken over. It is never the last line (it sits inside the `<handoff>`
 * block), so the trailing newline is always there.
 */
const SEED_ID_LINE = /^- handoff-seed: ([0-9a-f]{12})\n/m;

function seedDigest(body: string): string {
	return createHash("sha256").update(body, "utf8").digest("hex").slice(0, SEED_ID_CHARS);
}

/**
 * The seed's identity, read back from the seed itself.
 *
 * `verified` recomputes the digest over the body with the identity line removed, which is exactly how
 * it was produced: a payload edited after the fact no longer matches its own stamp. Returns
 * `undefined` for text that carries no identity line at all, which is what every seed written before
 * this existed looks like.
 * @param seed - the continuation prompt as stored in the child session.
 * @returns the stamped id and whether the body still hashes to it.
 */
export function seedIdentityOf(seed: string): { id: string; verified: boolean } | undefined {
	const match = SEED_ID_LINE.exec(seed);
	if (match === null) return undefined;
	const id = match[1] ?? "";
	return { id, verified: seedDigest(seed.replace(SEED_ID_LINE, "")) === id };
}

/**
 * The archived `HANDOFF.md` document: header, archive pointers and the file index, and nothing
 * generated. The relative pointers are what the document carries — see `perform.ts` for why the
 * child's first message needs absolute ones instead.
 */
export function renderHandoff(session: Session, fileOperations: string, archive: { log: string; index: string }, language: HandoffLanguage, seedId?: string): string {
	const text = SCAFFOLDING[language];
	const parts = [
		text.documentTitle(String(session.id)),
		"",
		text.documentCreated(new Date().toISOString()),
		text.documentProject(session.header.cwd ?? "unknown"),
		text.documentLog(archive.log),
		text.documentIndex(archive.index),
	];
	// The document is overwritten by the next handoff, so it only carries the id of the seed it
	// describes — the seed keeps the same id forever, and the pair is what makes a child attributable.
	if (seedId !== undefined) parts.push(`${SEED_ID_LABEL}${seedId}`);
	const files = fileOperations.trim();
	if (files.length > 0) parts.push("", files);
	parts.push("");
	return parts.join("\n");
}

/**
 * The first message of the fresh session; the archive pointers keep the raw history reachable.
 *
 * The carried state is stated explicitly in three shapes, mirroring pi's post-J `carryKept` /
 * `carryTrimmed` / `carryNothing`: a tail was carried verbatim, a tail was carried but one of its
 * messages was cut at the render cap, or nothing was carried at all (a zero recent budget). The third
 * one matters because a silent seed reads as "nothing to see here", while pi tells the successor to
 * work from the log instead.
 */
export function continuation(
	parentId: string,
	fileOperations: string,
	tail: string,
	archive: { log: string; index: string },
	language: HandoffLanguage = "en",
	pending?: string,
	decision?: UserDecision,
	trimmedTail = false,
	notice?: ContinuationNotice,
): string {
	const text = SCAFFOLDING[language];
	// The markers wrap the mechanical "previous session details" block. `isHandoffContinuationText`
	// requires both of them, so a payload that dropped them would make the child's own seed read as
	// a human turn ("humanUserText" reuses the predicate).
	const details = [text.detailsHeading, "", text.detailSessionId(parentId), text.continuationArchive(archive.log, archive.index)];
	const files = fileOperations.trim();
	if (files.length > 0) details.push("", files);
	const carried = tail.length === 0 ? text.continuationNothing : trimmedTail ? text.continuationTrimmed : text.continuationCarried;
	const parts = [
		text.continuationPreamble(parentId),
		// The person's half: the model instructions below never said that most of the conversation stayed
		// behind, so a handoff read as a seamless continuation. Kept after the prefix line because
		// `isHandoffContinuationText` recognizes a generated prompt by it.
		...(notice === undefined ? [] : [text.continuationNotice(notice)]),
		carried,
		text.continuationVerify,
		text.continuationContextNote,
		"",
		"<handoff>",
		...details,
		"</handoff>",
	];
	if (tail.length > 0) {
		parts.push("", "<recent-conversation>", tail, "</recent-conversation>");
	}
	// The user's own last input. A decision arrives either as a typed message or as the tool result
	// answering `ask_user_question`, and the carried tail contains both — so with a tail the block
	// would only duplicate what the successor can already read (pi post-J has no such block at all).
	// It is rendered exactly when the tail cannot carry it, which is the case it was built for: with
	// `handoffBudgetRecentTokens: 0` nothing is carried, and a session that had already settled a
	// question once handed its successor the same question to ask again. In that shape it also
	// replaces the usual closing: "start with the next concrete step" immediately after "wait for the
	// user" reads as the last instruction and cancels the wait.
	if (pending !== undefined && pending.trim().length > 0) {
		parts.push("", text.pendingHeading, "", pending.trim(), "", text.pendingWait);
	} else if (decision !== undefined && tail.length === 0) {
		// `readSessionInputs` only produces a decision with content: a message carries non-empty text
		// and an answer carries at least one answered question, so there is no empty block to guard.
		parts.push("", text.decisionHeading, "");
		if (decision.kind === "message") {
			parts.push(decision.text.trim());
		} else {
			for (const entry of decision.entries) {
				if (entry.question.length > 0) parts.push(text.decisionQuestion(entry.question));
				if (entry.options.length > 0) parts.push(text.decisionOptions(entry.options.join(" | ")));
				if (entry.selected.length > 0) parts.push(text.decisionSelected(entry.selected.join(" | ")));
				if (entry.custom.length > 0) parts.push(text.decisionCustom(entry.custom));
			}
		}
		// A carried decision is exactly what makes "otherwise ask" wrong: the user has already
		// spoken, so the successor continues from it instead of putting the question back to them.
		parts.push("", text.decisionClosing);
	} else {
		parts.push("", text.continuationClosing);
	}
	const body = parts.join("\n");
	// Stamp the body with its own digest, after the session-id detail line. Removing that one line
	// (newline included) reproduces `body` byte for byte, which is what `seedIdentityOf` recomputes —
	// so the seed proves its own provenance from the message alone. A literal `replace` on the
	// session-id line, not a pattern: the anchor is unique inside the details block and carries no
	// regex meaning in either language.
	const sessionLine = `${text.detailSessionId(parentId)}\n`;
	return body.replace(sessionLine, `${sessionLine}${SEED_ID_LABEL}${seedDigest(body)}\n`);
}
