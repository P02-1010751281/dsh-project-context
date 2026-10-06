/**
 * The two mechanical texts a handoff emits: the archived `HANDOFF.md` document and the child's
 * first message. Neither carries a generated summary — the dropped prefix stays reachable through
 * the session log the payload points at, and the recent tail rides verbatim — so this module holds
 * no model call, no output budget and no timeout.
 */

import { type Session } from "@deepseek-ai/dsh-session";
import { type UserDecision } from "./conversation.js";
import { type HandoffLanguage, SCAFFOLDING } from "./language.js";

/**
 * The archived `HANDOFF.md` document: header, archive pointers and the file index, and nothing
 * generated. The relative pointers are what the document carries — see `perform.ts` for why the
 * child's first message needs absolute ones instead.
 */
export function renderHandoff(session: Session, fileOperations: string, archive: { log: string; index: string }, language: HandoffLanguage): string {
	const text = SCAFFOLDING[language];
	const parts = [
		text.documentTitle(String(session.id)),
		"",
		text.documentCreated(new Date().toISOString()),
		text.documentProject(session.header.cwd ?? "unknown"),
		text.documentLog(archive.log),
		text.documentIndex(archive.index),
	];
	const files = fileOperations.trim();
	if (files.length > 0) parts.push("", files);
	parts.push("");
	return parts.join("\n");
}

/** The first message of the fresh session; the archive pointers keep the raw history reachable. */
export function continuation(
	parentId: string,
	fileOperations: string,
	tail: string,
	archive: { log: string; index: string },
	language: HandoffLanguage = "en",
	pending?: string,
	decision?: UserDecision,
): string {
	const text = SCAFFOLDING[language];
	// The markers wrap the mechanical "previous session details" block. `isHandoffContinuationText`
	// requires both of them, so a payload that dropped them would make the child's own seed read as
	// a human turn ("humanUserText" reuses the predicate).
	const details = [text.detailsHeading, "", text.detailSessionId(parentId), text.continuationArchive(archive.log, archive.index)];
	const files = fileOperations.trim();
	if (files.length > 0) details.push("", files);
	const parts = [
		text.continuationPreamble(parentId),
		text.continuationVerify,
		text.continuationContextNote,
		"",
		"<handoff>",
		...details,
		"</handoff>",
	];
	if (tail.length > 0) {
		parts.push("", "<recent-conversation>", text.continuationCarried, tail, "</recent-conversation>");
	}
	// The user's own last input. A decision arrives either as a typed message or as the tool result
	// answering `ask_user_question`, and with `handoffBudgetRecentTokens: 0` the tail carries neither,
	// so summary prose was the only place it could survive — which is how a session that had already
	// settled a question handed its successor the same question to ask again. With that budget at 0
	// the tail cannot carry the open question either, so the explicit block is the only thing that
	// keeps a `wait` handoff from silently dropping the decision the previous session stopped on. It
	// also replaces the usual closing: "start with the next concrete step" immediately after "wait for
	// the user" reads as the last instruction and cancels the wait.
	if (pending !== undefined && pending.trim().length > 0) {
		parts.push("", text.pendingHeading, "", pending.trim(), "", text.pendingWait);
	} else if (decision !== undefined) {
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
	return parts.join("\n");
}
