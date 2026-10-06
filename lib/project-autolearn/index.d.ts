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
 */
import type { Context } from "@deepseek-ai/cordis";
export declare const name = "project-autolearn";
export declare const inject: string[];
export declare function apply(ctx: Context, rawConfig: unknown): void;
