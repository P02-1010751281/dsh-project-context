/**
 * The one reader of a user-typed window fraction, shared by the `/handoff threshold` command and the
 * settings card. (The two threshold keys were merged into `handoffThreshold` in batch Z8e; this is the
 * ratio branch of `parseThresholdSpec`, kept here because the folding rule is its own fact.)
 *
 * Three spellings mean the same ratio — `0.4`, `40` and `40%` — and the rule that folds them is
 * *one* rule, not a copy per input surface. A second copy is how a card ends up accepting a draft
 * that the validator then drops on the next load, which is the defect this module exists to prevent:
 * before it, the command folded `40` to `0.4` while the card's number field passed `40` through
 * untouched and the Host rejected the write (the save failed with no explanation the user could act
 * on).
 */
/**
 * Fold a typed ratio into the number the settings document stores.
 *
 * A percent sign is stripped, a value above `1` is read as a percentage (`40` → `0.4`), and the
 * result must land inside the accepted pair — the same inclusive bounds the settings schema and the
 * config validator read, so accepted input always persists.
 * @param input - the text a user typed, e.g. `"0.4"`, `"40"` or `"40%"`.
 * @returns the ratio, or `undefined` when the text is not a value the Host would keep.
 */
export declare function parseRatioInput(input: string): number | undefined;
