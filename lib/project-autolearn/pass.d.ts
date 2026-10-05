/**
 * The pass itself: one throttled, single-flight distillation per project.
 */
import { type Context } from "@deepseek-ai/cordis";
import { type Agent } from "@deepseek-ai/dsh-agent";
import { type PluginConfig } from "../shared/config.js";
import { type LearnedSkill } from "./skill.js";
export interface AutolearnOptions {
    force?: boolean;
    signal?: AbortSignal;
}
export interface AutolearnOutcome {
    skill: LearnedSkill | null;
    /** Archived session ids read during backtracking (empty when memory/context sufficed). */
    backtracked: string[];
    /** True when `skill` was stored as a candidate awaiting `/autolearn approve`. */
    candidate: boolean;
    /**
     * Why the model's proposal was not written, when there was one and the admission rules refused
     * it (e.g. `body too short`). `undefined` means the model proposed nothing at all.
     *
     * The two used to be indistinguishable — `{skill: null, backtracked: [], candidate: false}` for
     * both — so `/autolearn` told the user "No new skill was warranted." after a paid model call
     * that had in fact *returned a skill* the plugin rejected on a size/evidence rule. That sends
     * the user to re-prompt a model that already answered.
     */
    rejected?: string | undefined;
    /**
     * Why no model call was made, when the pass declined to run one (a pass ran moments ago, there is
     * no memory/context to learn from, or no archived session grounds a skill).
     *
     * Without this, those paths returned the same `{skill: null, backtracked: [], candidate: false}`
     * as "the model answered and proposed nothing", so a reply that talks about what the model did
     * would be *false* here — the model was never asked. Kept separate from `rejected`, which means
     * the model *did* answer and an admission rule refused its proposal.
     */
    skipped?: string | undefined;
}
/**
 * Run one autolearn pass. Automatic runs require new material (MEMORY.md or
 * CONTEXT.md touched since the last pass) plus one open cadence gate (turn
 * count across sessions or wall-clock interval). Commands force the pass.
 */
export declare function autolearnProjectSkills(ctx: Context, agent: Agent, config: PluginConfig, options?: AutolearnOptions): Promise<AutolearnOutcome | undefined>;
