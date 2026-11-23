/**
 * The consolidation prompt's prose: every rule the model is given, and the numbers it is given with.
 *
 * Split out of `consolidate.ts` (RULES 3.2). The budgets are read from the renderer's own tables
 * (`memorySectionBudgets`, `contextSectionBudgets`), so the prompt cannot drift from what is stored.
 */
import { type PluginConfig } from "../shared/config.js";
import { type MemoryEntryState } from "./entry-states.js";
import { type MemorySectionOverage } from "./sections.js";
/**
 * The cross-project boundary, stated as a rule.
 *
 * The pass hands the model the whole session conversation and asks it to regenerate the documents
 * from that, so a session that quotes a sibling repository's state (its sizes, counts, research
 * values) writes it into this project's memory — hand-cleaning does not hold, because the next pass
 * writes it again. Naming another project stays legal for recording who owns an open item: this repo
 * keeps exactly those pointers on purpose.
 */
export declare const FOREIGN_STATE_RULE = "Write only durable facts about this project itself. Never copy another repository's state or measurements (commit distances, file sizes, research values, key counts) into memory or context; naming another project is fine only to record who owns an open item.";
/**
 * The same boundary where the foreign text actually enters: the first line inside
 * `<recent-conversation>`, which is the block built from the session's own transcript.
 */
export declare const CONVERSATION_CAPTION = "[This session's working state. It may quote other projects and their numbers; those are not memory material \u2014 write only durable facts about this project.]";
/**
 * The fixed instructions of the consolidation prompt. Exported so a test can assert the shape
 * contract the model is actually given: naming the `context` keys without their types is what let
 * a mis-shaped reply hollow out CONTEXT.md silently.
 */
export declare const CONSOLIDATION_PROMPT_RULES: readonly string[];
/**
 * The compression ladder both prompt layers state (batch L, ported from pi v0.4.4).
 *
 * The sentence this replaces — "When over budget, merge duplicates within a section, then drop the
 * least durable entries" — was the only permission the prompt gave for an overflow, and it made
 * deletion the closing step. Measured on 2026-10-06, this repo's memory sat at 98.8% / 97.9% of two
 * section budgets, one added line away from a whole-entry drop, and the tier C retry that fires on
 * exactly that loss repeated the same instruction — asking for the loss the gate refuses.
 * Compression is now the default and a deletion has to name a reason; one constant, so the two
 * layers cannot drift apart.
 */
/**
 * The entry-id convention, stated where the model writes entries (batch Z2).
 *
 * The id has to be copied verbatim: it is what a `supersedes:` declaration points at and what a
 * tombstone names, and an id the model invents would either collide with a live entry or name nothing.
 * The replacement instruction is one sentence because the mechanical half — retiring the named entry —
 * is the pass's job, not the model's: asking the model to also delete the old entry is the behaviour
 * that failed before this existed.
 */
export declare const MEMORY_ENTRY_ID_RULE = "Every entry ends with its id in a full-width parenthetical, e.g. `\u2026 durable fact\uFF084f2\uFF09`. When you keep an entry, keep its id exactly as given. Do not invent an id for a new entry and do not add one to an entry that has none. To replace an entry, write the replacement and end it with `supersedes:<old id>`; the old entry is retired automatically, so do not repeat it.";
export declare const MEMORY_KEEP_RULE = "Keep every entry that is still true and make each section fit its stated target above: merge duplicates within a section, deduplicate across sections. A section still over its target is fixed by removing phrasing that repeats elsewhere in the document \u2014 not by compressing a fact's wording and not by dropping a fact. Delete an entry only when it is superseded or another entry already states the same fact, never to make room for a new one.";
/**
 * The same rule at the block whose text the reply rewrites (pi's second layer): the material arrives
 * with the instruction attached, rather than only in the rules above it.
 *
 * It used to end "fixed by condensing its wording, not by dropping entries", and that clause is the
 * licence the silent loss took: a pass that shortens every entry a little reports no structural loss
 * (tier C counts whole entries) while literals leave, which is why the rewrite measure exists
 * (`missing-literals.ts`). The cheap move is the opposite order, so the caption names it.
 */
export declare const MEMORY_SURVIVAL_CAPTION = "The existing-memory block below is what has to survive this pass: every entry that is still true must reappear unless it is superseded or another entry already states it, and a document that does not fit its cap is fixed by merging duplicates and pointing at a skill or document the entry itself already names \u2014 not by dropping entries and not by shortening a still-true entry's wording.";
/**
 * The memory layout the pass actually writes, stated with the real per-section budgets.
 *
 * The stored memory carries these exact sections in this order. `renderMemoryDocument` treats each
 * section's share as a target rather than a cap: it pools what an under-target section leaves and lends
 * it to the over-target ones, dropping whole entries only when the whole document reaches
 * `maxMemoryChars`. The cap is per project, so the section budgets have to be built per pass instead of
 * sitting in the static rules — and like `memoryBudgetRule`, every number here is in characters.
 *
 * Each section states two numbers: the figure the prompt asks for, and the share it expects to take.
 * The gap is deliberate — a reply written to the share spends the headroom the next pass needs, and the
 * model cannot count characters — so the target, not the share, is what the model is told to aim at.
 * Both come from the one table so neither can drift.
 */
export declare function memorySectionRule(maxMemoryChars: number): string;
/**
 * The memory bound the pass actually enforces, stated with the real numbers.
 *
 * A word hint is not the enforced bound: the document is cut at `maxMemoryChars` **characters** on
 * write, so a reply that satisfies a word count can still lose whatever sat at the end — and the
 * model had no way to know. The cap is per project, so the line has to be built per pass. The
 * per-section figures above are targets the renderer may exceed by borrowing, so the cap is named here
 * as the only hard limit.
 */
export declare function memoryBudgetRule(maxMemoryChars: number, currentChars: number): string;
/**
 * The order a full document is bought back in.
 *
 * The previous rule said a full document is fixed "by condensing its wording", and that is the move
 * that loses detail: a rewrite that shortens every entry reports no structural loss while literals
 * vanish (the rewrite measure exists because of it). The measured cheap move is the opposite order —
 * merge true restatements, then fold a procedure into a pointer at the skill, document, CHANGELOG
 * entry or test that owns it, which keeps the fact reachable for a fraction of its characters. The
 * pointer may only name a home the entry *already* names: the pass reads no files, so an instruction
 * to "point at the skill that owns this" would invite an invented path. Deleting stays last and only
 * for an entry something else already supersedes.
 */
export declare const MEMORY_RETENTION_LADDER = "The document is at or near its cap, so buy room in this order: merge entries that restate one fact; then replace an entry that already names the skill, tracked document, CHANGELOG entry or test holding its procedure with one sentence that keeps that name and drops the steps. Never shorten a still-true entry's wording to buy room, and delete only an entry that is superseded.";
/**
 * The one transition the system may fire on its own (batch AA2b).
 *
 * Every other change of an entry's state is either mechanical (the retirement engine) or a human's
 * (`/memory reconcile --accept`). This is the third: the pass is handed the entries whose evidence says
 * they may no longer hold, and told the two things it may do with them — update an entry the conversation
 * explains, or leave it alone. The prohibitions are the load-bearing half: the pass reads no files
 * (`MEMORY_SURVIVAL_CAPTION` says so too), so "point at where this moved" would invite an invented path,
 * and deleting a still-true entry is the loss class tier C and the rewrite measure exist to catch.
 *
 * Reasons, not just file drift: `task-closed` and `version-shipped` are settled by the disk and cannot be
 * seen by a fingerprint, so the wording names the state and its evidence rather than assuming bytes.
 * @param entries - the non-healthy entries the arbiter reported, in document order.
 * @returns the rule, or `""` when there is nothing to report.
 */
export declare function memoryExpiryRule(entries: readonly MemoryEntryState[]): string;
/**
 * The expiry rule for this pass, or `""` when the pass should not spend the tokens.
 *
 * Only near the cap: below it the document has room, and naming possibly-stale entries invites a rewrite
 * of a fact that is still true for no gain. A failed measurement is a skipped hint, never a failed pass —
 * but it is logged, because a hint that silently stopped appearing is indistinguishable from a healthy
 * document. The same threshold the retention ladder uses, so one number moves both.
 */
export declare function expiryRuleFor(projectRoot: string, text: string, config: PluginConfig): Promise<string>;
/** The one retry a cut-off reply is allowed. Kept as a constant so a wording regression is visible. */
export declare const TRUNCATED_REPLY_RULE = "Your previous reply was cut off by the model output limit. Retry this same consolidation now without the tool: return exactly one complete JSON object with string memory_markdown and object context, making memory_markdown shorter by merging duplicates and pointing at a home an entry already names \u2014 never by compressing a still-true entry and never by dropping a fact.";
/**
 * The targeted retry a complete-but-lossy reply is allowed (tier C).
 *
 * The reply was usable and the model simply over-filled a section, which a second, specific
 * instruction can fix — that is the whole difference between tier C and tier B. The rule names
 * sections and counts only: the previous reply is not an input to it, so it can neither leak a
 * section's text into the prompt nor invite a rewrite from memory.
 *
 * @param overage - what each section would give up, from `memorySectionOverage`.
 * @param writeCapDroppedChars - characters the memory cap would drop from the reply, 0 when it fits.
 */
export declare function memoryLossRetryRule(overage: readonly MemorySectionOverage[], writeCapDroppedChars: number): string;
