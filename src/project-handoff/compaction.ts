/**
 * The compaction **core**: one session's compaction history, as a pure fold over records.
 *
 * This module knows nothing about dsh. A record is a three-field DTO; the host event shapes live in
 * the sibling shim `compaction-events.ts`, so a change in what dsh emits touches that file alone and
 * this fold stays testable without a session, a context or a logging host.
 *
 * Why count at all: compaction belongs to the host (`@deepseek-ai/dsh-compaction`), and this package
 * must not take that service. What is left for us is *evidence* — a user reading `/handoff status`
 * needs to know the host already compacted twice before deciding the occupancy number means what they
 * think it means.
 */

import { type HandoffLanguage } from "./language.js";

/** One compaction fact, normalized from whatever the host recorded. */
export type CompactionRecord =
	/** A transaction opened; it states no amount and its end carries the outcome. */
	| { readonly kind: "start" }
	/** A summarization that wrote a replacement; `id` is the transaction's. */
	| { readonly kind: "summary"; readonly id: string; readonly shadowedTokens?: number; readonly provider?: string; readonly model?: string }
	/** A transaction's outcome; `error` is present exactly when it failed. */
	| { readonly kind: "end"; readonly id: string; readonly error?: string }
	/** A model-free replacement of an over-budget tool result; it is not a transaction, so it has no id. */
	| { readonly kind: "prune"; readonly shadowedTokens?: number };

/**
 * What the shim could make of the log.
 *
 * `unavailable` is a *named* gap, never a zero: a log we failed to read, or a compaction record whose
 * shape we do not recognize, must not be reported as "no compaction" — that is a wrong cause, and this
 * repository treats a wrong cause as worse than a named absence.
 */
export type CompactionFeed =
	| { readonly kind: "records"; readonly records: readonly CompactionRecord[] }
	| { readonly kind: "unavailable"; readonly reason: "unreadable" | "malformed" };

/** The last replacement the log states, in log order. */
export interface CompactionSuccess {
	/** The heuristic price of the shadowed span; absent when the record did not state one. */
	readonly shadowedTokens?: number;
	readonly provider?: string;
	readonly model?: string;
}

/** A folded history. Every count is one distinct fact in the log, not an inference. */
export interface CompactionHistory {
	/** Distinct `summary` ids: summarizations that wrote a replacement. */
	readonly summarized: number;
	/** `prune` records: model-free replacements of over-budget tool results. */
	readonly pruned: number;
	/** Distinct `end` ids carrying an `error` — attempts that reclaimed nothing. */
	readonly failed: number;
	/** Sum of every stated shadowed-token count (a heuristic price, not a meter reading). */
	readonly reclaimedTokens: number;
	readonly lastSuccess?: CompactionSuccess;
	readonly lastError?: string;
}

/** A failure message is one line in a receipt; longer text is clipped rather than wrapped. */
const MAX_COMPACTION_ERROR_CHARS = 120;

/**
 * One line of a host error, with control characters folded away.
 *
 * An exception message carries newlines often enough that pasting it raw would split the receipt,
 * which is a single joined string.
 */
function oneLineError(text: string): string {
	const folded = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
	return folded.length <= MAX_COMPACTION_ERROR_CHARS ? folded : `${folded.slice(0, MAX_COMPACTION_ERROR_CHARS - 1)}…`;
}

/**
 * Fold records into a history.
 *
 * Counting rules, each chosen so the number means one thing:
 * - `summarized` counts distinct summary ids (a replayed record is the same compaction);
 * - `pruned` counts prune records, which have no id because a prune is not a transaction;
 * - `failed` counts distinct `end` ids that carry an error;
 * - `reclaimedTokens` sums only stated amounts — a missing field contributes nothing and is never
 *   read as `0`.
 */
export function foldCompactions(records: readonly CompactionRecord[]): CompactionHistory {
	const summarized = new Set<string>();
	const ended = new Set<string>();
	const failed = new Set<string>();
	let pruned = 0;
	let reclaimedTokens = 0;
	let lastSuccess: CompactionSuccess | undefined;
	let lastError: string | undefined;
	for (const record of records) {
		if (record.kind === "start") continue;
		if (record.kind === "prune") {
			pruned += 1;
			if (record.shadowedTokens !== undefined) reclaimedTokens += record.shadowedTokens;
			lastSuccess = record.shadowedTokens === undefined ? {} : { shadowedTokens: record.shadowedTokens };
			continue;
		}
		if (record.kind === "summary") {
			if (summarized.has(record.id)) continue;
			summarized.add(record.id);
			if (record.shadowedTokens !== undefined) reclaimedTokens += record.shadowedTokens;
			lastSuccess = {
				...(record.shadowedTokens === undefined ? {} : { shadowedTokens: record.shadowedTokens }),
				...(record.provider === undefined ? {} : { provider: record.provider }),
				...(record.model === undefined ? {} : { model: record.model }),
			};
			continue;
		}
		// `end`: the outcome. A missing error is a success (already counted through its summary), so
		// only the failure branch records anything.
		if (ended.has(record.id)) continue;
		ended.add(record.id);
		if (record.error === undefined || record.error === "") continue;
		const folded = oneLineError(record.error);
		// A whitespace-only message states no cause; it is not a failure to report by name.
		if (folded === "") continue;
		failed.add(record.id);
		lastError = folded;
	}
	return {
		summarized: summarized.size,
		pruned,
		failed: failed.size,
		reclaimedTokens,
		...(lastSuccess === undefined ? {} : { lastSuccess }),
		...(lastError === undefined ? {} : { lastError }),
	};
}

/**
 * The `/handoff status` compaction line.
 *
 * It rides next to the occupancy lines because the two are read together: a crossed threshold means
 * something different when the host already compacted twice and occupancy is *still* high. Nothing
 * here claims "occupancy after the last compaction" — that would need the meter snapshot from that
 * moment, which the log does not carry.
 */
export function compactionStatusLine(feed: CompactionFeed, language: HandoffLanguage): string {
	const zh = language === "zh";
	if (feed.kind === "unavailable") {
		if (zh) return feed.reason === "unreadable" ? "压缩记录不可用（会话日志不可读）" : "压缩记录不可用（存在无法识别的压缩事件）";
		return feed.reason === "unreadable" ? "compactions unavailable (session log unreadable)" : "compactions unavailable (unrecognized compaction record)";
	}
	const stats = foldCompactions(feed.records);
	const total = stats.summarized + stats.pruned;
	const failure = stats.failed === 0
		? ""
		: stats.lastError === undefined
			? (zh ? `，失败 ${stats.failed} 次` : `, failed ${stats.failed}`)
			: (zh ? `，失败 ${stats.failed} 次：${stats.lastError}` : `, failed ${stats.failed}: ${stats.lastError}`);
	if (total === 0) {
		// "no compaction recorded" is false when an attempt failed; the two zero lines say different things.
		const empty = stats.failed === 0
			? (zh ? "压缩 0 次（未记录压缩）" : "compactions 0 (no compaction recorded)")
			: (zh ? "压缩 0 次（没有成功的压缩）" : "compactions 0 (no successful compaction)");
		return `${empty}${failure}`;
	}
	const shadowed = stats.lastSuccess?.shadowedTokens;
	const shadowedText = shadowed === undefined
		? ""
		: (zh ? `，最近回收 ${shadowed} token` : `, last shadowed ${shadowed} tokens`);
	const provider = stats.lastSuccess?.provider;
	const model = stats.lastSuccess?.model;
	const route = provider === undefined || model === undefined ? "" : (zh ? `，${provider}/${model}` : `, ${provider}/${model}`);
	return zh
		? `压缩 ${total} 次（摘要 ${stats.summarized} 次、prune ${stats.pruned} 次）${shadowedText}${route}${failure}`
		: `compactions ${total} (summarized ${stats.summarized}, pruned ${stats.pruned})${shadowedText}${route}${failure}`;
}
