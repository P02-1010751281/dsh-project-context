/**
 * The consolidation pass's data shapes.
 *
 * Split out of `consolidate.ts` so the prompt half and the reply half can both name them without
 * importing each other, and so no single module carries the pass's 1200 lines (RULES 3.2).
 */

import type { ConsolidationResult } from "../shared/reply-json.js";
import type { Tombstone } from "./retired.js";
import type { MemorySections } from "./sections.js";

/**
 * Which entry produced the memory this pass would write, or `"none"` when the pass was refused before
 * any model call (the read-cap gate): there is no reply, so nothing produced the document.
 */
type ConsolidateKind = "structured" | "fallback-sections" | "fallback-opaque" | "merged-partial" | "unmergeable-partial" | "none";

/** A reply read into the shape this pass writes: the sections when it had them, plus the context. */
export type ResolvedReply = {
	kind: ConsolidateKind;
	sections?: MemorySections;
	result: ConsolidationResult;
	/** For a merged partial reply (batch Q2): the headings the stored document contributed. */
	mergedFromStore?: string[];
	/** Why an unmergeable partial reply was refused (batch Q2): which side could not be read. */
	partialRefusal?: PartialRefusalReason;
};

/**
 * Which half of batch Q2's merge could not be read: the stored document (nothing to merge into) or the
 * reply itself. The two are different causes with different levers, so the refusal names one of them
 * rather than collapsing both into "the reply was partial" — which is false for a complete document
 * whose sections are not plain `- ` entries.
 */
export type PartialRefusalReason = "store-not-sections" | "reply-not-sections";

/** A consolidation result plus a monotonic version so each plugin writes a given pass at most once. */
export type ConsolidationOutcome = {
	result: ConsolidationResult;
	version: number;
	// A pass-level "the model was shown a shortened view" flag and the two hidden-character counts it
	// summarized used to live here. Both input gates now refuse before the model call
	// (`readCappedRefused` / `fitCappedRefused`), so no outcome that ever reached a model call could
	// carry them. Of the shortenings that remain, only the gate refusals produce an outcome, and each
	// carries its own counts. The truncation retry's fit never becomes an outcome at all: it is either
	// not sent (logged with its own hidden count) or sent with `clipped === false`.
	/**
	 * The memory this pass's prompt was built from, byte for byte. The write path refuses a reply
	 * whose baseline no longer matches what is stored: publishing it would overwrite a newer edit.
	 */
	basisKey: string;
	/**
	 * The memory the model was actually shown, which is not `basisKey` once batch Z2's plan retired an
	 * entry before the prompt was built: a deliberate retirement is a deletion this pass already made
	 * and reported, so it must not come back as an unexplained lost fact. The rewrite loss measure
	 * compares the landed document against this view, not against the store.
	 */
	shownMemory: string;
	/**
	 * The context the model was actually shown, the baseline of the same rewrite-loss measure the memory
	 * half already takes. It is not always the stored bytes: `fitMemoryInput` may shorten the context
	 * head-and-tail, and a pass that would be shortened is refused — so for every pass that lands this
	 * equals the file the reply replaced, and the value is carried anyway rather than re-read at the
	 * write site, where a concurrent writer could have replaced it in between.
	 */
	shownContext: string;
	/**
	 * Which entry the memory came from. Reported for diagnostics and tests; no receipt reads it yet,
	 * so a pass is never worded differently because of it.
	 */
	kind: ConsolidateKind;
	/** No section held an entry worth storing, so the memory must not be written at all. */
	semanticEmpty: boolean;
	/**
	 * The task this pass wrote for, when the session is bound to one. Absent means the project-level
	 * `CONTEXT.md` — the pre-task behaviour, byte for byte. The write path reads this rather than the
	 * session metadata again, so the file the prompt was built from is the file the reply replaces.
	 */
	taskSlug?: string;
	/** Sections that lost at least one entry to their budget. */
	sectionDropped: number;
	/** Entries dropped because their section's budget was full. */
	droppedItems: number;
	/** Entries clipped to their section's per-item cap. */
	itemTruncated: number;
	/**
	 * Characters of this reply the memory cap would drop on write, measured here rather than at the
	 * write so the loss can be retried and refused like any other. The write path measures the landed
	 * value separately; this one describes the reply tier C decided about.
	 */
	memoryWriteCapDroppedChars: number;
	/**
	 * True when tier C refused this reply: it would have been stored lossily and the one targeted
	 * retry did not fix it, so the write must not happen and the stored memory stays effective.
	 */
	memoryLossyRefused: boolean;
	/**
	 * The `maxMemoryChars` this outcome was measured under.
	 *
	 * A cached outcome is re-reported as it stands — the throttled path serves it without re-running —
	 * so a caller that names "the cap" must read this, not the config in force at report time, or it
	 * names a cap that never measured the loss it is describing.
	 */
	maxMemoryChars: number;
	/**
	 * True when batch Q2's guard refused this reply: it carried our document shape but could not be
	 * merged into the stored one, so writing it would have replaced content this pass cannot account
	 * for. The write must not happen; the refusal is logged where it is decided.
	 */
	partialRefused: boolean;
	/** Which half of the merge could not be read, when `partialRefused` is set. */
	partialRefusal?: PartialRefusalReason;
	/** Headings the stored document contributed to a merged partial reply (batch Q2); empty otherwise. */
	mergedFromStore: string[];
	/**
	 * Invariants/Pitfalls entries the reply no longer carries (batch Q2's report layer). Reported, never
	 * blocking: a compression pass is supposed to drop entries, and refusing that would be permanent.
	 */
	removedEntries?: { count: number; samples: string[] };
	/**
	 * Entries this pass put back verbatim because the reply dropped them and their literals went with
	 * them (`lost-entry-repair.ts`). `removedEntries` is measured after the repair, so the two never
	 * describe the same entry: what is still listed there was not restored.
	 */
	restoredEntries?: { count: number; samples: string[] };
	/**
	 * Entries the repair found lost but could not put back without the renderer dropping something
	 * else. Reported so a document that stays lossy after the repair is never silent.
	 */
	unrestoredEntries?: { count: number; samples: string[] };
	/**
	 * Set when the pass refused before the model call because the read cap had shortened the stored
	 * document: the view was incomplete, so a reply built from it would have deleted everything the cap
	 * kept back, and tier C would have called that write clean — it measures a reply against a cap the
	 * reply does fit. The numbers are this pass's own, so a cached refusal re-reported under a raised
	 * `maxMemoryChars` cannot name the wrong cap.
	 */
	readCappedRefused?: { cap: number; memoryHiddenChars: number; contextHiddenChars: number };
	/**
	 * Set when the pass refused before the model call because the output budget could not hold both
	 * documents whole: `fitMemoryInput` shortened them head-and-tail, and a reply built from that view
	 * replaces the stored file with it — the same deletion `readCappedRefused` exists to prevent, one
	 * budget further out. Separate from it because the levers differ: the read cap is `maxMemoryChars`
	 * (or the stored document), while this one is `maxOutputTokens` (or both documents), and a receipt
	 * that named the wrong knob would be a dead lever.
	 */
	fitCappedRefused?: { maxOutputTokens: number; memoryHiddenChars: number; contextHiddenChars: number };
	/**
	 * Batch Z2's retirement pass, present only when this reply would actually be stored.
	 *
	 * The tombstones describe a deletion that has not been written yet: a pass refused by tier C or by
	 * the basis-key race deletes nothing, so recording them would claim a fact was retired while it is
	 * still in `MEMORY.md`. `added` carries the first-seen date of every id the landed document owns, and
	 * `ids` carries that same prune set (see `RetirementResult.keepIds`) — a partial stamp's unstamped
	 * entries are in the document too, so their clocks must survive the prune.
	 */
	retirement?: { tombstones: Tombstone[]; added: [string, string][]; ids?: string[] };
};

