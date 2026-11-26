/**
 * project-autolearn — the skill-distillation feature (pass ③).
 *
 * Low-frequency pass over `.agents/memory/CONTEXT.md` + `MEMORY.md` plus the
 * mechanical session index; when those documents lack the concrete steps it
 * backtracks into the archived sessions named by the index, reading each one's
 * canonical `session.jsonl` rather than its rendered `session.md`. Output is
 * `.agents/skills/<name>/SKILL.md`; dsh discovers skills natively, so only the
 * description enters the prompt while the body loads on demand.
 *
 * Commands: /autolearn
 *
 * The body is `start.ts`: this file is the cordis entry and nothing else.
 */
import type { Context } from "../host/contract.js";
export declare const name = "project-autolearn";
/**
 * The skills card: the Host projects a settings form from this schema, keyed by this entry's id.
 * Every field carries the `volatile` mark — schemastery drops a schema whose fields are all
 * ordinary, and the card would then disappear with no error anywhere.
 */
export declare const Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<{
    autolearnEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    autolearnExpireSkills: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    autolearnTurns: import("@deepseek-ai/schemastery").default<number, number>;
    autolearnIntervalMs: import("@deepseek-ai/schemastery").default<number, number>;
}>, Schemastery.ObjectT<{
    autolearnEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    autolearnExpireSkills: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    autolearnTurns: import("@deepseek-ai/schemastery").default<number, number>;
    autolearnIntervalMs: import("@deepseek-ai/schemastery").default<number, number>;
}>>;
export declare const inject: string[];
/**
 * Cordis entry: resolve this card's four keys and hand the core a façade over this context.
 * It publishes nothing; `start.ts` overlays the shared ten from the archive entry's publication.
 * @param ctx - the plugin context.
 * @param rawConfig - the raw config the Loader passed.
 */
export declare function apply(ctx: Context, rawConfig: unknown): void;
