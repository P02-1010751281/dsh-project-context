/**
 * Project-local autolearn gate state.
 *
 * The autolearn throttle needs one fact to outlive the process: when the last
 * pass ran. Kept in memory, every restart forgets the gate and runs a pass again
 * on material that was already distilled, and the "new material" comparison has
 * no baseline to compare against. Kept in the project (rather than in dsh
 * settings), the gate travels with the repository, exactly like the memory and
 * the archive it guards — and like pi's persisted `autolearnAt`.
 *
 * Storage: `<project>/.agents/memory/autolearn-state.json`
 */

import path from "node:path";
import { memoryDir, readOptional, writeAtomic } from "./project-state.js";

export interface LearnState {
	/** Epoch ms of the first model call of the last recorded pass; 0 when none was ever recorded. */
	autolearnAt: number;
}

const EMPTY_STATE: LearnState = { autolearnAt: 0 };

export function learnStateFile(projectRoot: string): string {
	return path.join(memoryDir(projectRoot), "autolearn-state.json");
}

/** Accept only a usable epoch-ms timestamp; anything else means "not recorded". */
function timestamp(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
}

function normalizeState(raw: unknown): LearnState {
	const value = raw !== null && typeof raw === "object" && !Array.isArray(raw)
		? (raw as { autolearnAt?: unknown }).autolearnAt
		: undefined;
	return { autolearnAt: timestamp(value) ?? 0 };
}

/**
 * Read the gate.
 *
 * A missing, unreadable, or corrupt file reads as "never ran" instead of
 * throwing: the gate is an optimization, and a damaged state file must never
 * block — let alone fail — a pass that could still learn something.
 * @param projectRoot - resolved project root that owns the state file.
 * @returns the stored state, or the empty state when there is nothing usable.
 */
export async function readLearnState(projectRoot: string): Promise<LearnState> {
	const raw = await readOptional(learnStateFile(projectRoot));
	if (!raw.trim()) return { ...EMPTY_STATE };
	try {
		return normalizeState(JSON.parse(raw));
	} catch {
		return { ...EMPTY_STATE };
	}
}

/**
 * Read-modify-write one patch of the state file, published atomically.
 *
 * A failed write is swallowed and the intended state is still returned: losing
 * the gate only costs one extra pass, while throwing here would lose the pass
 * that just ran.
 * @param projectRoot - resolved project root that owns the state file.
 * @param patch - fields to merge over the current state.
 * @returns the state that was written (or would have been).
 */
export async function updateLearnState(projectRoot: string, patch: Partial<LearnState>): Promise<LearnState> {
	const current = await readLearnState(projectRoot);
	const next: LearnState = { autolearnAt: timestamp(patch.autolearnAt) ?? current.autolearnAt };
	try {
		await writeAtomic(learnStateFile(projectRoot), `${JSON.stringify(next)}\n`);
	} catch {
		// Best effort: see the contract above.
	}
	return next;
}

/**
 * Record the gate timestamp of a pass. Called after the first model call, so a
 * crash before it re-runs the pass on the next idle and a completed pass does not.
 * @param projectRoot - resolved project root that owns the state file.
 * @param at - epoch ms of the pass; defaults to now.
 */
export async function markAutolearnAt(projectRoot: string, at: number = Date.now()): Promise<void> {
	await updateLearnState(projectRoot, { autolearnAt: at });
}
