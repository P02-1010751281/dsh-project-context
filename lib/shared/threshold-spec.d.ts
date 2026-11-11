/**
 * The one reader of the user's `handoffThreshold` setting, and the only place the accepted spellings
 * are defined.
 *
 * The setting names **one fact** — where the handoff trigger sits — and that fact has three shapes:
 * `auto` (the guardrail decides), a fraction of the window, or an absolute token count. Before this
 * module the fact was two keys (`handoffThresholdAuto` + `handoffThresholdRatio`), which forced every
 * surface to know the pair and made an absolute count inexpressible at all; the `/handoff threshold
 * 400k` answer was "needs auto or a ratio between 0.1 and 0.95", which is a refusal that misnames its
 * own reason (a token count is a legal trigger, just not a fraction).
 *
 * The two spellings that collide are `40` — a ratio, as it has always been — and `400000`, a token
 * count. They are told apart by the legal ranges themselves rather than by new syntax: a bare number at
 * or below `1` is a fraction, at or below `95` a percentage, and above that only a token count can be
 * meant because no legal ratio reaches it. `k` always reads as thousands, and a trailing `%` always
 * reads as a ratio, so `400k` and `40%` stay unambiguous.
 */
/** One threshold setting: the guardrail, a window fraction, or an absolute token count. */
export type ThresholdSpec = {
    readonly mode: "auto";
} | {
    readonly mode: "ratio";
    readonly ratio: number;
} | {
    readonly mode: "tokens";
    readonly tokens: number;
};
/**
 * Parse a token count: `12k`, `12000` or `0`.
 *
 * Shared by the threshold spells and the two budget settings so an absolute count means the same thing
 * on every surface. `0` is accepted here — the budgets use it as "carry nothing" — and rejected by the
 * threshold spell, where no zero-token trigger can exist.
 * @param input - the text a user typed.
 * @returns the count, or `undefined` when the text is not a count.
 */
export declare function parseTokenCount(input: string): number | undefined;
/**
 * Read one `handoffThreshold` value.
 *
 * Ratio spellings are delegated to {@link parseRatioInput} — the same reader the settings card used
 * before the merge — so `0.4`, `40` and `40%` keep meaning exactly what they meant, and the bounds live
 * in one place. Only the token branch is new here.
 * @param input - the stored value or the text a user typed.
 * @returns the spec, or `undefined` when the text is not one of the three shapes.
 */
export declare function parseThresholdSpec(input: string): ThresholdSpec | undefined;
/**
 * The canonical stored spelling of a spec.
 *
 * `tokens` is written as a plain count rather than `400k` so the stored value re-parses without
 * depending on the suffix rule; a ratio keeps the decimal form (`0.4`), which is what the settings
 * document held before the merge.
 * @param spec - the spec to write.
 * @returns the value to store.
 */
export declare function formatThresholdSpec(spec: ThresholdSpec): string;
/**
 * Every accepted spelling, for the three surfaces that have to explain a refusal (the command, the
 * config validator and the settings card) without writing the grammar a fourth time.
 * @returns a one-line description of the value space.
 */
export declare function thresholdSpecHelp(): string;
